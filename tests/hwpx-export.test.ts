import { describe, expect, it } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { buildSection, type Block } from '@/lib/hwpx/build';
import { validateHwpxParts } from '@/lib/hwpx/validate';
import { toDocx, toHwpx } from '@/lib/export';
import type { DocModel } from '@/lib/docs';

const blocks: Block[] = [
  { type: 'p', align: 'center', runs: [{ text: '한빛시 검증용 조례안', size: 'title' }] },
  { type: 'p', runs: [{ text: '첫째 줄\n둘째 줄 & <개정> $&\u0000\u000B\ud800 끝 📝', bold: true }] },
  { type: 'p', runs: [{ text: '검토 사항', size: 'heading' }], pageBreakBefore: true },
  { type: 'table', widths: [1, 1, 2], rows: [
    { head: true, cells: [[[{ text: '항목', bold: true }]], [[{ text: '상태', bold: true }]], [[{ text: '근거', bold: true }]]] },
    { cells: [[[{ text: '시행일' }]], [[{ text: '미확인' }]], [[{ text: '공포일\n의견 제출 기한' }]]] },
  ] },
];
const doc: DocModel = { id: 'checklist', title: '조례 $& $1 <검토> "제정"', name: '입안점검표', blocks, layout: 'legislation' };
const parts = (bytes: Uint8Array) => Object.fromEntries(Object.entries(unzipSync(bytes)).map(([name, content]) => [name, strFromU8(content)]));

describe('HWPX 편집 가능한 문서 패키지', () => {
  it('첫 ZIP 항목은 무압축 mimetype이며 모든 XML과 내부 참조가 유효하다', () => {
    const bytes = toHwpx(doc);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    expect(view.getUint16(8, true)).toBe(0);
    expect(strFromU8(bytes.slice(30, 30 + view.getUint16(26, true)))).toBe('mimetype');
    const content = parts(bytes);
    expect(content.mimetype).toBe('application/hwp+zip');
    expect(Object.keys(content)).toHaveLength(10);
    for (const [name, xml] of Object.entries(content)) if (/\.(xml|hpf|rdf)$/.test(name)) expect(XMLValidator.validate(xml), name).toBe(true);
    expect(() => validateHwpxParts(content)).not.toThrow();
    expect(content['Contents/content.hpf']).toContain('<opf:itemref idref="header" linear="no"/>');
    expect(content['Contents/content.hpf']).not.toContain('2026년 3월 7일');
  });

  it('XML 금지문자를 제거하고 줄 나눔·한글·특수문자·이모지와 제목의 $ 문자를 보존한다', () => {
    const content = parts(toHwpx(doc));
    const section = content['Contents/section0.xml'];
    expect(section).toContain('첫째 줄<hp:lineBreak/>둘째 줄 &amp; &lt;개정&gt; $&amp; 끝 📝');
    expect(section).toContain('공포일<hp:lineBreak/>의견 제출 기한');
    expect(section).not.toMatch(/[\u0000\u000B\uD800]/u);
    expect(content['Contents/content.hpf']).toContain('<opf:title>조례 $&amp; $1 &lt;검토&gt; &quot;제정&quot;</opf:title>');
    expect(section).toContain('pageBreak="1"');
  });

  it('공식 HWPX 구조와 같이 글꼴 속성 뒤에 굵게를 두고 매뉴얼 규격을 적용한다', () => {
    const content = parts(toHwpx(doc));
    const header = content['Contents/header.xml'];
    const bold = header.match(/<hh:charPr id="1"[\s\S]*?<\/hh:charPr>/)![0];
    expect(bold.indexOf('<hh:bold')).toBeGreaterThan(bold.indexOf('<hh:offset'));
    expect(bold.indexOf('<hh:bold')).toBeLessThan(bold.indexOf('<hh:underline'));
    expect(bold).toContain('height="1400"');
    expect(header).toContain('face="신명조"');
    expect(header).toContain('lineSpacing type="PERCENT" value="230"');
    expect(content['Contents/section0.xml']).toContain('left="7087" right="7087" top="4535" bottom="4535"');
    const tableWidth = Number(content['Contents/section0.xml'].match(/<hp:sz width="(\d+)"/)![1]);
    const cellWidths = [...content['Contents/section0.xml'].matchAll(/<hp:cellSz width="(\d+)"/g)].slice(0, 3).map(m => Number(m[1]));
    expect(cellWidths.reduce((a, b) => a + b, 0)).toBe(tableWidth);
    const comparison = parts(toHwpx({ ...doc, layout: 'comparison' }));
    expect(comparison['Contents/header.xml']).not.toContain('lineSpacing type="PERCENT" value="230"');
    expect(comparison['Contents/header.xml']).toContain('lineSpacing type="PERCENT" value="180"');
  });

  it('없는 서식 참조·매니페스트 파일·표 셀 누락을 배포 가능한 파일로 만들지 않는다', () => {
    const content = parts(toHwpx(doc));
    expect(() => validateHwpxParts({ ...content, 'Contents/section0.xml': content['Contents/section0.xml'].replace('charPrIDRef="0"', 'charPrIDRef="999"') })).toThrow('서식 참조');
    expect(() => validateHwpxParts({ ...content, 'Contents/content.hpf': content['Contents/content.hpf'].replace('href="Contents/header.xml"', 'href="missing.xml"') })).toThrow('파일 목록');
    expect(() => buildSection([{ type: 'table', widths: [1, 1], rows: [{ cells: [[[{ text: '누락된 셀' }]]] }] }])).toThrow('셀 개수');
  });

  it('DOCX도 같은 문장·줄 나눔과 A4 여백·글꼴·본문 줄 간격을 보존한다', async () => {
    const content = parts(await toDocx(doc));
    const xml = content['word/document.xml'];
    expect(XMLValidator.validate(xml)).toBe(true);
    expect(xml).toContain('<w:br/>');
    expect(xml).toContain('둘째 줄 &amp; &lt;개정&gt; $&amp; 끝 📝');
    expect(xml).toContain('w:line="644"');
    expect(xml).toContain('w:lineRule="exact"');
    expect(xml).toContain('w:top="907"');
    expect(xml).toContain('w:left="1417"');
    expect(xml).toContain('신명조');
    const parsed = new XMLParser().parse(xml);
    expect(parsed['w:document']).toBeTruthy();
  });
});
