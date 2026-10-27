import { z } from 'zod';
import { circled, hashText, parseRule, renderArticle, type AddendaSpec, type Rule, type TransitionCategory, type TransitionDecision } from '@/engine';
import { deadlineReviewIssues, transitionDecisionIssues, transitionDecisionState, transitionDraftHash } from '@/engine/transition';
import { buildDeadlineArticle } from '@/engine/transition';
import { deriveProject } from './amendment-method';
import type { Project } from './project';

export { buildDeadlineArticle, TRANSITION_FORMS, transitionDecisionIssues, transitionDecisionState, transitionDraftHash, deadlineReviewIssues } from '@/engine/transition';

const text = z.string().max(30_000);
const short = z.string().max(1_000);
const hash = z.string().regex(/^[a-f0-9]{16}$/);
const date = z.string().max(10).refine(value => {
  if (!value) return true;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
});

/** The same allowlist is used by portable project backups. */
export const transitionDecisionSchema = z.object({
  id: z.string().min(1).max(128),
  category: z.enum(['application', 'contract', 'term', 'sanction', 'preparation', 'other']),
  articleRefs: z.array(z.string().max(160)).max(100), target: short, event: short,
  eventDate: date.optional(), application: z.enum(['unresolved', 'old', 'new', 'separate']),
  form: z.enum(['preparation', 'application', 'special', 'transitional']),
  title: z.string().max(240), clause: text, basis: text, note: text,
  status: z.enum(['unreviewed', 'confirmed', 'not_needed']), sourceHash: hash.optional(),
});
export const deadlineReviewSchema = z.object({
  institutionType: z.enum(['unknown', 'central', 'local', 'public']),
  applicability: z.enum(['unreviewed', 'applies', 'excluded', 'not_needed']),
  kind: z.enum(['review', 'sunset']), basis: text, clause: text, confirmed: z.boolean(), sourceHash: hash.optional(),
});
export const priorAddendaReviewSchema = z.object({
  decision: z.enum(['unreviewed', 'retain', 'replace', 'not_needed']), note: text, sourceHash: hash.optional(),
});

export const TRANSITION_CATEGORIES: Record<TransitionCategory, { label: string; question: string; hint: string }> = {
  application: { label: '이미 접수한 신청', question: '시행 전에 접수해 아직 처리 중인 신청이 있나요?', hint: '신청일과 처분일, 특별한 적용 규정과 신뢰 보호를 함께 확인하세요. 접수일만으로 종전 규정 적용을 확정하지 않습니다.' },
  contract: { label: '계약·위탁', question: '진행 중인 계약이나 위탁은 어떻게 이어가나요?', hint: '이미 체결한 계약, 갱신·신규 계약, 위탁기간과 수탁기관의 권리·의무를 구분해 주세요.' },
  term: { label: '위원·임기', question: '현재 위원의 지위와 남은 임기는 유지하나요?', hint: '위원회 존속, 구성 변경과 기존 위원 임기를 나누어 검토해 주세요.' },
  sanction: { label: '위반행위·제재', question: '시행 전에 발생한 위반행위와 진행 중인 제재가 있나요?', hint: '행위 시점, 계속되는 위반 여부, 제재의 종류와 완화 여부, 특별한 적용 규정을 확인하세요. 종전 기준이나 소급 적용을 자동 결정하지 않습니다.' },
  preparation: { label: '서식·시스템 준비', question: '서식이나 시스템을 준비할 시간이 필요한가요?', hint: '준비 기간, 시행 전 준비행위의 근거와 담당 부서, 조문별 시행 시점의 차이를 확인해 주세요.' },
  other: { label: '그 밖의 기존 업무', question: '기존 대상자의 권리·지위·진행 절차를 더 살펴볼까요?', hint: '실제 남아 있는 법률관계와 새 규정의 적용 범위를 구체적으로 적어 주세요.' },
};

export const TRANSITION_STATE_LABELS = { unreviewed: '담당자 확인 전', stale: '본문 변경 후 다시 확인 필요', incomplete: '입력 보완 필요', confirmed: '확인 완료·부칙 반영', not_needed: '해당 없음·판단 이유 기록' };

const patterns: Partial<Record<TransitionCategory, RegExp>> = {
  application: /신청|접수|인허가|허가|등록|신고/,
  contract: /계약|위탁|수탁|협약/,
  term: /위원|임기/,
  sanction: /위반|과태료|과징금|제재|벌금|징계|취소|정지처분/,
  preparation: /서식|시스템|정보체계|전산|준비행위/,
};

export function transitionCandidates(rule: Rule): { category: TransitionCategory; articleRefs: string[] }[] {
  return (Object.entries(patterns) as [TransitionCategory, RegExp][]).flatMap(([category, pattern]) => {
    const articles = rule.articles.filter(article => !article.deleted && pattern.test(renderArticle(article)));
    return articles.length ? [{ category, articleRefs: articles.map(a => `제${a.num}조${a.br ? `의${a.br}` : ''}`) }] : [];
  });
}

