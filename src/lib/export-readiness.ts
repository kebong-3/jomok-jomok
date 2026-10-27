import type { DocModel } from './docs';
import type { Project } from './project';
import { draftingChecks } from './document-settings';
import { reasonInputHash } from './review';
import { hashText, parseRule } from '@/engine';
import { amendmentDecisionHash, amendmentKind, deriveProject, replacementDraftHash } from './amendment-method';
import { authorityArticleReviews } from './authority-review';
import { priorAddendaHash, transitionReviewWarnings } from './transition-review';
import { enactRule } from './pipeline';
import { opinionRequestIssues, opinionRequestStatus } from './opinion-request';
import { consultationReviewIssues } from './consultation-review';

export interface ExportNotice {
  id: string;
  message: string;
  destination: 'articles' | 'reason' | 'lint' | 'fields' | 'transitions' | 'procedure';
}

export interface DocumentReadiness {
  available: boolean;
  draft: boolean;
  notices: ExportNotice[];
  unavailableReason?: string;
}

export interface ExportReviewOptions {
  amendmentHash?: string;
  reasonBusy?: boolean;
  must?: number;
  rejected?: number;
}

/** Review status describes the saved draft; it must not prevent taking that draft away to edit. */
export function documentReadiness(doc: DocModel | undefined, project: Project, options: ExportReviewOptions = {}): DocumentReadiness {
  const hasContent = doc?.blocks.some(block => block.type === 'p'
    ? block.runs.some(run => run.text.trim())
    : block.rows.some(row => row.cells.flat(2).some(run => run.text.trim())));
  if (!doc || !hasContent) {
    return { available: false, draft: true, notices: [], unavailableReason: '아직 내려받을 문서 내용이 없습니다. 조문을 작성하면 여기에서 받을 수 있어요.' };
  }
  const notices: ExportNotice[] = [];
  const add = (id: string, message: string, destination: ExportNotice['destination']) => notices.push({ id, message, destination });
  if (project.mode === 'enact') {
    const articles = project.enact?.outline ?? [];
    const empty = articles.filter(article => !article.paragraphs.some(text => text.trim())).length;
    const unreviewed = articles.filter(article => article.provenance === 'ai' && article.paragraphs.some(text => text.trim())).length;
    if (!articles.length) add('no-articles', '제정 조문이 아직 작성되지 않았습니다.', 'articles');
    if (empty) add('empty-articles', `본문을 작성하지 않은 조문 ${empty}개가 있습니다.`, 'articles');
    if (unreviewed) add('unreviewed-articles', `담당자 검토 전인 AI 조문 ${unreviewed}개가 있습니다.`, 'articles');
    if (articles.length && !project.enact?.outlineConfirmed) add('outline-unconfirmed', '조문 체계의 담당자 확인이 남아 있습니다.', 'articles');
  } else {
    const accepted = project.spec.ops.filter(op => op.status === 'accepted').length;
    const pending = project.spec.ops.filter(op => op.status === 'proposed').length;
    const method = amendmentKind(project);
    if (method === 'partial' && !accepted) add('no-amendments', '수락한 개정 내용이 없어 현재 원문과 서식만 포함됩니다.', 'articles');
    if (method === 'partial' && pending) add('pending-amendments', `수락하지 않은 개정 제안 ${pending}개는 문서에 반영되지 않았습니다.`, 'articles');
    if (method !== 'partial' && (!project.amendmentDecision?.note.trim() || project.amendmentDecision.confirmedHash !== amendmentDecisionHash(project))) add('method-review', '전부개정·폐지 방식의 선택 이유와 현재 본문·적용 관계의 담당자 확인이 남아 있습니다.', 'articles');
    if (method === 'full' && (!project.replacementDraft || project.replacementDraft.confirmedHash !== replacementDraftHash(project.replacementDraft.raw, project))) add('full-text-review', '전부개정 본칙 전체와 별표·서식의 작성·원문 대조가 남아 있습니다.', 'articles');
    if (method !== 'partial') {
      const source = parseRule(project.source.raw, project.kind, project.title);
      const prior = project.spec.addenda.priorAddendaReview;
      if (!prior?.note.trim() || prior.decision === 'unreviewed' || prior.sourceHash !== priorAddendaHash(source, method)) add('prior-addenda-review', '종전 부칙 중 계속 필요한 적용례·경과조치·특례의 검토가 남아 있습니다.', 'transitions');
    }
  }
  if (options.rejected) add('rejected-amendments', `적용하지 못한 변경 ${options.rejected}개는 문서에 반영되지 않았습니다.`, 'articles');
  if (options.must) add('must-fix', `자동 점검에서 반드시 고칠 문제 ${options.must}개가 남아 있습니다.`, 'lint');

  const rule = project.mode === 'enact' ? enactRule(project) : deriveProject(project, parseRule(project.source.raw, project.kind, project.title)).after;
  const transitions = transitionReviewWarnings(rule, project.spec.addenda);
  if (transitions.length) add('transition-review', `기존 업무·일몰 검토 ${transitions.length}건에 확인이 남아 있습니다. 미확인 부칙 문장은 출력에서 제외했습니다.`, 'transitions');
  if (doc.id === 'authority' || doc.id === 'checklist' || project.authorityReview?.entries.length) {
    const pending = authorityArticleReviews(project, rule).filter(row => row.status !== 'reviewed').length;
    if (pending) add('authority-review', `조문별 권한·근거표 ${pending}개 조문에 작성·재확인이 남아 있습니다.`, 'lint');
  }
  if (doc.id === 'opinion') {
    const count = project.opinionRequest ? opinionRequestIssues(project.opinionRequest).length : 1;
    if (count || opinionRequestStatus(project) !== 'reviewed') add('opinion-review', `의견제시 요청서의 입력·요청요건·현재 작업 대조가 남아 있습니다${count ? `(${count}항목)` : ''}. 원본 서식과 대조한 뒤 제출 준비에 사용하세요.`, 'procedure');
  }
  if (doc.id === 'consultation' || (project.consultationReview && doc.id === 'checklist')) {
    const issues = consultationReviewIssues(project, rule);
    if (issues.length) add('consultation-review', `제출의견 처리·통지·재예고 검토 ${issues.length}항목에 확인이 남아 있습니다.`, 'procedure');
  }

  // A missing reason must not gate an independently available bill or checklist.
  if (doc.id === 'reason' || doc.id === 'notice') {
    if (options.reasonBusy) add('reason-writing', '이유서를 작성 중입니다. 지금 화면에 있는 내용으로 저장합니다.', 'reason');
    else if (!project.prose?.reason.trim()) add('reason-missing', '제정·개정이유가 아직 작성되지 않아 작성란으로 남습니다.', 'reason');
    else if (project.prose.specHash !== reasonInputHash(project, options.amendmentHash)) add('reason-stale', '이유서가 현재 조문으로 갱신되기 전의 내용입니다.', 'reason');
    else if (!project.prose.reviewed) add('reason-review', '이유서의 담당자 검토가 남아 있습니다.', 'reason');
  }
  if (doc.id === 'notice') {
    const fields = project.documentSettings?.notice;
    const missing = [
      ['number', '공고번호'], ['date', '공고일'], ['deadline', '제출기한'],
      ['department', '담당부서'], ['method', '제출방법'], ['website', '전문 공개 위치'],
    ].filter(([key]) => !fields?.[key as keyof NonNullable<typeof fields>]?.trim()).map(([, label]) => label);
    if (missing.length) add('notice-fields', `${missing.join('·')} 확인·입력이 남아 있습니다.`, 'fields');
    if (fields?.date && fields.deadline && fields.deadline < fields.date) add('notice-dates', '의견 제출기한이 공고일보다 앞섭니다.', 'fields');
  }
  if (doc.id === 'checklist') {
    const hash = reasonInputHash(project, options.amendmentHash);
    const pending = draftingChecks(project.kind).filter(check => {
      const saved = project.documentSettings?.checks?.find(item => item.id === check.id);
      return !saved || saved.result === 'unreviewed' || saved.result === 'needs_work' || saved.sourceHash !== hash;
    }).length;
    if (pending) add('checklist-review', `입안점검표 ${pending}개 항목에 검토·보완이 남아 있습니다.`, 'fields');
  }
  return { available: true, draft: notices.length > 0, notices };
}

