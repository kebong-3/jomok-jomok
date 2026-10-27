import { describe, expect, it } from 'vitest';
import { parseRule } from '@/engine';
import { PROFILES } from '@/config/profiles';
import type { Project } from '@/lib/project';
import { amendmentDecisionHash, deriveProject, methodSuggestion, replacementDraftHash, workMethodLabel } from '@/lib/amendment-method';
import { buildAmendDocs, type DocModel } from '@/lib/docs';
import { documentReadiness } from '@/lib/export-readiness';
import { reasonInputHash } from '@/lib/review';
import { reviewDocument, reviewDraft, reviewDraftHash } from '@/lib/work-review';
import { priorAddendaHash } from '@/lib/transition-review';
import { parseProjectBackup, serializeProjectBackup } from '@/lib/project-transfer';

const original = '한빛시 시험 조례\n제1조(목적) 종전의 목적이다.\n제2조(위원회) 위원 임기는 2년으로 한다.\n부칙\n제1조(시행일) 공포한 날부터 시행한다.\n제2조(경과조치) 종전 위원의 임기를 보장한다.';
function project(patch: Partial<Project> = {}): Project { return { id: 'method-work', title: '한빛시 시험 조례', mode: 'amend', kind: 'ordinance', createdAt: 0, updatedAt: 0, profileId: 'hanbit-city', source: { raw: original, hash: '', type: 'paste' }, intent: '규정의 체계를 전면 개편한다.', spec: { ops: [], addenda: { effective: 'promulgation' } }, evidence: [], excludedFixes: [], log: [], ...patch }; }
function text(doc: DocModel) { return doc.blocks.flatMap(block => block.type === 'p' ? block.runs.map(run => run.text) : block.rows.flatMap(row => row.cells.flat(2).map(run => run.text))).join('\n'); }
function documents(p: Project) { const before = parseRule(p.source.raw, p.kind, p.title); const d = deriveProject(p, before); return { d, docs: buildAmendDocs(p, before, d, PROFILES[0]) }; }

