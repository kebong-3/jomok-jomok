import { describe, expect, it } from 'vitest';
import { hashText, parseRule } from '@/engine';
import { replacementDraftHash } from '@/lib/amendment-method';
import type { Project } from '@/lib/project';
import { sha256 } from '@/lib/project';
import { parseProjectBackup, serializeProjectBackup } from '@/lib/project-transfer';
import { getKnowledgeChunk } from '@/server/knowledge';
import { applyReviewSelection, reviewChangeStates, reviewDocument, reviewDraft, reviewDraftHash, undoReviewApplication, workReviewSessionSchema, type ReviewChange, type WorkReviewSession } from '@/lib/work-review';

function fixture(): Project {
  const p: Project = { id: 'full-review', createdAt: 0, updatedAt: 0, mode: 'amend', amendmentKind: 'full', kind: 'ordinance', title: '한빛시 지원 조례', profileId: 'hanbit-city',
    source: { type: 'paste', raw: '한빛시 지원 조례\n제1조(목적) 종전 목적을 정한다.\n부칙\n이 조례는 공포한 날부터 시행한다.', hash: '' },
    intent: '체계를 전면 정비한다.', spec: { ops: [], addenda: { effective: 'promulgation' } }, excludedFixes: [], evidence: [], log: [],
    replacementDraft: { raw: '한빛시 지원 조례\r\n\r\n제1장 총칙\r\n제1조(목적) 주민이 이용하고자 하는 시설을 지원한다.\r\n제2절 신청\r\n제3조(신청) ① 신청서는 서면으로 제출한다. 기한은 7일로 한다.\r\n② 시장은 필요한 사항을 공고한다.\r\n제3조의2(처리) 당해 신청인을 안내한다.\r\n\r\n[별표 1] 지원 기준\r\n  항목\t금액  \r\n  서면으로  제출한다.\r\n[별지 제1호서식] 신청서\r\n성명:   __________\r\n주소:   __________\r\n' },
    prose: { reason: '업무 절차 정비', mainPoints: ['신청 정비'], via: 'template', specHash: 'prior', reviewed: true } };
  p.replacementDraft!.confirmedHash = replacementDraftHash(p.replacementDraft!.raw, p);
  return p;
}
function session(p: Project, edits: Pick<ReviewChange, 'before' | 'after'>[], scope = reviewDraft(p).units.map(unit => unit.key)): WorkReviewSession {
  const source = getKnowledgeChunk('KB-local-ordinance-2026-p0366-c01')!;
  const citations = [{ id: source.id, quote: source.text.slice(0, 80) }];
  return { version: 1, id: 'full-session', stage: 'articles', createdAt: 100, scope, snapshotHash: reviewDraftHash(p), selected: [],
    request: { question: '현재 전부개정 본문의 문장을 검토해 주세요.', document: reviewDocument(p, scope), kind: p.kind, mode: 'review' },
    result: { status: 'answered', sources: [source], retrieval: { role: 'knowledge_review', query: '문장 정비', retrievedAt: '2026-10-27T01:00:00.000Z', version: 'test', method: 'hybrid-lexical', status: 'retrieved', citations: [source] },
      answer: { summary: '문장별 확인', points: [{ heading: '문장 정비', explanation: '변경 전후 의미를 확인하세요.', citations }], changes: edits.map(edit => ({ ...edit, changeType: 'wording', reason: '직접 선택한 문장 정비', citations })), nextSteps: ['현행 근거 확인'], needsCheck: ['변경 범위 확인'] } } };
}