/** The same marked document is used for preview, both exports, clipboard, and print. */
export function documentForExport(doc: DocModel, readiness: DocumentReadiness): DocModel {
  if (!readiness.draft || !readiness.available) return doc;
  const note = `검토용 초안 · ${readiness.notices.map(item => item.message).join(' ')}`;
  const first = doc.blocks[0];
  const insert = first?.type === 'p' && first.runs.some(run => run.size === 'title') ? 1 : 0;
  return {
    ...doc,
    name: `${doc.name}(검토용)`,
    blocks: [
      ...doc.blocks.slice(0, insert),
      { type: 'p', runs: [{ text: note, size: 'small' }], align: 'left' },
      ...doc.blocks.slice(insert),
    ],
  };
}

export function uniqueExportNotices(states: DocumentReadiness[]): ExportNotice[] {
  return [...new Map(states.flatMap(state => state.notices).map(notice => [notice.id, notice])).values()];
}

/** User-facing file versions ignore save timestamps and usage counters, but bind actual content and selection. */
export function preparedDownloadVersion(project: Project, docs: DocModel[], selected: string, format: string): string {
  const { updatedAt: _updatedAt, evaluation, ...content } = project;
  const recordedEvaluation = evaluation && { ...evaluation, exportCount: undefined, firstExportAt: undefined };
  return hashText(JSON.stringify({ project: content, recordedEvaluation, docs, selected, format }));
}
