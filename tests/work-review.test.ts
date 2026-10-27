import { describe, expect, it } from 'vitest';
import { getKnowledgeChunk } from '@/server/knowledge';
import type { Project } from '@/lib/project';
import { applyReviewSelection, knowledgeAssistResultSchema, reviewChangeStates, reviewDocument, reviewDraft, reviewDraftHash, undoReviewApplication, workReviewSessionSchema, type ReviewChange, type WorkReviewSession } from '@/lib/work-review';

function fixture(): Project {
  return { id: 'review-test', createdAt: 0, updatedAt: 0, mode: 'enact', kind: 'ordinance', title: '한빛시 지원 조례', profileId: 'hanbit-city',
    source: { type: 'none', raw: '', hash: '' }, intent: '', purpose: '지원 절차를 정한다.', spec: { ops: [], addenda: { effective: 'promulgation' } }, excludedFixes: [], evidence: [], log: [],
    enact: { title: '한빛시 지원 조례', outlineConfirmed: true, outline: [
      { id: 'one', title: '목적', paragraphs: ['주민이 이용하고자 하는 시설을 지원한다.'], provenance: 'ai' },
      { id: 'two', title: '신청', paragraphs: ['신청서는 서면으로 제출한다. 기한은 7일로 한다.', '시장은 필요한 사항을 공고한다.'], provenance: 'human' },
    ] },
    prose: { reason: '지원 절차를 정하기 위함.', mainPoints: ['신청 절차'], specHash: 'prior', reviewed: true, via: 'template' },
  };
}
function session(p: Project, edits: { before: string; after: string; changeType?: ReviewChange['changeType'] }[], scope = reviewDraft(p).units.map(unit => unit.key)): WorkReviewSession {
  const source = getKnowledgeChunk('KB-local-ordinance-2026-p0366-c01')!;
  const citations = [{ id: source.id, quote: source.text.slice(0, 80) }];
  return { version: 1, id: 'session-test', stage: 'articles', createdAt: 100, scope, snapshotHash: reviewDraftHash(p), selected: [],
    request: { question: '가상 조례 문장 정비를 검토해 주세요.', document: reviewDocument(p, scope), kind: p.kind, mode: 'review' },
    result: { status: 'answered', sources: [source], retrieval: { role: 'knowledge_review', query: '조문 검토', retrievedAt: '2026-10-26T01:00:00.000Z', version: 'test', method: 'hybrid-lexical', status: 'retrieved', citations: [source] },
      answer: { summary: '문장별로 확인합니다.', points: [{ heading: '검토 의견', explanation: '원문의 적용 대상을 확인하세요.', citations }], changes: edits.map(edit => ({ ...edit, changeType: edit.changeType ?? 'wording', reason: '검토용 문구 제안', citations })), nextSteps: ['현행 근거 확인'], needsCheck: ['기관 적용 여부'] } },
  };
}

