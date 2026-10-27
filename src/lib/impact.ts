import { z } from 'zod';
import type { RuleKind } from '@/engine';

export const IMPACT_LIMITS = { upper: 12_000, institution: 24_000, candidates: 12, quote: 700 } as const;

const articleLabel = z.string().regex(/^제[1-9]\d*조(?:의[1-9]\d*)?$/).max(40);
const quote = z.string().trim().min(6).max(IMPACT_LIMITS.quote);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(isCalendarDate, '실제 날짜를 입력해 주세요.');
const aiCandidateSchema = z.object({
  target: articleLabel,
  upperTarget: articleLabel,
  institutionQuote: quote,
  beforeQuote: quote,
  afterQuote: quote,
  reason: z.string().trim().min(5).max(320),
  checks: z.array(z.string().trim().min(3).max(200)).min(1).max(5),
}).strict();

/** AI가 반환할 수 있는 구조. 문서와의 인용 일치는 별도로 검증한다. */
export const impactResponseSchema = z.object({ candidates: z.array(aiCandidateSchema).max(IMPACT_LIMITS.candidates) }).strict();
export type ImpactResponse = z.infer<typeof impactResponseSchema>;

export const impactCandidateSchema = aiCandidateSchema.strip().extend({
  id: z.string().regex(/^IC-\d+$/).max(30),
  source: z.enum(['ai', 'literal']),
});
export type ImpactCandidate = z.infer<typeof impactCandidateSchema>;

/** 백업에도 보존하는 입력 스냅샷과 분석 기록. API 키 등 연결 정보는 담지 않는다. */
export const upperLawReviewSchema = z.object({
  version: z.literal(1),
  upperTitle: z.string().trim().min(2).max(160),
  before: z.object({ text: z.string().min(1).max(IMPACT_LIMITS.upper), effectiveAt: date.optional() }),
  after: z.object({ text: z.string().min(1).max(IMPACT_LIMITS.upper), effectiveAt: date.optional() }),
  institutionHash: z.string().regex(/^[a-f0-9]{64}$/),
  analyzedAt: z.number().int().positive(),
  method: z.enum(['ai', 'literal']),
  candidates: z.array(impactCandidateSchema).max(IMPACT_LIMITS.candidates),
  selectedIds: z.array(z.string().regex(/^IC-\d+$/).max(30)).max(IMPACT_LIMITS.candidates),
  elapsedMs: z.number().finite().min(0).max(600_000),
  rejectedCount: z.number().int().min(0).max(IMPACT_LIMITS.candidates),
  model: z.string().max(200).optional(),
  modelLabel: z.string().max(200).optional(),
  actualModel: z.string().max(200).optional(),
  promptVersion: z.string().max(80).optional(),
  trace: z.object({
    tokens: z.number().int().nonnegative().max(10_000_000).optional(),
    repairs: z.number().int().nonnegative().max(100).optional(),
    fallbacks: z.array(z.string().max(200)).max(20).optional(),
    family: z.string().max(80).optional(),
  }).optional(),
  note: z.string().max(1_000).optional(),
}).superRefine((review, ctx) => {
  if (review.before.effectiveAt && review.after.effectiveAt && review.before.effectiveAt >= review.after.effectiveAt) {
    ctx.addIssue({ code: 'custom', path: ['after', 'effectiveAt'], message: '개정 후 기준일은 개정 전 기준일보다 뒤여야 합니다.' });
  }
  const ids = new Set(review.candidates.map((candidate) => candidate.id));
  if (ids.size !== review.candidates.length || new Set(review.selectedIds).size !== review.selectedIds.length || review.selectedIds.some((id) => !ids.has(id))) {
    ctx.addIssue({ code: 'custom', path: ['selectedIds'], message: '선택된 후보가 분석 기록과 일치하지 않습니다.' });
  }
  if (review.candidates.some((candidate) => candidate.source !== (review.method === 'ai' ? 'ai' : 'literal'))) {
    ctx.addIssue({ code: 'custom', path: ['method'], message: '분석 방식과 후보 출처가 일치하지 않습니다.' });
  }
  const changes = changedArticlePairs(impactArticles(review.before.text), impactArticles(review.after.text));
  if (!changes.length || review.candidates.some((candidate) => {
    const pair = changes.find(({ before }) => before.label === candidate.upperTarget);
    return !pair || !sourceQuote(pair.before.text, candidate.beforeQuote) || !sourceQuote(pair.after.text, candidate.afterQuote) || compact(candidate.beforeQuote) === compact(candidate.afterQuote);
  })) {
    ctx.addIssue({ code: 'custom', path: ['candidates'], message: '후보의 상위법 인용이 보관된 두 시점의 실제 변경 조문과 일치하지 않습니다.' });
  }
});
export type UpperLawReview = z.infer<typeof upperLawReviewSchema>;

