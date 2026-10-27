import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { allModels, modelById } from '@/config/models';
import { availableModels, extractJson, keyFor, probeModel, runRole } from '@/server/llm';
import { roleRequest, userConnection } from '@/server/ai-request';
import { ROLES } from '@/server/prompts';

// Retrieval has its own corpus/integrity suites. Provider contract tests should
// not race a 2,283-chunk cold index build against the test runner's 5-second timer.
vi.mock('@/server/knowledge', () => ({ retrieveForRole: () => undefined }));

const vars = { title: '시험 규칙', kind: '규칙', outline: '제1조', articles: '제1조 신청은 2회로 한다.', intent: '2회를 3회로 바꾸기', evidence: '' };
const result = { ops: [{ type: 'replace_text', target: '제1조', find: '2회', replace: '3회' }] };
const json = (content: unknown, model = 'provider-model') => new Response(JSON.stringify({ model, choices: [{ message: { content: JSON.stringify(content) }, finish_reason: 'stop' }], usage: { total_tokens: 123 } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
const envs = ['GROQ_API_KEY', 'GOOGLE_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_GENERATIVE_AI_API_KEY', 'CEREBRAS_API_KEY', 'OPENROUTER_API_KEY', 'UPSTAGE_API_KEY', 'CLOVA_API_KEY', 'CUSTOM_LLM_KEY', 'MODELS_JSON', 'GOOGLE_MODEL', 'GROQ_MODEL', 'CUSTOM_LLM_BASEURL', 'CUSTOM_LLM_ALLOWED_BASEURLS', 'GOOGLE_THINKING_LEVEL', 'OPENAI_API_KEY', 'OPENAI_MODEL', 'GEMMA_MODEL', 'GROQ_GPTOSS_MODEL', 'DEFAULT_MODEL_ID'];
beforeEach(() => { for (const key of envs) vi.stubEnv(key, ''); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('일시적인 제공자 429 대기와 재시도', () => {
  const googleOk = () => Response.json({ modelVersion: 'gemma-4-31b-it', candidates: [{ content: { parts: [{ text: JSON.stringify(result) }] }, finishReason: 'STOP' }] });
  const googleRetry = () => Response.json({ error: { message: 'Quota exceeded. Check plan and billing details.', details: [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '2.5s' }] } }, { status: 429 });
  beforeEach(() => { vi.useFakeTimers(); vi.stubEnv('GOOGLE_API_KEY', 'test-google-key'); vi.stubEnv('GROQ_API_KEY', 'test-groq-key'); });

  it('Retry-After초만큼 실제로 기다린 뒤 동일한 선택 모델을 재요청한다', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response('rate limit', { status: 429, headers: { 'Retry-After': '5' } })).mockResolvedValueOnce(googleOk());
    vi.stubGlobal('fetch', fetcher); const progress = vi.fn();
    const pending = runRole({ role: 'amend_plan', vars, modelId: 'gemma4-31b@google', strictModel: true, onProgress: progress });
    await vi.advanceTimersByTimeAsync(0); expect(fetcher).toHaveBeenCalledTimes(1);
    expect(progress.mock.calls.some(([p]) => p.phase === 'waiting')).toBe(true);
    await vi.advanceTimersByTimeAsync(4999); expect(fetcher).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    const value = await pending;
    expect(fetcher).toHaveBeenCalledTimes(2); expect(value.trace.fallbacks).toEqual([]);
    expect(fetcher.mock.calls.every(([url]) => String(url).includes('generativelanguage.googleapis.com'))).toBe(true);
  });

  it('Google RetryInfo를 존중해 최대 두 번 재시도하며 일반 billing 안내를 잔액 소진으로 오인하지 않는다', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(googleRetry()).mockResolvedValueOnce(googleRetry()).mockResolvedValueOnce(googleOk()); vi.stubGlobal('fetch', fetcher);
    const pending = runRole({ role: 'amend_plan', vars, modelId: 'gemma4-31b@google', strictModel: true });
    await vi.advanceTimersByTimeAsync(2499); expect(fetcher).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1); expect(fetcher).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(2500);
    expect((await pending).trace.model).toBe('gemma4-31b@google'); expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it('힌트 없는 429는 20초 후 한 번만 재시도하고 한도 오류를 유지한다', async () => {
    const fetcher = vi.fn().mockImplementation(async () => new Response('rate limit', { status: 429 })); vi.stubGlobal('fetch', fetcher);
    const pending = runRole({ role: 'amend_plan', vars, modelId: 'gemma4-31b@google', strictModel: true }).catch(error => error);
    await vi.advanceTimersByTimeAsync(19_999); expect(fetcher).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1); expect((await pending).code).toBe('LLM_QUOTA');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('자동 연결은 같은 모델의 429 재시도를 마친 뒤 다른 제공자의 성공과 fallback을 기록한다', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response('rate limit', { status: 429 })).mockResolvedValueOnce(new Response('rate limit', { status: 429 })).mockResolvedValueOnce(json(result, 'openai/gpt-oss-120b'));
    vi.stubGlobal('fetch', fetcher);
    const pending = runRole({ role: 'amend_plan', vars, modelId: 'gemma4-31b@google', strictModel: false });
    await vi.advanceTimersByTimeAsync(20_000);
    const value = await pending;
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(String(fetcher.mock.calls[0][0])).toBe(String(fetcher.mock.calls[1][0]));
    expect(String(fetcher.mock.calls[2][0])).toContain('api.groq.com');
    expect(value.trace.model).toBe('gptoss-120b@groq');
    expect(value.trace.fallbacks).toEqual(['gemma4-31b@google']);
  });

  it('자동 연결은 긴 Retry-After를 줄여 재요청하지 않고 다른 제공자를 남은 예산으로 시도한다', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response('rate limit', { status: 429, headers: { 'Retry-After': '300' } })).mockResolvedValueOnce(json(result, 'openai/gpt-oss-120b'));
    vi.stubGlobal('fetch', fetcher); const progress = vi.fn();
    const value = await runRole({ role: 'amend_plan', vars, modelId: 'gemma4-31b@google', strictModel: false, onProgress: progress });
    expect(fetcher).toHaveBeenCalledTimes(2); expect(vi.getTimerCount()).toBe(0);
    expect(progress.mock.calls.some(([event]) => event.phase === 'waiting')).toBe(false);
    expect(value.trace.model).toBe('gptoss-120b@groq');
    expect(value.trace.fallbacks).toEqual(['gemma4-31b@google']);
  });

  it('다른 모델 후보라도 동일 제공자·키의 Retry-After를 우회하지 않는다', async () => {
    vi.stubEnv('GOOGLE_API_KEY', '');
    const fetcher = vi.fn().mockImplementation(async () => new Response('rate limit', { status: 429, headers: { 'Retry-After': '300' } })); vi.stubGlobal('fetch', fetcher);
    await expect(runRole({ role: 'amend_plan', vars, modelId: 'gptoss-120b@groq', strictModel: false })).rejects.toMatchObject({ code: 'LLM_QUOTA' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['일일 한도', 429, 'Quota exceeded: GenerateRequestsPerDay', '2'],
    ['잔액 소진', 429, 'insufficient_quota', '2'],
    ['결제 필요', 402, 'payment required', '2'],
    ['실행 예산 초과', 429, 'rate limit', '300'],
  ])('%s는 대기·재요청 없이 분류된 한도 오류를 반환한다', async (_label, status, body, retryAfter) => {
    const fetcher = vi.fn().mockResolvedValue(new Response(body, { status: Number(status), headers: { 'Retry-After': String(retryAfter) } })); vi.stubGlobal('fetch', fetcher);
    await expect(runRole({ role: 'amend_plan', vars, modelId: 'gemma4-31b@google', strictModel: true })).rejects.toMatchObject({ code: 'LLM_QUOTA' });
    expect(fetcher).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
  });

  it('대기 중 사용자가 중단하면 타이머를 제거하고 재요청하지 않는다', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('rate limit', { status: 429, headers: { 'Retry-After': '30' } })); vi.stubGlobal('fetch', fetcher);
    const controller = new AbortController();
    const pending = runRole({ role: 'amend_plan', vars, modelId: 'gemma4-31b@google', strictModel: true, signal: controller.signal }).catch(error => error);
    await vi.advanceTimersByTimeAsync(1000); controller.abort();
    expect((await pending).code).toBe('LLM_CANCELLED'); expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(30_000); expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

describe('AI 연결과 실제 응답 구분', () => {
  it('Google 키 별칭과 양끝 공백을 인식하지만 설정만으로 검증됐다고 표시하지 않는다', () => {
    vi.stubEnv('GEMINI_API_KEY', '  test-google-key  ');
    expect(keyFor(modelById('gemma4-31b@google')!)).toBe('test-google-key');
    const model = availableModels().find((m) => m.id === 'gemma4-31b@google')!;
    expect(model.configured).toBe(true);
    expect(model.verified).toBe(false);
  });
  it('MODELS_JSON 추가 모델이 목록과 실제 선택에 함께 반영된다', () => {
    vi.stubEnv('MODELS_JSON', JSON.stringify([{ id: 'internal', label: '기관 모델', family: 'other', adapter: 'openai', baseURL: 'https://example.test/v1', model: 'internal-v1', keyEnv: 'CUSTOM_LLM_KEY' }]));
    vi.stubEnv('CUSTOM_LLM_KEY', 'server-key');
    expect(allModels().some((m) => m.id === 'internal')).toBe(true);
    expect(availableModels().find((m) => m.id === 'internal')?.configured).toBe(true);
  });
  it('단일모델 비교는 실패해도 다른 제공자로 바꾸지 않고 제공자 원문·키를 노출하지 않는다', async () => {
    vi.stubEnv('GROQ_API_KEY', 'private-groq-key'); vi.stubEnv('GOOGLE_API_KEY', 'google-key');
    const fetcher = vi.fn().mockResolvedValue(new Response('private-groq-key invalid_api_key', { status: 401 })); vi.stubGlobal('fetch', fetcher);
    await expect(runRole({ role: 'amend_plan', vars, modelId: 'gptoss-120b@groq', strictModel: true })).rejects.toMatchObject({ code: 'LLM_AUTH' });
    expect(fetcher).toHaveBeenCalledTimes(1);
    await expect(runRole({ role: 'amend_plan', vars, modelId: 'gptoss-120b@groq', strictModel: true })).rejects.not.toThrow('private-groq-key');
  });
  it('자동 전환은 실제 성공 모델과 실패했던 모델을 기록한다', async () => {
    vi.stubEnv('GROQ_API_KEY', 'groq-key'); vi.stubEnv('GOOGLE_API_KEY', 'google-key');
    const fetcher = vi.fn().mockResolvedValueOnce(new Response('insufficient balance', { status: 402 })).mockResolvedValueOnce(new Response(JSON.stringify({ modelVersion: 'gemma-4-31b-it', candidates: [{ content: { parts: [{ text: JSON.stringify(result) }] }, finishReason: 'STOP' }] }), { status: 200 }));
    vi.stubGlobal('fetch', fetcher);
    const r = await runRole({ role: 'amend_plan', vars, modelId: 'gptoss-120b@groq' });
    expect(r.trace.model).toBe('gemma4-31b@google'); expect(r.trace.actualModel).toBe('gemma-4-31b-it');
    expect(r.trace.fallbacks).toEqual(['gptoss-120b@groq']); expect(r.data).toEqual(result);
  });
  it('probe는 선택 모델에 한 번 실제 요청을 보내고 실제 모델명을 반환한다', async () => {
    vi.stubEnv('GROQ_API_KEY', 'key');
    const fetcher = vi.fn().mockResolvedValue(json({ ok: true }, 'openai/gpt-oss-120b')); vi.stubGlobal('fetch', fetcher);
    const r = await probeModel({ modelId: 'gptoss-120b@groq' });
    expect(r.ok).toBe(true); expect(r.actualModel).toBe('openai/gpt-oss-120b'); expect(fetcher).toHaveBeenCalledTimes(1);
    expect(availableModels().find((m) => m.id === 'gptoss-120b@groq')?.verified).toBe(true);
  });
  it('잘린 응답은 JSON 복구로 가짜 성공시키지 않으며 1회만 재시도한다', async () => {
    vi.stubEnv('GROQ_API_KEY', 'key');
    const fetcher = vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify({ choices: [{ message: { content: '{"ops":[]}' }, finish_reason: 'length' }] }), { status: 200 })));
    vi.stubGlobal('fetch', fetcher);
    await expect(runRole({ role: 'amend_plan', vars, modelId: 'gptoss-120b@groq', strictModel: true })).rejects.toMatchObject({ code: 'LLM_TRUNCATED' });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(() => extractJson('{"ops":[{"type":"replace_text"')).toThrow();
  });
  it('취소된 요청은 다음 모델에 재전송하지 않는다', async () => {
    vi.stubEnv('GROQ_API_KEY', 'key');
    const ctrl = new AbortController(); ctrl.abort(); const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    await expect(runRole({ role: 'amend_plan', vars, signal: ctrl.signal })).rejects.toMatchObject({ code: 'LLM_CANCELLED' });
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe('AI 요청의 의미 검증', () => {
  it('명시한 내 키가 없으면 서버 키로 몰래 전환하지 않는다', () => {
    vi.stubEnv('GROQ_API_KEY', 'server-key');
    expect(() => userConnection(new Request('https://app.test/api/llm', { headers: { 'x-user-connection': 'byok' } }))).toThrow('API 키가 없습니다');
  });
  it('상속된 역할 이름과 null vars 또는 비문자열 입력은 거부한다', () => {
    for (const body of [{ role: 'constructor', vars }, { role: 'amend_plan', vars: null }, { role: 'amend_plan', vars: { ...vars, intent: 123 } }]) expect(() => roleRequest(body)).toThrow();
  });
  it('연산 종류에 필요한 target/find/replace/위치가 없는 제안은 거부한다', () => {
    for (const op of [{ type: 'replace_text' }, { type: 'replace_text', target: '제1조', find: '' }, { type: 'insert_paragraph', target: '제1조', text: '본문', position: 1.5 }]) expect(ROLES.amend_plan.schema.safeParse({ ops: [op] }).success).toBe(false);
    expect(ROLES.amend_plan.schema.safeParse(result).success).toBe(true);
  });
  it('기관 주소가 등록되지 않으면 서버로 임의 URL을 요청하지 않는다', async () => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    await expect(probeModel({ modelId: 'custom', byok: { key: 'key', modelId: 'custom', model: 'model', baseURL: 'http://127.0.0.1:9000/v1' } })).rejects.toMatchObject({ code: 'LLM_CONFIG' });
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe('무효 키를 공유하는 예비 모델 건너뛰기', () => {
  it.each([[401, 'Unauthorized'], [400, 'invalid_api_key']] as const)('HTTP %s의 확정 인증 실패 뒤에도 남은 실행 예산을 주고 같은 키로 재시도하지 않는다', async (status, body) => {
    vi.stubEnv('GROQ_API_KEY', 'invalid-groq-key'); vi.stubEnv('GOOGLE_API_KEY', 'google-key');
    vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
    const timeouts = vi.spyOn(AbortSignal, 'timeout');
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(body, { status })).mockRejectedValueOnce(new DOMException('Time limit', 'TimeoutError'));
    vi.stubGlobal('fetch', fetcher);
    await expect(runRole({ role: 'amend_plan', vars, modelId: 'gptoss-120b@groq' })).rejects.toMatchObject({ code: 'LLM_TIMEOUT' });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(timeouts.mock.calls.map(([ms]) => ms)).toEqual([270_000, 270_000]);
    expect(String(fetcher.mock.calls[1][0])).toContain('generativelanguage.googleapis.com');
  });
  it('일반 403은 모델 권한 문제일 수 있어 같은 제공자의 다른 모델을 계속 시도한다', async () => {
    vi.stubEnv('GROQ_API_KEY', 'groq-key'); vi.stubEnv('GOOGLE_API_KEY', 'google-key');
    const fetcher = vi.fn().mockResolvedValueOnce(new Response('Model permission denied', { status: 403 }))
      .mockRejectedValueOnce(new DOMException('Time limit', 'TimeoutError')).mockResolvedValueOnce(json(result, 'llama-3.3-70b-versatile'));
    vi.stubGlobal('fetch', fetcher);
    const r = await runRole({ role: 'amend_plan', vars, modelId: 'gptoss-120b@groq' });
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(r.trace.model).toBe('llama33-70b@groq');
    expect(r.trace.fallbacks).toEqual(['gptoss-120b@groq', 'gemma4-31b@google']);
  });
  it('긴 생성 실패 뒤 Groq 인증 오류가 나도 원래 실패를 보존하고 요청 합계 270초를 지킨다', async () => {
    vi.stubEnv('GOOGLE_API_KEY', 'private-google-key'); vi.stubEnv('GROQ_API_KEY', 'private-groq-key');
    let now = 1_000_000; vi.spyOn(Date, 'now').mockImplementation(() => now);
    const timeouts = vi.spyOn(AbortSignal, 'timeout');
    const fetcher = vi.fn().mockImplementationOnce(async () => { now += 240_000; throw new DOMException('Time limit', 'TimeoutError'); })
      .mockResolvedValueOnce(new Response('private-groq-key invalid_api_key', { status: 401 }));
    vi.stubGlobal('fetch', fetcher);
    const error = await runRole({ role: 'amend_plan', vars }).catch(failure => failure);
    expect(error.code).toBe('LLM_TIMEOUT');
    expect(error.message).toContain('Gemma'); expect(error.message).toContain('Groq'); expect(error.message).toContain('HTTP 401');
    expect(error.message).not.toContain('private-google-key'); expect(error.message).not.toContain('private-groq-key');
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(timeouts.mock.calls.map(([ms]) => ms)).toEqual([270_000, 30_000]);
  });
  it('모든 연결의 인증 실패는 최초 인증 오류와 안전한 연결별 요약을 남긴다', async () => {
    vi.stubEnv('GOOGLE_API_KEY', 'private-google-key'); vi.stubEnv('GROQ_API_KEY', 'private-groq-key');
    const fetcher = vi.fn().mockImplementation(() => Promise.resolve(new Response('private-google-key private-groq-key invalid_api_key', { status: 401 })));
    vi.stubGlobal('fetch', fetcher);
    const error = await runRole({ role: 'amend_plan', vars }).catch(failure => failure);
    expect(error.code).toBe('LLM_AUTH'); expect(error.credentialInvalid).toBe(true);
    expect(error.message).toContain('Gemma'); expect(error.message).toContain('Groq');
    expect(error.message).not.toContain('private-google-key'); expect(error.message).not.toContain('private-groq-key');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});

describe('공개 서버의 Gemma 4 추론 설정', () => {
  const googleResult = (content: unknown) => new Response(JSON.stringify({ modelVersion: 'gemma-4-31b-it', candidates: [{ content: { parts: [{ text: JSON.stringify(content) }] }, finishReason: 'STOP' }] }), { status: 200 });
  it('기본 연결은 Google과 Groq가 함께 설정됐을 때 Gemma를 먼저 호출한다', async () => {
    vi.stubEnv('GOOGLE_API_KEY', 'google-key'); vi.stubEnv('GROQ_API_KEY', 'groq-key');
    const fetcher = vi.fn().mockResolvedValue(googleResult(result)); vi.stubGlobal('fetch', fetcher);
    const r = await runRole({ role: 'amend_plan', vars });
    expect(r.trace.model).toBe('gemma4-31b@google'); expect(r.trace.fallbacks).toEqual([]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(String(fetcher.mock.calls[0][0])).toContain('generativelanguage.googleapis.com');
  });
  it('일반 생성의 기본은 minimal이며 모델과 응답 검증을 유지한다', async () => {
    vi.stubEnv('GOOGLE_API_KEY', 'google-key');
    const fetcher = vi.fn().mockResolvedValue(googleResult(result)); vi.stubGlobal('fetch', fetcher);
    const r = await runRole({ role: 'amend_plan', vars, modelId: 'gemma4-31b@google', strictModel: true });
    const body = JSON.parse(fetcher.mock.calls[0][1].body);
    expect(body.generationConfig.thinkingConfig.thinkingLevel).toBe('minimal');
    expect(body.generationConfig.maxOutputTokens).toBe(ROLES.amend_plan.maxTokens);
    expect(String(fetcher.mock.calls[0][0])).toContain('/models/gemma-4-31b-it:generateContent');
    expect(r.data).toEqual(result);
  });
  it('운영자가 high를 지정하면 생성 요청에 반영한다', async () => {
    vi.stubEnv('GOOGLE_API_KEY', 'google-key'); vi.stubEnv('GOOGLE_THINKING_LEVEL', 'high');
    const fetcher = vi.fn().mockResolvedValue(googleResult(result)); vi.stubGlobal('fetch', fetcher);
    await runRole({ role: 'amend_plan', vars, modelId: 'gemma4-31b@google', strictModel: true });
    expect(JSON.parse(fetcher.mock.calls[0][1].body).generationConfig.thinkingConfig.thinkingLevel).toBe('high');
    expect(JSON.parse(fetcher.mock.calls[0][1].body).generationConfig.maxOutputTokens).toBe(ROLES.amend_plan.maxTokens + 2048);
  });
  it('연결 진단은 high 환경에서도 minimal로 짧게 실행한다', async () => {
    vi.stubEnv('GOOGLE_API_KEY', 'google-key'); vi.stubEnv('GOOGLE_THINKING_LEVEL', 'high');
    const fetcher = vi.fn().mockResolvedValue(googleResult({ ok: true })); vi.stubGlobal('fetch', fetcher);
    const r = await probeModel({ modelId: 'gemma4-31b@google' });
    expect(r.ok).toBe(true);
    expect(JSON.parse(fetcher.mock.calls[0][1].body).generationConfig.thinkingConfig.thinkingLevel).toBe('minimal');
  });
});

describe('모델 이식과 OpenAI 요청 호환', () => {
  it('Gemma·GPT-OSS 기존 모델 환경변수를 유지하고 새 이름이 우선한다', () => {
    vi.stubEnv('GOOGLE_MODEL', 'legacy-gemma'); vi.stubEnv('GROQ_MODEL', 'legacy-groq');
    expect(modelById('gemma4-31b@google')?.model).toBe('legacy-gemma');
    expect(modelById('gptoss-120b@groq')?.model).toBe('legacy-groq');
    vi.stubEnv('GEMMA_MODEL', 'new-gemma'); vi.stubEnv('GROQ_GPTOSS_MODEL', 'new-groq');
    expect(modelById('gemma4-31b@google')?.model).toBe('new-gemma');
    expect(modelById('gptoss-120b@groq')?.model).toBe('new-groq');
  });
  it('서버 기본 OpenAI 모델은 completion 토큰을 쓰고 추론 모델의 temperature는 생략한다', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'openai-test'); vi.stubEnv('DEFAULT_MODEL_ID', 'gpt54-mini@openai');
    vi.stubEnv('GOOGLE_API_KEY', 'google-test');
    const fetcher = vi.fn().mockResolvedValue(json(result, 'gpt-5.4-mini')); vi.stubGlobal('fetch', fetcher);
    const r = await runRole({ role: 'amend_plan', vars });
    expect(r.trace.model).toBe('gpt54-mini@openai');
    const body = JSON.parse(fetcher.mock.calls[0][1].body);
    expect(body.model).toBe('gpt-5.4-mini'); expect(body.max_completion_tokens).toBeGreaterThan(0);
    expect(body).not.toHaveProperty('max_tokens'); expect(body).not.toHaveProperty('temperature');
  });
  it('등록된 OpenAI 호환 기관 서버는 기존 max_tokens와 temperature를 유지한다', async () => {
    vi.stubEnv('CUSTOM_LLM_BASEURL', 'https://institution.example/v1');
    vi.stubEnv('CUSTOM_LLM_MODEL', 'institution-model'); vi.stubEnv('CUSTOM_LLM_KEY', 'local-test');
    const fetcher = vi.fn().mockResolvedValue(json({ ok: true }, 'institution-model')); vi.stubGlobal('fetch', fetcher);
    await probeModel({ modelId: 'custom' });
    const body = JSON.parse(fetcher.mock.calls[0][1].body);
    expect(body.max_tokens).toBeGreaterThan(0); expect(body.temperature).toBe(0);
    expect(body).not.toHaveProperty('max_completion_tokens');
  });
  it('존재하지 않는 서버 기본 모델은 제공자에 요청하기 전에 진단 가능한 오류로 중단한다', async () => {
    vi.stubEnv('DEFAULT_MODEL_ID', 'missing-model'); const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    await expect(runRole({ role: 'amend_plan', vars })).rejects.toMatchObject({ code: 'LLM_CONFIG' });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
