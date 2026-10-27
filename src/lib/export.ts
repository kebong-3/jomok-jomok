import { AlignmentType, BorderStyle, Document, HeadingLevel, Packer, Paragraph, ShadingType, Table, TableCell, TableLayoutType, TableRow, TextRun, VerticalAlign, WidthType } from 'docx';
import { strToU8, zipSync } from 'fflate';
import type { DocModel } from './docs';
import { buildHwpx, documentText, type Block, type Run } from './hwpx/build';
import { documentLayout, type DocumentLayout } from './document-layout';

const mm = (value: number) => Math.round(value * 1440 / 25.4);

function docxRuns(runs: Run[], layout: DocumentLayout) {
  const style = documentLayout(layout);
  return runs.flatMap((r) => documentText(r.text).split('\n').map((line, index) => new TextRun({ text: line, break: index ? 1 : undefined, bold: r.bold || r.size === 'title' || r.size === 'heading', underline: r.underline ? {} : undefined, size: 2 * (r.size === 'title' ? style.titlePt : r.size === 'heading' ? style.headingPt : r.size === 'small' ? style.smallPt : style.bodyPt), font: r.size === 'small' ? '함초롬돋움' : style.font, color: '000000' })));
}

/** Express HWP's percentage in points so fallback CJK font metrics do not inflate every line. */
function lineTwips(runs: Run[], layout: DocumentLayout, table = false): number {
  const style = documentLayout(layout);
  const points = Math.max(style.bodyPt, ...runs.map(r => r.size === 'title' ? style.titlePt : r.size === 'heading' ? style.headingPt : r.size === 'small' ? style.smallPt : style.bodyPt));
  return Math.round(points * 20 * (table ? style.tableLinePercent : style.linePercent) / 100);
}

function docxBlocks(blocks: Block[], layout: DocumentLayout) {
  const style = documentLayout(layout);
  const width = 11906 - mm(style.leftMm) - mm(style.rightMm);
  const out: (Paragraph | Table)[] = [];
  const border = { style: BorderStyle.SINGLE, size: 4, color: 'D9D9D9' };
  for (const b of blocks) {
    if (b.type === 'p') {
      out.push(new Paragraph({
        children: docxRuns(b.runs, layout),
        heading: b.runs[0]?.size === 'title' ? HeadingLevel.TITLE : undefined,
        pageBreakBefore: b.pageBreakBefore,
        keepNext: b.runs[0]?.size === 'title' || b.runs[0]?.size === 'heading',
        alignment: b.align === 'center' ? AlignmentType.CENTER : b.align === 'left' ? AlignmentType.LEFT : AlignmentType.JUSTIFIED,
        indent: b.align === 'hang' ? { left: 400, hanging: 400 } : undefined,
        spacing: { after: layout === 'support' ? 60 : 0, line: lineTwips(b.runs, layout), lineRule: 'exact' },
      }));
    } else {
      const sum = b.widths.reduce((s, x) => s + x, 0);
      if (!b.widths.length || b.widths.some(w => !Number.isFinite(w) || w <= 0) || b.rows.some(r => r.cells.length !== b.widths.length)) throw new Error('표의 열 너비와 셀 개수를 확인해 주세요.');
      const ws = b.widths.map((x) => Math.floor((x / sum) * width));
      ws[ws.length - 1] += width - ws.reduce((s, x) => s + x, 0);
      out.push(new Table({
        width: { size: width, type: WidthType.DXA },
        columnWidths: ws,
        layout: TableLayoutType.FIXED,
        rows: b.rows.map((row) => new TableRow({
          tableHeader: row.head,
          cantSplit: layout === 'support',
          children: row.cells.map((c, ci) => new TableCell({
            width: { size: ws[ci], type: WidthType.DXA },
            verticalAlign: VerticalAlign.CENTER,
            borders: { top: border, bottom: border, left: border, right: border },
            shading: row.head ? { fill: 'E6E6E6', type: ShadingType.CLEAR, color: 'auto' } : undefined,
            margins: { top: 80, bottom: 80, left: 120, right: 120 },
            children: (c.length ? c : [[]]).map((line) => new Paragraph({ children: docxRuns(line, layout), alignment: row.head ? AlignmentType.CENTER : AlignmentType.LEFT, spacing: { after: 20, line: lineTwips(line, layout, true), lineRule: 'exact' } })),
          })),
        })),
      }));
      out.push(new Paragraph({ children: [] }));
    }
  }
  return out;
}

