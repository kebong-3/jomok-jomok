import { cassette } from '@/data/cassettes';
import { loadSettings, type Settings } from './settings';
import type { KnowledgeRecord } from './knowledge';
import { AI_CLIENT_TIMEOUT_MS, type AiProgressEvent } from './ai-protocol';

export interface AiResult<T> {
  data: T;
  knowledge?: KnowledgeRecord;
  via: 'live' | 'cassette';
  model?: string;
  modelLabel?: string;
  actualModel?: string;
  family?: string;
  ms: number;
  note?: string;
  trace?: { promptVersion?: string; tokens?: number; repairs?: number; fallbacks?: string[]; actualModel?: string; family?: string };
}

export class AiUnavailable extends Error {
  constructor(message: string, public code = 'AI_UNAVAILABLE') { super(message); }
}

/** 선택한 연결의 값만 전송한다. 미입력 상태를 서버 공용키로 바꾸지 않는다. */
export function aiHeaders(s: Settings = loadSettings()): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', 'x-user-connection': s.connection };
  if (s.connection === 'byok') {
    if (!s.byokKey?.trim()) throw new AiUnavailable('내 키가 비어 있습니다. 설정·진단에서 키를 입력하거나 기본 연결을 선택하세요.', 'NO_KEY');
    headers['x-user-key'] = s.byokKey.trim();
    headers['x-user-model'] = s.byokModelId ?? 'gptoss-120b@groq';
  } else if (s.connection === 'org') {
    if (!s.orgBaseURL?.trim() || !s.orgModel?.trim()) throw new AiUnavailable('기관 서버 주소와 모델 이름을 모두 입력하세요.', 'BAD_REQUEST');
    headers['x-user-key'] = s.orgKey?.trim() || 'none';
    headers['x-user-model'] = 'custom';
    headers['x-user-baseurl'] = s.orgBaseURL.trim();
    headers['x-user-modelname'] = s.orgModel.trim();
  }
  return headers;
}

export interface CallRoleOptions {
  sampleId?: string; modelId?: string; cassetteKey?: string; tapeRole?: string;
  strictModel?: boolean; allowCassette?: boolean; signal?: AbortSignal;
  onProgress?: (progress: AiProgressEvent) => void;
}

/** Read server heartbeat frames without treating them as model output. */
export async function readAiResponse(res: Response, onProgress?: CallRoleOptions['onProgress']): Promise<unknown> {
  if (!res.headers.get('content-type')?.includes('application/x-ndjson')) return res.json().catch(() => null);
  if (!res.body) throw new AiUnavailable('AI 응답 연결이 끊겼습니다. 저장된 내용을 확인하고 이어서 실행하세요.', 'LLM_INTERRUPTED');
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '', bytes = 0, result: unknown;
  const line = (raw: string) => {
    if (!raw.trim()) return;
    let frame: Record<string, unknown>;
    try { frame = JSON.parse(raw); } catch { throw new AiUnavailable('AI 진행 응답의 형식을 확인하지 못했습니다. 저장된 내용을 확인하고 다시 실행하세요.', 'LLM_SCHEMA'); }
    if (frame.type === 'error') {
      const error = frame.error as { code?: string; message?: string } | undefined;
      throw new AiUnavailable(error?.message || 'AI 실행을 완료하지 못했습니다.', error?.code || 'LLM_HTTP');
    }
    if (frame.type === 'result') result = frame.result;
    if (frame.type === 'progress' && frame.progress && typeof frame.progress === 'object') onProgress?.(frame.progress as unknown as AiProgressEvent);
  };
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) { buffer += decoder.decode(); if (buffer.trim()) line(buffer); break; }
      bytes += value.byteLength;
      if (bytes > 4_000_000) throw new AiUnavailable('AI 응답이 허용 크기를 넘었습니다.', 'LLM_SCHEMA');
      buffer += decoder.decode(value, { stream: true });
      let end: number;
      while ((end = buffer.indexOf('\n')) >= 0) { line(buffer.slice(0, end)); buffer = buffer.slice(end + 1); }
    }
  } catch (error) { await reader.cancel().catch(() => undefined); throw error; }
  finally { reader.releaseLock(); }
  if (result === undefined) throw new AiUnavailable('AI 응답 연결이 완료 전에 끊겼습니다. 저장된 조문은 유지됩니다. 남은 조문을 이어서 작성하세요.', 'LLM_INTERRUPTED');
  return result;
}