describe('작업 안 검토 — 선택한 문장만 반영', () => {
  it('선택한 수정만 반영하고 다른 조문·원본·미확인 상태를 보존한다', () => {
    const p = fixture(), s = session(p, [{ before: '이용하고자 하는', after: '이용하려는' }, { before: '서면으로', after: '전자문서로' }]);
    const result = applyReviewSelection(p, s, [0], 500);
    expect(result.error).toBeUndefined(); expect(result.count).toBe(1);
    expect(result.project.enact!.outline[0].paragraphs[0]).toBe('주민이 이용하려는 시설을 지원한다.');
    expect(result.project.enact!.outline[0].provenance).toBe('ai');
    expect(result.project.enact!.outline[1]).toEqual(p.enact!.outline[1]);
    expect(result.project.source).toEqual(p.source); expect(result.project.prose!.reviewed).toBe(false);
    expect(p.enact!.outline[0].paragraphs[0]).toContain('이용하고자 하는');
    expect(result.project.workReview!.result.answer!.changes).toHaveLength(2);
  });

  it('같은 항의 겹치지 않는 두 수정을 위치 역순으로 반영해 문자를 잃지 않는다', () => {
    const p = fixture(), s = session(p, [{ before: '서면으로', after: '전자문서 또는 서면으로' }, { before: '7일', after: '10일', changeType: 'substance' }]);
    const result = applyReviewSelection(p, s, [1, 0], 500);
    expect(result.count).toBe(2);
    expect(result.project.enact!.outline[1].paragraphs[0]).toBe('신청서는 전자문서 또는 서면으로 제출한다. 기한은 10일로 한다.');
    expect(result.project.workReview!.application!.undo.paragraphs).toHaveLength(1);
    const undone = undoReviewApplication(result.project, 600);
    expect(undone.error).toBeUndefined(); expect(undone.project.enact).toEqual(p.enact);
  });

  it('겹치는 수정 제안은 하나도 적용하지 않는다', () => {
    const p = fixture(), s = session(p, [{ before: '서면으로 제출한다.', after: '전자문서로 제출한다.' }, { before: '제출한다.', after: '보낸다.' }]);
    const result = applyReviewSelection(p, s, [0, 1]);
    expect(result.count).toBe(0); expect(result.error).toContain('겹칩니다'); expect(result.project).toBe(p);
  });

  it('검토 이후 본문이나 개정 의도가 바뀌면 적용을 멈춘다', () => {
    const p = fixture(), s = session(p, [{ before: '7일', after: '10일' }]);
    for (const changed of [{ ...p, purpose: '다른 대상에 지원한다.' }, { ...p, enact: { ...p.enact!, title: '다른 조례' } }]) {
      expect(applyReviewSelection(changed, s, [0]).error).toContain('검토 이후');
      expect(reviewChangeStates(changed, s)[0].eligible).toBe(false);
    }
  });

  it('전체 항 삭제와 제목·번호가 포함된 구조 변경은 문장 치환으로 처리하지 않는다', () => {
    const p = fixture();
    const full = p.enact!.outline[0].paragraphs[0];
    expect(reviewChangeStates(p, session(p, [{ before: full, after: '' }]))[0].reason).toContain('항 전체');
    expect(reviewChangeStates(p, session(p, [{ before: '제1조(목적)', after: '제1조(취지)' }]))[0].eligible).toBe(false);
  });

  it('문장 뒤에 새 조·항·부칙·별표·별지·장 표지를 넣어 파서 구조를 바꾸지 못한다', () => {
    const p = fixture(), before = p.enact!.outline[0].paragraphs[0];
    for (const marker of ['제3조(새 조) 새 내용을 정한다.', '② 새 항을 정한다.', '㊿ 새 항을 정한다.', '부칙', '[별표 1] 새 표', '[별지 제1호서식] 새 서식', '제2장 추가 사항']) {
      const s = session(p, [{ before, after: `${before}\n${marker}` }]);
      expect(reviewChangeStates(p, s)[0].reason, marker).toContain('구조');
      expect(applyReviewSelection(p, s, [0]).project, marker).toBe(p);
    }
    // Each harmless-looking edit can combine into a new heading at a boundary.
    p.enact!.outline[0].paragraphs[0] = '현재 내용을 정한다.\n제X어(추가) 처리한다.';
    const combined = session(p, [{ before: 'X', after: '3' }, { before: '어(추가)', after: '조(추가)' }]);
    expect(reviewChangeStates(p, combined).every(state => state.eligible)).toBe(true);
    expect(applyReviewSelection(p, combined, [0, 1]).error).toContain('구조');
    expect(applyReviewSelection(p, combined, [0, 1]).project).toBe(p);
  });

  it('기존 호·목 줄과 인용 문장은 보존하며 줄 첫머리의 정상 인용도 허용한다', () => {
    const p = fixture();
    p.enact!.outline[0].paragraphs[0] = '다음 서류를 제출한다.\n1. 신청서\n가. 성명과 주소\n제3조에 따라 처리한다.';
    const before = p.enact!.outline[0].paragraphs[0];
    const after = before.replace('성명과 주소', '이름과 주소').replace('제3조에 따라 처리한다.', '제3조에 따라 처리한다. 필요한 내용을 안내한다.');
    const result = applyReviewSelection(p, session(p, [{ before, after }]), [0], 500);
    expect(result.error).toBeUndefined(); expect(result.count).toBe(1);
    expect(result.project.enact!.outline[0].paragraphs[0]).toBe(after);
  });

  it('빈 선택·없는 번호·중복 선택을 구분하고 같은 반영을 두 번 하지 않는다', () => {
    const p = fixture(), s = session(p, [{ before: '7일', after: '10일' }]);
    expect(applyReviewSelection(p, s, []).count).toBe(0);
    expect(applyReviewSelection(p, s, [7]).error).toContain('존재하지');
    const once = applyReviewSelection(p, s, [0, 0], 500);
    expect(once.count).toBe(1);
    expect(applyReviewSelection(once.project, once.project.workReview!, [0]).error).toContain('이미 반영');
  });

  it('리터럴 달러·따옴표를 뜻하지 않은 치환 패턴으로 해석하지 않는다', () => {
    const p = fixture(), after = '$& / $$ / $` / $\' 표기를 보존한다';
    const s = session(p, [{ before: '서면으로', after }]);
    const result = applyReviewSelection(p, s, [0], 500);
    expect(result.project.enact!.outline[1].paragraphs[0]).toContain(after);
  });

  it('되돌린 뒤 같은 검토를 다시 선택해 반영할 수 있다', () => {
    const p = fixture(), s = session(p, [{ before: '7일', after: '10일' }]);
    const once = applyReviewSelection(p, s, [0], 500);
    const undone = undoReviewApplication(once.project, 600);
    expect(undone.project.workReview!.application!.undoneAt).toBe(600);
    expect(reviewChangeStates(undone.project, undone.project.workReview!)[0].eligible).toBe(true);
    const again = applyReviewSelection(undone.project, undone.project.workReview!, [0], 700);
    expect(again.count).toBe(1); expect(again.project.workReview!.application!.undoneAt).toBeUndefined();
  });
});

