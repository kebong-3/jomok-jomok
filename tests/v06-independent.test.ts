import { describe, expect, it } from 'vitest';
import { derive, parseRule, type SpecOp } from '@/engine';
import { emptySpec, sha256, type Project } from '@/lib/project';
import { parseProjectBackup, restoreProjectBackup, serializeProjectBackup } from '@/lib/project-transfer';
import { getKnowledgeChunk } from '@/server/knowledge';
import {
  applyReviewSelection, knowledgeAssistResultSchema, reviewChangeStates, reviewDocument,
  reviewDraft, reviewDraftHash, undoReviewApplication, workReviewSessionSchema,
  type ReviewChange, type WorkReviewSession,
} from '@/lib/work-review';

function project(mode: 'enact' | 'amend' = 'enact'): Project {
  return {
    id: 'independent-review', createdAt: 1_790_000_000_000, updatedAt: 1_790_000_000_000,
    mode, title: '독립 검증용 조례', kind: 'ordinance', profileId: 'hanbit-city',
    source: { type: mode === 'enact' ? 'none' : 'paste', raw: '', hash: '' },
    intent: '검증용 문장을 다듬는다.', evidence: [], excludedFixes: [], log: [], spec: emptySpec(),
    enact: mode === 'enact' ? { title: '독립 검증용 조례', outlineConfirmed: true, outline: [
      { id: 'a1', title: '지원', paragraphs: ['시장은 신청자에게 교육을 제공한다.'], provenance: 'ai' },
      { id: 'a2', title: '확인', paragraphs: ['자료를 확인한다.'], provenance: 'human' },
    ] } : undefined,
  };
}

function citation() {
  const c = getKnowledgeChunk('KB-local-ordinance-2026-p0366-c01');
  if (!c) throw new Error('정본 검증용 발췌문이 없습니다.');
  return c;
}

function change(before: string, after: string): ReviewChange {
  const c = citation();
  return { before, after, reason: '실제 반영 범위를 검사하기 위한 문장 정비 제안', changeType: 'wording', citations: [{ id: c.id, quote: c.text.slice(0, 100) }] };
}

function session(p: Project, changes: ReviewChange[], scope = reviewDraft(p).units.map(unit => unit.key)): WorkReviewSession {
  const c = citation();
  return {
    version: 1, id: 'independent-session', createdAt: 1_790_000_000_000, stage: 'articles',
    scope, snapshotHash: reviewDraftHash(p), selected: [],
    request: { question: '현재 초안의 표현을 검토해 주세요.', document: reviewDocument(p, scope), kind: p.kind, mode: 'review' },
    result: {
      status: 'answered', sources: [c],
      retrieval: { role: 'knowledge_review', query: '현재 초안의 표현을 검토해 주세요.', retrievedAt: '2026-10-26T00:00:00.000Z', version: 'v06-test', method: 'hybrid-lexical', status: 'retrieved', citations: [c] },
      answer: { summary: '검증용 정비 제안입니다.', points: [{ heading: '검토 범위', explanation: '원문 인용과 실제 반영 범위를 각각 확인합니다.', citations: [{ id: c.id, quote: c.text.slice(0, 100) }] }], changes, nextSteps: ['담당자가 선택한 문장만 반영'], needsCheck: ['실제 위임 근거 확인'] },
    },
  };
}

