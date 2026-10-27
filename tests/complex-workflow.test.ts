import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { collectCitations, derive, parseRule, type ChangeOp, type ChangeSpec, type Rule } from '@/engine';
import { buildAmendDocs, type DocModel } from '@/lib/docs';
import { toDocx, toHwpx } from '@/lib/export';
import { profileById } from '@/config/profiles';
import type { Project } from '@/lib/project';

// Fictional, 19-article source. These tests verify structure/content in exported
// archives; they do not establish visual fidelity or native Hancom compatibility.
const raw = readFileSync(path.resolve(__dirname, '../docs/fixtures/complex-regulation.txt'), 'utf8');
const newParagraph = '신청인은 전자문서로 서류를 제출할 수 있으며 운영자는 접수 사실을 즉시 알려야 한다.';
const publicResult = '시장은 제5조제3항에 따른 승인 처리 결과를 분기마다 공개하여야 한다.';
const changes: ChangeOp[] = [
  { op: 'insert_paragraph', art: { art: 5 }, position: 2, text: newParagraph },
  { op: 'replace_text', target: { kind: 'unit', ref: { art: 5, para: 2 } }, find: '7일', replace: '10일' },
  { op: 'insert_article', after: { art: 7 }, title: '결과의 공개', paragraphs: [publicResult], policy: 'branch' },
  { op: 'replace_text', target: { kind: 'unit', ref: { art: 1, artBr: 2 } }, find: '신청인', replace: '이용자' },
  { op: 'replace_text', target: { kind: 'annex', annexKind: 'table', num: 1 }, find: '회의실 5,000원', replace: '회의실 7,000원' },
];
const spec: ChangeSpec = {
  ops: changes.map((change, index) => ({ id: `complex-${index + 1}`, change, status: 'accepted', provenance: 'human' })),
  addenda: { effective: 'date', date: '2027-01-01' },
};
const article = (rule: Rule, num: number, br?: number) => rule.articles.find((a) => a.num === num && a.br === br)!;
const paragraph = (rule: Rule, num: number, para?: number, br?: number) => article(rule, num, br).paragraphs.find((p) => p.num === para)!;
const flattenDoc = (doc: DocModel) => doc.blocks.map((block) => block.type === 'p'
  ? block.runs.map((run) => run.text).join('')
  : block.rows.map((row) => row.cells.map((cell) => cell.map((line) => line.map((run) => run.text).join('')).join('\n')).join('\n')).join('\n')).join('\n');

function prepare() {
  const before = parseRule(raw, 'rule');
  const derived = derive(before, spec);
  const project: Project = {
    id: 'complex-regression', title: before.title, kind: 'rule', mode: 'amend', createdAt: 0, updatedAt: 0,
    profileId: 'hanbit-city', source: { type: 'paste', raw, hash: '' },
    intent: '전자문서 접수, 결과 공개와 처리기한 조정 및 사용료 변경', spec, excludedFixes: [], evidence: [], log: [],
  };
  const docs = buildAmendDocs(project, before, derived, profileById('hanbit-city'));
  return { before, derived, docs };
}

function xmlText(xml: string): string {
  expect(XMLValidator.validate(xml)).toBe(true);
  const nodes = new XMLParser({ preserveOrder: true, removeNSPrefix: true, ignoreAttributes: true, parseTagValue: false, trimValues: false, htmlEntities: true }).parse(xml) as Record<string, unknown>[];
  const text: string[] = [];
  const visit = (list: Record<string, unknown>[], inText = false) => {
    for (const node of list) for (const [tag, value] of Object.entries(node)) {
      if (tag === '#text' && inText) text.push(String(value));
      else if (Array.isArray(value)) visit(value as Record<string, unknown>[], inText || tag === 't');
    }
  };
  visit(nodes);
  return text.join('');
}