describe('검토 기록의 출처·원문 대조', () => {
  it('유효한 실제 정본 인용과 적용 전후 기록을 보관한다', () => {
    const p = fixture(), s = session(p, [{ before: '7일', after: '10일' }]);
    expect(workReviewSessionSchema.safeParse(s).success).toBe(true);
    const applied = applyReviewSelection(p, s, [0], 500).project.workReview!;
    expect(workReviewSessionSchema.safeParse(applied).success).toBe(true);
  });
  it('출처 ID만 맞고 문장이 다른 인용을 거부한다', () => {
    const s = session(fixture(), []);
    s.result.answer!.points[0].citations[0].quote = '원문에는 존재하지 않는 인용문을 임의로 만들어 넣었습니다.';
    expect(knowledgeAssistResultSchema.safeParse(s.result).success).toBe(false);
  });
  it('검색 결과와 보관한 검색 기록이 다르면 거부한다', () => {
    const s = structuredClone(session(fixture(), []));
    s.result.retrieval.citations[0] = { ...s.result.retrieval.citations[0], text: s.result.retrieval.citations[0].text + '변조' };
    expect(knowledgeAssistResultSchema.safeParse(s.result).success).toBe(false);
  });
  it('검토 본문 밖 before 또는 반영 기록의 after 변경을 거부한다', () => {
    const p = fixture(), s = session(p, [{ before: '없는 문장', after: '새 문장' }]);
    expect(workReviewSessionSchema.safeParse(s).success).toBe(false);
    const valid = session(p, [{ before: '7일', after: '10일' }]);
    const applied = applyReviewSelection(p, valid, [0], 500).project.workReview!;
    applied.application!.changes[0].after = '100일';
    expect(workReviewSessionSchema.safeParse(applied).success).toBe(false);
  });
  it('12,000자를 넘은 검토 기록은 거부하며 조문 선택은 본문을 잘라내지 않는다', () => {
    const p = fixture(); p.enact!.outline[0].paragraphs = ['가'.repeat(12020)];
    const s = session(p, [], ['enact:one']);
    expect(s.request.document).toContain('가'.repeat(12020));
    expect(workReviewSessionSchema.safeParse(s).success).toBe(false);
    expect(reviewDocument(p, ['enact:two'])).not.toContain('가'.repeat(20));
    expect(reviewDocument(p, ['enact:two'])).toContain(p.enact!.outline[1].paragraphs[1]);
  });
});
