import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildImpactIntent, IMPACT_EXAMPLE, IMPACT_LIMITS, impactArticles, impactInputIssues, impactResponseSchema, literalImpactCandidates, sourceQuote, storedImpactIssues, upperLawReviewSchema, validateImpactCandidates, type ImpactResponse, type UpperLawReview } from '@/lib/impact';
import { callRole } from '@/lib/ai';
import { roleRequest } from '@/server/ai-request';

const aiCandidate: ImpactResponse['candidates'][number] = {
  target: '제2조', upperTarget: '제10조',
  institutionQuote: '위원회는 위원장 1명을 포함하여 30명 이내의 위원으로 구성한다.',
  beforeQuote: '위원회는 위원장 1명을 포함하여 30명 이내의 위원으로 구성한다.',
  afterQuote: '위원회는 위원장 1명을 포함하여 20명 이내의 위원으로 구성한다.',
  reason: '인용한 상위규정에서 위원 수의 상한이 바뀌어 기관 조문의 위원 수를 검토할 필요가 있습니다.',
  checks: ['기관에 대한 적용 범위와 시행일을 확인해 주세요.'],
};
const good = { candidates: [aiCandidate] };
const makeReview = (): UpperLawReview => ({
  version: 1, upperTitle: IMPACT_EXAMPLE.upperTitle,
  before: { text: IMPACT_EXAMPLE.before, effectiveAt: IMPACT_EXAMPLE.beforeDate },
  after: { text: IMPACT_EXAMPLE.after, effectiveAt: IMPACT_EXAMPLE.afterDate },
  institutionHash: 'a'.repeat(64), analyzedAt: 1_790_000_000_000, method: 'ai',
  candidates: validateImpactCandidates(IMPACT_EXAMPLE, good).candidates,
  selectedIds: ['IC-1'], elapsedMs: 10, rejectedCount: 0,
  model: 'actual-provider', actualModel: 'actual-model', promptVersion: 'impact_review@v1.3',
});

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('상위법 두 시점 입력의 유효성', () => {
  it('가상 예시는 실제 분석에 전달할 입력만 보유하고 기준일 순서가 맞다', () => {
    expect(impactInputIssues(IMPACT_EXAMPLE)).toEqual([]);
    expect(IMPACT_EXAMPLE).not.toHaveProperty('candidates');
    expect(roleRequest({ role: 'impact_review', vars: { ...IMPACT_EXAMPLE } }).role).toBe('impact_review');
  });
  it('공백만 다른 동일 원문, 역전된 날짜, 실제 없는 날짜를 거부한다', () => {
    expect(impactInputIssues({ ...IMPACT_EXAMPLE, after: IMPACT_EXAMPLE.before.replaceAll(' ', '  \n') }).join()).toContain('원문이 같습니다');
    expect(impactInputIssues({ ...IMPACT_EXAMPLE, beforeDate: '2026-01-01', afterDate: '2025-01-01' }).join()).toContain('뒤여야');
    expect(impactInputIssues({ ...IMPACT_EXAMPLE, afterDate: '2026-02-30' }).join()).toContain('실제 날짜');
  });
  it('중복 조문과 시점 자료가 뒤섞여 내림차순이 된 입력을 거부한다', () => {
    for (const before of [IMPACT_EXAMPLE.before + '\n제10조(구성) 위원 수는 20명이다.', '제11조(회의) 회의를 개최한다.\n' + IMPACT_EXAMPLE.before]) {
      expect(impactInputIssues({ ...IMPACT_EXAMPLE, before }).join()).toContain('중복되거나 순서');
    }
    expect(impactArticles('제2조의2(세부) 위원은 2명이다.\n제3조(회의) 회의를 개최한다.').map((article) => article.label)).toEqual(['제2조의2', '제3조']);
  });
  it('서버에서도 원문 길이와 동일 본문을 거부하고 조 번호만 이동한 비교를 안내한다', () => {
    expect(() => roleRequest({ role: 'impact_review', vars: { ...IMPACT_EXAMPLE, before: IMPACT_EXAMPLE.before + ' '.repeat(IMPACT_LIMITS.upper) } })).toThrow('12,000자');
    expect(() => roleRequest({ role: 'impact_review', vars: { ...IMPACT_EXAMPLE, after: IMPACT_EXAMPLE.before } })).toThrow('원문이 같습니다');
    expect(impactInputIssues({ ...IMPACT_EXAMPLE, after: IMPACT_EXAMPLE.after.replace('제10조', '제11조') }).join()).toContain('조 번호 이동');
  });
});

