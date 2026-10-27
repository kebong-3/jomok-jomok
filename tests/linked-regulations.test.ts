import { describe, expect, it } from 'vitest';
import { parseRule } from '@/engine';
import type { Project } from '@/lib/project';
import { deriveProject } from '@/lib/amendment-method';
import { analyzeLinkedRegulations, linkedRegulationsSchema, type LinkedRegulation } from '@/lib/linked-regulations';
import { buildLinkedRegulationsDoc } from '@/lib/linked-regulations-doc';
import { parseProjectBackup, serializeProjectBackup } from '@/lib/project-transfer';

const raw = '가상시 문화 지원 조례\n제1조(목적) 문화 활동을 지원한다.\n제2조(신청) ① 신청인은 자료를 제출한다.\n② 제출 기한은 10일로 한다.\n제3조(지원액) 지원액은 10만원으로 한다.\n[별표 1] 지원 기준\n일반 기준\n[별지 제2호서식] 신청서\n신청인 성명';
const title = '가상시 문화 지원 조례';
const peer = (raw: string, id = 'peer-1'): LinkedRegulation => ({ id, title: '가상시 기관 업무 규칙', kind: 'rule', raw, effectiveAt: '2026-01-01', partial: true, sourceUrl: 'https://www.law.go.kr' });
function project(linked: LinkedRegulation[] = []): Project { return { id: 'linked-fixture', createdAt: 1, updatedAt: 1, mode: 'amend', title, kind: 'ordinance', profileId: 'hanbit-city', source: { type: 'paste', raw, hash: '' }, intent: '지원 기준을 변경한다.', spec: { ops: [], addenda: { effective: 'promulgation' } }, evidence: [], excludedFixes: [], log: [], linkedRegulations: linked }; }
function analyze(p: Project) { const before = parseRule(p.source.raw, p.kind, p.title); const after = deriveProject(p, before).after; return { result: analyzeLinkedRegulations(p, before, after), before, after }; }

