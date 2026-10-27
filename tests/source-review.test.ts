import { describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { extractHwpx, extractTxt, reviewSource, sourceReviewGate } from '@/lib/source-review';
import { SAMPLES } from '@/data/samples';
import { buildHwpx } from '@/lib/hwpx/build';

const section = (body: string, prefix = 'hp') => `<?xml version="1.0" encoding="UTF-8"?><hs:sec xmlns:hs="urn:section" xmlns:${prefix}="urn:paragraph">${body}</hs:sec>`;
const p = (text: string, prefix = 'hp') => `<${prefix}:p><${prefix}:run><${prefix}:t>${text}</${prefix}:t></${prefix}:run></${prefix}:p>`;
const zip = (sections: Record<string, string>) => zipSync(Object.fromEntries(Object.entries(sections).map(([name, xml]) => [name, strToU8(xml)])));
const single = (body: string) => zip({ 'Contents/section0.xml': section(body) });
const utf8 = (text: string) => new TextEncoder().encode(text).buffer;

describe('HWPX source extraction', () => {
  it('reads namespace variants, attributes, XML entities, and text runs without double decoding', () => {
    const data = zip({ 'Contents/section0.xml': section('<q:p id="1"><q:run><q:t xml:space="preserve">제1조(목적) &#x2460; &lt;공개&gt; &amp; &#9313; </q:t><q:t>&amp;#x2460;</q:t></q:run></q:p>', 'q') });
    const result = extractHwpx(data);
    expect(result.text).toBe('제1조(목적) ① <공개> & ② &#x2460;');
    expect(result.issues).toEqual([]);
    expect(result.positions[0]).toMatchObject({ line: 1, location: expect.stringContaining('section0.xml') });
  });

  it('orders section 2 before section 10 regardless of archive order', () => {
    const result = extractHwpx(zip({
      'Contents/section10.xml': section(p('열')),
      'Contents/section2.xml': section(p('둘')),
      'Contents/section0.xml': section(p('영')),
      'Preview/PrvText.txt': '읽으면 안 되는 미리보기',
    }));
    expect(result.text).toBe('영\n둘\n열');
  });

  it('reads a real package from the existing HWPX exporter', () => {
    const file = buildHwpx('원문 호환', [
      { type: 'p', runs: [{ text: '원문 호환 규칙' }] },
      { type: 'p', runs: [{ text: '제1조(목적) ① 글자 <인용> & 숫자 100을 보존한다.' }] },
    ]);
    expect(extractHwpx(file).text).toBe('원문 호환 규칙\n제1조(목적) ① 글자 <인용> & 숫자 100을 보존한다.');
  });

  it('rejects duplicate numeric section identities', () => {
    const file = zip({ 'Contents/section1.xml': section(p('첫 본문')), 'Contents/section01.xml': section(p('겹친 본문')) });
    expect(() => extractHwpx(file)).toThrow(/같은 본문/);
  });

  it('emits nested table paragraphs once in source order and flags the lost cell structure', () => {
    const table = `<hp:tbl><hp:tr><hp:tc><hp:subList>${p('첫째 칸')}<hp:p><hp:run><hp:t>바깥 칸</hp:t><hp:tbl><hp:tr><hp:tc><hp:subList>${p('중첩 칸')}</hp:subList></hp:tc></hp:tr></hp:tbl><hp:t>칸 끝</hp:t></hp:run></hp:p></hp:subList></hp:tc><hp:tc><hp:subList>${p('둘째 칸')}</hp:subList></hp:tc></hp:tr></hp:tbl>`;
    const result = extractHwpx(single(`<hp:p><hp:run><hp:t>표 앞</hp:t>${table}<hp:t>표 뒤</hp:t></hp:run></hp:p>`));
    expect(result.text).toBe('표 앞\n첫째 칸\n바깥 칸\n중첩 칸\n칸 끝\n둘째 칸\n표 뒤');
    expect(result.issues.filter((issue) => issue.code === 'HWPX_TABLE')).toHaveLength(2);
    expect(result.issues.every((issue) => issue.location?.includes('표') && issue.excerpt)).toBe(true);
  });

  it('preserves explicit line breaks and tabs', () => {
    const result = extractHwpx(single(p('제1조(목적) 본문<hp:lineBreak/>1. 첫째<hp:tab/>항목')));
    expect(result.text).toBe('제1조(목적) 본문\n1. 첫째\t항목');
    expect(result.positions.map((position) => position.line)).toEqual([1, 2]);
  });

  it('warns about omitted notes and non-text objects at their original positions', () => {
    const body = `<hp:p><hp:run><hp:t>본문</hp:t><hp:header>${p('머리말')}</hp:header><hp:pic/><hp:equation/></hp:run></hp:p>`;
    const result = extractHwpx(single(body));
    expect(result.text).toBe('본문');
    expect(result.issues.map((issue) => issue.code)).toEqual(['HWPX_NOTE', 'HWPX_OBJECT', 'HWPX_OBJECT']);
    expect(result.issues.every((issue) => issue.location?.includes('1번째 문단'))).toBe(true);
    expect(result.issues[0].excerpt).toBe('머리말');
  });

  it('rejects malformed XML instead of quietly returning a partial document', () => {
    expect(() => extractHwpx(zip({ 'Contents/section0.xml': '<sec><p><t>앞부분</p></sec>' }))).toThrow(/XML.*행/);
  });

  it('rejects DTDs and entity definitions before XML parsing', () => {
    expect(() => extractHwpx(zip({ 'Contents/section0.xml': '<!DOCTYPE sec [<!ENTITY file SYSTEM "file:///etc/passwd">]><sec><p><t>&file;</t></p></sec>' }))).toThrow(/엔티티/);
  });

  it('rejects archives with no actual document section', () => {
    expect(() => extractHwpx(zip({ 'Preview/PrvText.txt': '제1조(목적) 미리보기' }))).toThrow(/본문/);
  });

  it('checks all ZIP entry counts and expanded sizes before selecting text', () => {
    const archive = zip({ 'Contents/section0.xml': section(p('조문')), 'BinData/large.bin': 'x'.repeat(4000) });
    expect(() => extractHwpx(archive, { entries: 1 })).toThrow(/파일 수/);
    expect(() => extractHwpx(archive, { expandedBytes: 1000 })).toThrow(/압축 해제 크기/);
    expect(() => extractHwpx(archive, { sectionBytes: 10 })).toThrow(/본문 섹션/);
    expect(() => extractHwpx(archive, { textBytes: 10 })).toThrow(/전체 본문/);
  });

  it('does not treat a traversal path as a source section', () => {
    expect(() => extractHwpx(zip({ '../Contents/section0.xml': section(p('외부')) }))).toThrow(/본문/);
  });

  it('rejects excessively nested XML with an actionable message', () => {
    const nested = '<hp:run>'.repeat(20) + p('본문') + '</hp:run>'.repeat(20);
    expect(() => extractHwpx(single(nested), { xmlDepth: 10 })).toThrow(/중첩/);
  });
});

describe('TXT source extraction', () => {
  it('preserves UTF-8 raw text, line endings and spacing', () => {
    const text = '규정  제목\r\n제1조(목적)  ① 원문  그대로\r\n';
    expect(extractTxt(utf8(text))).toEqual({ text, issues: [], positions: [] });
  });

  it('reads legacy Korean encoding with an explicit warning', () => {
    const result = extractTxt(new Uint8Array([0xb0, 0xa1]).buffer);
    expect(result.text).toBe('가');
    expect(result.issues[0].code).toBe('TXT_ENCODING');
  });

  it('rejects binary and empty content', () => {
    expect(() => extractTxt(utf8('본문\0'))).toThrow(/텍스트|글자 파일/);
    expect(() => extractTxt(utf8(' \n '))).toThrow(/내용이 없습니다/);
  });
});

describe('read-only structural source review', () => {
  const normal = '시설 규칙\n제1조(목적) 목적을 정한다.\n제2조(정의) ① 다음과 같다.\n1. 첫 번째\n2. 두 번째\n② 그 밖의 사항이다.\n부칙\n제1조(시행일) 공포한 날부터 시행한다.\n[별표 1] 요금\n성인 1000원';

  it('shows article, paragraph, item, addenda and annex structures without demanding confirmation', () => {
    const result = reviewSource(normal);
    expect(result.issues).toEqual([]);
    expect(result.counts).toEqual({ articles: 2, paragraphs: 3, items: 2, annexes: 1 });
    expect(result.articles[1].paragraphs[0].text).toContain('1. 첫 번째\n2. 두 번째');
    expect(result.rule.addenda).toContain('제1조(시행일)');
    expect(sourceReviewGate(result.issues, false).allowed).toBe(true);
  });

  it('preserves ordinary sample flows without unnecessary confirmation', () => {
    for (const sample of SAMPLES.filter((entry) => entry.mode === 'amend')) {
      const review = reviewSource(sample.text, sample.kind);
      expect(review.issues, sample.id).toEqual([]);
    }
  });

  it('blocks duplicate article addresses and gives the exact conflicting source line', () => {
    const result = reviewSource('규칙\n제1조(목적) 앞 내용\n제1조(범위) 뒤 내용');
    const issue = result.issues.find((item) => item.code === 'DUPLICATE_ARTICLE');
    expect(issue).toMatchObject({ severity: 'blocking', location: '3행', excerpt: '제1조(범위) 뒤 내용' });
    expect(sourceReviewGate(result.issues, true).allowed).toBe(false);
  });

  it('points to missing article/paragraph numbers and requires one explicit confirmation', () => {
    const result = reviewSource('규칙\n제1조(목적) 내용\n제3조(범위) ③ 셋째 항', 'rule', [], [{ line: 3, location: 'Contents/section0.xml · 7번째 문단' }]);
    expect(result.issues.map((issue) => issue.code)).toEqual(['ARTICLE_GAP', 'PARAGRAPH_START']);
    expect(result.issues[0].location).toBe('3행 · Contents/section0.xml · 7번째 문단');
    expect(sourceReviewGate(result.issues, false).allowed).toBe(false);
    expect(sourceReviewGate(result.issues, true).allowed).toBe(true);
  });

  it('does not mistake citations or addenda article numbers for duplicate source articles', () => {
    const result = reviewSource('규칙\n제1조(목적) 목적이다.\n제1조에 따른 사항이다.\n제2조(범위) 적용한다.\n부칙\n제1조(시행일) 공포한 날부터.');
    expect(result.issues).toEqual([]);
    expect(result.counts.articles).toBe(2);
  });

  it('locates a paragraph gap in the correct branch article', () => {
    const review = reviewSource('규칙\n제1조(목적) 내용\n제1조의2(기준) ① 첫 항\n③ 셋째 항\n제2조(절차) 내용');
    expect(review.issues.find((issue) => issue.code === 'PARAGRAPH_GAP')).toMatchObject({ location: '4행', excerpt: '③ 셋째 항', message: expect.stringContaining('제1조의2') });
    expect(review.articles[1].paragraphs[1].location).toBe('4행');
  });

  it('does not flag an ordinary in-sentence article citation as a joined heading', () => {
    const review = reviewSource('규칙\n제1조(목적) 「시설법」 제2조(정의)에 따른 시설을 대상으로 한다.');
    expect(review.issues).toEqual([]);
    const joined = reviewSource('규칙\n제1조(목적) 목적이다. 제2조(범위) 범위이다.');
    expect(joined.issues[0].code).toBe('JOINED_ARTICLES');
  });

  it('flags unsupported annex labels, broken characters and malformed headings instead of silently blessing them', () => {
    const result = reviewSource('규칙\n제1조(목적) 내용 �\n별표 1 금액표\n제２조(범위) 내용');
    expect(result.issues.map((issue) => issue.code)).toEqual(['BROKEN_CHARACTER', 'ANNEX_HEADING', 'UNREAD_ARTICLE']);
  });

  it('keeps extraction warnings in the review and never mutates the raw input', () => {
    const raw = '규칙\r\n제1조(목적)  원문 <개정 2020. 1. 1.>\r\n';
    const before = raw;
    const result = reviewSource(raw, 'rule', [{ code: 'HWPX_TABLE', message: '표 구조 확인', severity: 'warning', location: '표 1' }]);
    expect(raw).toBe(before);
    expect(result.issues[0].code).toBe('HWPX_TABLE');
    expect(sourceReviewGate(result.issues, false).allowed).toBe(false);
  });

  it('blocks inputs with no legal article structure', () => {
    const result = reviewSource('문서 제목\n그림에서 인식한 조 번호 없는 내용');
    expect(result.issues.some((issue) => issue.code === 'NO_ARTICLES')).toBe(true);
    expect(sourceReviewGate(result.issues, true).allowed).toBe(false);
  });
});
