import { z } from 'zod';
import { hashText, renderArticle, type Article, type Rule } from '@/engine';
import type { Evidence, Project } from './project';

/** A human review record. Detection and a recorded review never certify legality. */
export const MATTER_LABELS = { unknown: '아직 확인하지 않음', autonomous: '자치사무', delegated: '위임받은 사무', internal: '기관 내부 사무' } as const;
export const RIGHTS_LABELS = { unknown: '아직 확인하지 않음', no_new_burden: '새로운 주민 권리 제한·의무 부과 없음', new_burden: '주민 권리 제한·의무·제재 검토 필요' } as const;
export const RISK_LABELS = { permission: '허가·인가', registration: '등록', report: '신고·보고', duty: '의무 표현', restriction: '금지·제한', sanction: '제재', redelegation: '규칙 등에 맡기는 사항' } as const;
export type AuthorityRisk = keyof typeof RISK_LABELS;
const field = z.string().max(20_000);
const identifier = z.string().min(1).max(500);
export const authorityReviewEntrySchema = z.object({
  articleUid: identifier,
  target: field,
  matterKind: z.enum(['unknown', 'autonomous', 'delegated', 'internal']),
  rightsEffect: z.enum(['unknown', 'no_new_burden', 'new_burden']),
  evidenceIds: z.array(identifier).max(100),
  basisQuote: field,
  allowedScope: field,
  delegationScope: field,
  decisionNote: field,
  sourceChecked: z.boolean(),
  reviewedHash: z.string().max(100).optional(),
  reviewedAt: z.number().int().min(0).max(8_640_000_000_000_000).optional(),
});
export const authorityReviewStateSchema = z.object({ entries: z.array(authorityReviewEntrySchema).max(2_000) }).superRefine((state, ctx) => {
  if (new Set(state.entries.map(entry => entry.articleUid)).size !== state.entries.length) ctx.addIssue({ code: 'custom', path: ['entries'], message: '같은 조문에 권한 검토 기록이 중복되어 있습니다.' });
});
export type AuthorityReviewEntry = z.infer<typeof authorityReviewEntrySchema>;
export type AuthorityReviewState = z.infer<typeof authorityReviewStateSchema>;
export interface AuthorityFinding { risk: AuthorityRisk; text: string }
export interface AuthorityArticleReview {
  article: Article;
  label: string;
  entry: AuthorityReviewEntry;
  findings: AuthorityFinding[];
  issues: string[];
  stale: boolean;
  status: 'unreviewed' | 'incomplete' | 'reviewed' | 'stale';
}

/** Parser UIDs are transient; saved review addresses must survive reload/import. */
export function authorityArticleKey(p: Project, article: Article): string {
  const outlineId = p.mode === 'enact' ? p.enact?.outline[article.num - 1]?.id : undefined;
  return outlineId ? `enact:${outlineId}` : `article:${article.num}:${article.br ?? 0}`;
}

export function emptyAuthorityEntry(articleUid: string): AuthorityReviewEntry {
  return { articleUid, target: '', matterKind: 'unknown', rightsEffect: 'unknown', evidenceIds: [], basisQuote: '', allowedScope: '', delegationScope: '', decisionNote: '', sourceChecked: false };
}

/** These are lexical leads, not a determination that a burden is new or unlawful. */
export function detectAuthorityRisks(article: Article): AuthorityFinding[] {
  const text = [article.title ?? '', ...article.paragraphs.filter(p => !p.deleted).map(p => p.text)].join('\n');
  const patterns: [AuthorityRisk, RegExp][] = [
    ['permission', /(?:허가|인가)(?:를|을|받|하|신청|대상|제한)?/g],
    ['registration', /등록(?:을|하여|해야|대상|신청|의무)?/g],
    ['report', /(?:신고|보고|자료\s*제출)(?:를|을|하여|해야|대상|의무)?/g],
    ['duty', /(?:하여야\s*한다|해야\s*한다|의무|책무)/g],
    ['restriction', /(?:금지|제한|하여서는\s*아니\s*된다|할\s*수\s*없다)/g],
    ['sanction', /(?:과태료|과징금|벌금|징역|행정처분|허가\s*취소|영업\s*정지)/g],
    ['redelegation', /(?:규칙|고시|훈령|예규|지침)(?:으로|에서)\s*(?:따로\s*)?정한다/g],
  ];
  return patterns.flatMap(([risk, re]) => [...text.matchAll(re)].slice(0, 3).map(match => ({ risk, text: match[0] })));
}

