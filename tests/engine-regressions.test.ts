import { describe, expect, it } from 'vitest';
import { derive, parseRule, renderRule, collectCitations, buildAddenda, type ChangeOp, type SpecOp } from '@/engine';
import { rowsToPlain } from '@/engine/comparison';
import { buildAmendDocs } from '@/lib/docs';
import { profileById } from '@/config/profiles';
import type { Project } from '@/lib/project';

const accepted = (change: ChangeOp, id = 'change'): SpecOp => ({ id, change, status: 'accepted', provenance: 'human' });
const compute = (source: string, changes: ChangeOp[]) => {
  const before = parseRule(source);
  const spec = { ops: changes.map((c, i) => accepted(c, String(i))), addenda: { effective: 'promulgation' as const } };
  return { before, spec, d: derive(before, spec) };
};

describe('번호 이동과 개정문 정합성 회귀', () => {
  it.each([1, 2])('무번호 단일 본문에 %s항을 신설하면 제목 외의 부분을 올바른 항으로 바꾼다', (position) => {
    const { d } = compute('시험 규칙\n제1조(기준) 기존 본문을 적용한다.', [{ op: 'insert_paragraph', art: { art: 1 }, position, text: '새 기준을 적용한다.' }]);
    expect(d.amendPlain).toContain(`제1조 제목 외의 부분을 제${position === 1 ? 2 : 1}항으로 하고`);
    expect(d.amendPlain).toContain(`같은 조에 제${position}항을 다음과 같이 신설한다.`);
    expect(d.amendPlain).not.toContain('undefined');
    expect(rowsToPlain(d.comparison)).toContain('(현행 제목 외의 부분과 같음)');
    expect(d.after.articles[0].paragraphs.map((p) => p.num)).toEqual([1, 2]);
  });

  it('밀린 기존 항의 자구 수정은 신설 항 대신 새 항 번호와 종전 번호로 지시한다', () => {
    const { d } = compute('시험 규칙\n제1조(대상) ① 첫 기준이다.\n② 접수기한은 3일로 한다.', [
      { op: 'insert_paragraph', art: { art: 1 }, position: 2, text: '추가 기준이다.' },
      { op: 'replace_text', target: { kind: 'unit', ref: { art: 1, para: 2 } }, find: '3일', replace: '5일' },
    ]);
    expect(d.after.articles[0].paragraphs[2].text).toContain('5일');
    expect(d.amendPlain).toContain('같은 조 제3항(종전의 제2항) 중');
    expect(d.amendPlain).not.toContain('같은 조 제2항 중');
  });

  it('조와 항을 동시에 밀어도 상대 인용과 수정 대상은 원문 주소로 해석한다', () => {
    const { d } = compute('시험 규칙\n제1조(목적) 목적이다.\n제2조(기준) ① 기준이다.\n② 제1항에 따른다.\n제3조(다른 기준) ① 다르다.\n② 다르다.', [
      { op: 'insert_article', after: { art: 1 }, title: '신설', paragraphs: ['신설 본문이다.'], policy: 'renumber' },
      { op: 'insert_paragraph', art: { art: 2 }, position: 1, text: '새 기준이다.' },
    ]);
    const moved = d.after.articles.find((a) => a.num === 3)!;
    expect(moved.paragraphs[2].text).toBe('제2항에 따른다.');
    const fix = d.fixes.find((f) => f.where === '제3조제3항')!;
    expect(fix.target).toEqual({ kind: 'unit', ref: { art: 2, artBr: undefined, para: 2 } });
    expect(d.amendPlain).toContain('제3조제3항(종전의 제2항) 중');
  });

  it('범위 밖 항 위치를 임의로 조정하지 않고 거절한다', () => {
    const { d } = compute('시험 규칙\n제1조(기준) 본문이다.', [{ op: 'insert_paragraph', art: { art: 1 }, position: 99, text: '잘못된 위치다.' }]);
    expect(d.rejected).toHaveLength(1);
    expect(d.after.articles[0].paragraphs).toHaveLength(1);
    expect(d.after.articles[0].paragraphs[0].num).toBeUndefined();
  });
});