describe('기관 규정 묶음의 인용 영향 후보', () => {
  it('동일한 제5조만 보이거나 다른 규정·약칭을 인용하면 자동 연결하지 않는다', () => {
    const p = project([peer('제1조(기준) 제2조에 따른다.\n제2조(다른 규정) 「다른시 문화 지원 조례」 제2조 및 「가상시 문화 지원 조례 시행규칙」 제2조를 준용한다.\n제3조(약칭) 같은 조례 제2조를 따른다.')]);
    const { result } = analyze(p);
    expect(result.exact).toEqual([]); expect(result.uncertain).toEqual([]);
  });
  it('정확한 규정명+조문을 연결하고 인용부호 없는 제목은 불확실 후보로 분리한다', () => {
    const p = project([peer(`제1조(기준) 「${title}」 제3조에 따른다.\n제2조(참고) ${title} 제2조를 참고한다.`)]);
    const { result } = analyze(p);
    expect(result.exact).toHaveLength(1); expect(result.exact[0].target).toEqual({ kind: 'article', art: 3 });
    expect(result.uncertain).toHaveLength(1); expect(result.uncertain[0].impact).toBe('unlinked');
    expect(result.exact[0].line).toBe(1); expect(result.exact[0].location).toContain('원문 1행');
  });
  it('조문 이동을 원래 대상의 식별자로 추적하고 다른 번호의 조문과 혼동하지 않는다', () => {
    const p = project([peer(`제1조(지원) 「${title}」 제3조에 따른다.`)]);
    p.spec.ops = [{ id: 'insert', status: 'accepted', provenance: 'human', change: { op: 'insert_article', after: { art: 1 }, title: '새 절차', paragraphs: ['새 절차를 정한다.'], policy: 'renumber' } }];
    const { result } = analyze(p);
    expect(result.exact[0].impact).toBe('moved'); expect(result.exact[0].movedTo).toBe('제4조');
    expect(result.exact[0].afterText).toContain('10만원');
  });
  it('대상 삭제는 번호 정정으로 완료하지 않고 업무 근거·문맥 재작성 후보로 남긴다', () => {
    const p = project([peer(`제1조(지원) 「${title}」 제3조에 따른다.`)]);
    p.spec.ops = [{ id: 'delete', status: 'accepted', provenance: 'human', change: { op: 'delete_article', target: { art: 3 } } }];
    const { result } = analyze(p);
    expect(result.exact[0].impact).toBe('deleted'); expect(result.exact[0].movedTo).toBeUndefined();
    expect(result.exact[0].checks.join(' ')).toContain('번호만');
  });
  it('항·별표·서식의 인용과 본문 변경을 서로 다른 대상으로 검토한다', () => {
    const p = project([peer(`제1조(기준) 「${title}」 제2조제2항을 따른다.\n[별표 2] 정산 기준\n「${title}」 별표 1을 적용한다.\n[별지 제1호서식] 신청 확인서\n「${title}」 별지 제2호서식을 제출한다.`)]);
    p.spec.ops = [
      { id: 'para', status: 'accepted', provenance: 'human', change: { op: 'replace_text', target: { kind: 'unit', ref: { art: 2, para: 2 } }, find: '10일', replace: '20일' } },
      { id: 'table', status: 'accepted', provenance: 'human', change: { op: 'replace_text', target: { kind: 'annex', annexKind: 'table', num: 1 }, find: '일반 기준', replace: '변경 기준' } },
      { id: 'form', status: 'accepted', provenance: 'human', change: { op: 'replace_text', target: { kind: 'annex', annexKind: 'form', num: 2 }, find: '신청인 성명', replace: '신청인 연락처' } },
    ];
    const { result } = analyze(p);
    expect(result.exact).toHaveLength(3); expect(result.exact.map(item => item.impact)).toEqual(['text_changed', 'text_changed', 'text_changed']);
    expect(result.exact[1].location).toContain('별표 2'); expect(result.exact[2].location).toContain('별지 제1호서식');
    expect(result.exact[0].afterText).toContain('20일'); expect(result.exact[1].afterText).toContain('변경 기준');
  });
  it('전부개정은 같은 번호·문구도 동일 조문으로 확정하지 않고 폐지는 근거 재검토로 표시한다', () => {
    const p = project([peer(`제1조(지원) 「${title}」 제3조에 따른다.`)]);
    p.amendmentKind = 'full'; p.replacementDraft = { raw };
    expect(analyze(p).result.exact[0].impact).toBe('full');
    p.amendmentKind = 'repeal';
    expect(analyze(p).result.exact[0].impact).toBe('repeal');
  });
  it('기준 원문에 없는 대상은 현재 새 조문 번호가 같더라도 이동으로 추정하지 않는다', () => {
    const p = project([peer(`제1조(지원) 「${title}」 제99조에 따른다.`)]);
    const { result } = analyze(p);
    expect(result.exact[0].impact).toBe('missing_before'); expect(result.exact[0].afterText).toBeUndefined();
  });
  it('같은 조문 번호를 가진 여러 규정·판본은 문서 식별자를 보존해 구분한다', () => {
    const p = project([peer(`제1조(지원) 「${title}」 제3조를 따른다.`, 'peer-a'), peer(`제1조(지원) 「${title}」 제3조를 따른다.`, 'peer-b')]);
    const { result } = analyze(p);
    expect(new Set(result.exact.map(item => item.id)).size).toBe(2); expect(result.exact.map(item => item.regulationId)).toEqual(['peer-a', 'peer-b']);
  });
  it('부분 원문·시행일 미확인·미등록 주소는 확인범위에 남고 미입력 자료까지 검토했다고 하지 않는다', () => {
    const p = project([{ ...peer(`제1조(지원) 「${title}」 제3조를 따른다.`), effectiveAt: undefined, sourceUrl: undefined }]);
    const { result, before, after } = analyze(p);
    expect(result.coverage[0].issues.join(' ')).toContain('부분 원문'); expect(result.coverage[0].issues.join(' ')).toContain('시행일');
    const doc = buildLinkedRegulationsDoc(p, before, after);
    expect(doc.id).toBe('linked'); expect(JSON.stringify(doc.blocks)).toContain('자동 수정·정비 완료');
  });
  it('원문 개수·크기·중복 식별자·잘못된 날짜와 인증정보 포함 주소를 제한한다', () => {
    expect(linkedRegulationsSchema.safeParse(Array.from({ length: 9 }, (_, index) => peer('본문', `peer-${index}`))).success).toBe(false);
    expect(linkedRegulationsSchema.safeParse([peer('본문'), peer('다른 본문')]).success).toBe(false);
    expect(linkedRegulationsSchema.safeParse([peer('가'.repeat(100001))]).success).toBe(false);
    expect(linkedRegulationsSchema.safeParse([{ ...peer('본문'), effectiveAt: '2026-02-30' }]).success).toBe(false);
    expect(linkedRegulationsSchema.safeParse([{ ...peer('본문'), sourceUrl: 'https://www.law.go.kr/?apiKey=not-real' }]).success).toBe(false);
  });
  it('시행예정 연결 원문은 현행 규정의 영향과 구분해 확인 범위에 남긴다', () => {
    const p = project([{ ...peer(`제1조(지원) 「${title}」 제3조를 따른다.`), effectiveAt: '2099-01-01' }]);
    expect(analyze(p).result.coverage[0].issues.join(' ')).toContain('시행예정');
  });
  it('작업 보관파일에서 원문·규정 ID·판본·완전성 기록을 그대로 복원한다', async () => {
    const p = project([peer(`제1조(지원) 「${title}」 제3조를 따른다.`)]);
    const restored = (await parseProjectBackup(await serializeProjectBackup(p))).project;
    expect(restored.linkedRegulations).toEqual(p.linkedRegulations);
    expect(analyze(restored).result.exact[0].regulationId).toBe('peer-1');
  });
});
