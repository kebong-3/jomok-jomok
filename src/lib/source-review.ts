import { unzipSync, strFromU8 } from 'fflate';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { circled, parseRule, type Rule, type RuleKind } from '@/engine';

export interface SourceIssue {
  code: string;
  message: string;
  location?: string;
  severity: 'warning' | 'blocking';
  excerpt?: string;
}

export interface SourcePosition {
  line: number;
  location: string;
}

export interface ExtractedSource {
  text: string;
  issues: SourceIssue[];
  positions: SourcePosition[];
}

export interface SourcePreviewArticle {
  label: string;
  title?: string;
  location: string;
  deleted: boolean;
  paragraphs: { label: string; text: string; items: number; location: string }[];
}

export interface SourceReviewData {
  rule: Rule;
  issues: SourceIssue[];
  articles: SourcePreviewArticle[];
  annexLocations: string[];
  addendaLocation?: string;
  counts: { articles: number; paragraphs: number; items: number; annexes: number };
}

export const HWPX_LIMITS = {
  fileBytes: 10 * 1024 * 1024,
  entries: 2048,
  expandedBytes: 64 * 1024 * 1024,
  sectionBytes: 4 * 1024 * 1024,
  textBytes: 12 * 1024 * 1024,
  xmlDepth: 128,
} as const;

type XmlNode = Record<string, unknown>;
const SECTION_PATH = /^Contents\/section(\d+)\.xml$/i;
const short = (text: string, max = 220) => text.length > max ? `${text.slice(0, max)}…` : text;

function xmlExcerpt(nodes: XmlNode[]): string {
  const stack = nodes.map((node) => ({ node, inText: false })).reverse();
  let result = '';
  while (stack.length && result.length < 220) {
    const { node, inText } = stack.pop()!;
    for (const [tag, value] of Object.entries(node)) {
      if (tag === '#text' && inText && typeof value === 'string') result += value;
      else if (Array.isArray(value)) {
        for (let i = value.length - 1; i >= 0; i--) stack.push({ node: value[i] as XmlNode, inText: inText || tag === 't' });
      }
    }
  }
  return short(result);
}

