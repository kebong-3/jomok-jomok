import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { aiHeaders, callRole } from '../src/lib/ai';
import { loadSettings, saveSettings } from '../src/lib/settings';
import { originalSampleId } from '../src/lib/sample-mode';
import { SAMPLES } from '../src/data/samples';

function memoryStorage() {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) };
}
beforeEach(() => {
  vi.stubGlobal('window', { localStorage: memoryStorage(), sessionStorage: memoryStorage(), dispatchEvent: vi.fn() });
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('AI failure and provenance', () => {
  it('does not silently use the server key when a personal key is missing', async () => {
    saveSettings({ connection: 'byok', profileId: 'hanbit-city' });
    const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
    await expect(callRole('amend_plan', {})).rejects.toThrow('내 키가 비어');
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('does not substitute a cassette for a strict model comparison', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { code: 'LLM_QUOTA', message: '모델 한도 초과' } }), { status: 429 })));
    await expect(callRole('amend_plan', {}, { sampleId: 'telework', strictModel: true, modelId: 'gemma4-31b@google' })).rejects.toThrow('모델 한도 초과');
  });
  it('labels an unchanged sample fallback with its failure reason', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('연결 중단')));
    const r = await callRole('amend_plan', {}, { sampleId: 'telework' });
    expect(r.via).toBe('cassette'); expect(r.note).toContain('연결 중단'); expect(r.model).toBeUndefined();
  });
  it('preserves actual model and fallback trace for a live result', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ data: { ops: [] }, trace: { model: 'gemma4-31b@google', modelLabel: 'Gemma', actualModel: 'gemma-4-31b-it', family: 'gemma', fallbacks: ['gptoss-120b@groq'] } })));
    const r = await callRole('amend_plan', {});
    expect(r.via).toBe('live'); expect(r.actualModel).toBe('gemma-4-31b-it'); expect(r.note).toContain('gptoss-120b@groq');
  });
  it('rejects a success response without an identifiable model', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ data: { ops: [] } })));
    await expect(callRole('amend_plan', {})).rejects.toThrow('AI 응답을 확인할 수 없습니다');
  });
});

describe('sample input isolation', () => {
  const sample = SAMPLES.find((s) => s.id === 'telework')!;
  const input = { raw: sample.text, intent: sample.intent, purpose: '', upper: '', kind: sample.kind, title: '', profileId: 'hanbit-city' };
  it('allows the original example but not edited content or intent', () => {
    expect(originalSampleId(sample, input)).toBe('telework');
    expect(originalSampleId(sample, { ...input, intent: '주 4일로 바꿔 주세요' })).toBeUndefined();
    expect(originalSampleId(sample, { ...input, raw: sample.text.replace('주 2일', '주 1일') })).toBeUndefined();
    expect(originalSampleId(sample, { ...input, profileId: 'seogu' })).toBeUndefined();
  });
});

describe('key storage', () => {
  it('keeps personal and organization keys only in session storage', () => {
    saveSettings({ connection: 'org', profileId: 'hanbit-city', orgKey: 'test-org-key', byokKey: 'test-user-key', orgBaseURL: 'https://ai.example.go.kr/v1', orgModel: 'test-model' });
    expect(window.localStorage.getItem('jj:settings')).not.toContain('test-org-key');
    expect(window.localStorage.getItem('jj:settings')).not.toContain('test-user-key');
    expect(loadSettings().orgKey).toBe('test-org-key');
    expect(aiHeaders()['x-user-connection']).toBe('org');
  });
  it('migrates a legacy organization key out of local storage', () => {
    window.localStorage.setItem('jj:settings', JSON.stringify({ connection: 'org', orgKey: 'legacy-test-key' }));
    expect(loadSettings().orgKey).toBe('legacy-test-key');
    expect(window.localStorage.getItem('jj:settings')).not.toContain('legacy-test-key');
  });
});
