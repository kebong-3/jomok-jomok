import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseRule } from '@/engine';
import { referenceBody } from '@/lib/reference-evidence';
import type { LawDoc } from '@/server/law';
import { runRole } from '@/server/llm';

vi.mock('@/server/knowledge', () => ({ retrieveForRole: () => undefined }));

const document = (text: string): LawDoc => ({
  id: '2200001', kind: 'ordin', title: '검증시 신청 조례',
  url: 'https://www.law.go.kr/자치법규/검증시신청조례',
  articles: [{ label: '제3조', title: '신청', text }],
});

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('공식 원문의 첫 문장이 조 번호 인용으로 시작하는 경우', () => {
  it('가지조문 인용을 자기 조문 머리말로 오인하여 원래 조를 누락하지 않는다', () => {
    const doc: LawDoc = {
      id: '2200001', kind: 'ordin', title: '검증시 신청 조례',
      url: 'https://www.law.go.kr/자치법규/검증시신청조례',
      articles: [
        { label: '제3조', title: '신청', text: '제3조의2에 따른 신청서를 제출하여야 한다.' },
        { label: '제3조의2', title: '신청서', text: '신청서에는 신청인의 성명을 적는다.' },
      ],
    };
    const raw = referenceBody(doc);
    expect(raw).toContain('제3조(신청) 제3조의2에 따른 신청서를 제출하여야 한다.');
    const rule = parseRule(raw, 'ordinance');
    expect(rule.articles.map(article => [article.num, article.br, article.title])).toEqual([
      [3, undefined, '신청'], [3, 2, '신청서'],
    ]);
  });

  it.each([
    '제3조에 따른 신청서를 제출한다.',
    '제3조(신청)에 따른 신청서를 제출한다.',
    '제3조(신청) 및 제4조(접수)에 따른 신청서를 제출한다.',
    '제3조(신청) 제1항에 따른 신청서를 제출한다.',
  ])('첫 문장의 조문 인용을 그대로 본문으로 보존한다: %s', text => {
    const raw = referenceBody(document(text));
    expect(raw).toBe(`검증시 신청 조례\n제3조(신청) ${text}`);
    const rule = parseRule(raw, 'ordinance');
    expect(rule.articles).toHaveLength(1);
    expect(rule.articles[0].title).toBe('신청');
    expect(rule.articles[0].paragraphs[0].text).toBe(text);
  });

  it('실제 제목이 포함된 머리말은 중복하지 않는다', () => {
    const raw = referenceBody(document('제3조(신청) 신청서를 제출한다.'));
    expect(raw).toBe('검증시 신청 조례\n제3조(신청) 신청서를 제출한다.');
    expect(parseRule(raw, 'ordinance').articles[0].paragraphs[0].text).toBe('신청서를 제출한다.');
  });

  it('제목 없는 조문도 본문의 자기 조 번호 인용 때문에 누락하지 않는다', () => {
    const doc = document('제3조에 따른 신청서를 제출한다.');
    doc.articles[0].title = '';
    expect(referenceBody(doc)).toBe('검증시 신청 조례\n제3조 제3조에 따른 신청서를 제출한다.');
  });
});

describe('제정 체계 제공자 응답의 의미 검증', () => {
  const valid = { title: '검증시 신청 조례', articles: [{ title: '목적', summary: '신청 절차의 목적을 정한다.' }] };
  const input = { role: 'enact_outline' as const, vars: { kind: '조례', purpose: '신청 절차를 정한다.', upper: '', evidence: '' }, modelId: 'gptoss-120b@groq', strictModel: true };
  const completion = (data: unknown) => new Response(JSON.stringify({ model: 'openai/gpt-oss-120b', choices: [{ message: { content: JSON.stringify(data) }, finish_reason: 'stop' }] }), { headers: { 'Content-Type': 'application/json' } });

  it.each([
    ['빈 조 목록', { ...valid, articles: [] }],
    ['빈 규정 제목', { ...valid, title: ' \n ' }],
    ['빈 조 제목', { ...valid, articles: [{ title: ' \n ', summary: '신청 절차를 정한다.' }] }],
    ['빈 조 요지', { ...valid, articles: [{ title: '목적', summary: ' \n ' }] }],
  ])('%s를 성공으로 반환하지 않고 복구 후에도 같으면 실패한다', async (_label, invalid) => {
    vi.stubEnv('GROQ_API_KEY', 'test-key');
    const fetcher = vi.fn().mockImplementation(async () => completion(invalid));
    vi.stubGlobal('fetch', fetcher);
    await expect(runRole(input)).rejects.toMatchObject({ code: 'LLM_SCHEMA' });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('빈 체계를 복구한 완성 응답만 사용자에게 돌려준다', async () => {
    vi.stubEnv('GROQ_API_KEY', 'test-key');
    const fetcher = vi.fn().mockResolvedValueOnce(completion({ ...valid, articles: [] })).mockResolvedValueOnce(completion(valid));
    vi.stubGlobal('fetch', fetcher);
    const result = await runRole(input);
    expect(result.data).toEqual(valid);
    expect(result.trace.repairs).toBe(1);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