describe('AI 후보와 실제 인용의 대조', () => {
  it('실제 존재하는 세 인용과 같은 상위법 조 번호를 확인한 후보만 채택한다', () => {
    const result = validateImpactCandidates(IMPACT_EXAMPLE, good);
    expect(result.rejectedCount).toBe(0);
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({ id: 'IC-1', source: 'ai', target: '제2조', upperTarget: '제10조' });
  });
  it('없는 기관 조문·없는 숫자·다른 기관 조문의 인용을 제거한다', () => {
    const result = validateImpactCandidates(IMPACT_EXAMPLE, { candidates: [
      { ...aiCandidate, target: '제99조' },
      { ...aiCandidate, afterQuote: aiCandidate.afterQuote.replace('20명', '25명') },
      { ...aiCandidate, target: '제3조' },
    ] });
    expect(result.candidates).toEqual([]);
    expect(result.rejectedCount).toBe(3);
  });
  it('두 시점의 서로 다른 상위법 조문을 연결하거나 같은 문장을 변화로 표시하지 않는다', () => {
    const input = { ...IMPACT_EXAMPLE, before: IMPACT_EXAMPLE.before + '\n제11조(회의) 회의는 매월 개최한다.', after: IMPACT_EXAMPLE.after + '\n제11조(회의) 회의는 분기별 개최한다.' };
    const result = validateImpactCandidates(input, { candidates: [
      { ...aiCandidate, afterQuote: '제11조(회의) 회의는 분기별 개최한다.' },
      { ...aiCandidate, beforeQuote: '위원회는 위원장 1명을 포함하여', afterQuote: '위원회는 위원장 1명을 포함하여' },
    ] });
    expect(result.candidates).toHaveLength(0);
    expect(result.rejectedCount).toBe(2);
  });
  it('공백 차이는 허용하되 화면에 보이는 인용은 원문에서 다시 가져오고 중복 후보는 하나로 합친다', () => {
    expect(sourceQuote('위원회는 위원장\n 1명을 포함하여 20명으로 구성한다.', '위원회는 위원장 1명을 포함하여')).toBe('위원회는 위원장\n 1명을 포함하여');
    expect(validateImpactCandidates(IMPACT_EXAMPLE, { candidates: [aiCandidate, aiCandidate] }).rejectedCount).toBe(1);
    expect(sourceQuote('위원은 30명이다.', '위원은 20명이다.')).toBeUndefined();
  });
  it('부칙·별표를 본문의 조 번호로 오인하지 않고 출력 구조와 한도를 엄격히 제한한다', () => {
    expect(impactArticles(IMPACT_EXAMPLE.institutionRaw + '\n부칙\n제1조(시행일) 공포한 날부터 시행한다.\n[별표 1]\n제8조 형식의 서식 문구').map((article) => article.label)).toEqual(['제1조', '제2조', '제3조']);
    expect(impactResponseSchema.safeParse({ ...good, confidence: '법적 확정' }).success).toBe(false);
    expect(impactResponseSchema.safeParse({ candidates: Array.from({ length: 13 }, () => aiCandidate) }).success).toBe(false);
  });
});