describe('v0.6 독립 검수 — 선택한 수정의 정확한 범위', () => {
  it('다른 조에 같은 문장이 있어도 명시적으로 선택한 한 조만 수정하고 원본 입력은 보존한다', () => {
    const p = project();
    p.enact!.outline[1].paragraphs = ['시장은 신청자에게 교육을 제공한다.'];
    const snapshot = structuredClone(p);
    const s = session(p, [change('교육을 제공한다.', '교육 프로그램을 제공한다.')], ['enact:a1']);
    const result = applyReviewSelection(p, s, [0], 100);
    expect(result.error).toBeUndefined();
    expect(result.count).toBe(1);
    expect(result.project.enact!.outline[0].paragraphs[0]).toBe('시장은 신청자에게 교육 프로그램을 제공한다.');
    expect(result.project.enact!.outline[1]).toEqual(p.enact!.outline[1]);
    expect(result.project.enact!.outline[0].provenance).toBe('ai');
    expect(p).toEqual(snapshot);
    expect(result.project.source).toEqual(p.source);
  });

  it('선택된 같은 조의 두 항에 동일 문장이 있으면 어느 항도 임의로 수정하지 않는다', () => {
    const p = project();
    p.enact!.outline[0].paragraphs = ['자료를 확인한다.', '자료를 확인한다.'];
    const s = session(p, [change('자료를 확인한다.', '신청 자료를 확인한다.')], ['enact:a1']);
    expect(reviewChangeStates(p, s)[0].eligible).toBe(false);
    const result = applyReviewSelection(p, s, [0], 100);
    expect(result.count).toBe(0);
    expect(result.error).toContain('여러 곳');
    expect(result.project).toBe(p);
  });

  it('유효한 제안과 대상이 사라진 제안을 함께 고르면 부분 반영 없이 원자적으로 거부한다', () => {
    const p = project();
    const s = session(p, [change('교육을 제공한다.', '교육 프로그램을 제공한다.'), change('존재하지 않는 문장', '다른 문장')]);
    const snapshot = structuredClone(p);
    const result = applyReviewSelection(p, s, [0, 1], 100);
    expect(result.count).toBe(0);
    expect(result.error).toContain('찾지 못했습니다');
    expect(result.project).toBe(p);
    expect(p).toEqual(snapshot);
  });

  it('같은 문장 범위가 겹치는 두 정비 제안을 동시에 적용하지 않는다', () => {
    const p = project();
    const s = session(p, [change('신청자에게 교육을', '신청인에게 교육을'), change('교육을 제공한다.', '교육 프로그램을 제공한다.')]);
    const result = applyReviewSelection(p, s, [0, 1], 100);
    expect(result.count).toBe(0);
    expect(result.error).toContain('겹칩니다');
    expect(result.project).toBe(p);
  });

  it('검토 이후 본문을 직접 수정하면 오래된 제안을 덮어쓰지 않는다', () => {
    const p = project();
    const s = session(p, [change('교육을 제공한다.', '교육 프로그램을 제공한다.')]);
    p.enact!.outline[1].paragraphs[0] = '담당자가 따로 검토한 내용이다.';
    const result = applyReviewSelection(p, s, [0], 100);
    expect(result.count).toBe(0);
    expect(result.error).toContain('검토 이후 초안');
    expect(result.project).toBe(p);
  });

  it('조·항 이동과 선행 자구 수정을 보존하면서 현재 문장을 원래 조 주소에 반영한다', () => {
    const p = project('amend');
    p.source.raw = '독립 검증용 조례\n제1조(목적) 목적을 정한다.\n제2조(지원) ① 지원 대상을 정한다.\n② 시장은 신청자에게 교육을 제공한다.\n제3조(절차) 제2조제2항에 따른 교육을 안내한다.';
    const prior: SpecOp[] = [
      { id: 'move-article', status: 'accepted', provenance: 'human', change: { op: 'insert_article', after: { art: 1 }, title: '정의', paragraphs: ['용어를 정의한다.'], policy: 'renumber' } },
      { id: 'move-paragraph', status: 'accepted', provenance: 'human', change: { op: 'insert_paragraph', art: { art: 2 }, position: 1, text: '기본 원칙을 정한다.' } },
      { id: 'prior-wording', status: 'accepted', provenance: 'human', change: { op: 'replace_text', target: { kind: 'unit', ref: { art: 2, para: 2 } }, find: '신청자', replace: '신청인' } },
    ];
    p.spec.ops = prior;
    const beforeRaw = p.source.raw;
    const originalDraft = reviewDraft(p).derived!;
    const s = session(p, [change('신청인에게 교육을 제공한다.', '신청인에게 교육 프로그램을 제공한다.')], ['amend:3:0']);
    const result = applyReviewSelection(p, s, [0], 100);
    expect(result.error).toBeUndefined();
    expect(result.count).toBe(1);
    expect(result.project.spec.ops.slice(0, prior.length)).toEqual(prior);
    expect(result.project.spec.ops.at(-1)?.change).toMatchObject({ op: 'replace_text', target: { kind: 'unit', ref: { art: 2 } } });
    const after = derive(parseRule(beforeRaw, p.kind), result.project.spec);
    expect(after.rejected).toEqual([]);
    expect(after.after.articles.find(a => a.num === 3)?.paragraphs[2].text).toBe('시장은 신청인에게 교육 프로그램을 제공한다.');
    expect(after.after.articles.find(a => a.num === 4)?.paragraphs[0].text).toBe('제3조제3항에 따른 교육을 안내한다.');
    expect(result.project.source.raw).toBe(beforeRaw);
    const undone = undoReviewApplication(result.project, 200);
    expect(undone.error).toBeUndefined();
    expect(undone.project.spec.ops).toEqual(prior);
    expect(reviewDraft(undone.project).derived!.fullText).toBe(originalDraft.fullText);
  });

  it('새로 신설한 조는 기존 원문의 다른 조로 잘못 대응하지 않는다', () => {
    const p = project('amend');
    p.source.raw = '독립 검증용 조례\n제1조(목적) 목적을 정한다.\n제2조(기존) 다른 기준이다.';
    p.spec.ops = [{ id: 'new', status: 'accepted', provenance: 'human', change: { op: 'insert_article', after: { art: 1 }, title: '지원', paragraphs: ['교육을 제공한다.'], policy: 'renumber' } }];
    const s = session(p, [change('교육을 제공한다.', '교육 프로그램을 제공한다.')], ['amend:2:0']);
    const result = applyReviewSelection(p, s, [0], 100);
    expect(result.count).toBe(0);
    expect(result.error).toContain('신설');
    expect(result.project).toBe(p);
  });

  it('반영 뒤 공고 필드를 편집해도 되돌리기는 그 필드를 유지하고 본문만 복원한다', () => {
    const p = project();
    const s = session(p, [change('교육을 제공한다.', '교육 프로그램을 제공한다.')]);
    const applied = applyReviewSelection(p, s, [0], 100).project;
    applied.documentSettings = { notice: { number: '검증 공고 7호', department: '정책부서' } };
    const undone = undoReviewApplication(applied, 200);
    expect(undone.error).toBeUndefined();
    expect(undone.project.enact).toEqual(p.enact);
    expect(undone.project.documentSettings).toEqual(applied.documentSettings);
    expect(undone.project.workReview?.application?.undoneAt).toBe(200);
  });

  it('반영 뒤 담당자가 본문을 추가 수정하면 되돌리기로 그 수정을 없애지 않는다', () => {
    const p = project();
    const s = session(p, [change('교육을 제공한다.', '교육 프로그램을 제공한다.')]);
    const applied = applyReviewSelection(p, s, [0], 100).project;
    applied.enact!.outline[1].paragraphs[0] = '담당자의 후속 수정 내용을 보존한다.';
    const snapshot = structuredClone(applied);
    const undone = undoReviewApplication(applied, 200);
    expect(undone.count).toBe(0);
    expect(undone.error).toContain('다른 수정 내용을 보호');
    expect(undone.project).toEqual(snapshot);
  });
});