export interface ImpactInputs {
  upperTitle: string;
  before: string;
  after: string;
  beforeDate: string;
  afterDate: string;
  institutionRaw: string;
  kind: RuleKind;
}

interface SourceArticle { label: string; text: string; num: number; branch: number }
const compact = (text: string) => text.replace(/\s+/g, '');

function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/** 공백만 무시하고 찾은 뒤, 화면에는 실제 원문의 글자를 돌려준다. */
export function sourceQuote(source: string, requested: string): string | undefined {
  const sought = compact(requested);
  if (sought.length < 6) return undefined;
  const positions = [...source.matchAll(/\S/g)].map((match) => match.index);
  const at = compact(source).indexOf(sought);
  if (at < 0) return undefined;
  return source.slice(positions[at], positions[at + sought.length - 1] + 1);
}

/** 표·부칙은 본문 조문 후보에 섞지 않는다. 원문의 글자는 바꾸지 않는다. */
export function impactArticles(raw: string): SourceArticle[] {
  const articles: SourceArticle[] = [];
  let start = -1, offset = 0;
  let current: Omit<SourceArticle, 'text'> | undefined;
  const push = (end: number) => { if (current) articles.push({ ...current, text: raw.slice(start, end).trim() }); };
  for (const line of raw.split('\n')) {
    if (/^\s*(?:부\s*칙(?:\s*<[^>]*>)?\s*$|\[\s*별(?:표|지))/u.test(line)) { push(offset); current = undefined; break; }
    const match = line.match(/^\s*제\s*(\d+)\s*조(?:의\s*(\d+))?(?![\d의])(?=\s|\(|삭제|$)/u);
    if (match && !/^\s*제\s*\d+\s*조(?:의\s*\d+)?\s*(?:및|또는|부터|에서)/u.test(line)) {
      push(offset);
      const num = Number(match[1]), branch = Number(match[2] || 0);
      current = { label: `제${num}조${branch ? `의${branch}` : ''}`, num, branch };
      start = offset;
    }
    offset += line.length + 1;
  }
  if (current) push(raw.length);
  return articles;
}

function ordered(articles: SourceArticle[]): boolean {
  return articles.every((article, index) => article.num > 0 && article.branch >= 0 && (!index || article.num > articles[index - 1].num || article.num === articles[index - 1].num && article.branch > articles[index - 1].branch));
}

/** 입력 단계와 서버 요청 단계에서 같은 한도·시점·조문 순서 검증을 사용한다. */
export function impactInputIssues(input: ImpactInputs): string[] {
  const issues: string[] = [];
  if (input.upperTitle.trim().length < 2 || input.upperTitle.length > 160) issues.push('상위법령명을 2~160자로 입력해 주세요.');
  if (input.before.length > IMPACT_LIMITS.upper || input.after.length > IMPACT_LIMITS.upper) issues.push('상위법 개정 전·후 원문은 각각 12,000자 이하로 넣어 주세요. 필요한 조문 범위로 줄여 주세요.');
  if (input.institutionRaw.length > IMPACT_LIMITS.institution) issues.push('기관 규정은 24,000자 이하로 넣어 주세요. 검토할 조문 범위로 줄여 주세요.');
  for (const [name, value] of [['개정 전', input.beforeDate], ['개정 후', input.afterDate]] as const) {
    if (value && !isCalendarDate(value)) issues.push(`${name} 기준일을 실제 날짜로 입력해 주세요.`);
  }
  if (input.beforeDate && input.afterDate && input.beforeDate >= input.afterDate) issues.push('개정 후 기준일은 개정 전 기준일보다 뒤여야 합니다. 두 원문의 위치를 확인해 주세요.');
  const before = impactArticles(input.before), after = impactArticles(input.after), institution = impactArticles(input.institutionRaw);
  for (const [name, articles] of [['개정 전 원문', before], ['개정 후 원문', after], ['기관 규정', institution]] as const) {
    if (!articles.length) issues.push(`${name}에 "제1조(제목) …" 형식의 조문을 넣어 주세요.`);
    else if (!ordered(articles)) issues.push(`${name}의 조 번호가 중복되거나 순서가 뒤섞여 있습니다. 두 시점 자료가 섞이지 않았는지 확인해 주세요.`);
  }
  if (input.before.trim() && compact(input.before) === compact(input.after)) issues.push('개정 전·후 원문이 같습니다. 실제 변경된 두 시점의 조문을 넣어 주세요.');
  else if (before.length && after.length && !changedArticlePairs(before, after).length) issues.push('같은 조 번호에서 달라진 본문을 찾지 못했습니다. 신설·삭제·조 번호 이동은 이 비교에서 자동 분석하지 않습니다.');
  return issues;
}

function changedArticlePairs(before: SourceArticle[], after: SourceArticle[]): { before: SourceArticle; after: SourceArticle }[] {
  return before.flatMap((old) => {
    const next = after.find((article) => article.label === old.label);
    return next && compact(old.text) !== compact(next.text) ? [{ before: old, after: next }] : [];
  });
}

export function validateImpactCandidates(input: ImpactInputs, response: unknown): { candidates: ImpactCandidate[]; rejectedCount: number } {
  const parsed = impactResponseSchema.parse(response);
  const institution = impactArticles(input.institutionRaw);
  const changes = changedArticlePairs(impactArticles(input.before), impactArticles(input.after));
  const seen = new Set<string>();
  const candidates: ImpactCandidate[] = [];
  for (const candidate of parsed.candidates) {
    const target = institution.find((article) => article.label === candidate.target);
    const pair = changes.find(({ before }) => before.label === candidate.upperTarget);
    const institutionQuote = target && sourceQuote(target.text, candidate.institutionQuote);
    const beforeQuote = pair && sourceQuote(pair.before.text, candidate.beforeQuote);
    const afterQuote = pair && sourceQuote(pair.after.text, candidate.afterQuote);
    const key = `${candidate.target}:${candidate.upperTarget}`;
    if (!institutionQuote || !beforeQuote || !afterQuote || compact(beforeQuote) === compact(afterQuote) || seen.has(key)) continue;
    if ([institutionQuote, beforeQuote, afterQuote].some((text) => text.length > IMPACT_LIMITS.quote)) continue;
    seen.add(key);
    candidates.push({ ...candidate, institutionQuote, beforeQuote, afterQuote, id: `IC-${candidates.length + 1}`, source: 'ai' });
  }
  return { candidates, rejectedCount: parsed.candidates.length - candidates.length };
}

function escapeRegExp(text: string): string { return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

function excerptAround(source: string, index: number, length: number, maximum = 360): string {
  const left = Math.max(0, index - 60);
  return source.slice(left, Math.min(source.length, Math.max(index + length, left + maximum))).trim();
}

function differenceQuotes(before: string, after: string): { before: string; after: string } {
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start += 1;
  const from = Math.max(0, start - 80);
  return { before: before.slice(from, from + 360).trim(), after: after.slice(from, from + 360).trim() };
}

/** AI 실패 시 직접 인용(법령명+조 번호)만 찾는다. 의미상 영향 여부는 추정하지 않는다. */
export function literalImpactCandidates(input: ImpactInputs): ImpactCandidate[] {
  if (impactInputIssues(input).length) return [];
  const title = input.upperTitle.replace(/[「」]/g, '').trim();
  const changes = changedArticlePairs(impactArticles(input.before), impactArticles(input.after));
  const result: ImpactCandidate[] = [];
  for (const article of impactArticles(input.institutionRaw)) {
    for (const pair of changes) {
      // 법령명 바로 뒤의 조 번호만 연결한다. 다른 법령·다른 조의 숫자까지 연결하지 않는다.
      const number = `제\\s*${pair.before.num}\\s*조${pair.before.branch ? `의\\s*${pair.before.branch}` : ''}(?![\\d의]|\\s*의\\s*\\d)`;
      const reference = new RegExp(`(?:「\\s*${escapeRegExp(title)}\\s*」|(?:^|[\\s(])${escapeRegExp(title)})\\s*${number}`, 'u');
      const match = reference.exec(article.text);
      if (!match) continue;
      const diff = differenceQuotes(pair.before.text, pair.after.text);
      if (compact(diff.before) === compact(diff.after) || compact(diff.before).length < 6 || compact(diff.after).length < 6) continue;
      result.push({
        id: `IC-${result.length + 1}`, target: article.label, upperTarget: pair.before.label,
        institutionQuote: excerptAround(article.text, match.index, match[0].length),
        beforeQuote: diff.before, afterQuote: diff.after,
        reason: `기관 조문이 「${title}」 ${pair.before.label}를 직접 인용하고, 제공된 두 시점의 해당 조문이 달라 문자일치 후보로 찾았습니다.`,
        checks: ['개정 내용이 이 기관에 적용되는지 담당자가 확인해 주세요.', '시행일·경과조치와 실제로 고칠 문구를 확인해 주세요.'],
        source: 'literal',
      });
      if (result.length >= IMPACT_LIMITS.candidates) return result;
    }
  }
  return result;
}

export function selectedImpactCandidates(review: UpperLawReview): ImpactCandidate[] {
  const selected = new Set(review.selectedIds);
  return review.candidates.filter((candidate) => selected.has(candidate.id));
}

/** 복원한 기록도 현재 보관 원문과 다시 대조한다. 해시는 저장소 담당 코드가 별도로 확인한다. */
export function storedImpactIssues(review: UpperLawReview, institutionRaw: string, kind: RuleKind): string[] {
  const input: ImpactInputs = {
    upperTitle: review.upperTitle, before: review.before.text, after: review.after.text,
    beforeDate: review.before.effectiveAt || '', afterDate: review.after.effectiveAt || '', institutionRaw, kind,
  };
  const issues = impactInputIssues(input);
  if (issues.length) return issues;
  try {
    const data = { candidates: review.candidates.map(({ id: _id, source: _source, ...candidate }) => candidate) };
    if (validateImpactCandidates(input, data).rejectedCount) issues.push('영향 후보의 인용이 보관된 기관 규정 또는 상위법 조문과 일치하지 않습니다.');
    if (review.method === 'literal') {
      const direct = new Set(literalImpactCandidates(input).map((candidate) => `${candidate.target}:${candidate.upperTarget}`));
      if (review.candidates.some((candidate) => !direct.has(`${candidate.target}:${candidate.upperTarget}`))) issues.push('문자일치 후보의 법령명·조 번호 직접 인용을 확인하지 못했습니다.');
    }
  } catch { issues.push('영향 후보의 저장 형식이 올바르지 않습니다.'); }
  return issues;
}

export function buildImpactIntent(review: UpperLawReview, instruction = ''): string {
  const selected = selectedImpactCandidates(review);
  if (!selected.length) throw new Error('검토할 영향 후보를 한 개 이상 선택해 주세요.');
  const targets = [...new Set(selected.map((candidate) => candidate.target))];
  return [
    `제공된 「${review.upperTitle}」 개정 전·후 자료를 검토하여 기관 규정의 ${targets.join(', ')}만 최소한으로 개정하는 초안을 제안한다.`,
    '검토 범위는 위에서 선택한 현행 조문으로 한정한다. 다른 조문 신설·삭제·변경과 조 번호 이동은 제안하지 않는다. 제공되지 않은 법령의 최신성·적용 여부·개정 의무를 단정하지 않는다.',
    `분석 경로: ${review.method === 'ai' ? 'AI 영향 후보에서 담당자가 선택함' : '직접 인용의 문자일치 후보에서 담당자가 선택함(법률적 영향 분석은 미완료)'}.`,
    ...selected.map((candidate) => [
      `[검토 대상 ${candidate.target} / 상위법 ${candidate.upperTarget}]`,
      `기관 원문: ${candidate.institutionQuote}`,
      `개정 전(EV-IMPACT-BEFORE): ${candidate.beforeQuote}`,
      `개정 후(EV-IMPACT-AFTER): ${candidate.afterQuote}`,
      `선정 이유: ${candidate.reason}`,
      `확인할 사항: ${candidate.checks.join(' ')}`,
    ].join('\n')),
    instruction.trim() ? `담당자 추가 지시(위 대상 범위 안에서 적용): ${instruction.trim().slice(0, 2_000)}` : '원문과 근거만으로 변경 내용을 정할 수 없으면 임의로 만들지 말고 연산을 비워 둔다.',
  ].join('\n\n');
}

/** 예시는 입력만 채운다. 분석 결과나 AI 응답을 저장해 두지 않는다. */
export const IMPACT_EXAMPLE: ImpactInputs = {
  upperTitle: '공공위원회 운영기준(가상)',
  beforeDate: '2025-01-01', afterDate: '2026-01-01', kind: 'rule',
  before: '공공위원회 운영기준(가상)\n제10조(위원회 구성) 위원회는 위원장 1명을 포함하여 30명 이내의 위원으로 구성한다.',
  after: '공공위원회 운영기준(가상)\n제10조(위원회 구성) 위원회는 위원장 1명을 포함하여 20명 이내의 위원으로 구성한다.',
  institutionRaw: '한빛시 공공위원회 운영 규칙(가상)\n제1조(목적) 이 규칙은 한빛시 공공위원회의 운영에 필요한 사항을 정한다.\n제2조(구성) 「공공위원회 운영기준(가상)」 제10조에 따라 위원회는 위원장 1명을 포함하여 30명 이내의 위원으로 구성한다.\n제3조(회의) 위원장은 위원회의 회의를 소집하고 그 의장이 된다.',
};
