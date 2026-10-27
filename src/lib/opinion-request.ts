import { z } from 'zod';
import { hashText, type Rule } from '@/engine';
import type { Project } from './project';
import type { DocModel } from './docs';
import type { Block } from './hwpx/build';
import { consultationDraftText } from './consultation-review';

const text = z.string().max(30_000);
const line = z.string().max(1_000);
const fingerprint = z.string().regex(/^[a-f0-9]{16}$/);
const date = z.string().max(10).refine(value => !value || (/^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value));
const relationSchema = z.object({ status: z.enum(['unreviewed', 'related', 'not_related']), detail: text });
const publicUrl = z.string().max(4_096).refine(value => {
  if (!value) return true;
  try { const url = new URL(value); return /^https?:$/.test(url.protocol) && !url.username && !url.password && ![...url.searchParams.keys()].some(key => /^(?:api[-_]?key|token|access[-_]?token|authorization|password|secret|signature|key)$/i.test(key)); } catch { return false; }
});

/** Human-authored fields only. Form examples and AI suggestions never become facts. */
export const opinionRequestStateSchema = z.object({
  organization: line, requester: z.enum(['unreviewed', 'local_head', 'education_superintendent', 'council_chair', 'other']), requesterOffice: line,
  targetTitle: line, targetKind: z.enum(['unreviewed', 'ordinance', 'rule', 'administrative_rule', 'other']),
  jurisdiction: z.enum(['unreviewed', 'own', 'related']), relationship: text,
  stage: z.enum(['unreviewed', 'draft', 'notice', 'review_committee', 'council_review', 'resolved', 'promulgated']),
  resolutionDate: date.optional(), promulgationDate: date.optional(),
  specificity: z.enum(['unreviewed', 'specific', 'whole_legality']),
  requestType: z.enum(['unreviewed', 'drafting', 'general_interpretation', 'legality_after_resolution', 'fact_or_disposition']),
  nationalTask: relationSchema, localPlan: relationSchema,
  background: text, questions: z.array(z.object({ id: z.string().min(1).max(100), text, articleRef: line })).max(20),
  targetText: z.string().max(200_000), relatedLaws: z.string().max(200_000),
  viewsStatus: z.enum(['unreviewed', 'present', 'none']), viewA: text, viewASource: line, viewB: text, viewBSource: line,
  requestingOpinion: text, relatedOpinionStatus: z.enum(['unreviewed', 'present', 'none']), relatedOpinion: text, relatedOpinionSource: line,
  referencesStatus: z.enum(['unreviewed', 'present', 'none']),
  references: z.array(z.object({ id: z.string().min(1).max(100), label: line, url: publicUrl.optional(), note: text })).max(50),
  checkedHash: fingerprint.optional(), checkedAt: z.number().int().nonnegative().optional(),
}).superRefine((state, ctx) => {
  for (const field of ['questions', 'references'] as const) if (new Set(state[field].map(item => item.id)).size !== state[field].length) ctx.addIssue({ code: 'custom', path: [field], message: '항목 ID가 중복됩니다.' });
});
export type OpinionRequestState = z.infer<typeof opinionRequestStateSchema>;
export const REQUESTER_LABELS = { unreviewed: '미확인', local_head: '지방자치단체장', education_superintendent: '교육감', council_chair: '지방의회 의장', other: '그 밖의 명의·요청권한 확인 필요' } as const;
export const OPINION_KIND_LABELS = { unreviewed: '미확인', ordinance: '조례', rule: '규칙', administrative_rule: '행정규칙(고시·훈령·예규)', other: '그 밖의 규정·대상 여부 확인 필요' } as const;
export const OPINION_STAGE_LABELS = { unreviewed: '미확인', draft: '제·개정안 마련 중', notice: '입법예고 중', review_committee: '조례·규칙심의회 심의 중', council_review: '지방의회 심의 중', resolved: '지방의회 의결 완료', promulgated: '공포 완료' } as const;
export const OPINION_TYPE_LABELS = { unreviewed: '미확인', drafting: '입안 중 구체적인 법적 쟁점', general_interpretation: '자치법규의 일반적 해석', legality_after_resolution: '의결·공포 후 상위법 위반 여부', fact_or_disposition: '구체적 사실인정·처분의 위법 또는 부당 여부' } as const;
export const RELATION_LABELS = { unreviewed: '미확인', related: '관련 있음', not_related: '관련 없음' } as const;