describe('v0.6 독립 검수 — 검토 결과와 보관파일의 신뢰 범위', () => {
  it('본문에 없는 변경 및 가짜 인용은 보관 가능한 검토 결과로 인정하지 않는다', () => {
    const p = project();
    const s = session(p, [change('교육을 제공한다.', '교육 프로그램을 제공한다.')]);
    expect(workReviewSessionSchema.safeParse(s).success).toBe(true);
    const missingBefore = structuredClone(s);
    missingBefore.result.answer!.changes[0].before = '검토한 원문에 존재하지 않는 다른 문장이다.';
    expect(workReviewSessionSchema.safeParse(missingBefore).success).toBe(false);
    const fakeQuote = structuredClone(s.result);
    fakeQuote.answer!.points[0].citations[0].quote = '정본에 없는 허구의 인용을 검토 근거로 사용한다.';
    expect(knowledgeAssistResultSchema.safeParse(fakeQuote).success).toBe(false);
  });

  it('선택·반영·되돌리기 자료가 백업과 새 작업 복원 뒤에도 정확히 이어진다', async () => {
    const p = project();
    p.source.hash = await sha256(p.source.raw);
    const s = session(p, [change('교육을 제공한다.', '교육 프로그램을 제공한다.')]);
    const applied = applyReviewSelection(p, s, [0], 100).project;
    const prepared = await parseProjectBackup(await serializeProjectBackup(applied));
    expect(prepared.project.workReview).toEqual(applied.workReview);
    const restored = await restoreProjectBackup(prepared, {}, async () => true);
    expect(restored.id).not.toBe(p.id);
    expect(restored.workReview).toEqual(applied.workReview);
    const undone = undoReviewApplication(restored, 200);
    expect(undone.error).toBeUndefined();
    expect(undone.project.enact).toEqual(p.enact);
  });

  it('일반 검색 기록이 없어도 검토 결과에만 담긴 변조 발췌문을 정본 색인과 대조해 거부한다', async () => {
    const p = project();
    p.source.hash = await sha256(p.source.raw);
    const s = session(p, [change('교육을 제공한다.', '교육 프로그램을 제공한다.')]);
    const fake = { ...citation(), text: citation().text + '\n발췌문에 임의로 추가한 가짜 규정 문장.' };
    fake.contentHash = await sha256(fake.text);
    s.result.sources = [fake];
    s.result.retrieval.citations = [fake];
    p.workReview = s;
    p.knowledge = undefined;
    expect(workReviewSessionSchema.safeParse(s).success).toBe(true);
    await expect(serializeProjectBackup(p)).rejects.toThrow('정본 색인');
  });
});
