import { z } from 'zod';
import { buildAddenda, eunNeun, hashText, kindSuffix, parseRule, renderRule, wordHunks, type Rule } from '@/engine';
import { transitionDraftHash } from '@/engine/transition';
import type { Project } from './project';
import type { DocModel } from './docs';
import type { Block } from './hwpx/build';

const text = z.string().max(30_000);
const line = z.string().max(1_000);
const fingerprint = z.string().regex(/^[a-f0-9]{16}$/);
const baselineSchema = z.object({ text: z.string().max(200_000), hash: fingerprint, capturedAt: z.number().int().nonnegative() });
export const CONSULTATION_BASELINE_BUDGET_BYTES = 2 * 1024 * 1024;
const baselineBytes = (entries: { text: string }[]) => entries.reduce((sum, entry) => sum + new TextEncoder().encode(entry.text).byteLength, 0);
const date = z.string().max(10).refine(value => !value || (/^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value));

export const consultationEntrySchema = z.object({
  id: z.string().min(1).max(100), label: line, receivedOn: date.optional(), summary: text,
  decision: z.enum(['unreviewed', 'accept', 'partial', 'reject', 'other']), reason: text, articleRefs: z.array(z.string().max(160)).max(100),
  notification: z.enum(['unreviewed', 'pending', 'notified', 'not_required']), notificationDate: date.optional(), notificationNote: text,
  checkedHash: fingerprint.optional(), checkedAt: z.number().int().nonnegative().optional(),
});
export const consultationReviewStateSchema = z.object({
  procedure: z.enum(['unreviewed', 'legislative_notice', 'administrative_notice', 'internal_consultation', 'not_required']),
  basis: text, stage: z.enum(['not_started', 'in_progress', 'closed']),
  startDate: date.optional(), endDate: date.optional(),
  baseline: baselineSchema.optional(), baselineHistory: z.array(baselineSchema).max(20).optional(),
  intake: z.enum(['unreviewed', 'received', 'none']), noOpinionsNote: text,
  entries: z.array(consultationEntrySchema).max(200),
  reNotice: z.object({ decision: z.enum(['unreviewed', 'required', 'not_required', 'defer']), reason: text, checkedHash: fingerprint.optional(), checkedAt: z.number().int().nonnegative().optional() }),
}).superRefine((state, ctx) => {
  if (new Set(state.entries.map(entry => entry.id)).size !== state.entries.length) ctx.addIssue({ code: 'custom', path: ['entries'], message: '의견 ID가 중복됩니다.' });
  if (state.baseline && state.baseline.hash !== hashText(state.baseline.text)) ctx.addIssue({ code: 'custom', path: ['baseline', 'hash'], message: '보관한 예고안과 그 지문이 일치하지 않습니다.' });
  if (state.baselineHistory?.some(entry => entry.hash !== hashText(entry.text))) ctx.addIssue({ code: 'custom', path: ['baselineHistory'], message: '이전 예고안과 그 지문이 일치하지 않습니다.' });
  if (baselineBytes([...(state.baseline ? [state.baseline] : []), ...(state.baselineHistory ?? [])]) > CONSULTATION_BASELINE_BUDGET_BYTES) ctx.addIssue({ code: 'custom', path: ['baselineHistory'], message: '예고안 보관 범위가 2MB를 넘습니다. 작업을 나누어 보관해 주세요.' });
  if (state.startDate && state.endDate && state.startDate > state.endDate) ctx.addIssue({ code: 'custom', path: ['endDate'], message: '예고 종료일이 시작일보다 앞섭니다.' });
});
export type ConsultationReviewState = z.infer<typeof consultationReviewStateSchema>;
export type ConsultationEntry = z.infer<typeof consultationEntrySchema>;
export const CONSULTATION_PROCEDURES = { unreviewed: '대상·절차 미확인', legislative_notice: '자치법규 입법예고', administrative_notice: '행정예고', internal_consultation: '기관 내부 의견수렴', not_required: '예고·의견수렴 대상 아님(근거 확인)' } as const;
export const CONSULTATION_DECISIONS = { unreviewed: '미검토', accept: '반영', partial: '일부 반영', reject: '미반영', other: '그 밖의 처리' } as const;
export const NOTIFICATION_LABELS = { unreviewed: '통지 여부 미확인', pending: '통지 준비 중', notified: '처리결과·이유 통지함', not_required: '통지 대상 아님·근거 기록' } as const;
export const RENOTICE_LABELS = { unreviewed: '검토 전', required: '재예고 필요 판단', not_required: '재예고 불필요 판단', defer: '추가 법무 검토 필요' } as const;