describe('삭제 조문과 원문 보존 회귀', () => {
  it('제목 힌트가 원문 제목과 같으면 전문에 제목을 중복 출력하지 않는다', () => {
    const r = parseRule('시험 규칙\n※ 원문 안내\n제1조(목적) 목적이다.', 'rule', '시험 규칙');
    const text = renderRule(r);
    expect(text.match(/시험 규칙/g)).toHaveLength(1);
    expect(text).toContain('※ 원문 안내');
  });
  it('삭제된 조 내부의 인용은 남은 규정의 수정 사항으로 세지 않는다', () => {
    const { d } = compute('시험 규칙\n제1조(기준) ① 기준이다.\n② 다른 기준이다.\n제2조(인용) 제1조제2항에 따른다.', [
      { op: 'delete_article', target: { art: 2 } },
      { op: 'delete_paragraph', target: { art: 1, para: 2 } },
    ]);
    expect(collectCitations(d.after)).toHaveLength(0);
    expect(d.fixes).toHaveLength(0);
    expect(d.lint.filter((l) => l.code.startsWith('인용-'))).toHaveLength(0);
  });

  it('장·절 표제와 본문·별표의 주석을 전문에서 보존한다', () => {
    const raw = '시험 규칙\n※ 원문 안내\n제1장 총칙\n제1절 목적\n제1조(목적) 목적이다.\n제2장 절차\n제2조(절차) 절차다.\n※ 특별한 경우는 제외한다.\n[별표 1] 금액\n기본 100원\n※ 초과분은 별도 정산한다.';
    const r = parseRule(raw);
    const text = renderRule(r);
    expect(r.articles[0].headings).toEqual(['제1장 총칙', '제1절 목적']);
    expect(r.articles[1].headings).toEqual(['제2장 절차']);
    for (const line of raw.split('\n')) expect(text).toContain(line);
    expect(r.diagnostics).toHaveLength(0);
  });

  it('조와 같은 줄에 있는 삭제된 첫 항도 삭제 상태로 읽는다', () => {
    const r = parseRule('시험 규칙\n제1조(기준) ① 삭제 <2025. 1. 1.>\n② 본문이다.');
    expect(r.articles[0].paragraphs[0].deleted).toBe(true);
  });
});

describe('문서 세트 단일원천 회귀', () => {
  it('수락했지만 적용할 수 없는 변경은 반드시 고칠 점검 항목에 남긴다', () => {
    const { d } = compute('시험 규칙\n제1조(목적) 원래 본문이다.', [
      { op: 'replace_text', target: { kind: 'unit', ref: { art: 1 } }, find: '원문에 없는 문자열', replace: '다른 본문' },
    ]);
    expect(d.rejected).toHaveLength(1);
    expect(d.lint).toContainEqual(expect.objectContaining({ code: '정합-02', tier: 'must', origin: 'introduced', where: '변경 제안 1' }));
    expect(d.lint.find((issue) => issue.code === '정합-02')?.message).toContain('문서에 반영되지 않았습니다');
    expect(d.fullText).toContain('원래 본문이다.');
  });

  it('이전 재검토기한 선택은 검토 요청으로 보관하고 부칙에 작성란을 만들지 않는다', () => {
    const before = parseRule('시험 지침\n제1조(목적) 원래 본문이다.', 'guideline');
    const d = derive(before, { ops: [], addenda: { effective: 'promulgation', reviewDeadline: true } });
    expect(d.amend.addendaText.join('\n')).not.toContain('재검토기한');
    expect(d.amend.addendaText.join('\n')).not.toMatch(/3년|20\d{2}년/);
    expect(d.lint).toContainEqual(expect.objectContaining({ code: '부칙-04', tier: 'check' }));
    expect(d.lint.find(issue => issue.code === '부칙-04')?.where).toBe('본칙 마지막');
  });

  it('재검토기한 선택으로 부칙을 생성하지 않고 기존 경과조치 입력을 보존한다', () => {
    expect(buildAddenda('guideline', { effective: 'promulgation' }).join('\n')).not.toContain('재검토기한');
    expect(buildAddenda('ordinance', { effective: 'promulgation', reviewDeadline: true }).join('\n')).not.toContain('재검토기한');
    const text = buildAddenda('directive', { effective: 'promulgation', transitional: '종전의 규정에 따른다.', reviewDeadline: true }).join('\n');
    expect(text).toContain('제2조(경과조치)');
    expect(text).not.toContain('재검토기한');
  });

  it('교체를 선언한 별지의 새 본문을 개정안에 첨부하고 미확인 예산조치를 단정하지 않는다', () => {
    const { before, spec, d } = compute('시험 규칙\n제1조(기준) 본문이다.\n[별지 제2호서식] 신청서\n기한: 3일', [
      { op: 'replace_text', target: { kind: 'annex', annexKind: 'form', num: 2 }, find: '3일', replace: '5일' },
    ]);
    const project: Project = { id: 'test', title: before.title, kind: 'rule', mode: 'amend', createdAt: 0, updatedAt: 0, profileId: 'hanbit-city', source: { type: 'paste', raw: '', hash: '' }, intent: '', spec, evidence: [], excludedFixes: [], log: [] };
    const docs = buildAmendDocs(project, before, d, profileById('hanbit-city'));
    const amend = JSON.stringify(docs.find((x) => x.id === 'amend'));
    expect(amend).toContain('별지 제2호서식을 별지와 같이 한다.');
    expect(amend).toContain('[별지 제2호서식] 신청서');
    expect(amend).toContain('기한: 5일');
    const reason = JSON.stringify(docs.find((x) => x.id === 'reason'));
    expect(reason).not.toContain('별도 조치 필요 없음');
    expect(reason).not.toContain('해당 기관 없음');
    expect(reason).toContain('확인 필요');
  });
});