/** Extract text in document order. No filesystem extraction or external entities. */
export function extractHwpx(input: ArrayBuffer | Uint8Array, overrides: Partial<Record<keyof typeof HWPX_LIMITS, number>> = {}): ExtractedSource {
  const limits = { ...HWPX_LIMITS, ...overrides };
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.byteLength > limits.fileBytes) throw new Error('HWPX 파일은 10MB 이하로 올려 주세요.');
  const sections: string[] = [];
  const seen = new Set<string>();
  let entries = 0;
  let expandedBytes = 0;
  let textBytes = 0;
  // Inspect every central-directory entry before allocating any decompressed data.
  unzipSync(bytes, { filter(file) {
    entries += 1;
    if (entries > limits.entries) throw new Error('HWPX 안의 파일 수가 너무 많습니다. 필요한 규정만 새 파일로 저장해 주세요.');
    if (!Number.isSafeInteger(file.originalSize) || file.originalSize < 0) throw new Error('HWPX의 압축 크기 정보가 올바르지 않습니다.');
    expandedBytes += file.originalSize;
    if (expandedBytes > limits.expandedBytes) throw new Error('HWPX 압축 해제 크기가 너무 큽니다. 그림을 줄이거나 필요한 규정만 저장해 주세요.');
    const sectionMatch = file.name.match(SECTION_PATH);
    if (sectionMatch) {
      const sectionNumber = Number(sectionMatch[1]);
      if (!Number.isSafeInteger(sectionNumber)) throw new Error('HWPX의 본문 섹션 번호가 올바르지 않습니다.');
      const canonical = String(sectionNumber);
      if (seen.has(canonical)) throw new Error('HWPX에 같은 본문 섹션이 두 번 들어 있습니다. 한글에서 다시 저장해 주세요.');
      seen.add(canonical);
      if (file.originalSize > limits.sectionBytes) throw new Error('HWPX 본문 섹션이 너무 큽니다. 필요한 규정만 나누어 저장해 주세요.');
      textBytes += file.originalSize;
      if (textBytes > limits.textBytes) throw new Error('HWPX의 전체 본문 크기가 너무 큽니다. 필요한 규정만 저장해 주세요.');
      if (file.compression !== 0 && file.compression !== 8) throw new Error('지원하지 않는 HWPX 압축 방식입니다. 한글에서 다시 저장해 주세요.');
      sections.push(file.name);
    }
    return false;
  } });
  if (!sections.length) throw new Error('HWPX 본문(Contents/section*.xml)을 찾지 못했습니다. 한글에서 HWPX로 다시 저장해 주세요.');
  sections.sort((a, b) => Number(a.match(SECTION_PATH)![1]) - Number(b.match(SECTION_PATH)![1]));
  const selected = new Set(sections);
  const files = unzipSync(bytes, { filter: (file) => selected.has(file.name) });
  const lines: string[] = [];
  const positions: SourcePosition[] = [];
  const issues: SourceIssue[] = [];
  const parser = new XMLParser({
    preserveOrder: true,
    removeNSPrefix: true,
    ignoreAttributes: true,
    parseTagValue: false,
    trimValues: false,
    // XML numeric character references are disabled by default by this parser.
    htmlEntities: true,
    processEntities: { enabled: true, maxTotalExpansions: 100000, maxExpandedLength: limits.sectionBytes },
  });

  for (const path of sections) {
    const xml = strFromU8(files[path]);
    if (/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(xml)) throw new Error(`${path}: 외부 문서·사용자 정의 엔티티가 있는 XML은 읽지 않습니다. 한글에서 다시 저장해 주세요.`);
    const valid = XMLValidator.validate(xml);
    if (valid !== true) throw new Error(`${path}의 XML ${valid.err.line ?? '?'}행을 읽지 못했습니다. 파일이 손상되었는지 확인해 주세요.`);
    const nodes = parser.parse(xml) as XmlNode[];
    let paragraph = 0;
    let table = 0;
    let current: { text: string; location: string } | undefined;
    const emit = () => {
      if (!current?.text.trim()) { if (current) current.text = ''; return; }
      for (const line of current.text.split(/\r?\n/)) {
        if (!line.trim()) continue;
        lines.push(line);
        positions.push({ line: lines.length, location: current.location });
      }
      current.text = '';
    };
    const warn = (code: string, message: string, location: string, excerpt?: string) => {
      issues.push({ code, message, location, excerpt: excerpt ? short(excerpt) : undefined, severity: 'warning' });
    };
    const visit = (list: XmlNode[], depth: number, inText = false, tableLocation?: string) => {
      if (depth > limits.xmlDepth) throw new Error(`${path}: XML 중첩이 너무 깊습니다. 필요한 본문을 TXT로 저장해 주세요.`);
      for (const node of list) {
        for (const [tag, value] of Object.entries(node)) {
          if (tag === '#text') {
            if (inText && current && typeof value === 'string') current.text += value;
            continue;
          }
          if (tag === ':@' || tag.startsWith('?')) continue;
          const children = Array.isArray(value) ? value as XmlNode[] : [];
          if (tag === 'p') {
            // A table cell can contain a paragraph inside another paragraph.
            // Flush the outer buffer and visit each child once, preserving order.
            emit();
            const previous = current;
            paragraph += 1;
            current = { text: '', location: `${path} · ${paragraph}번째 문단${tableLocation ? ` · ${tableLocation}` : ''}` };
            visit(children, depth + 1, false, tableLocation);
            emit();
            current = previous;
          } else if (tag === 'tbl') {
            emit();
            table += 1;
            const where = `${path} · 표 ${table}${current ? ` · ${current.location.split(' · ')[1]}` : ''}`;
            const start = lines.length;
            visit(children, depth + 1, false, `표 ${table}`);
            emit();
            warn('HWPX_TABLE', '표 안의 글자는 읽었지만 행·열, 병합 셀과 계산식은 재현하지 못합니다. 원본 표와 대조해 누락·순서를 확인해 주세요.', where, lines.slice(start, start + 3).join('\n') || '(표 안에서 읽을 수 있는 글자가 없습니다)');
          } else if (['header', 'footer', 'footNote', 'endNote'].includes(tag)) {
            warn('HWPX_NOTE', '머리말·꼬리말·각주·미주 영역은 조문에 합치지 않았습니다. 이 영역에 규정 내용이 있으면 본문에 추가해 주세요.', `${path} · ${current?.location.split(' · ')[1] ?? '부가 영역'}`, xmlExcerpt(children));
          } else if (['pic', 'ole', 'equation', 'video', 'chart'].includes(tag)) {
            warn('HWPX_OBJECT', '그림·수식·삽입 개체의 내용은 글자로 읽지 못했습니다. 해당 내용이 규정의 일부인지 원본에서 확인해 주세요.', current?.location ?? path, `개체 종류: ${tag}`);
          } else if (tag === 'drawText') {
            warn('HWPX_TEXTBOX', '글상자 안의 글자는 문서 순서대로 읽었습니다. 본문과의 배치 순서는 원본에서 확인해 주세요.', current?.location ?? path, xmlExcerpt(children));
            visit(children, depth + 1, inText, tableLocation);
          } else if (tag === 'autoNum') {
            warn('HWPX_AUTO_NUMBER', '자동 번호 개체는 글자로 복원하지 않았습니다. 조·항·호 번호가 원본과 같은지 확인해 주세요.', current?.location ?? path, current?.text || '자동 번호 개체');
          } else if (tag === 'lineBreak' && current) {
            current.text += '\n';
          } else if (['tab', 'nbSpace', 'fwSpace'].includes(tag) && current) {
            current.text += tag === 'tab' ? '\t' : ' ';
          } else {
            visit(children, depth + 1, inText || tag === 't', tableLocation);
          }
        }
      }
    };
    visit(nodes, 0);
    emit();
  }
  if (!lines.length) throw new Error('HWPX에서 읽을 수 있는 본문 글자를 찾지 못했습니다. 그림으로 된 문서는 먼저 글자로 변환해 주세요.');
  return { text: lines.join('\n'), issues, positions };
}

