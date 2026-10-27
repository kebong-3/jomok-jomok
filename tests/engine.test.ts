import { describe, expect, it } from 'vitest';
import { parseRule, derive, extractCitations, finalOf, euro, eulReul, previewInsertPolicy, rowsToPlainForTest } from './helpers';
import { TRAVEL_RULE } from '@/data/samples';
import type { ChangeSpec, SpecOp } from '@/engine';

const travelOps: SpecOp[] = [
  { id: 'o1', status: 'accepted', provenance: 'ai', change: { op: 'insert_paragraph', art: { art: 5 }, position: 2, text: '제1항에도 불구하고 대규모 행사 등으로 숙박비가 상한액을 초과하는 경우에는 상한액의 100분의 30 범위에서 추가로 지급할 수 있다.' } },
  { id: 'o2', status: 'accepted', provenance: 'ai', change: { op: 'insert_article', after: { art: 7 }, title: '출장 결과 보고', paragraphs: ['출장자는 출장을 마친 후 7일 이내에 출장 결과를 소속 부서장에게 보고하여야 한다.'], policy: 'branch' } },
  { id: 'o3', status: 'accepted', provenance: 'ai', change: { op: 'delete_paragraph', target: { art: 9, para: 2 } } },
];
const spec: ChangeSpec = { ops: travelOps, addenda: { effective: 'promulgation' } };

describe('파서', () => {
  const r = parseRule(TRAVEL_RULE, 'rule');
  it('제목·조·항·별표', () => {
    expect(r.title).toBe('한빛시 공무원 여비 지급 규칙');
    expect(r.articles).toHaveLength(13);
    expect(r.articles[4].paragraphs.map((p) => p.num)).toEqual([1, 2, 3]);
    expect(r.articles[1].paragraphs[0].text).toContain('1. "여비"란');
    expect(r.annexes.map((a) => `${a.kind}${a.num}`)).toEqual(['table1', 'form1', 'form2']);
    expect(r.addenda).toContain('2025년 1월 1일');
    expect(r.diagnostics).toHaveLength(0);
  });
});

describe('인용 추출', () => {
  it('절대·상대·같은 조·범위·외부 구분', () => {
    const c = extractCitations('「공무원 여비 규정」 제16조와 제5조제2항, 같은 조 제3항, 제4항 및 제2조부터 제4조까지', { num: 9 });
    expect(c.map((x) => x.raw)).toEqual(['제5조제2항', '제3항', '제4항', '제2조', '제4조']);
    expect(c[1].target).toEqual({ art: 5, para: 3, artBr: undefined });
    expect(c[2].target.art).toBe(5);
    expect(extractCitations('제4항에 따라', { num: 9 })[0].target).toEqual({ art: 9, artBr: undefined, para: 4 });
  });
});

describe('조사', () => {
  it('받침', () => {
    expect(eulReul('제5조제2항')).toBe('을');
    expect(euro('제5조제3항')).toBe('으로');
    expect(eulReul('제7조의2')).toBe('를');
    expect(euro('2년')).toBe('으로');
    expect(euro('1일')).toBe('로');
    expect(eulReul('100')).toBe('을');
    expect(finalOf('시장')).toBe('other');
  });
});

describe('개정 시나리오(한빛시 여비 규칙)', () => {
  const before = parseRule(TRAVEL_RULE, 'rule');
  const d = derive(before, spec);
  it('항 신설로 번호가 밀린 인용 3건 자동 정정', () => {
    const moved = d.fixes.filter((f) => f.reason === 'moved');
    expect(moved.map((f) => `${f.where}:${f.before}>${f.after}`).sort()).toEqual([
      '별지 제2호서식:제5조제2항>제5조제3항',
      '제11조제1항:제5조제3항>제5조제4항',
      '제8조:제5조제2항>제5조제3항',
    ]);
  });
  it('삭제된 항을 인용하는 2곳 탐지', () => {
    const del = d.fixes.filter((f) => f.reason === 'deleted');
    expect(del.map((f) => f.where).sort()).toEqual(['제10조', '제12조']);
    expect(d.lint.filter((l) => l.code === '인용-02').length).toBe(2);
  });
  it('개정문 문형', () => {
    const t = d.amendPlain;
    expect(t).toContain('한빛시 공무원 여비 지급 규칙 일부를 다음과 같이 개정한다.');
    expect(t).toContain('제5조제2항 및 제3항을 각각 제3항 및 제4항으로 하고, 같은 조에 제2항을 다음과 같이 신설한다.');
    expect(t).toContain('제7조의2를 다음과 같이 신설한다.');
    expect(t).toContain('제8조 중 “제5조제2항”을 “제5조제3항”으로 한다.');
    expect(t).toContain('제9조제2항을 삭제한다.');
    expect(t).toContain('제11조제1항 중 “제5조제3항”을 “제5조제4항”으로 한다.');
    expect(t).toContain('별지 제2호서식을 별지와 같이 한다.');
    expect(t).toContain('이 규칙은 공포한 날부터 시행한다.');
    expect(t).not.toMatch(/추가한다|삽입한다|폐지한다/);
  });
  it('대비표 표기', () => {
    const plain = rowsToPlainForTest(d.comparison);
    expect(plain).toContain('<신 설>');
    expect(plain).toContain('<삭 제>');
    expect(plain).toContain('(현행 제2항과 같음)');
    expect(plain).toContain('_제5조제3항_');
    expect(plain).toMatch(/-{3,}/);
  });
  it('결정성: 같은 명세 → 같은 지문', () => {
    const d2 = derive(parseRule(TRAVEL_RULE, 'rule'), spec);
    expect(d2.specHash).toBe(d.specHash);
    expect(d2.amendPlain).toBe(d.amendPlain);
  });
  it('번호 방식 미리보기: 가지번호 0건, 밀기 n건', () => {
    const p = previewInsertPolicy(before, travelOps, 'o2');
    expect(p.branch).toBe(0);
    expect(p.renumber).toBeGreaterThan(0);
  });
});