describe('복합 규정 개정에서 원문 → 변경 → 산출물 회귀', () => {
  it('가지번호 조문을 독립적으로 읽고 가지조를 인용하는 본문은 새 조문으로 읽지 않는다', () => {
    const before = parseRule(raw, 'rule');
    expect(before.articles).toHaveLength(19);
    expect(before.diagnostics).toEqual([]);
    expect(article(before, 1, 2).title).toBe('운영 원칙');
    expect(article(before, 10, 12).title).toBe('위원회 지원');
    expect(article(before, 10, 12).paragraphs).toHaveLength(2);
    expect(paragraph(before, 6).text).toContain('제1조의2에 따른 운영 원칙');
    expect(before.articles.filter((a) => a.num === 1 && a.br === 2)).toHaveLength(1);
    expect(before.annexes).toHaveLength(3);
    expect(before.preamble?.[0]).toContain('허구의 규정');
  });

  it('항 신설 후에도 원문 주소로 지정한 항을 수정하고 호·목·미변경 조항과 별표를 보존한다', () => {
    const { before, derived: d } = prepare();
    expect(d.rejected).toEqual([]);
    expect(d.after.articles).toHaveLength(20);
    const application = article(d.after, 5);
    expect(application.paragraphs.map((p) => p.num)).toEqual([1, 2, 3, 4]);
    expect(paragraph(d.after, 5, 1).text).toBe(paragraph(before, 5, 1).text);
    expect(paragraph(d.after, 5, 1).text).toContain('1. 별지 제1호서식의 이용신청서\n2. 행사 목적과 참가 인원을 적은 이용계획서');
    expect(paragraph(d.after, 5, 2).text).toBe(newParagraph);
    expect(paragraph(d.after, 5, 3).text).toBe('운영자는 신청을 받은 날부터 10일 이내에 승인 여부를 알려야 한다.');
    expect(paragraph(d.after, 5, 4).text).toBe(paragraph(before, 5, 3).text);
    expect(paragraph(d.after, 7, undefined, 2).text).toBe(publicResult);
    expect(paragraph(d.after, 1, undefined, 2).text).toContain('이용자의 접근성');
    for (const num of [2, 3, 4, 7, 8, 10, 12, 14, 15, 16, 17]) {
      expect(article(d.after, num)).toEqual(article(before, num));
    }
    expect(d.after.annexes[0].text).toBe(before.annexes[0].text.replace('회의실 5,000원', '회의실 7,000원'));
    expect(d.after.annexes[1]).toEqual(before.annexes[1]);
    expect(paragraph(before, 5, 2).text).toContain('7일');
    expect(before.annexes[0].text).toContain('5,000원');
  });

  it('절대·상대·가지조·서식 인용을 새 항 번호로 연결하고 신설 조문의 새 번호는 다시 밀지 않는다', () => {
    const { derived: d } = prepare();
    expect(paragraph(d.after, 6).text).toContain('제5조제3항');
    expect(paragraph(d.after, 6).text).toContain('제1조의2에 따른');
    expect(paragraph(d.after, 9).text).toContain('제5조제4항');
    expect(paragraph(d.after, 10, 1, 12).text).toContain('제5조제3항');
    expect(paragraph(d.after, 11).text).toContain('제10조의12제1항');
    expect(paragraph(d.after, 13).text).toContain('제5조제3항 및 같은 조 제4항');
    expect(d.after.annexes[2].text).toContain('제5조제3항');
    expect(paragraph(d.after, 7, undefined, 2).text).toBe(publicResult);
    expect(d.fixes.filter((fix) => fix.reason === 'moved')).toHaveLength(6);
    const dangling = collectCitations(d.after).filter((citation) => {
      const target = article(d.after, citation.target.art, citation.target.artBr);
      return !target || (citation.target.para !== undefined && !target.paragraphs.some((p) => p.num === citation.target.para));
    });
    expect(dangling).toEqual([]);
    expect(d.lint.filter((issue) => issue.code.startsWith('인용-') && issue.tier === 'must')).toEqual([]);
  });

  it('개정문·대비표·개정 후 전문이 같은 변경과 별표·서식 본문을 나타낸다', () => {
    const { before, derived: d, docs } = prepare();
    const amendment = flattenDoc(docs.find((doc) => doc.id === 'amend')!);
    const comparison = flattenDoc(docs.find((doc) => doc.id === 'comparison')!);
    const full = flattenDoc(docs.find((doc) => doc.id === 'full')!);
    expect(amendment).toContain('제7조의2를 다음과 같이 신설한다.');
    expect(amendment).toContain('제3항(종전의 제2항) 중');
    expect(amendment).toContain('별표 1을 별지와 같이 한다.');
    expect(amendment).toContain('별지 제1호서식을 별지와 같이 한다.');
    expect(amendment).toContain('2027년 1월 1일부터 시행한다.');
    for (const text of [amendment, comparison, full]) {
      expect(text).toContain(newParagraph);
      expect(text).toContain(publicResult);
      expect(text).toContain('10일');
      expect(text).toContain('7,000원');
      expect(text).toContain('제5조제3항');
    }
    expect(full).toBe(d.fullText);
    expect(full).toContain('[별표 2] 비영리 행사 감면 요건');
    expect(full).toContain('※ 행사 결과를 운영자에게 제출하여야 한다.');
    const feeRow = d.comparison.find((row) => row.key === before.annexes[0].uid)!;
    const formRow = d.comparison.find((row) => row.key === before.annexes[2].uid)!;
    expect(feeRow.left.flat().filter((segment) => segment.underline).map((segment) => segment.text).join('')).toContain('5,000원');
    expect(feeRow.right.flat().filter((segment) => segment.underline).map((segment) => segment.text).join('')).toContain('7,000원');
    expect(formRow.right.flat().filter((segment) => segment.underline).map((segment) => segment.text).join('')).toContain('제5조제3항');
    expect(d.comparison.some((row) => row.key === before.annexes[1].uid)).toBe(false);
    expect(comparison).toContain('별표·서식 본문 텍스트 비교');
    expect(d.lint.filter((issue) => issue.code.startsWith('정합-'))).toEqual([]);
  });

  it('실제 HWPX·DOCX 압축 파일의 XML에 개정 내용·별표·서식이 빠짐없이 들어간다', async () => {
    const { docs } = prepare();
    const deliverables = docs.filter((doc) => ['amend', 'comparison', 'full'].includes(doc.id));
    for (const doc of deliverables) {
      const hwpx = unzipSync(toHwpx(doc));
      const docx = unzipSync(await toDocx(doc));
      expect(strFromU8(hwpx.mimetype)).toBe('application/hwp+zip');
      expect(docx['[Content_Types].xml']).toBeDefined();
      const hwpText = xmlText(strFromU8(hwpx['Contents/section0.xml']));
      const wordText = xmlText(strFromU8(docx['word/document.xml']));
      for (const body of [hwpText, wordText]) {
        expect(body, doc.id).toContain(newParagraph);
        expect(body, doc.id).toContain(publicResult);
        expect(body, doc.id).toContain('10일');
        expect(body, doc.id).toContain('7,000원');
        expect(body, doc.id).toContain('제5조제3항');
        expect(body, doc.id).toContain('이용신청서');
      }
      if (doc.id === 'comparison') {
        expect(strFromU8(hwpx['Contents/section0.xml'])).toContain('<hp:tbl');
        expect(strFromU8(docx['word/document.xml'])).toContain('<w:tbl>');
      }
      if (doc.id === 'full') {
        for (const body of [hwpText, wordText]) {
          expect(body).toContain('별표 2');
          expect(body).toContain('※ 행사 결과를 운영자에게 제출하여야 한다.');
          expect(body).toContain('허구의 규정');
        }
      }
    }
  });
});