/** UTF-8 first; old Korean text files get an explicit encoding warning. */
export function extractTxt(input: ArrayBuffer): ExtractedSource {
  const bytes = new Uint8Array(input);
  if (bytes.byteLength > HWPX_LIMITS.fileBytes) throw new Error('TXT 파일은 10MB 이하로 올려 주세요.');
  let text: string;
  const issues: SourceIssue[] = [];
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    try { text = new TextDecoder('euc-kr', { fatal: true }).decode(bytes); }
    catch { throw new Error('TXT의 문자 인코딩을 읽지 못했습니다. UTF-8 형식으로 저장하거나 내용을 붙여넣어 주세요.'); }
    issues.push({ code: 'TXT_ENCODING', message: 'UTF-8이 아닌 한글 인코딩으로 읽었습니다. 특수문자와 항 번호가 원본과 같은지 확인해 주세요.', location: 'TXT 전체', severity: 'warning', excerpt: short(text) });
  }
  if (text.includes('\0')) throw new Error('글자 파일이 아닌 내용이 포함되어 있습니다. 규정 원문을 UTF-8 TXT로 저장해 주세요.');
  if (!text.trim()) throw new Error('TXT 파일에 읽을 수 있는 내용이 없습니다.');
  return { text, issues, positions: [] };
}

const ARTICLE = /^\s*제\s*(\d+)\s*조(?:의\s*(\d+))?/u;
const ARTICLE_REFERENCE_TAIL = /^(?:[을를이가은는에의와과로부까]|제\d|\s*(?:및|또는|부터|에서))/u;
const ADDENDA = /^\s*부\s*칙(?:\s*<[^>]*>)?\s*$/u;
const ANNEX = /^\s*\[\s*(?:별표\s*(?:\d+(?:의\s*\d+)?)?|별지\s*제?\s*\d+(?:의\s*\d+)?\s*호\s*서식)\s*\]/u;
const itemCount = (text: string) => text.split('\n').filter((line) => /^\s*\d+(?:의\d+)?\.\s/u.test(line)).length;