describe('AI 실패 시 직접 인용의 문자일치만 안내', () => {
  it('같은 법령명과 변경 조 번호를 직접 인용한 기관 조문만 찾는다', () => {
    const result = literalImpactCandidates(IMPACT_EXAMPLE);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ target: '제2조', upperTarget: '제10조', source: 'literal' });
    expect(result[0].reason).toContain('문자일치');
    expect(IMPACT_EXAMPLE.institutionRaw).toContain(result[0].institutionQuote);
    expect(IMPACT_EXAMPLE.before).toContain(result[0].beforeQuote);
    expect(IMPACT_EXAMPLE.after).toContain(result[0].afterQuote);
  });
  it('같은 숫자·비슷한 법령명·가지조를 근거로 임의 영향을 추정하지 않는다', () => {
    const texts = [
      '제1조(구성) 위원 수는 30명으로 한다.',
      '제1조(구성) 「다른공공위원회 운영기준(가상)」 제10조에 따라 구성한다.',
      '제1조(구성) 「공공위원회 운영기준(가상)」 제10조의2에 따라 구성한다.',
      '제1조(구성) 「공공위원회 운영기준(가상)」 제100조에 따라 구성한다.',
    ];
    for (const institutionRaw of texts) expect(literalImpactCandidates({ ...IMPACT_EXAMPLE, institutionRaw })).toEqual([]);
  });
  it('예시 모드 설정에서도 이 기능은 녹화 응답 대신 실제 요청을 보내고 실패를 반환한다', async () => {
    vi.stubGlobal('window', { localStorage: { getItem: () => JSON.stringify({ forceCassette: true, connection: 'default' }) }, sessionStorage: { getItem: () => null } });
    const fetcher = vi.fn().mockResolvedValue(Response.json({ error: { code: 'LLM_QUOTA', message: '요청 한도 초과' } }, { status: 429 }));
    vi.stubGlobal('fetch', fetcher);
    await expect(callRole('impact_review', { ...IMPACT_EXAMPLE }, { allowCassette: false })).rejects.toThrow('요청 한도 초과');
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetcher.mock.calls[0][1].body).role).toBe('impact_review');
  });
});

describe('선택 범위와 분석 기록 보존', () => {
  it('선택한 후보만 개정 의도에 넣고 두 시점 인용과 근거 ID를 보존한다', () => {
    const review = makeReview();
    review.candidates.push({ ...review.candidates[0], id: 'IC-2', target: '제3조', reason: '선택하지 않은 후보입니다.' });
    const intent = buildImpactIntent(review);
    expect(intent).toContain('기관 규정의 제2조만');
    expect(intent).not.toContain('제3조');
    expect(intent).not.toContain('선택하지 않은 후보');
    expect(intent).toContain('EV-IMPACT-BEFORE');
    expect(intent).toContain('EV-IMPACT-AFTER');
    expect(intent).toContain('20명');
    expect(() => buildImpactIntent({ ...review, selectedIds: [] })).toThrow('한 개 이상');
  });
  it('백업 스키마는 API 키·알 수 없는 필드를 제거하고 선택 불일치·위조 인용을 거부한다', () => {
    const review = makeReview();
    expect(upperLawReviewSchema.parse({ ...review, apiKey: 'must-strip', before: { ...review.before, secret: 'strip' } })).not.toHaveProperty('apiKey');
    expect(upperLawReviewSchema.parse({ ...review, before: { ...review.before, secret: 'strip' } }).before).not.toHaveProperty('secret');
    expect(upperLawReviewSchema.safeParse({ ...review, selectedIds: ['IC-999'] }).success).toBe(false);
    expect(upperLawReviewSchema.safeParse({ ...review, candidates: [{ ...review.candidates[0], afterQuote: '실제 원문에 존재하지 않는 상위법 문장' }] }).success).toBe(false);
    expect(upperLawReviewSchema.safeParse({ ...review, method: 'literal' }).success).toBe(false);
  });
  it('백업 복원에서도 기관 원문의 실제 인용과 문자일치 출처를 다시 확인한다', () => {
    const review = makeReview();
    expect(storedImpactIssues(review, IMPACT_EXAMPLE.institutionRaw, IMPACT_EXAMPLE.kind)).toEqual([]);
    expect(storedImpactIssues(review, IMPACT_EXAMPLE.institutionRaw.replace('30명', '25명'), IMPACT_EXAMPLE.kind).join()).toContain('일치하지 않습니다');
    const literal: UpperLawReview = { ...review, method: 'literal', candidates: literalImpactCandidates(IMPACT_EXAMPLE) };
    expect(storedImpactIssues(literal, IMPACT_EXAMPLE.institutionRaw, IMPACT_EXAMPLE.kind)).toEqual([]);
    const unrelated = IMPACT_EXAMPLE.institutionRaw.replace('「공공위원회 운영기준(가상)」 제10조에 따라 ', '');
    const relabelled: UpperLawReview = { ...review, method: 'literal', candidates: review.candidates.map((candidate) => ({ ...candidate, source: 'literal' })) };
    expect(storedImpactIssues(relabelled, unrelated, IMPACT_EXAMPLE.kind).join()).toContain('직접 인용');
  });
});
