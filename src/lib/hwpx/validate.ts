import { XMLValidator } from 'fast-xml-parser';

/** Package integrity checks, not a claim of native Hancom rendering certification. */
export function validateHwpxParts(parts: Record<string, string>): void {
  const required = ['mimetype', 'version.xml', 'Contents/header.xml', 'Contents/section0.xml', 'Contents/content.hpf', 'settings.xml', 'META-INF/container.xml', 'META-INF/manifest.xml'];
  if (required.some(name => !parts[name]) || parts.mimetype !== 'application/hwp+zip') throw new Error('한글 문서의 필수 구성 파일을 확인해 주세요.');
  for (const [name, xml] of Object.entries(parts)) {
    if (!/\.(?:xml|hpf|rdf)$/.test(name)) continue;
    if (XMLValidator.validate(xml) !== true) throw new Error(`한글 문서의 XML 형식을 확인하지 못했습니다 (${name}).`);
  }
  const header = parts['Contents/header.xml'];
  const section = parts['Contents/section0.xml'];
  const definitions = (tag: string) => new Set([...header.matchAll(new RegExp(`<hh:${tag}\\b[^>]*\\bid="(\\d+)"`, 'g'))].map(m => m[1]));
  for (const [attribute, tag] of [['charPrIDRef', 'charPr'], ['paraPrIDRef', 'paraPr'], ['styleIDRef', 'style'], ['borderFillIDRef', 'borderFill']]) {
    const ids = definitions(tag);
    for (const match of section.matchAll(new RegExp(`\\b${attribute}="(\\d+)"`, 'g'))) {
      if (!ids.has(match[1])) throw new Error(`한글 문서의 서식 참조가 맞지 않습니다 (${attribute}).`);
    }
  }
  const hpf = parts['Contents/content.hpf'];
  const manifestIds = new Set<string>();
  for (const match of hpf.matchAll(/<opf:item\b[^>]*\bid="([^"]+)"[^>]*\bhref="([^"]+)"/g)) {
    if (!Object.hasOwn(parts, match[2]) || manifestIds.has(match[1])) throw new Error('한글 문서의 파일 목록을 확인해 주세요.');
    manifestIds.add(match[1]);
  }
  for (const match of hpf.matchAll(/<opf:itemref\b[^>]*\bidref="([^"]+)"/g)) {
    if (!manifestIds.has(match[1])) throw new Error('한글 문서의 읽기 순서를 확인해 주세요.');
  }
  const tableIds = new Set<string>();
  for (const match of section.matchAll(/<hp:tbl\b([^>]*)>([\s\S]*?)<\/hp:tbl>/g)) {
    const [, attrs, body] = match;
    const id = attrs.match(/\bid="(\d+)"/)?.[1];
    const rows = [...body.matchAll(/<hp:tr>([\s\S]*?)<\/hp:tr>/g)];
    const cols = Number(attrs.match(/\bcolCnt="(\d+)"/)?.[1]);
    if (!id || tableIds.has(id) || rows.length !== Number(attrs.match(/\browCnt="(\d+)"/)?.[1]) || !cols || rows.some(row => [...row[1].matchAll(/<hp:tc\b/g)].length !== cols)) throw new Error('한글 문서의 표 구조를 확인해 주세요.');
    tableIds.add(id);
  }
}