const normalize = (text: string) => text.normalize('NFC').replace(/\s+/g, '');

/** Comparison notes/manuals are intentionally unable to become statutory authority. */
export function authorityEvidenceEligibility(evidence: Evidence): { eligible: boolean; note?: string } {
  if (/^(?:EV-PEER-|EV-HISTORY$|EV-SOURCE$|KB-)/.test(evidence.id)
    || /(?:자치법규\s*입안\s*길라잡이|법령\s*입안[·ㆍ\s]*심사\s*기준|행정규칙\s*입안[·ㆍ\s]*심사\s*기준|알기\s*쉬운\s*법령\s*정비기준)/.test(evidence.label)
    || /위임[·ㆍ\s/]*(?:수권|권한)?\s*근거로\s*쓰지\s*않/.test(evidence.note ?? '')) {
    return { eligible: false, note: '비교·입안 참고 또는 검토 대상 원문입니다. 이 조문의 위임·수권 근거로 연결하지 않습니다.' };
  }
  if (evidence.kind === 'user' && evidence.id !== 'EV-DELEGATION') return { eligible: false, note: '일반 사용자 메모는 위임·수권 근거가 아닙니다. 실제 위임 조항은 작업 시작의 위임 조항 원문으로 등록하고 공식 원문과 대조해 주세요.' };
  return evidence.kind === 'user' ? { eligible: true, note: '사용자가 직접 제공한 위임 조항입니다. 출처·현행성·적용 대상·위임 경로를 공식 원문과 직접 대조해야 합니다.' } : { eligible: true };
}

export function authorityQuoteMatches(entry: AuthorityReviewEntry, evidence: Evidence[]): boolean {
  const quote = normalize(entry.basisQuote);
  // A law name or an article number by itself is not a substantive quotation.
  if (quote.length < 12 || !/[가-힣]/.test(quote) || !/[가-힣]{3}/.test(quote.replace(/「[^」]*」|제\d+조(?:의\d+)?/g, ''))) return false;
  return evidence.some(item => entry.evidenceIds.includes(item.id) && authorityEvidenceEligibility(item).eligible && normalize(item.text).includes(quote));
}

export function authorityInputHash(p: Project, article: Article, entry: AuthorityReviewEntry): string {
  return hashText(JSON.stringify({
    version: 2, article: renderArticle(article), articleKey: authorityArticleKey(p, article),
    title: p.enact?.title ?? p.title, kind: p.kind, mode: p.mode, amendmentKind: p.amendmentKind, source: hashText(p.source.raw),
    // A definition or scope article elsewhere can change this article's meaning.
    activeBody: p.mode === 'enact' ? p.enact?.outline.map(item => ({ id: item.id, title: item.title, paragraphs: item.paragraphs }))
      : p.amendmentKind === 'full' ? p.replacementDraft?.raw
      : p.amendmentKind === 'repeal' ? 'repeal' : p.spec.ops.filter(op => op.status === 'accepted').map(op => op.change),
    profileId: p.profileId, profile: p.profileSnapshot,
    fields: { ...entry, reviewedHash: undefined, reviewedAt: undefined },
    evidence: [...entry.evidenceIds].sort().map(id => {
      const item = p.evidence.find(e => e.id === id);
      return item ? { id, kind: item.kind, lawKind: item.lawKind, lawId: item.lawId, label: item.label, text: item.text, url: item.url, via: item.via, effectiveAt: item.effectiveAt, date: item.date, partial: item.partial, note: item.note } : { id, missing: true };
    }),
  }));
}