export function emptyOpinionRequest(): OpinionRequestState {
  return { organization: '', requester: 'unreviewed', requesterOffice: '', targetTitle: '', targetKind: 'unreviewed', jurisdiction: 'unreviewed', relationship: '', stage: 'unreviewed', specificity: 'unreviewed', requestType: 'unreviewed', nationalTask: { status: 'unreviewed', detail: '' }, localPlan: { status: 'unreviewed', detail: '' }, background: '', questions: [{ id: 'question-1', text: '', articleRef: '' }], targetText: '', relatedLaws: '', viewsStatus: 'unreviewed', viewA: '', viewASource: '', viewB: '', viewBSource: '', requestingOpinion: '', relatedOpinionStatus: 'unreviewed', relatedOpinion: '', relatedOpinionSource: '', referencesStatus: 'unreviewed', references: [] };
}

/** Explicit reuse fills empty text fields; it never chooses a requester, date or opinion. */
export function reuseOpinionWork(p: Project, rule: Rule, current = p.opinionRequest ?? emptyOpinionRequest()): OpinionRequestState {
  const kinds = { ordinance: 'ordinance', rule: 'rule', directive: 'administrative_rule', established_rule: 'administrative_rule', notice: 'administrative_rule', guideline: 'other', bylaw: 'other', act: 'other', decree: 'other', ministry_rule: 'other' } as const;
  const references = p.evidence.map(e => `[${e.id}] ${e.label}\n출처: ${e.url || '사용자 입력·저장 자료'}\n시행일: ${e.effectiveAt || '미확인'} · 조회·입력일: ${e.fetchedAt || e.date || '미확인'}\n${e.text}`).join('\n\n');
  const bounded = (value: string) => value.length <= 200_000 ? value : `${value.slice(0, 199_900)}\n[발췌: 입력 한도로 일부만 가져왔습니다. 질의 대상 조문과 관련 근거를 선별해 확인하세요.]`;
  return { ...current, organization: current.organization || p.profileSnapshot?.name || '', targetTitle: current.targetTitle || p.enact?.title || p.title, targetKind: current.targetKind === 'unreviewed' ? kinds[p.kind] : current.targetKind, targetText: current.targetText || bounded(consultationDraftText(p, rule)), relatedLaws: current.relatedLaws || bounded(references), checkedHash: undefined, checkedAt: undefined };
}