describe('전부개정 새 본문 — 검증된 문장 선택 반영', () => {
  it('새 주소의 선택한 문장만 반영하고 원본·다른 조문·장절·별표·서식의 원문을 그대로 보존한다', () => {
    const p = fixture(), raw = p.replacementDraft!.raw;
    const s = session(p, [{ before: '이용하고자 하는', after: '이용하려는' }, { before: '당해', after: '해당' }]);
    const result = applyReviewSelection(p, s, [1], 500);
    expect(result.error).toBeUndefined(); expect(result.count).toBe(1);
    expect(result.project.replacementDraft!.raw).toBe(raw.replace('당해', '해당'));
    expect(result.project.replacementDraft!.confirmedHash).toBeUndefined();
    expect(result.project.source).toEqual(p.source); expect(result.project.spec).toEqual(p.spec);
    expect(result.project.prose!.reviewed).toBe(false);
    expect(p.replacementDraft!.raw).toBe(raw);
    expect(result.project.workReview!.application!.undo.replacement).toEqual({ beforeRaw: raw, afterRaw: raw.replace('당해', '해당') });
    expect(workReviewSessionSchema.safeParse(result.project.workReview).success).toBe(true);
  });

  it('한 항의 길이가 다른 두 수정과 다른 조의 수정을 동시에 적용해 원본 위치를 잃지 않는다', () => {
    const p = fixture(), raw = p.replacementDraft!.raw;
    const s = session(p, [{ before: '서면으로', after: '전자문서 또는 서면으로' }, { before: '7일', after: '10일' }, { before: '당해', after: '해당' }]);
    const result = applyReviewSelection(p, s, [2, 0, 1], 500);
    expect(result.error).toBeUndefined(); expect(result.count).toBe(3);
    expect(result.project.replacementDraft!.raw).toBe(raw.replace('서면으로', '전자문서 또는 서면으로').replace('7일', '10일').replace('당해', '해당'));
    expect(result.project.replacementDraft!.raw.slice(result.project.replacementDraft!.raw.indexOf('[별표'))).toBe(raw.slice(raw.indexOf('[별표')));
    expect(parseRule(result.project.replacementDraft!.raw).articles.map(a => [a.num, a.br])).toEqual([[1, undefined], [3, undefined], [3, 2]]);
  });

  it('JSON 재실행·작업 보관파일 복원 뒤에도 되돌리기와 재반영을 유지한다', async () => {
    const p = fixture(); p.source.hash = await sha256(p.source.raw);
    const applied = applyReviewSelection(p, session(p, [{ before: '당해', after: '해당' }]), [0], 500);
    expect(applied.error).toBeUndefined();
    const reloaded = JSON.parse(JSON.stringify(applied.project)) as Project;
    const prepared = await parseProjectBackup(await serializeProjectBackup(reloaded));
    expect(prepared.project.replacementDraft!.raw).toBe(applied.project.replacementDraft!.raw);
    expect(prepared.project.workReview!.application!.undo.replacement).toEqual(applied.project.workReview!.application!.undo.replacement);
    const undone = undoReviewApplication(prepared.project, 600);
    expect(undone.error).toBeUndefined(); expect(undone.project.replacementDraft!.raw).toBe(p.replacementDraft!.raw);
    expect(undone.project.replacementDraft!.confirmedHash).toBeUndefined();
    expect(undone.project.workReview!.application!.undoneAt).toBe(600);
    expect(reviewChangeStates(undone.project, undone.project.workReview!)[0].eligible).toBe(true);
    expect(applyReviewSelection(undone.project, undone.project.workReview!, [0], 700).count).toBe(1);
  });

  it('검토 이후 raw·개정 취지·작업 방식 변경과 범위 변조를 막는다', () => {
    const p = fixture(), s = session(p, [{ before: '당해', after: '해당' }]);
    for (const changed of [{ ...p, replacementDraft: { raw: p.replacementDraft!.raw + '\n' } }, { ...p, intent: '목적 변경' }, { ...p, amendmentKind: 'partial' as const }]) {
      expect(applyReviewSelection(changed, s, [0]).error).toContain('검토 이후');
      expect(reviewChangeStates(changed, s)[0].eligible).toBe(false);
    }
    const tampered = { ...s, scope: ['amend:1:0'] };
    expect(applyReviewSelection(p, tampered, [0]).error).toContain('검토 범위');
    expect(reviewChangeStates(p, tampered)[0].eligible).toBe(false);
    const missingInput = { ...s, request: { ...s.request, document: '검토하지 않은 본문' } };
    expect(applyReviewSelection(p, missingInput, [0]).count).toBe(0);
  });

  it('겹치는 수정, 항 전체 삭제, 구조 삽입과 여러 수정의 구조 합성은 원자적으로 거부한다', () => {
    const p = fixture();
    const overlap = session(p, [{ before: '서면으로 제출한다.', after: '전자문서로 제출한다.' }, { before: '제출한다.', after: '보낸다.' }]);
    expect(applyReviewSelection(p, overlap, [0, 1]).error).toContain('겹칩니다');
    for (const marker of ['제9조(추가) 새 내용을 정한다.', '③ 새 항을 정한다.', '부칙', '[별표 2] 다른 표', '[별지 제2호서식] 다른 서식', '제2장 추가']) {
      const s = session(p, [{ before: '당해 신청인을 안내한다.', after: `당해 신청인을 안내한다.\n${marker}` }]);
      expect(applyReviewSelection(p, s, [0]).project, marker).toBe(p);
    }
    const paragraph = '주민이 이용하고자 하는 시설을 지원한다.';
    expect(applyReviewSelection(p, session(p, [{ before: paragraph, after: '' }]), [0]).error).toContain('항 전체');
    const combinedP = { ...p, replacementDraft: { raw: p.replacementDraft!.raw.replace(paragraph, `${paragraph}\r\n제X어(추가) 처리한다.`) } };
    const combined = session(combinedP, [{ before: 'X', after: '9' }, { before: '어(추가)', after: '조(추가)' }]);
    expect(reviewChangeStates(combinedP, combined).every(state => state.eligible)).toBe(true);
    expect(applyReviewSelection(combinedP, combined, [0, 1]).error).toContain('구조');
  });

  it('서로 다른 조문의 동일 문구는 좁힌 검토 범위에서만 반영하고 별표의 같은 문구를 건드리지 않는다', () => {
    const p = fixture(); p.replacementDraft!.raw = p.replacementDraft!.raw.replace('주민이 이용하고자 하는 시설을 지원한다.', '신청서는 서면으로 제출한다.');
    const edit = { before: '서면으로', after: '전자문서로' };
    expect(applyReviewSelection(p, session(p, [edit]), [0]).error).toContain('여러 곳');
    const scoped = session(p, [edit], ['amend:3:0']);
    const result = applyReviewSelection(p, scoped, [0]);
    expect(result.error).toBeUndefined();
    expect(result.project.replacementDraft!.raw).toBe(p.replacementDraft!.raw.replace('제3조(신청) ① 신청서는 서면으로', '제3조(신청) ① 신청서는 전자문서로'));
  });

  it('동시 수정 이후 되돌리기를 멈추고 변조한 undo 원문도 저장 지문과 대조한다', () => {
    const p = fixture(), applied = applyReviewSelection(p, session(p, [{ before: '당해', after: '해당' }]), [0], 500).project;
    const concurrent = { ...applied, replacementDraft: { raw: applied.replacementDraft!.raw.replace('7일', '30일') } };
    expect(undoReviewApplication(concurrent).error).toContain('다시 바뀌');
    const forged = structuredClone(applied); forged.workReview!.application!.undo.replacement!.beforeRaw += '\n변조';
    expect(undoReviewApplication(forged).error).toContain('반영 전 초안');
    expect(undoReviewApplication(concurrent).project).toBe(concurrent);
  });

  it('원문과 검토 문장의 공백·따옴표가 다르면 전역 치환하지 않고 보류한다', () => {
    const p = fixture(); p.replacementDraft!.raw = p.replacementDraft!.raw.replace('당해 신청인을 안내한다.', '“당해”  신청인을 안내한다.');
    const s = session(p, [{ before: '"당해" 신청인을', after: '해당 신청인을' }]);
    expect(reviewChangeStates(p, s)[0].eligible).toBe(true);
    const result = applyReviewSelection(p, s, [0]);
    expect(result.error).toContain('정확한 원문 위치'); expect(result.project).toBe(p);
  });

  it('리터럴 달러 표기를 그대로 넣고 폐지문·부칙·제목의 자동 반영은 계속 금지한다', () => {
    const p = fixture(), literal = '$& $$ $` $\' 표기';
    const result = applyReviewSelection(p, session(p, [{ before: '당해', after: literal }]), [0]);
    expect(result.error).toBeUndefined(); expect(result.project.replacementDraft!.raw).toContain(literal);
    expect(applyReviewSelection(p, session(p, [{ before: '제3조의2(처리)', after: '제3조의2(안내)' }]), [0]).count).toBe(0);
    const repeal: Project = { ...p, amendmentKind: 'repeal' };
    const s = session(repeal, [{ before: '폐지한다.', after: '유지한다.' }]);
    expect(reviewChangeStates(repeal, s)[0].reason).toContain('폐지문');
    expect(applyReviewSelection(repeal, s, [0]).project).toBe(repeal);
    expect(hashText(result.project.replacementDraft!.raw)).not.toBe(hashText(p.replacementDraft!.raw));
  });
});