export function newTransitionDecision(category: TransitionCategory, articleRefs: string[] = [], id = `transition-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`): TransitionDecision {
  return { id, category, articleRefs, target: '', event: '', application: 'unresolved', form: category === 'preparation' ? 'preparation' : 'transitional', title: '', clause: '', basis: '', note: '', status: 'unreviewed' };
}

export function priorAddendaHash(rule: Rule, method = 'partial'): string { return hashText(JSON.stringify({ title: rule.title, kind: rule.kind, addenda: rule.addenda, method })); }

/** Recompute the active draft when a user applies a proposal, rather than trusting a UI closure. */
export function transitionProjectRule(project: Project): Rule {
  if (project.mode !== 'enact') return deriveProject(project, parseRule(project.source.raw, project.kind, project.title)).after;
  const lines = [project.enact?.title ?? project.title];
  (project.enact?.outline ?? []).forEach((article, index) => {
    const paragraphs = article.paragraphs.length ? article.paragraphs : ['(내용을 써 주세요)'];
    paragraphs.forEach((text, paragraph) => lines.push(paragraph === 0 ? `제${index + 1}조(${article.title}) ${paragraphs.length > 1 ? `${circled(1)} ` : ''}${text}` : `${circled(paragraph + 1)} ${text}`));
  });
  return parseRule(lines.join('\n'), project.kind);
}