export async function toDocx(doc: DocModel): Promise<Uint8Array> {
  const style = documentLayout(doc.layout);
  const d = new Document({
    creator: '조목조목',
    title: documentText(doc.title),
    styles: { default: { document: { run: { font: style.font, size: style.bodyPt * 2, color: '000000' } }, title: { run: { font: style.font, size: style.titlePt * 2, color: '000000', bold: true }, paragraph: { alignment: AlignmentType.CENTER, spacing: { before: 0, after: 0 } } } } },
    sections: [{ properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: mm(style.topMm), bottom: mm(style.bottomMm), left: mm(style.leftMm), right: mm(style.rightMm), header: mm(style.headerMm), footer: mm(style.footerMm) } } }, children: docxBlocks(doc.blocks, doc.layout ?? 'support') }],
  });
  const blob = await Packer.toBlob(d);
  return new Uint8Array(await blob.arrayBuffer());
}

export function toHwpx(doc: DocModel): Uint8Array {
  return buildHwpx(doc.title, doc.blocks, doc.layout);
}

export function fileName(base: string, doc: DocModel, ext: string): string {
  const d = new Date();
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  return `${ymd}_${base}_${doc.name}.${ext}`.replace(/[\\/:*?"<>|]/g, '');
}

export interface DownloadFile {
  name: string;
  url: string;
  revoke: () => void;
}

/** Keep an explicit link available when a browser suppresses an asynchronous auto-download. */
export function createDownloadFile(name: string, data: Uint8Array | string, type: string): DownloadFile {
  const blob = new Blob([typeof data === 'string' ? data : (data as BlobPart)], { type });
  const url = URL.createObjectURL(blob);
  let released = false;
  return { name, url, revoke: () => { if (!released) { released = true; URL.revokeObjectURL(url); } } };
}

export function startDownload(file: Pick<DownloadFile, 'name' | 'url'>): void {
  const a = document.createElement('a');
  a.href = file.url;
  a.download = file.name;
  document.body.appendChild(a);
  try { a.click(); }
  finally { a.remove(); }
}

export function download(name: string, data: Uint8Array | string, type: string) {
  const file = createDownloadFile(name, data, type);
  try { startDownload(file); }
  finally { setTimeout(file.revoke, 60_000); }
}

export async function buildDownloadSet(base: string, docs: DocModel[], format: 'hwpx' | 'docx' | 'both', extras: Record<string, string> = {}): Promise<{ name: string; bytes: Uint8Array }> {
  const files: Record<string, Uint8Array> = {};
  for (const d of docs) {
    if (format !== 'docx') files[fileName(base, d, 'hwpx')] = toHwpx(d);
    if (format !== 'hwpx') files[fileName(base, d, 'docx')] = await toDocx(d);
  }
  for (const [name, content] of Object.entries(extras)) {
    if (/[\\/]/.test(name) || name.includes('..') || files[name]) throw new Error('추가 파일 이름을 확인해 주세요.');
    files[name] = strToU8(content);
  }
  files['서식기준.txt'] = strToU8(docs.filter(d => d.formSource).map(d => `${d.name}\n${d.formSource!.label}\n${d.formSource!.adaptation}\nhttps://jomokjomok.vercel.app${d.formSource!.url}\n`).join('\n'));
  files['읽어보세요.txt'] = strToU8('조목조목이 만든 편집 가능한 초안입니다. AI가 쓴 문장과 공고번호·일자·의견제출처 등 미입력란을 제출 전에 확인하세요.\n자치법규안·이유서·대비표에는 자치법규 입안 길라잡이의 A4·여백·신명조·줄간격 기본규격을 적용했습니다. 신명조가 설치되지 않은 기기에서는 편집기가 대체 글꼴을 사용할 수 있으니 기관의 설치 글꼴을 확인하세요.\n예고문은 매뉴얼의 기재사항을 기준으로 재구성했고, 입안 점검표는 검토 항목을 기록표로 재구성했습니다. 출처와 적용 범위는 서식기준.txt에 적었습니다. 기관의 공고·결재 서식과 최종 대조하세요.\nHWPX는 XML·패키지 구조 검사를 거쳐 생성합니다. 한글 버전별 열기·저장·인쇄 결과는 기관 PC에서 확인하세요. 함께 받은 DOCX와 화면의 한글 붙여넣기를 이용할 수도 있습니다.\n작업백업.jomok.json은 홈의 보관한 작업 불러오기로 복원할 수 있습니다. 원문·변경·검토 상태와 서식 입력값·근거가 포함됩니다. API 키와 연결 설정은 포함하지 않습니다.\n근거원문.txt는 조회·입력 당시의 보존본이며 이후 개정 내용은 자동 갱신되지 않습니다.\n사용기록.csv가 있으면 사용자가 선택해서 기록한 값이며 자동 검증된 업무효과 측정 결과가 아닙니다.\n');
  const name = `${base}_문서세트.zip`.replace(/[\\/:*?"<>|]/g, '');
  return { name, bytes: zipSync(files) };
}

export async function downloadSet(base: string, docs: DocModel[], format: 'hwpx' | 'docx' | 'both', extras: Record<string, string> = {}): Promise<string> {
  const { name, bytes } = await buildDownloadSet(base, docs, format, extras);
  download(name, bytes, 'application/zip');
  return name;
}

/** 한글에 붙여넣기용 HTML(밑줄·테두리 유지) */
export function toClipboardHtml(doc: DocModel): string {
  const style = documentLayout(doc.layout);
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const run = (r: Run) => {
    let t = esc(documentText(r.text)).replace(/\n/g, '<br>');
    if (r.underline) t = `<u>${t}</u>`;
    if (r.bold || r.size === 'title' || r.size === 'heading') t = `<b>${t}</b>`;
    return t;
  };
  const parts = doc.blocks.map((b) => {
    if (b.type === 'p') return `<p style="margin:0 0 4pt 0;font-family:'${style.font}';font-size:${b.runs[0]?.size === 'title' ? style.titlePt : b.runs[0]?.size === 'heading' ? style.headingPt : b.runs[0]?.size === 'small' ? style.smallPt : style.bodyPt}pt;line-height:${style.linePercent}%;text-align:${b.align === 'center' ? 'center' : 'justify'};${b.pageBreakBefore ? 'page-break-before:always;' : ''}">${b.runs.map(run).join('') || '&nbsp;'}</p>`;
    const rows = b.rows
      .map((r) => `<tr>${r.cells.map((c) => `<td style="border:1px solid #d9d9d9;padding:4pt 6pt;vertical-align:middle;font-family:'${style.font}';font-size:${style.bodyPt}pt;line-height:${style.tableLinePercent}%;${r.head ? 'background:#e6e6e6;text-align:center;' : ''}">${c.map((l) => l.map(run).join('')).join('<br>')}</td>`).join('')}</tr>`)
      .join('');
    return `<table style="border-collapse:collapse;width:100%">${rows}</table>`;
  });
  return `<html><body>${parts.join('')}</body></html>`;
}

export async function copyForHangul(doc: DocModel): Promise<void> {
  const html = toClipboardHtml(doc);
  const text = doc.blocks.map((b) => (b.type === 'p' ? b.runs.map((r) => r.text).join('') : b.rows.map((r) => r.cells.map((c) => c.map((l) => l.map((x) => x.text).join('')).join('\n')).join('\t')).join('\n'))).join('\n');
  if ('ClipboardItem' in window) {
    await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([html], { type: 'text/html' }), 'text/plain': new Blob([text], { type: 'text/plain' }) })]);
  } else {
    await navigator.clipboard.writeText(text);
  }
}