export function authorityEntryIssues(p: Project, article: Article, entry: AuthorityReviewEntry): string[] {
  const issues: string[] = [];
  if (entry.articleUid !== authorityArticleKey(p, article)) issues.push('현재 조문과 기록의 대상이 다릅니다. 현재 조문에서 새 기록을 작성해 주세요.');
  if (!entry.target.trim()) issues.push('누구에게 적용하는 조문인지 적어 주세요.');
  if (entry.matterKind === 'unknown') issues.push('사무의 성격을 확인해 주세요.');
  if (entry.rightsEffect === 'unknown') issues.push('주민에게 새로운 제한·의무가 생기는지 확인해 주세요.');
  if (!entry.decisionNote.trim()) issues.push('해당 사무와 규정 형식을 선택한 이유를 적어 주세요.');
  if (entry.evidenceIds.some(id => !p.evidence.some(e => e.id === id))) issues.push('연결했던 근거가 삭제되었습니다. 현재 근거를 다시 연결해 주세요.');
  if (p.evidence.some(e => entry.evidenceIds.includes(e.id) && !authorityEvidenceEligibility(e).eligible)) issues.push('비교·입안 참고자료나 일반 메모가 근거에 연결되어 있습니다. 실제 권한·위임 조항과 구분해 주세요.');
  const today = new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 10).replace(/-/g, '');
  if (p.evidence.some(e => entry.evidenceIds.includes(e.id) && /^\d{8}$/.test((e.effectiveAt ?? '').replace(/-/g, '')) && (e.effectiveAt ?? '').replace(/-/g, '') > today)) issues.push('시행예정 근거가 연결되어 있습니다. 현재 적용할 수 있는 권한 근거와 시행 관계를 별도로 확인해 주세요.');
  const needsBasis = entry.matterKind === 'delegated' || entry.rightsEffect === 'new_burden';
  if (needsBasis) {
    if (!entry.evidenceIds.length) issues.push('권한·위임을 확인할 근거 원문을 연결해 주세요.');
    if (!authorityQuoteMatches(entry, p.evidence)) issues.push('연결한 근거에서 해당 내용을 정할 수 있도록 한 원문을 그대로 인용해 주세요. 법령명만으로는 확인되지 않습니다.');
    if (!entry.allowedScope.trim()) issues.push('근거가 허용하는 대상·내용·범위와 이 조문의 관계를 적어 주세요.');
    if (!entry.sourceChecked) issues.push('근거의 현행성, 위임 경로, 적용 대상과 범위를 직접 대조해 주세요.');
  } else if (entry.basisQuote.trim() && !authorityQuoteMatches(entry, p.evidence)) {
    issues.push('기록한 인용문이 연결된 근거 원문과 일치하지 않습니다.');
  }
  if (entry.rightsEffect === 'new_burden' && !['ordinance', 'rule'].includes(p.kind)) issues.push('기관 내부 규정으로 주민의 권리·의무를 정할 수 있는지 법제 담당자와 규정 형식부터 확인해 주세요.');
  if (detectAuthorityRisks(article).some(finding => finding.risk === 'redelegation') && !entry.delegationScope.trim()) issues.push('규칙 등에 맡길 사항·구체적 범위와 조례에 남길 기준을 확인해 주세요. 단순 집행 문구이면 그 사유를 적어 주세요.');
  return issues;
}

export function authorityArticleReviews(p: Project, rule: Rule): AuthorityArticleReview[] {
  return rule.articles.filter(article => !article.deleted).map(article => {
    const key = authorityArticleKey(p, article);
    const entry = p.authorityReview?.entries.find(saved => saved.articleUid === key) ?? emptyAuthorityEntry(key);
    const issues = authorityEntryIssues(p, article, entry);
    const stale = !!entry.reviewedHash && entry.reviewedHash !== authorityInputHash(p, article, entry);
    return { article, label: `제${article.num}조${article.br ? `의${article.br}` : ''}${article.title ? `(${article.title})` : ''}`, entry, findings: detectAuthorityRisks(article), issues, stale,
      status: stale ? 'stale' : entry.reviewedHash && !issues.length ? 'reviewed' : entry.target || entry.decisionNote || entry.evidenceIds.length ? 'incomplete' : 'unreviewed' };
  });
}

export const AUTHORITY_STATUS_LABELS = { unreviewed: '아직 미검토', incomplete: '작성·확인 중', reviewed: '담당자 검토 기록', stale: '초안·근거 변경 · 재확인' } as const;

export function replaceAuthorityEntry(state: AuthorityReviewState | undefined, entry: AuthorityReviewEntry): AuthorityReviewState {
  return { entries: [...(state?.entries ?? []).filter(saved => saved.articleUid !== entry.articleUid), entry] };
}

export function recordAuthorityReview(p: Project, article: Article, entry: AuthorityReviewEntry, at = Date.now()): AuthorityReviewEntry {
  if (authorityEntryIssues(p, article, entry).length) return { ...entry, reviewedAt: undefined, reviewedHash: undefined };
  return { ...entry, reviewedAt: at, reviewedHash: authorityInputHash(p, article, entry) };
}
