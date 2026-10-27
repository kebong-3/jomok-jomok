import type { AddendaSpec, Article, DeadlineReview, Rule, RuleKind, TransitionDecision, TransitionForm } from './types';

export const TRANSITION_FORMS: Record<TransitionForm, string> = {
  preparation: '시행 준비', application: '적용례', special: '특례', transitional: '경과조치',
};

/** Kept independent of engine/index so this pure helper has no circular imports. */
function fingerprint(value: unknown): string {
  const text = JSON.stringify(value);
  let one = 0x811c9dc5;
  let two = 0x01000193;
  for (let i = 0; i < text.length; i++) {
    one = Math.imul(one ^ text.charCodeAt(i), 0x01000193) >>> 0;
    two = Math.imul(two ^ (text.charCodeAt(i) + i), 0x811c9dc5) >>> 0;
  }
  return one.toString(16).padStart(8, '0') + two.toString(16).padStart(8, '0');
}

/** Excludes review records themselves: saving a decision must not make it stale. */
export function transitionDraftHash(rule: Rule, addenda: AddendaSpec): string {
  return fingerprint({
    version: 1, title: rule.title, kind: rule.kind,
    articles: rule.articles.map(a => ({ num: a.num, br: a.br, title: a.title, deleted: a.deleted, paragraphs: a.paragraphs.map(p => ({ num: p.num, text: p.text, deleted: p.deleted })) })),
    annexes: rule.annexes.map(a => ({ kind: a.kind, num: a.num, br: a.br, title: a.title, text: a.text })),
    originalAddenda: rule.addenda,
    effective: addenda.effective, months: addenda.months, date: addenda.date,
    transitional: addenda.transitional,
  });
}

export function validTransitionDate(value: string | undefined): boolean {
  if (!value) return true;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

const incomplete = (value: string) => /\[(?:작성|담당자 확인|확인|미확인)[^\]]*\]|○○|제○조/.test(value);
const articleHead = /^제\d+조(?:의\d+)?\s*(?:\(|[ \t])/m;

export function transitionDecisionIssues(entry: TransitionDecision, rule?: Rule): string[] {
  const issues: string[] = [];
  if (!entry.target.trim()) issues.push('기존 대상 또는 진행 중인 업무를 적어 주세요.');
  if (!entry.event.trim()) issues.push('적용을 나누는 기준 사건을 적어 주세요.');
  if (!validTransitionDate(entry.eventDate)) issues.push('기준 날짜를 실제 날짜로 확인해 주세요.');
  if (!entry.articleRefs.length) issues.push('관련 본칙 조문을 연결해 주세요.');
  if (entry.articleRefs.some(ref => !/^(?:종전의 )?제\d+조(?:의\d+)?(?:제\d+항)?$/.test(ref))) issues.push('연결 조문은 ‘제5조’, ‘제5조제2항’, ‘종전의 제5조’ 형식으로 적어 주세요.');
  if (rule && entry.articleRefs.some(ref => {
    const match = ref.match(/^(종전의 )?제(\d+)조(?:의(\d+))?/);
    return !match || !rule.articles.some(a => (!!match[1] || !a.deleted) && a.num === Number(match[2]) && (a.br ?? 0) === Number(match[3] ?? 0));
  })) issues.push('현재 본칙에 없는 연결 조문을 확인해 주세요. 삭제 전 조문은 ‘종전의 제○조’처럼 구분해 적어 주세요.');
  if (entry.status === 'not_needed') {
    if (!entry.note.trim()) issues.push('부칙이 필요하지 않다고 판단한 이유를 적어 주세요.');
    return issues;
  }
  if (entry.application === 'unresolved') issues.push('종전·개정·별도 기준 중 적용할 규정을 판단해 주세요.');
  if (!entry.basis.trim()) issues.push('개별 법령·종전 부칙 등 확인한 근거를 적어 주세요.');
  if (!entry.title.trim() || /[()\r\n]/.test(entry.title)) issues.push('조문 제목을 괄호 없이 한 줄로 적어 주세요.');
  if (!entry.clause.trim() || incomplete(entry.clause)) issues.push('검토하여 반영할 조문 본문을 완성해 주세요.');
  if (articleHead.test(entry.clause)) issues.push('조 번호와 제목은 자동으로 붙습니다. 본문만 적어 주세요.');
  if (entry.form === 'special' && !entry.note.trim()) issues.push('특례의 기간·대상·예외 범위를 검토 메모에 적어 주세요.');
  return issues;
}

export function transitionDecisionState(entry: TransitionDecision, draftHash: string, rule?: Rule): 'unreviewed' | 'stale' | 'incomplete' | 'confirmed' | 'not_needed' {
  if (entry.status === 'unreviewed') return 'unreviewed';
  if (!entry.sourceHash || entry.sourceHash !== draftHash) return 'stale';
  if (transitionDecisionIssues(entry, rule).length) return 'incomplete';
  return entry.status;
}

/** Only explicit, complete and current human decisions reach the bill. */
export function confirmedTransitionClauses(addenda: AddendaSpec, draftHash?: string, rule?: Rule): string[] {
  if (!draftHash) return [];
  const order: Record<TransitionForm, number> = { preparation: 0, application: 1, special: 2, transitional: 3 };
  const firstArticle = (entry: TransitionDecision) => Number(entry.articleRefs[0]?.match(/^제(\d+)조/)?.[1] ?? Number.MAX_SAFE_INTEGER);
  return (addenda.transitions ?? [])
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => transitionDecisionState(entry, draftHash, rule) === 'confirmed')
    .sort((a, b) => order[a.entry.form] - order[b.entry.form] || firstArticle(a.entry) - firstArticle(b.entry) || a.index - b.index)
    .map(({ entry }) => `(${entry.title.trim()}) ${entry.clause.trim()}`);
}