describe('입안 방식별 문서와 변경 후 재확인', () => {
  it('기존 보관작업은 일부개정으로 유지하고 변경량으로 방식을 결정하지 않는다', () => {
    expect(workMethodLabel(project())).toBe('일부개정');
    expect(methodSuggestion('용어 100곳 변경').kind).toBe('partial');
    expect(methodSuggestion('조문 체계 전면 개편').kind).toBe('full');
  });
  it('새 본문을 쓰지 않은 전부개정안은 종전 본문을 새 내용처럼 내보내지 않는다', () => {
    const { d, docs } = documents(project({ amendmentKind: 'full' }));
    expect(d.lint.some(issue => issue.code === '전부-00')).toBe(true);
    const bill = text(docs.find(doc => doc.id === 'amend')!);
    expect(bill).toContain('[작성 필요]'); expect(bill).not.toContain('종전의 목적이다.');
  });
  it('전부개정 제목·지시문·새 본문·별지와 붙임이 일치하고 종전 부칙을 몰래 승계하지 않는다', () => {
    const p = project({ amendmentKind: 'full', replacementDraft: { raw: '한빛시 시험 조례\n제1조(목적) 새 목적이다.\n제2조(절차) 새 절차이다.\n[별지 제1호서식] 신청서\n신청 사유' } });
    const { docs } = documents(p); const all = docs.map(text).join('\n');
    expect(docs.some(doc => doc.id === 'comparison')).toBe(false);
    expect(all).toContain('전부개정조례안'); expect(all).toContain('전부를 다음과 같이 개정한다.');
    expect(all).toContain('새 목적이다.'); expect(all).toContain('신청 사유');
    expect(all).not.toContain('일부를 다음과 같이'); expect(all).not.toContain('신·구조문대비표 별첨');
    expect(text(docs.find(doc => doc.id === 'amend')!)).not.toContain('종전 위원의 임기를 보장한다.');
  });
  it('전부개정 본문에 부칙을 붙여 넣으면 충돌을 알리고 그 부칙은 출력에서 제외한다', () => {
    const { d, docs } = documents(project({ amendmentKind: 'full', replacementDraft: { raw: '한빛시 시험 조례\n제1조(목적) 새 목적.\n부칙\n이 조례는 2099년부터 시행한다.' } }));
    expect(d.lint.some(issue => issue.code === '전부-01')).toBe(true);
    expect(text(docs[0])).not.toContain('2099년');
  });
  it('폐지안은 보관된 일부변경을 적용하지 않으며 대비표와 개정 후 본문을 만들지 않는다', () => {
    const p = project({ amendmentKind: 'repeal', spec: { addenda: { effective: 'promulgation' }, ops: [{ id: 'old-op', status: 'accepted', provenance: 'human', change: { op: 'replace_text', target: { kind: 'unit', ref: { art: 1 } }, find: '종전의 목적', replace: '숨은 변경' } }] } });
    const { d, docs } = documents(p); const bill = text(docs[0]);
    expect(bill).toContain('한빛시 시험 조례는 폐지한다.'); expect(bill).not.toContain('숨은 변경');
    expect(docs.some(doc => ['comparison', 'full'].includes(doc.id))).toBe(false);
    expect(documentReadiness(docs[0], p, { amendmentHash: d.specHash }).notices.some(n => n.id === 'no-amendments')).toBe(false);
  });
  it('방식·새 본문을 바꾸면 이유서와 검토문 지문이 달라진다', () => {
    const p = project({ amendmentKind: 'full', replacementDraft: { raw: '새 조례\n제1조(목적) 새 목적.' } });
    const changed = { ...p, replacementDraft: { raw: '새 조례\n제1조(목적) 바뀐 목적.' } };
    expect(reasonInputHash(p, 'same')).not.toBe(reasonInputHash(changed, 'same'));
    expect(reviewDraftHash(p)).not.toBe(reviewDraftHash(changed));
    expect(reasonInputHash(p, 'same')).not.toBe(reasonInputHash({ ...p, amendmentKind: 'repeal' }, 'same'));
  });
  it('전체 검토는 새 본문을, 폐지 검토는 폐지문과 종전 부칙을 구분해 보낸다', () => {
    const full = project({ amendmentKind: 'full', replacementDraft: { raw: '새 조례\n제1조(목적) 검토할 새 목적.' } });
    expect(reviewDocument(full, reviewDraft(full).units.map(unit => unit.key))).toContain('검토할 새 목적.');
    const repeal = project({ amendmentKind: 'repeal' });
    const draft = reviewDraft(repeal);
    expect(draft.units.some(unit => unit.key === 'repeal')).toBe(true);
    expect(draft.units.some(unit => unit.label === '종전 부칙(참고)')).toBe(true);
  });
  it('정확한 새 본문 대조와 방식 선택을 기록해도 종전 부칙 미확인을 자동 완료로 바꾸지 않는다', () => {
    let p = project({ amendmentKind: 'full', replacementDraft: { raw: '새 조례\n제1조(목적) 새 목적.' }, amendmentDecision: { note: '체계 전면 개편' } });
    p = { ...p, replacementDraft: { ...p.replacementDraft!, confirmedHash: replacementDraftHash(p.replacementDraft!.raw, p) }, amendmentDecision: { ...p.amendmentDecision!, confirmedHash: amendmentDecisionHash(p) } };
    const { docs } = documents(p); const state = documentReadiness(docs[0], p);
    expect(state.available).toBe(true); expect(state.notices.some(n => n.id === 'prior-addenda-review')).toBe(true);
    const originalRule = parseRule(p.source.raw, p.kind, p.title);
    expect(priorAddendaHash(originalRule, 'full')).not.toBe(priorAddendaHash(originalRule, 'repeal'));
  });
  it('새 방식과 전체 본문·선택 이유는 작업 보관파일 왕복에서 보존한다', async () => {
    const p = project({ amendmentKind: 'full', replacementDraft: { raw: '한빛시 시험 조례\n제1조(목적) 새 목적.' }, amendmentDecision: { note: '새 제도의 체계를 정비한다.' } });
    const restored = (await parseProjectBackup(await serializeProjectBackup(p))).project;
    expect(restored.amendmentKind).toBe('full'); expect(restored.replacementDraft).toEqual(p.replacementDraft); expect(restored.amendmentDecision).toEqual(p.amendmentDecision);
  });
});