function materialWork(p: Project) {
  return { title: p.enact?.title ?? p.title, kind: p.kind, mode: p.mode, amendmentKind: p.amendmentKind, intent: p.intent, purpose: p.purpose, upperLaw: p.upperLaw, source: p.source.raw, replacement: p.replacementDraft?.raw, outline: p.enact?.outline.map(a => ({ title: a.title, paragraphs: a.paragraphs })), ops: p.spec.ops.filter(o => o.status === 'accepted').map(o => o.change), addenda: p.spec.addenda, evidence: p.evidence, profile: p.profileSnapshot ?? p.profileId };
}
export function opinionRequestHash(p: Project, state: OpinionRequestState): string {
  const { checkedHash: _hash, checkedAt: _at, ...fields } = state;
  return hashText(JSON.stringify({ work: materialWork(p), fields }));
}
const unfinished = (value: string) => !value.trim() || /\[(?:작성|미확인|확인 필요|발췌)[^\]]*\]|○○|00월\s*00일/.test(value);
export function opinionRequestIssues(state: OpinionRequestState): string[] {
  const issues: string[] = [];
  if (unfinished(state.organization) || unfinished(state.requesterOffice)) issues.push('요청기관과 실제 요청 명의를 확인해 주세요.');
  if (state.requester === 'unreviewed') issues.push('요청권한자를 확인해 주세요.');
  if (state.requester === 'other') issues.push('원본 서식은 지방자치단체장·교육감·지방의회 의장 명의를 안내합니다. 소속기관·산하기관 또는 의원 개인 명의 등의 요청 가능 여부를 확인해 주세요.');
  if (unfinished(state.targetTitle) || state.targetKind === 'unreviewed') issues.push('의견제시 대상 자치법규의 제목·형식을 확인해 주세요.');
  if (state.targetKind === 'other') issues.push('지침·기관 내규 등은 해당 의견제시 제도의 대상인지 따로 확인해 주세요.');
  if (state.jurisdiction === 'unreviewed') issues.push('요청 지자체 소관인지 관련 지자체 소관인지 확인해 주세요.');
  if (state.jurisdiction === 'related' && unfinished(state.relationship)) issues.push('관련 지자체 소관 자치법규와 요청기관의 업무관련성을 적어 주세요.');
  if (state.stage === 'unreviewed') issues.push('현재 입법단계를 확인해 주세요.');
  if (state.stage === 'resolved' && !state.resolutionDate) issues.push('실제 의결일을 확인해 주세요. 예시 날짜를 옮겨 적지 않습니다.');
  if (state.stage === 'promulgated' && !state.promulgationDate) issues.push('실제 공포일을 확인해 주세요. 예시 날짜를 옮겨 적지 않습니다.');
  if ((state.resolutionDate && !date.safeParse(state.resolutionDate).success) || (state.promulgationDate && !date.safeParse(state.promulgationDate).success)) issues.push('의결일·공포일을 실제 달력 날짜로 확인해 주세요.');
  if (state.specificity !== 'specific') issues.push('조례안 전체의 적법성 대신, 대상 조문과 판단이 필요한 쟁점을 특정해 주세요.');
  if (state.requestType === 'unreviewed') issues.push('입안 쟁점인지 일반적 해석인지 요청 성격을 확인해 주세요.');
  if (state.requestType === 'fact_or_disposition') issues.push('구체적 사실인정이나 처분의 위법·부당 여부는 서식상 반려 가능 사유입니다. 일반적 해석 쟁점과 구분해 주세요.');
  if (state.requestType === 'legality_after_resolution' || ((state.stage === 'resolved' || state.stage === 'promulgated') && state.requestType === 'drafting')) issues.push('본회의 의결·공포 후 상위법 위반 여부를 묻는 요청은 서식상 반려될 수 있습니다. 요청 경로·내용을 법무 담당자와 확인해 주세요.');
  for (const [label, relation] of [['국정과제', state.nationalTask], ['지방시대 시행계획', state.localPlan]] as const) {
    if (relation.status === 'unreviewed') issues.push(`${label} 관련 여부를 확인해 주세요.`);
    if (relation.status === 'related' && unfinished(relation.detail)) issues.push(`${label}의 실제 번호·내용 또는 관련 사업을 적어 주세요.`);
  }
  if (unfinished(state.background)) issues.push('실제 질의배경을 적어 주세요.');
  if (!state.questions.length || state.questions.some(q => unfinished(q.text) || unfinished(q.articleRef))) issues.push('질의별로 대상 조문과 구체적인 질문을 적어 주세요.');
  if (unfinished(state.targetText) || unfinished(state.relatedLaws)) issues.push('대상 조문과 관련 법령 원문·출처·기준일을 확인해 주세요.');
  if (state.viewsStatus === 'unreviewed') issues.push('대립 견해의 유무를 확인해 주세요. 견해가 없으면 없음을 직접 선택할 수 있습니다.');
  if (state.viewsStatus === 'present' && (unfinished(state.viewA) || unfinished(state.viewB) || unfinished(state.viewASource) || unfinished(state.viewBSource))) issues.push('실제로 검토한 갑설·을설과 각 논거의 출처를 적어 주세요.');
  if (unfinished(state.requestingOpinion)) issues.push('요청기관이 실제로 검토한 의견을 적어 주세요.');
  if (state.relatedOpinionStatus === 'unreviewed') issues.push('관계기관 의견의 유무를 확인해 주세요.');
  if (state.relatedOpinionStatus === 'present' && (unfinished(state.relatedOpinion) || unfinished(state.relatedOpinionSource))) issues.push('관계기관 의견 내용과 실제 회신·확인 출처를 적어 주세요.');
  if (state.referencesStatus === 'unreviewed') issues.push('참고자료·붙임의 유무를 확인해 주세요.');
  if (state.referencesStatus === 'present' && (!state.references.length || state.references.some(ref => unfinished(ref.label)))) issues.push('참고자료·붙임의 제목과 필요한 첨부를 확인해 주세요.');
  if (state.references.some(ref => ref.url && !publicUrl.safeParse(ref.url).success)) issues.push('참고자료 주소는 비밀값이 없는 공개 HTTP(S) 주소로 확인해 주세요.');
  return issues;
}
export function opinionRequestStatus(p: Project, state = p.opinionRequest): 'unreviewed' | 'incomplete' | 'stale' | 'reviewed' {
  if (!state) return 'unreviewed';
  if (state.checkedHash && state.checkedHash !== opinionRequestHash(p, state)) return 'stale';
  return state.checkedHash && !opinionRequestIssues(state).length ? 'reviewed' : 'incomplete';
}
export function confirmOpinionRequest(p: Project, state: OpinionRequestState, now = Date.now()): OpinionRequestState {
  return opinionRequestIssues(state).length ? { ...state, checkedHash: undefined, checkedAt: undefined } : { ...state, checkedHash: opinionRequestHash(p, state), checkedAt: now };
}