export const administrativeDeadlineKind = (kind: RuleKind): boolean => ['directive', 'established_rule', 'notice', 'guideline'].includes(kind);

export function deadlineReviewIssues(review: DeadlineReview, kind: RuleKind): string[] {
  const issues: string[] = [];
  if (!administrativeDeadlineKind(kind)) issues.push('행정규칙의 일몰 기준을 자치규칙·조례·기관 내규에 일괄 적용하지 않습니다.');
  if (review.institutionType === 'unknown') issues.push('발령 기관의 유형을 먼저 확인해 주세요.');
  if (review.applicability === 'unreviewed') issues.push('일몰제의 적용 대상·제외 사유를 확인해 주세요.');
  if (!review.basis.trim()) issues.push('적용하거나 제외하는 법령·기관 기준과 판단 이유를 적어 주세요.');
  if (review.applicability === 'applies') {
    if (!review.clause.trim() || incomplete(review.clause)) issues.push('확인한 검토 주체·기준일·주기 또는 유효기간을 본문으로 작성해 주세요.');
    if (articleHead.test(review.clause)) issues.push('본칙 조 번호와 제목을 제외하고 본문만 적어 주세요.');
  }
  return issues;
}

/** A proposal for the last substantive article. Callers must present/accept this explicitly. */
export function buildDeadlineArticle(rule: Rule, addenda: AddendaSpec): Article | undefined {
  const review = addenda.deadlineReview;
  if (!review || !review.confirmed || review.applicability !== 'applies' || deadlineReviewIssues(review, rule.kind).length || review.sourceHash !== transitionDraftHash(rule, addenda)) return undefined;
  const title = review.kind === 'review' ? '재검토기한' : '유효기간';
  if (rule.articles.some(a => !a.deleted && /재검토\s*기한|유효\s*기간|존속\s*기한/.test(a.title ?? ''))) return undefined;
  return { uid: 'deadline-review-proposal', num: Math.max(0, ...rule.articles.map(a => a.num)) + 1, title, paragraphs: [{ uid: 'deadline-review-proposal-p', text: review.clause.trim() }] };
}
