import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST, maxDuration } from '@/app/api/llm/route';
import { runRole, LlmError } from '@/server/llm';
import { callRole, readAiResponse } from '@/lib/ai';
import { AI_CLIENT_TIMEOUT_MS, AI_REQUEST_BUDGET_MS } from '@/lib/ai-protocol';

vi.mock('@/server/llm', async importOriginal => ({ ...await importOriginal<typeof import('@/server/llm')>(), runRole: vi.fn() }));
const run = vi.mocked(runRole);
const result = { data: { articles: [{ title: '목적', paragraphs: ['검증용 조문이다.'] }] }, trace: { model: 'test', modelLabel: '검증 모델', actualModel: 'provider-test', family: 'other' as const, latencyMs: 70000, repairs: 0, promptVersion: 'test', fallbacks: [] } };
function request(stream = true) { return new Request('https://app.test/api/llm', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(stream ? { Accept: 'application/x-ndjson' } : {}) }, body: JSON.stringify({ role: 'enact_draft', vars: { kind: '지침', title: '검증', outline: '제1조(목적)', institution: '시험기관' } }) }); }
beforeEach(() => { run.mockReset(); run.mockResolvedValue(result); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('긴 AI 응답의 연결 유지와 완료 구분', () => {
  it('300초 서버 한도 안에서 생성하고 브라우저는 서버보다 먼저 잘라내지 않는다', () => {
    expect(maxDuration).toBe(300);
    expect(AI_REQUEST_BUDGET_MS).toBeLessThan(maxDuration * 1000);
    expect(AI_CLIENT_TIMEOUT_MS).toBeGreaterThan(maxDuration * 1000);
  });
  it('진행 프레임과 실제 최종 결과를 구분하며 구형 JSON 응답도 유지한다', async () => {
    run.mockImplementationOnce(async input => { input.onProgress?.({ phase: 'requesting', modelLabel: '검증 모델', attempt: 1 }); return result; });
    const response = await POST(request()); const progress = vi.fn();
    expect(response.headers.get('content-type')).toContain('application/x-ndjson');
    expect(await readAiResponse(response, progress)).toEqual(result);
    expect(progress.mock.calls.map(([event]) => event.phase)).toEqual(['preparing', 'requesting']);
    const legacy = await POST(request(false));
    expect(legacy.headers.get('content-type')).toContain('application/json');
    expect(await legacy.json()).toEqual(result);
  });
  it('대기 중 10초마다 연결 확인 프레임을 보내고 끝나면 타이머를 정리한다', async () => {
    vi.useFakeTimers();
    let finish!: (value: typeof result) => void;
    run.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const response = await POST(request()); const reader = response.body!.getReader(); const decoder = new TextDecoder();
    expect(decoder.decode((await reader.read()).value)).toContain('preparing');
    await vi.advanceTimersByTimeAsync(10_000);
    const heartbeat = decoder.decode((await reader.read()).value);
    expect(heartbeat).toContain('heartbeat'); expect(heartbeat).not.toContain('articles');
    finish(result);
    expect(decoder.decode((await reader.read()).value)).toContain('result');
    expect((await reader.read()).done).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('응답 스트림이 취소되면 제공자 신호를 중단하고 연결 유지 타이머도 정리한다', async () => {
    vi.useFakeTimers(); let providerSignal: AbortSignal | undefined;
    run.mockImplementationOnce(input => { providerSignal = input.signal; return new Promise((_resolve, reject) => input.signal!.addEventListener('abort', () => reject(new LlmError('LLM_CANCELLED', '중단')), { once: true })); });
    const response = await POST(request()); const reader = response.body!.getReader(); await reader.read(); await reader.cancel();
    expect(providerSignal?.aborted).toBe(true);
    await Promise.resolve(); expect(vi.getTimerCount()).toBe(0);
  });
  it('스트림이 시작된 뒤 오류가 나도 성공 응답으로 표시하지 않는다', async () => {
    run.mockRejectedValueOnce(new LlmError('LLM_QUOTA', '검증용 모델 한도'));
    const response = await POST(request());
    await expect(readAiResponse(response)).rejects.toMatchObject({ code: 'LLM_QUOTA', message: '검증용 모델 한도' });
  });
  it('잘린 응답과 연결 확인 프레임만 있는 응답을 완성된 결과로 사용하지 않는다', async () => {
    const response = new Response('{"type":"heartbeat","elapsedMs":10000}\n', { headers: { 'Content-Type': 'application/x-ndjson' } });
    await expect(readAiResponse(response)).rejects.toMatchObject({ code: 'LLM_INTERRUPTED' });
  });
  it('UTF-8 한국어가 네트워크 청크 경계에서 갈라져도 정확히 복원한다', async () => {
    const bytes = new TextEncoder().encode(`${JSON.stringify({ type: 'result', result })}\n`);
    const stream = new ReadableStream<Uint8Array>({ start(controller) { for (let i = 0; i < bytes.length; i += 7) controller.enqueue(bytes.slice(i, i + 7)); controller.close(); } });
    expect(await readAiResponse(new Response(stream, { headers: { 'Content-Type': 'application/x-ndjson' } }))).toEqual(result);
  });
  it('사용자 취소를 예시 응답으로 대체하지 않는다', async () => {
    const storage = { getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() };
    vi.stubGlobal('window', { localStorage: storage, sessionStorage: storage });
    const controller = new AbortController(); controller.abort(); const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    await expect(callRole('enact_draft', {}, { sampleId: 'enact', signal: controller.signal })).rejects.toMatchObject({ code: 'AI_CANCELLED' });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
