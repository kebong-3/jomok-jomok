// HWPX(한글 문서) 생성기 — 최소 서식 템플릿 + 본문 XML 생성, fflate로 묶음
// charPr: 0 본문 11pt / 1 굵게 / 2 밑줄 / 3 제목 15pt 굵게 / 4 돋움 10pt / 5 돋움 10pt 굵게
// paraPr: 0 양쪽 / 1 가운데 / 2 왼쪽(줄간 150) / 3 내어쓰기 / 4 가운데+아래 여백
// borderFill: 3 실선 칸 / 4 실선+회색 칸
import { strToU8, zipSync } from 'fflate';
import T from './template.json';
import { documentLayout, type DocumentLayout } from '../document-layout';
import { validateHwpxParts } from './validate';

export interface Run {
  text: string;
  bold?: boolean;
  underline?: boolean;
  size?: 'title' | 'small' | 'heading';
}
export type Block =
  | { type: 'p'; runs: Run[]; align?: 'center' | 'left' | 'justify' | 'hang'; pageBreakBefore?: boolean }
  | { type: 'table'; widths: number[]; rows: { cells: Run[][][]; head?: boolean }[] };

/** XML 1.0 excludes control characters and unpaired UTF-16 surrogates. */
export const documentText = (s: string) => s.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '');
const esc = (s: string) => documentText(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const textXml = (s: string) => esc(s).replace(/\n/g, '<hp:lineBreak/>').replace(/\t/g, '    ');

function charPr(r: Run): number {
  if (r.size === 'title') return 3;
  if (r.size === 'heading') return 6;
  if (r.size === 'small') return r.bold ? 5 : 4;
  if (r.underline) return 2;
  if (r.bold) return 1;
  return 0;
}

const ALIGN: Record<string, number> = { justify: 0, center: 1, left: 2, hang: 3 };
type SectionContext = { pid: number; tableId: number; contentWidth: number; bodyPt: number; line: number };
function para(runs: Run[], ctx: SectionContext, paraPr = 0, pageBreak = false): string {
  const id = String(ctx.pid++);
  const body = runs.length ? runs.map((r) => `<hp:run charPrIDRef="${charPr(r)}"><hp:t>${textXml(r.text)}</hp:t></hp:run>`).join('') : '<hp:run charPrIDRef="0"><hp:t/></hp:run>';
  return `<hp:p id="${id}" paraPrIDRef="${paraPr}" styleIDRef="0" pageBreak="${pageBreak ? 1 : 0}" columnBreak="0" merged="0">${body}</hp:p>`;
}

function table(b: Extract<Block, { type: 'table' }>, ctx: SectionContext): string {
  if (!b.widths.length || b.widths.some(w => !Number.isFinite(w) || w <= 0) || !b.rows.length || b.rows.some(r => r.cells.length !== b.widths.length)) throw new Error('표의 열 너비와 셀 개수를 확인해 주세요.');
  const sum = b.widths.reduce((s, w) => s + w, 0);
  const ws = b.widths.map((w) => Math.floor((w / sum) * ctx.contentWidth));
  ws[ws.length - 1] += ctx.contentWidth - ws.reduce((s, w) => s + w, 0);
  let totalH = 0;
  const rowsXml = b.rows
    .map((row, ri) => {
      const lines = Math.max(1, ...row.cells.map((c, ci) => c.reduce((s, ln) => s + ln.map(r => documentText(r.text)).join('').split('\n').reduce((n, text) => n + Math.max(1, Math.ceil([...text].length / Math.max(4, (ws[ci] - 1020) / (ctx.bodyPt * 100)))), 0), 0)));
      const h = Math.max(1800, Math.ceil(lines * ctx.bodyPt * ctx.line + 566));
      totalH += h;
      const cells = row.cells
        .map((c, ci) => {
          const ps = (c.length ? c : [[]]).map((ln) => para(ln, ctx, row.head ? 5 : 2)).join('');
          return `<hp:tc name="" header="${row.head ? 1 : 0}" hasMargin="0" protect="0" editable="0" dirty="0" borderFillIDRef="${row.head ? 4 : 3}"><hp:subList id="" textDirection="HORIZONTAL" lineWrap="BREAK" vertAlign="${row.head ? 'CENTER' : 'TOP'}" linkListIDRef="0" linkListNextIDRef="0" textWidth="0" textHeight="0" hasTextRef="0" hasNumRef="0">${ps}</hp:subList><hp:cellAddr colAddr="${ci}" rowAddr="${ri}"/><hp:cellSpan colSpan="1" rowSpan="1"/><hp:cellSz width="${ws[ci]}" height="${h}"/><hp:cellMargin left="510" right="510" top="283" bottom="283"/></hp:tc>`;
        })
        .join('');
      return `<hp:tr>${cells}</hp:tr>`;
    })
    .join('');
  const id = ctx.tableId++;
  return `<hp:p id="${ctx.pid++}" paraPrIDRef="0" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0"><hp:run charPrIDRef="0"><hp:tbl id="${id}" zOrder="0" numberingType="TABLE" textWrap="TOP_AND_BOTTOM" textFlow="BOTH_SIDES" lock="0" dropcapstyle="None" pageBreak="CELL" repeatHeader="1" rowCnt="${b.rows.length}" colCnt="${ws.length}" cellSpacing="0" borderFillIDRef="3" noAdjust="0"><hp:sz width="${ctx.contentWidth}" widthRelTo="ABSOLUTE" height="${totalH}" heightRelTo="ABSOLUTE" protect="0"/><hp:pos treatAsChar="1" affectLSpacing="0" flowWithText="1" allowOverlap="0" holdAnchorAndSO="0" vertRelTo="PARA" horzRelTo="PARA" vertAlign="TOP" horzAlign="LEFT" vertOffset="0" horzOffset="0"/><hp:outMargin left="0" right="0" top="0" bottom="0"/><hp:inMargin left="510" right="510" top="283" bottom="283"/>${rowsXml}</hp:tbl></hp:run></hp:p>`;
}

const mm = (value: number) => Math.round(value * 7200 / 25.4);

function headerXml(layout: DocumentLayout): string {
  const style = documentLayout(layout);
  const sizes = [style.bodyPt, style.bodyPt, style.bodyPt, style.titlePt, style.smallPt, style.smallPt, style.headingPt];
  let header = T.header.replace(/함초롬바탕/g, style.font);
  // Match the official sample's character-property child order (font fields before bold).
  header = header.replace(/<hh:charPr\b[^>]*>[\s\S]*?<\/hh:charPr>/g, block => block.replace(/height="\d+"/, `height="${sizes[Number(block.match(/id="(\d+)"/)?.[1] ?? 0)] * 100}"`).replace('<hh:bold/>', ''));
  // The source uses self-closing offset elements. Bold is inserted at its schema position.
  header = header.replace(/<hh:charPr\b[^>]*>[\s\S]*?<\/hh:charPr>/g, block => [1, 3, 5, 6].includes(Number(block.match(/id="(\d+)"/)?.[1])) ? block.replace(/(<hh:offset\b[^>]*\/?>)/, '$1<hh:bold/>') : block);
  return header.replace(/<hh:paraPr\b[^>]*>[\s\S]*?<\/hh:paraPr>/g, block => {
    const id = Number(block.match(/id="(\d+)"/)?.[1]);
    return block.replace(/(<hh:lineSpacing\b[^>]*value=")\d+/g, (_match, prefix: string) => `${prefix}${id === 2 || id === 5 ? style.tableLinePercent : style.linePercent}`);
  });
}

export function buildSection(blocks: Block[], layout: DocumentLayout = 'support'): string {
  const style = documentLayout(layout);
  const ctx: SectionContext = { pid: 1, tableId: 1000000000, contentWidth: 59528 - mm(style.leftMm) - mm(style.rightMm), bodyPt: style.bodyPt, line: style.tableLinePercent };
  const section = T.secPr.replace(/<hp:margin\b[^>]*\/>/, `<hp:margin header="${mm(style.headerMm)}" footer="${mm(style.footerMm)}" gutter="0" left="${mm(style.leftMm)}" right="${mm(style.rightMm)}" top="${mm(style.topMm)}" bottom="${mm(style.bottomMm)}"/>`);
  const first = `<hp:p id="0" paraPrIDRef="0" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0"><hp:run charPrIDRef="0">${section}<hp:ctrl><hp:colPr id="" type="NEWSPAPER" layout="LEFT" colCount="1" sameSz="1" sameGap="0"/></hp:ctrl></hp:run><hp:run charPrIDRef="0"><hp:ctrl><hp:pageNum pos="BOTTOM_CENTER" formatType="DIGIT" sideChar="-"/></hp:ctrl></hp:run></hp:p>`;
  const body = blocks.map((b) => (b.type === 'p' ? para(b.runs, ctx, ALIGN[b.align ?? 'justify'], b.pageBreakBefore) : table(b, ctx))).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>${T.secOpen}${first}${body}</hs:sec>`;
}

export function buildHwpx(title: string, blocks: Block[], layout: DocumentLayout = 'support'): Uint8Array {
  const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  const hpf = T.hpf
    .replace(/<opf:title>[^<]*<\/opf:title>/, () => `<opf:title>${esc(title)}</opf:title>`)
    .replace(/(<opf:meta name="creator" content="text">)[^<]*/, '$1조목조목')
    .replace(/(<opf:meta name="lastsaveby" content="text">)[^<]*/, '$1조목조목')
    .replace(/(<opf:meta name="CreatedDate" content="text">)[^<]*/, `$1${now}`)
    .replace(/(<opf:meta name="ModifiedDate" content="text">)[^<]*/, `$1${now}`)
    .replace(/<opf:meta name="date" content="text">[^<]*<\/opf:meta>/, '')
    .replace('<opf:itemref idref="header" linear="yes"/>', '<opf:itemref idref="header" linear="no"/>');
  const settings = T.settings.replace(/paraIDRef="\d+" pos="\d+"/, 'paraIDRef="0" pos="0"');
  const prv = blocks
    .map((b) => (b.type === 'p' ? b.runs.map((r) => r.text).join('') : b.rows.map((r) => r.cells.map((c) => c.map((l) => l.map((x) => x.text).join('')).join(' ')).join(' | ')).join('\n')))
    .join('\n')
    .slice(0, 1000);
  const parts: Record<string, string> = {
    mimetype: 'application/hwp+zip',
    'version.xml': T.version,
    'Contents/header.xml': headerXml(layout),
    'Contents/section0.xml': buildSection(blocks, layout),
    'Contents/content.hpf': hpf,
    'Preview/PrvText.txt': documentText(prv),
    'settings.xml': settings,
    'META-INF/container.xml': T.container,
    'META-INF/manifest.xml': T.manifest,
    'META-INF/container.rdf': T.rdf,
  };
  validateHwpxParts(parts);
  // mimetype은 첫 항목·무압축
  return zipSync(
    {
      mimetype: [strToU8(parts.mimetype), { level: 0 }],
      ...Object.fromEntries(Object.entries(parts).filter(([name]) => name !== 'mimetype').map(([name, content]) => [name, strToU8(content)])),
    },
    { level: 6 },
  );
}