/** Read-only assessment: raw text is never normalized or overwritten here. */
export function reviewSource(raw: string, kind: RuleKind = 'rule', extractionIssues: SourceIssue[] = [], positions: SourcePosition[] = []): SourceReviewData {
  const rule = parseRule(raw, kind);
  const lines = raw.split(/\r?\n/);
  const issues: SourceIssue[] = [...extractionIssues];
  const origins = new Map(positions.map((p) => [p.line, p.location]));
  const where = (line: number) => `${line}행${origins.has(line) ? ` · ${origins.get(line)}` : ''}`;
  const add = (code: string, message: string, line: number, severity: SourceIssue['severity'] = 'warning', excerpt = lines[line - 1]) => {
    issues.push({ code, message, location: line > 0 ? where(line) : '원문 전체', severity, excerpt: excerpt ? short(excerpt) : undefined });
  };
  const articleLines: { line: number; num: number; br?: number }[] = [];
  const annexLines: number[] = [];
  let addendaLine: number | undefined;
  let inBody = true;
  lines.forEach((line, index) => {
    const number = index + 1;
    if (ADDENDA.test(line)) { inBody = false; addendaLine ??= number; }
    if (ANNEX.test(line)) { inBody = false; annexLines.push(number); }
    if (line.includes('\ufffd')) add('BROKEN_CHARACTER', '읽을 수 없는 문자(�)가 있습니다. 원본의 글자나 항 번호를 복원해 주세요.', number);
    if (line.includes('\0')) add('BINARY_CHARACTER', '텍스트가 아닌 제어 문자가 포함되어 있습니다. 원문을 다시 붙여넣어 주세요.', number, 'blocking');
    if (!inBody) return;
    if (/^\s*(?:\[\s*)?(?:별표\s*\d+|별지\s*제?\s*\d+\s*호\s*서식)/u.test(line) && !ANNEX.test(line)) {
      add('ANNEX_HEADING', '별표·서식 표제를 독립 구조로 읽지 못했습니다. [별표 1] 또는 [별지 제1호서식]처럼 대괄호로 표시해 주세요.', number);
    }
    const match = line.match(ARTICLE);
    if (match && !ARTICLE_REFERENCE_TAIL.test(line.slice(match[0].length))) {
      articleLines.push({ line: number, num: Number(match[1]), br: match[2] ? Number(match[2]) : undefined });
      const rest = line.slice(match[0].length).trimStart();
      if (rest.startsWith('(') && !rest.includes(')')) add('ARTICLE_TITLE', '조 제목의 닫는 괄호가 없어 제목과 본문을 구분하지 못했습니다.', number);
      if (/[.。]\s*제\s*\d+\s*조(?:의\s*\d+)?\s*\([^)]*\)(?![을를이가은는에의와과로])/u.test(rest)) {
        add('JOINED_ARTICLES', '한 줄에 다른 조의 표제도 있습니다. 조문 사이의 줄바꿈이 빠진 것인지 확인해 주세요.', number);
      }
    } else if (/^\s*제\s*[０-９IlO]+\s*조/u.test(line)) {
      add('UNREAD_ARTICLE', '조 번호를 숫자로 읽지 못했습니다. 전각 숫자나 비슷한 영문자가 섞였는지 확인해 주세요.', number);
    }
  });
  if (!rule.articles.length) add('NO_ARTICLES', '조문을 찾지 못했습니다. 제1조(목적)처럼 조 번호가 있는 규정 원문을 넣어 주세요.', 0, 'blocking', lines.find((line) => line.trim()));
  if (raw.length > 500000) add('SOURCE_SIZE', '원문이 50만 자를 넘습니다. 처리할 규정을 나누어 넣어 주세요.', 0, 'blocking');
  const articleKeys = new Set<string>();
  const articles = rule.articles.map((article, index): SourcePreviewArticle => {
    const label = `제${article.num}조${article.br ? `의${article.br}` : ''}`;
    const sourceLine = articleLines[index]?.line ?? 1;
    if (articleKeys.has(label)) add('DUPLICATE_ARTICLE', `${label}가 중복되어 어느 조문을 고칠지 구분할 수 없습니다. 중복 원문이나 번호를 정리해 주세요.`, sourceLine, 'blocking');
    articleKeys.add(label);
    const previous = rule.articles[index - 1];
    if (index === 0 && article.num !== 1) add('PARTIAL_SOURCE', `${label}부터 시작합니다. 앞부분이 빠진 발췌문인지, 필요한 규정 전체인지 확인해 주세요.`, sourceLine);
    if (previous && article.num > previous.num + 1) add('ARTICLE_GAP', `제${previous.num}조 다음이 ${label}입니다. 중간 조문이나 삭제 표시가 빠졌는지 확인해 주세요.`, sourceLine);
    if (previous && (article.num < previous.num || (article.num === previous.num && (article.br ?? 0) < (previous.br ?? 0)))) add('ARTICLE_ORDER', `${label}의 순서가 앞 조문보다 되돌아갑니다. 원본의 문단 순서를 확인해 주세요.`, sourceLine);
    if (!article.deleted && !article.paragraphs.some((p) => p.text.trim())) add('EMPTY_ARTICLE', `${label}의 본문이 비어 있습니다. 추출되지 않은 표·그림이 있는지 확인해 주세요.`, sourceLine);
    const firstNumber = article.paragraphs.find((p) => p.num !== undefined)?.num;
    if (firstNumber !== undefined && firstNumber !== 1) add('PARAGRAPH_START', `${label}의 첫 항 번호가 ${firstNumber}입니다. 앞 항이나 원문자(①)가 빠졌는지 확인해 주세요.`, sourceLine);
    const endLine = Math.min(articleLines[index + 1]?.line ?? Infinity, addendaLine ?? Infinity, annexLines[0] ?? Infinity, lines.length + 1);
    let lineCursor = sourceLine - 1;
    let previousNumber: number | undefined;
    const paragraphs = article.paragraphs.map((p, i) => {
      const marker = p.num ? circled(p.num) : undefined;
      let paragraphLine = sourceLine;
      if (marker) {
        for (let line = lineCursor; line < endLine - 1; line++) {
          if (lines[line].trimStart().startsWith(marker) || (i === 0 && line === sourceLine - 1 && lines[line].includes(marker))) {
            paragraphLine = line + 1;
            lineCursor = line + 1;
            break;
          }
        }
      }
      if (p.num !== undefined) {
        if (previousNumber !== undefined && p.num !== previousNumber + 1) add('PARAGRAPH_GAP', `${label}의 항 번호가 ${previousNumber} 다음에 ${p.num}입니다. 누락·중복된 항 번호를 확인해 주세요.`, paragraphLine);
        previousNumber = p.num;
      }
      return { label: p.num ? `제${p.num}항` : article.paragraphs.length === 1 ? '본문' : `번호 없는 문단 ${i + 1}`, text: p.deleted ? '삭제' : p.text, items: itemCount(p.text), location: where(paragraphLine) };
    });
    return {
      label, title: article.title, location: where(sourceLine), deleted: !!article.deleted,
      paragraphs,
    };
  });
  for (const diagnostic of rule.diagnostics) {
    // The parser's paragraph diagnostic omits branch numbers and uses line 0.
    // The assessment above replaces it with the exact article and source line.
    if (/^항 번호가 /u.test(diagnostic.message)) continue;
    const index = diagnostic.line || articleLines.find((a) => `제${a.num}조` === diagnostic.text)?.line || 0;
    add('PARSER_DIAGNOSTIC', diagnostic.message, index, 'warning', diagnostic.line ? diagnostic.text : lines[index - 1] ?? diagnostic.text);
  }
  return {
    rule, issues, articles, annexLocations: annexLines.map(where), addendaLocation: addendaLine ? where(addendaLine) : undefined,
    counts: {
      articles: rule.articles.length,
      paragraphs: rule.articles.reduce((total, article) => total + article.paragraphs.length, 0),
      items: articles.reduce((total, article) => total + article.paragraphs.reduce((sum, p) => sum + p.items, 0), 0),
      annexes: rule.annexes.length,
    },
  };
}

export function sourceReviewGate(issues: SourceIssue[], confirmed: boolean): { allowed: boolean; message?: string } {
  if (issues.some((issue) => issue.severity === 'blocking')) return { allowed: false, message: '원문 인식에서 작업을 막는 문제가 있습니다. 표시된 위치를 고친 뒤 시작해 주세요.' };
  if (issues.length && !confirmed) return { allowed: false, message: '원문 인식의 확인할 곳을 살펴보고 확인란을 선택해 주세요.' };
  return { allowed: true };
}