/** An explicit click adds a human-authored article; no AI inference or automatic deadline. */
export function applyDeadlineArticle(project: Project, expectedDraftHash: string): { project?: Project; error?: string } {
  if (project.mode === 'amend' && project.amendmentKind === 'repeal') return { error: '폐지 작업에는 새 본칙 조문을 추가하지 않습니다.' };
  const current = transitionProjectRule(project);
  if (transitionDraftHash(current, project.spec.addenda) !== expectedDraftHash) return { error: '본문이나 시행일이 달라졌어요. 현재 내용을 다시 확인한 뒤 반영해 주세요.' };
  const article = buildDeadlineArticle(current, project.spec.addenda);
  if (!article) return { error: '확인한 일몰 조문이 없거나 같은 조항이 이미 있습니다. 적용 대상·근거·본문과 확인 상태를 살펴봐 주세요.' };
  const id = `deadline-${Date.now().toString(36)}`;
  const finalized = (next: Project): { project: Project } => {
    const after = transitionProjectRule(next);
    // The explicit accepted change is exactly this reviewed clause. Rebind its
    // own record while leaving all other transition decisions stale for review.
    return { project: { ...next, spec: { ...next.spec, addenda: { ...next.spec.addenda, deadlineReview: { ...next.spec.addenda.deadlineReview!, sourceHash: transitionDraftHash(after, next.spec.addenda) } } } } };
  };
  if (project.mode === 'enact') {
    if (!project.enact || !project.enact.outlineConfirmed) return { error: '조문 체계를 먼저 확인해 주세요.' };
    return finalized({ ...project, enact: { ...project.enact, outline: [...project.enact.outline, { id, title: article.title!, paragraphs: [article.paragraphs[0].text], provenance: 'human' }] } });
  }
  if (project.amendmentKind === 'full') {
    const raw = project.replacementDraft?.raw;
    if (!raw?.trim() || current.diagnostics.length || parseRule(raw, project.kind, project.title).addenda.trim()) return { error: '전부개정 본문의 조문·부칙 구분을 먼저 확인해 주세요.' };
    const annex = /(^|\n)[ \t]*\[\s*(?:별표|별지)\s*/.exec(raw);
    const at = annex ? annex.index + (annex[1] ? 1 : 0) : raw.length;
    const nextRaw = `${raw.slice(0, at).trimEnd()}\n${renderArticle(article)}\n${raw.slice(at)}`.trimEnd();
    return finalized({ ...project, replacementDraft: { raw: nextRaw } });
  }
  const before = parseRule(project.source.raw, project.kind, project.title);
  const anchor = before.articles.at(-1);
  if (!anchor) return { error: '원문 마지막 조문을 찾지 못했습니다. 원문을 대조해 주세요.' };
  // All operations use original article addresses. Place this insertion first;
  // later insertions can then move it to the real end without changing their
  // intended numbers. Validate the final result before returning the project.
  const next: Project = { ...project, spec: { ...project.spec, ops: [{ id, change: { op: 'insert_article', after: { art: anchor.num, artBr: anchor.br }, title: article.title!, paragraphs: [article.paragraphs[0].text], policy: 'renumber' }, status: 'accepted', provenance: 'human', why: '담당자가 적용 근거와 문장을 검토한 일몰 조문을 본칙 마지막에 추가' }, ...project.spec.ops] } };
  const derived = deriveProject(next, before);
  const last = derived.after.articles.at(-1);
  if (!last || last.title !== article.title || last.paragraphs.length !== 1 || last.paragraphs[0].text !== article.paragraphs[0].text || derived.rejected.some(entry => entry.opId === id)) return { error: '본칙 마지막 위치에 안전하게 추가하지 못했습니다. 조문 작성 단계에서 추가 위치를 확인해 주세요.' };
  const without = { ...derived.after, articles: derived.after.articles.slice(0, -1) };
  if (transitionDraftHash(without, project.spec.addenda) !== expectedDraftHash) return { error: '다른 조문의 번호나 내용에 영향이 있어 자동 추가를 멈췄습니다. 조문 작성 단계에서 배치를 확인해 주세요.' };
  return finalized(next);
}

export function transitionReviewWarnings(rule: Rule, addenda: AddendaSpec): string[] {
  const draftHash = transitionDraftHash(rule, addenda);
  const messages = (addenda.transitions ?? []).flatMap(entry => {
    const state = transitionDecisionState(entry, draftHash, rule);
    return state === 'confirmed' || state === 'not_needed' ? [] : [`${entry.title.trim() || TRANSITION_CATEGORIES[entry.category].label}: ${state === 'stale' ? '본문·시행일 변경 후 다시 확인 필요' : state === 'incomplete' ? transitionDecisionIssues(entry, rule).join(' ') : '담당자 판단 미확인'} · 부칙에 반영하지 않았습니다.`];
  });
  const deadline = addenda.deadlineReview;
  if (deadline && (!deadline.confirmed || deadline.sourceHash !== draftHash || deadlineReviewIssues(deadline, rule.kind).length)) messages.push('일몰 검토: 기관 유형·적용 근거·본칙 조문의 담당자 확인이 남아 있습니다.');
  else if (!deadline && addenda.reviewDeadline) messages.push('이전 재검토기한 선택: 적용 대상·기관 기준을 확인하고 본칙 마지막 조문으로 작성해 주세요.');
  return messages;
}

export function transitionReviewText(rule: Rule, addenda: AddendaSpec, context?: { priorRule?: Rule; method?: string }): string {
  const current = transitionDraftHash(rule, addenda);
  const lines = ['기존 업무의 적용 관계 검토 기록', '담당자 입력 기록이며 적법성 자동 판정이 아닙니다. 미확인·변경 후 재확인 항목은 부칙에서 제외합니다.', `검토 본문 지문: ${current}`];
  for (const entry of addenda.transitions ?? []) {
    lines.push('', `[${TRANSITION_CATEGORIES[entry.category].label}] ${entry.title || '제목 미작성'}`, `상태: ${TRANSITION_STATE_LABELS[transitionDecisionState(entry, current, rule)]}`, `관련 조문: ${entry.articleRefs.join(', ') || '미연결'}`, `기존 대상: ${entry.target || '미확인'}`, `기준 사건: ${entry.event || '미확인'}${entry.eventDate ? ` (${entry.eventDate})` : ''}`, `적용 판단: ${{ unresolved: '미확인', old: '종전 규정', new: '개정 규정', separate: '별도 기준' }[entry.application]}`, `확인 근거: ${entry.basis || '미확인'}`, `검토 메모: ${entry.note || '없음'}`, `담당자가 작성한 문장: ${entry.clause || '없음'}`);
  }
  const prior = addenda.priorAddendaReview;
  if (prior) {
    const match = context?.priorRule && context.method ? prior.sourceHash === priorAddendaHash(context.priorRule, context.method) : undefined;
    lines.push('', '종전 부칙 검토', `판단: ${{ unreviewed: '미확인', retain: '계속 필요한 내용 있음', replace: '새 적용 관계로 정비 필요', not_needed: '계속 필요한 내용 없음' }[prior.decision]}`, `담당자 검토 메모: ${prior.note || '미작성'}`, `기준본·개정 방식 일치: ${match === undefined ? '종전 원문·개정 방식 별도 대조 필요' : match ? '일치' : '불일치·다시 확인 필요'}`, `검토 당시 지문: ${prior.sourceHash || '미기록'}`, '이 기록만으로 종전 부칙의 효력 유지·소멸을 확정하거나 문장을 승계하지 않습니다.');
  }
  const deadline = addenda.deadlineReview;
  if (deadline) lines.push('', '일몰 검토', `발령 기관: ${{ unknown: '미확인', central: '중앙행정기관', local: '지방자치단체', public: '공공기관' }[deadline.institutionType]}`, `적용 판단: ${{ unreviewed: '미확인', applies: '적용 근거 확인', excluded: '제외 근거 확인', not_needed: '해당 없음' }[deadline.applicability]}`, `유형: ${deadline.kind === 'review' ? '재검토기한' : '유효기간'}`, `담당자 확인: ${deadline.confirmed && deadline.sourceHash === current && !deadlineReviewIssues(deadline, rule.kind).length ? '현재 본문 기준 확인' : '미확인·입력 보완 또는 본문 변경 후 재확인 필요'}`, `적용·제외 근거: ${deadline.basis || '미작성'}`, `담당자 작성 본칙 문장: ${deadline.clause || '미작성'}`);
  for (const warning of transitionReviewWarnings(rule, addenda)) lines.push(`확인 필요: ${warning}`);
  return lines.join('\n');
}