const paragraph = (text: string, bold = false): Block => ({ type: 'p', runs: [{ text, bold }] });
const value = (text: string) => text.trim() || '[작성 필요]';
const lines = (text: string): Block[] => value(text).split('\n').map(line => paragraph(line));
const STATUS = { unreviewed: '아직 작성 전', incomplete: '작성·확인 중', stale: '작업·입력 변경 · 재확인 필요', reviewed: '담당자 작성내용 확인 기록' };
export function buildOpinionRequestDoc(p: Project): DocModel {
  const state = p.opinionRequest ?? emptyOpinionRequest();
  const title = `${state.targetTitle || p.enact?.title || p.title} 자치법규 의견제시 요청서 작성자료`;
  const relationText = (relation: OpinionRequestState['nationalTask']) => `${RELATION_LABELS[relation.status]}${relation.status === 'related' ? ` · ${value(relation.detail)}` : ''}`;
  const row = (label: string, content: string) => ({ cells: [[[{ text: label, bold: true }]], [[{ text: content }]]] });
  const blocks: Block[] = [
    { type: 'p', runs: [{ text: title, size: 'title' }], align: 'center' },
    paragraph('제공된 공식 요청서의 항목을 채울 수 있도록 재구성한 작성자료입니다. 원본의 배치·체크란을 직접 채운 파일이 아니므로 제출 전 원본 서식과 대조하세요.'),
    paragraph(`상태: ${STATUS[opinionRequestStatus(p, state)]}. 담당자 작성내용의 확인 기록이며, 법제처의 접수 또는 요청요건 충족 판정이 아닙니다.`),
    paragraph('요청요건 사전 확인', true),
    { type: 'table', widths: [2, 5], rows: [
      row('요청기관·명의', `${value(state.organization)} / ${value(state.requesterOffice)} / ${REQUESTER_LABELS[state.requester]}`),
      row('대상 자치법규·형식', `${value(state.targetTitle)} / ${OPINION_KIND_LABELS[state.targetKind]}`),
      row('소관·업무관련성', `${{ unreviewed: '미확인', own: '요청 지자체 소관', related: '관련 지자체 소관' }[state.jurisdiction]}${state.jurisdiction === 'related' ? `\n${value(state.relationship)}` : ''}`),
      row('현재 입법단계', `${OPINION_STAGE_LABELS[state.stage]}${state.stage === 'resolved' ? ` / 의결일 ${state.resolutionDate || '[작성 필요]'}` : state.stage === 'promulgated' ? ` / 공포일 ${state.promulgationDate || '[작성 필요]'}` : ''}`),
      row('요청사항 특정', { unreviewed: '미확인', specific: '담당자가 조문·쟁점을 특정함', whole_legality: '전체 적법성 질의 · 쟁점 특정 필요' }[state.specificity]),
      row('요청 성격', OPINION_TYPE_LABELS[state.requestType]), row('국정과제 관련성', relationText(state.nationalTask)), row('지방시대 시행계획', relationText(state.localPlan)),
    ] },
    paragraph('1. 질의배경', true), ...lines(state.background), paragraph('2. 질의요지', true),
    ...(state.questions.length ? state.questions.flatMap((question, i) => [paragraph(`${i + 1}. 대상 조문: ${value(question.articleRef)}`, true), ...lines(question.text)]) : [paragraph('[작성 필요]')]),
    paragraph('3. 의견제시 대상 자치법규 조문 및 관련 법령', true), paragraph('대상 조문', true), ...lines(state.targetText), paragraph('관련 법령·출처·기준일', true), ...lines(state.relatedLaws),
    paragraph('4. 대립되는 의견', true),
    ...(state.viewsStatus === 'present' ? [paragraph(`가. 갑설 · 출처 ${value(state.viewASource)}`, true), ...lines(state.viewA), paragraph(`나. 을설 · 출처 ${value(state.viewBSource)}`, true), ...lines(state.viewB)] : [paragraph(state.viewsStatus === 'none' ? '담당자 확인: 대립되는 의견 없음(원본 안내에 따라 생략 가능)' : '[작성 필요] 실제 견해의 유무 확인')]),
    paragraph('5. 요청기관 및 관계기관의 의견', true), paragraph('요청기관 의견', true), ...lines(state.requestingOpinion), paragraph('관계기관 의견', true),
    ...(state.relatedOpinionStatus === 'present' ? [paragraph(`실제 회신·확인 출처: ${value(state.relatedOpinionSource)}`), ...lines(state.relatedOpinion)] : [paragraph(state.relatedOpinionStatus === 'none' ? '담당자 확인: 확보한 관계기관 의견 없음' : '[작성 필요] 관계기관 의견의 유무 확인')]),
    paragraph('6. 참고자료·붙임 목록', true),
    ...(state.referencesStatus === 'present' ? state.references.flatMap((ref, i) => [paragraph(`${i + 1}. ${value(ref.label)}${ref.url ? ` · ${ref.url}` : ''}`), ...(ref.note.trim() ? lines(ref.note) : [])]) : [paragraph(state.referencesStatus === 'none' ? '담당자 확인: 별도 참고자료 없음' : '[작성 필요] 참고자료·붙임 유무 확인')]),
    paragraph('제출 전 남은 확인', true), ...(opinionRequestIssues(state).length ? opinionRequestIssues(state).map(issue => paragraph(`- ${issue}`)) : [paragraph('항목 누락 검사를 통과했습니다. 실제 요청권한·관할·법적 쟁점·첨부 및 기관의 제출 절차를 별도로 확인하세요.')]),
    paragraph('붙임 목록은 파일 첨부 완료를 의미하지 않습니다. 원본 서식의 예시 체크표시·의결일·국정과제 번호는 실제 입력값으로 재사용하지 않습니다.'),
  ];
  return { id: 'opinion', name: '의견제시요청서작성자료', title, blocks, layout: 'support', formSource: { label: '사용자 제공 자치법규 의견제시 요청서 원본 HWPX', url: '/references/opinion-request.hwpx', adaptation: '사전 확인 및 본문 1–6항을 입력값으로 재구성한 작성자료 · 원본 배치에 직접 기입한 파일이 아님' } };
}