export async function callRole<T>(role: string, vars: Record<string, string>, opts: CallRoleOptions = {}): Promise<AiResult<T>> {
  const s = loadSettings();
  if (opts.signal?.aborted) throw new AiUnavailable('AI 작성을 중단했습니다. 이미 저장한 내용은 유지됩니다.', 'AI_CANCELLED');
  const t0 = performance.now();
  const tape = () => {
    if (opts.allowCassette === false || opts.strictModel) return undefined;
    const c = cassette(opts.sampleId, opts.tapeRole ?? role) as Record<string, unknown> | undefined;
    return c ? (opts.cassetteKey ? c[opts.cassetteKey] as T : c as T) : undefined;
  };
  if (s.forceCassette && opts.sampleId && !opts.strictModel && opts.allowCassette !== false) {
    const data = tape();
    if (data) return { data, via: 'cassette', ms: 0, note: '예시 응답 모드입니다. 실제 AI를 호출하지 않았습니다.' };
  }
  try {
    if (opts.signal?.aborted) throw new AiUnavailable('AI 작성을 중단했습니다. 이미 저장한 내용은 유지됩니다.', 'AI_CANCELLED');
    const timeout = AbortSignal.timeout(AI_CLIENT_TIMEOUT_MS);
    const res = await fetch('/api/llm', {
      method: 'POST', headers: { ...aiHeaders(s), Accept: 'application/x-ndjson' },
      body: JSON.stringify({ role, vars, modelId: opts.modelId ?? s.modelId, strictModel: opts.strictModel ?? !!s.modelId }),
      signal: opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout,
    });
    const j = await readAiResponse(res, opts.onProgress) as { data?: T; knowledge?: KnowledgeRecord; error?: { code?: string; message?: string }; trace?: AiResult<T>['trace'] & { model?: string; modelLabel?: string; family?: string; actualModel?: string } } | null;
    if (opts.signal?.aborted) throw new AiUnavailable('AI 작성을 중단했습니다. 이미 저장한 내용은 유지됩니다.', 'AI_CANCELLED');
    if (!res.ok) throw new AiUnavailable(j?.error?.message ?? (res.status === 504 ? 'AI 실행 시간이 지났습니다. 잠시 후 다시 실행하세요.' : `서버가 AI 요청을 처리하지 못했습니다(HTTP ${res.status}). 설정·진단에서 확인하세요.`), j?.error?.code ?? `HTTP_${res.status}`);
    if (!j || j.data == null || !j.trace?.model) throw new AiUnavailable('AI 응답을 확인할 수 없습니다. 설정·진단에서 다시 시험하세요.', 'LLM_SCHEMA');
    if (typeof window !== 'undefined') window.dispatchEvent(new Event('jj:models-changed'));
    const fallbacks: string[] = j.trace.fallbacks ?? [];
    return { data: j.data as T, knowledge: j.knowledge, via: 'live', model: j.trace.model, modelLabel: j.trace.modelLabel, actualModel: j.trace.actualModel, family: j.trace.family,
      trace: j.trace, ms: Math.round(performance.now() - t0), note: fallbacks.length ? `앞선 모델 ${fallbacks.join(', ')} 호출 실패 후 ${j.trace.modelLabel}로 실행했습니다.` : undefined };
  } catch (e) {
    if (opts.signal?.aborted || (e instanceof AiUnavailable && ['AI_CANCELLED', 'LLM_CANCELLED'].includes(e.code))) throw new AiUnavailable('AI 작성을 중단했습니다. 이미 저장한 내용은 유지됩니다.', 'AI_CANCELLED');
    const message = (e as Error).name === 'TimeoutError' ? '이번 AI 요청의 연결 시간이 지났습니다. 저장된 조문은 유지됩니다. 남은 조문을 이어서 작성하거나 설정·진단에서 연결을 확인하세요.' : (e as Error).message;
    const data = tape();
    if (data) return { data, via: 'cassette', ms: Math.round(performance.now() - t0), note: `${message} 현재 결과는 미리 작성한 예시입니다.` };
    throw e instanceof AiUnavailable ? e : new AiUnavailable(message);
  }
}