export function emptyConsultationReview(): ConsultationReviewState { return { procedure: 'unreviewed', basis: '', stage: 'not_started', intake: 'unreviewed', noOpinionsNote: '', entries: [], reNotice: { decision: 'unreviewed', reason: '' } }; }
export function emptyConsultationEntry(id = `opinion-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`): ConsultationEntry { return { id, label: '', summary: '', decision: 'unreviewed', reason: '', articleRefs: [], notification: 'unreviewed', notificationNote: '' }; }

/** Use the new addenda, never old source addenda, for the saved notice comparison. */
export function consultationDraftText(p: Project, rule: Rule): string {
  const addenda = buildAddenda(p.kind, p.spec.addenda, transitionDraftHash(rule, p.spec.addenda), rule).join('\n');
  if (p.mode === 'amend' && p.amendmentKind === 'repeal') return `${rule.title} 폐지${kindSuffix(rule)}안\n${rule.title}${eunNeun(rule.title)} 폐지한다.\n\n부칙\n${addenda}`;
  return renderRule({ ...rule, preamble: [], addenda });
}
export function captureConsultationBaseline(p: Project, rule: Rule, state = p.consultationReview ?? emptyConsultationReview(), now = Date.now()): ConsultationReviewState {
  const text = consultationDraftText(p, rule);
  if (text.length > 200_000) throw new Error('비교 기준으로 보관할 본문이 200,000자를 넘습니다. 검토 대상 규정의 범위를 나누어 주세요.');
  if (state.baseline?.text === text) return state;
  if ((state.baselineHistory?.length ?? 0) >= 20) throw new Error('이전 예고안 20개를 보관하고 있습니다. 작업 백업을 보관하고 새 작업에서 이어 주세요.');
  if (baselineBytes([{ text }, ...(state.baseline ? [state.baseline] : []), ...(state.baselineHistory ?? [])]) > CONSULTATION_BASELINE_BUDGET_BYTES) throw new Error('예고안 보관 내용이 2MB를 넘습니다. 기존 작업 백업을 보관하고 새 작업에서 이어 주세요.');
  return { ...state, ...(state.baseline ? { baselineHistory: [...(state.baselineHistory ?? []), state.baseline] } : {}), baseline: { text, hash: hashText(text), capturedAt: now }, reNotice: { ...state.reNotice, checkedHash: undefined, checkedAt: undefined } };
}
function context(p: Project, rule: Rule, state: ConsultationReviewState) {
  return { draft: consultationDraftText(p, rule), kind: p.kind, method: p.mode === 'enact' ? 'enact' : p.amendmentKind ?? 'partial', profile: p.profileSnapshot ?? p.profileId, procedure: state.procedure, basis: state.basis, stage: state.stage, startDate: state.startDate, endDate: state.endDate, baseline: state.baseline?.text, intake: state.intake, noOpinionsNote: state.noOpinionsNote };
}
export function consultationEntryHash(p: Project, rule: Rule, state: ConsultationReviewState, entry: ConsultationEntry): string {
  const { checkedHash: _hash, checkedAt: _at, ...fields } = entry;
  return hashText(JSON.stringify({ context: context(p, rule, state), fields }));
}
function actualArticleRef(ref: string, rule: Rule): boolean {
  const match = ref.trim().match(/^제(\d+)조(?:의(\d+))?(?:제(\d+)항)?$/);
  return !!match && rule.articles.some(a => !a.deleted && a.num === +match[1] && (a.br ?? 0) === +(match[2] ?? 0) && (!match[3] || a.paragraphs.some(p => !p.deleted && p.num === +match[3])));
}
export function consultationEntryIssues(entry: ConsultationEntry, rule?: Rule): string[] {
  const issues: string[] = [];
  if (!entry.summary.trim()) issues.push('제출된 의견의 요지를 적어 주세요.');
  if (entry.decision === 'unreviewed') issues.push('반영 여부를 판단해 주세요.');
  if (!entry.reason.trim()) issues.push('처리 이유를 적어 주세요.');
  if ((entry.decision === 'accept' || entry.decision === 'partial') && !entry.articleRefs.length) issues.push('실제로 반영한 조문을 연결해 주세요.');
  if (rule && entry.articleRefs.some(ref => !actualArticleRef(ref, rule))) issues.push('연결한 반영 조문이 현재 본칙에 있는지 확인해 주세요.');
  if (entry.notification === 'unreviewed') issues.push('처리결과·이유의 통지 여부를 확인해 주세요.');
  if (entry.notification === 'notified' && (!entry.notificationDate || !entry.notificationNote.trim())) issues.push('실제 통지일과 통지 방법·기록을 적어 주세요.');
  if (entry.notification === 'not_required' && !entry.notificationNote.trim()) issues.push('통지 대상이 아니라고 판단한 근거를 적어 주세요.');
  if ((entry.receivedOn && !date.safeParse(entry.receivedOn).success) || (entry.notificationDate && !date.safeParse(entry.notificationDate).success)) issues.push('접수일·통지일을 실제 달력 날짜로 확인해 주세요.');
  return issues;
}
export function consultationEntryStatus(p: Project, rule: Rule, state: ConsultationReviewState, entry: ConsultationEntry): 'unreviewed' | 'incomplete' | 'stale' | 'reviewed' {
  if (entry.checkedHash && entry.checkedHash !== consultationEntryHash(p, rule, state, entry)) return 'stale';
  if (entry.checkedHash && !consultationEntryIssues(entry, rule).length) return 'reviewed';
  return entry.summary || entry.reason ? 'incomplete' : 'unreviewed';
}
export function confirmConsultationEntry(p: Project, rule: Rule, state: ConsultationReviewState, entry: ConsultationEntry, now = Date.now()): ConsultationEntry {
  return consultationEntryIssues(entry, rule).length ? { ...entry, checkedHash: undefined, checkedAt: undefined } : { ...entry, checkedHash: consultationEntryHash(p, rule, state, entry), checkedAt: now };
}
export interface ReNoticeSignal { id: 'draft_changed' | 'rights' | 'benefits' | 'third_party' | 'purpose' | 'addenda'; label: string; detail: string }
/** These are review candidates, never an automatic legal requirement or exception. */
export function reNoticeSignals(p: Project, rule: Rule, state = p.consultationReview): ReNoticeSignal[] {
  if (!state?.baseline) return [];
  const before = state.baseline.text, after = consultationDraftText(p, rule);
  if (before === after) return [];
  const hunks = wordHunks(before, after);
  // Keep nearby unchanged nouns so a changed penalty amount is not missed just
  // because the word '과태료' itself stayed the same.
  const changed = hunks.map(h => `${before.slice(Math.max(0, h.oS - 70), Math.min(before.length, h.oE + 70))} ${after.slice(Math.max(0, h.nS - 70), Math.min(after.length, h.nE + 70))}`).join('\n');
  const signals: ReNoticeSignal[] = [{ id: 'draft_changed', label: '보관한 예고안 이후 본문 변경', detail: '변경된 조문과 의견 처리, 재예고 필요성을 함께 검토해 주세요.' }];
  if (/허가|등록|신고|금지|의무|하여야|과태료|과징금|취소|제재|부과/.test(changed)) signals.push({ id: 'rights', label: '권리 제한·의무·제재 표현의 변경', detail: '추가·강화인지, 적용 대상·금액·기준의 변화가 있는지 확인해 주세요.' });
  if (/지원|감면|혜택|수혜|급여|보조|면제|자격/.test(changed)) signals.push({ id: 'benefits', label: '혜택·자격·지원 범위의 변경', detail: '수혜 내용이 축소되거나 일부 대상자에게 불리해지는지 확인해 주세요.' });
  if (/완화|경감|확대|면제|감면|지원/.test(changed)) signals.push({ id: 'third_party', label: '제3자 이익·공익에 미치는 영향 확인', detail: '일부에게 유리한 변경도 다른 대상자나 공익에는 영향을 줄 수 있습니다.' });
  const oldRule = parseRule(before, p.kind), newRule = parseRule(after, p.kind);
  const first = (r: Rule) => r.articles.filter(a => !a.deleted).find(a => a.num === 1)?.paragraphs.map(v => v.text).join('\n') ?? '';
  if (first(oldRule) !== first(newRule)) signals.push({ id: 'purpose', label: '첫 조문·목적 내용의 변경', detail: '입법안의 본질적 부분 또는 주요 취지 변화인지 확인해 주세요.' });
  if (oldRule.addenda !== newRule.addenda) signals.push({ id: 'addenda', label: '시행일·적용례·경과조치 등 부칙 변경', detail: '시행 시점, 기한, 적용 대상을 불리하게 조정하는지 확인해 주세요.' });
  return signals;
}
export function reNoticeReviewHash(p: Project, rule: Rule, state: ConsultationReviewState): string {
  return hashText(JSON.stringify({ context: context(p, rule, state), decision: state.reNotice.decision, reason: state.reNotice.reason, entries: state.entries.map(({ checkedHash: _hash, checkedAt: _at, ...entry }) => entry) }));
}
export function consultationReviewIssues(p: Project, rule: Rule, state = p.consultationReview): string[] {
  if (!state) return ['예고·의견수렴의 적용 절차를 아직 확인하지 않았습니다.'];
  const issues: string[] = [];
  if (state.procedure === 'unreviewed') issues.push('예고·내부 의견수렴의 대상과 적용 절차를 확인해 주세요.');
  if (!state.basis.trim()) issues.push('적용 법령·기관 기준 또는 해당 없음의 판단 근거를 적어 주세요.');
  if (state.procedure === 'not_required') {
    if (state.entries.length || state.stage !== 'not_started') issues.push('절차 해당 없음 선택과 기존 의견·실시 기록이 함께 있습니다. 실제 적용 절차와 기록 대상을 다시 확인해 주세요.');
    return issues;
  }
  if (state.stage !== 'not_started' && !state.baseline) issues.push('실제로 예고·의견수렴한 안의 본문을 보관해 주세요.');
  if (state.stage === 'closed' && state.intake === 'unreviewed') issues.push('예고·의견수렴 종료 후 실제 접수 의견의 유무를 확인해 주세요.');
  if (state.intake === 'none' && (!state.noOpinionsNote.trim() || state.entries.length)) issues.push('접수 의견 없음의 확인 기록과 실제 입력한 의견 목록이 일치하는지 확인해 주세요.');
  if (state.intake === 'received' && !state.entries.length) issues.push('접수한 제출 의견을 처리표에 기록해 주세요.');
  if (state.startDate && state.endDate && state.startDate > state.endDate) issues.push('종료일이 시작일보다 앞섭니다.');
  if ((state.startDate && !date.safeParse(state.startDate).success) || (state.endDate && !date.safeParse(state.endDate).success)) issues.push('예고·의견수렴 기간을 실제 달력 날짜로 확인해 주세요.');
  const pending = state.entries.filter(entry => consultationEntryStatus(p, rule, state, entry) !== 'reviewed').length;
  if (pending) issues.push(`제출 의견 ${pending}건에 처리·통지 확인 또는 변경 후 재확인이 남아 있습니다.`);
  if (state.entries.some(entry => entry.notification === 'pending')) issues.push('처리결과·이유의 실제 통지가 남아 있습니다.');
  if (state.baseline && reNoticeSignals(p, rule, state).length) {
    if (state.reNotice.decision === 'unreviewed' || !state.reNotice.reason.trim()) issues.push('보관한 예고안 이후 변경에 대한 재예고 검토와 판단 이유를 기록해 주세요.');
    else if (state.reNotice.checkedHash !== reNoticeReviewHash(p, rule, state)) issues.push('현재 변경내용을 기준으로 재예고 판단을 다시 확인해 주세요.');
    if (state.reNotice.decision === 'required') issues.push('재예고가 필요하다고 판단한 기록입니다. 실제 재예고 절차는 별도로 진행해 주세요.');
    if (state.reNotice.decision === 'defer') issues.push('추가 법무 검토가 필요하다고 기록되어 있습니다.');
  }
  return issues;
}

const paragraph = (text: string, bold = false): Block => ({ type: 'p', runs: [{ text, bold }] });
const val = (text?: string) => text?.trim() || '[작성 필요]';
const STATE_LABEL = { unreviewed: '아직 미검토', incomplete: '작성·확인 중', stale: '본문·입력 변경 · 재확인 필요', reviewed: '담당자 검토 기록' };
export function buildConsultationReviewDoc(p: Project, rule: Rule): DocModel {
  const state = p.consultationReview ?? emptyConsultationReview();
  const title = `${p.enact?.title ?? p.title} 제출의견 처리·재예고 검토 기록`;
  const signals = reNoticeSignals(p, rule, state), issues = consultationReviewIssues(p, rule, state);
  const blocks: Block[] = [
    { type: 'p', runs: [{ text: title, size: 'title' }], align: 'center' },
    paragraph('담당자가 작성한 의견 처리 기록입니다. 제출 의견을 적었다고 본문이 자동 수정되거나 처리결과가 자동 통지되지는 않습니다.'),
    paragraph(`적용 절차: ${CONSULTATION_PROCEDURES[state.procedure]}`), paragraph(`판단 근거: ${val(state.basis)}`),
    paragraph(`현재 상태: ${{ not_started: '아직 실시 전', in_progress: '진행 중', closed: '종료한 절차' }[state.stage]} · 기간 ${state.startDate || '[시작일 미확인]'} ~ ${state.endDate || '[종료일 미확인]'}`),
    paragraph(`비교 기준 예고안: ${state.baseline ? `담당자 보관 기록 ${new Date(state.baseline.capturedAt).toISOString()} · 지문 ${state.baseline.hash}` : '아직 보관하지 않음'}`),
    paragraph(`이전 예고안 보관: ${state.baselineHistory?.length ?? 0}개 · 실제 접수 의견: ${{ unreviewed: '유무 미확인', received: '있음', none: '없음(담당자 확인)' }[state.intake]}${state.intake === 'none' ? ` / ${val(state.noOpinionsNote)}` : ''}`),
    paragraph('제출 의견별 처리', true),
    ...(state.entries.length ? state.entries.flatMap((entry, i) => [
      paragraph(`${i + 1}. ${entry.label || `제출의견 ${i + 1}`}`, true),
      paragraph(`상태: ${STATE_LABEL[consultationEntryStatus(p, rule, state, entry)]} · 접수일 ${entry.receivedOn || '[미확인]'}`),
      paragraph(`의견 요지: ${val(entry.summary)}`), paragraph(`처리: ${CONSULTATION_DECISIONS[entry.decision]}`), paragraph(`처리 이유: ${val(entry.reason)}`),
      paragraph(`실제 반영·관련 조문: ${entry.articleRefs.join(', ') || '[미연결]'}`),
      paragraph(`결과·이유 통지: ${NOTIFICATION_LABELS[entry.notification]}${entry.notificationDate ? ` · ${entry.notificationDate}` : ''}`), paragraph(`통지 방법·기록 또는 제외 근거: ${val(entry.notificationNote)}`),
      ...consultationEntryIssues(entry, rule).map(issue => paragraph(`남은 확인: ${issue}`)),
    ]) : [paragraph(state.procedure === 'not_required' ? '해당 없음 판단 기록에 따라 별도 의견 처리 항목 없음' : '아직 기록한 제출 의견이 없습니다. 접수 내역을 확인해 주세요.')]),
    paragraph('재예고 필요성 검토', true), paragraph('표현 탐지는 검토 후보입니다. 국민에게 유리한 변경도 제3자 이익·공익을 살피며, 변경이 없다는 이유만으로 재예고가 불필요하다고 자동 판정하지 않습니다.'),
    ...(signals.length ? signals.map(signal => paragraph(`${signal.label}: ${signal.detail}`)) : [paragraph(state.baseline ? '보관한 안과 현재 본문의 문자 변경을 찾지 못했습니다. 지연·환경 변화 등은 별도로 확인하세요.' : '예고안을 보관해야 변경 후보를 비교할 수 있습니다.')]),
    paragraph(`담당자 판단: ${RENOTICE_LABELS[state.reNotice.decision]}`), paragraph(`판단 이유: ${val(state.reNotice.reason)}`),
    paragraph(`판단 기록: ${state.reNotice.checkedHash && state.reNotice.checkedHash === reNoticeReviewHash(p, rule, state) ? '현재 본문에 대한 기록' : '미확인 또는 이전 본문 기록'}`),
    paragraph('남은 확인', true), ...(issues.length ? issues.map(issue => paragraph(`- ${issue}`)) : [paragraph('입력된 기록의 누락·변경 확인 사항이 없습니다. 실제 법적 절차 이행과 통지 내역은 담당자가 확인합니다.')]),
    paragraph('근거 자료: 자치법규 입안 길라잡이 2026 PDF 539–541쪽(본문 531–533쪽). 행정규칙 기준 2025 PDF 18·22·24쪽은 중앙행정기관 절차이며 지방기관·공공기관에 일괄 적용하지 않습니다.'),
  ];
  return { id: 'consultation', name: '제출의견처리및재예고검토기록', title, blocks, layout: 'support', formSource: { label: '자치법규 입안 길라잡이 2026 · PDF 539–541쪽', url: '/references/local-ordinance-2026.pdf#page=539', adaptation: '제출의견 처리·통지와 재예고 검토 항목을 기록 양식으로 재구성' } };
}
