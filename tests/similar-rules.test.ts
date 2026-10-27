import { describe, expect, it } from 'vitest';
import type { LawDoc, LawHit, LawMeta } from '@/server/law';
import { mergePeerEvidence, peerReferenceEvidence, referenceBody } from '@/lib/reference-evidence';
import {
  buildSimilarComparison, buildSimilarMatrix, officialRuleUrl, parseSimilarReference, parseSimilarSearch,
  similarComparisonText, similarReferenceText, type SimilarRuleReference,
} from '@/lib/similar-rules';

const NOW = Date.parse('2026-10-23T12:00:00Z');
const hit = (): LawHit => ({ id: '12345', kind: 'ordin', title: '한빛시 위원회 운영 조례', org: '한빛시', effectiveAt: '2026-01-01' });
const payload = (): { doc: LawDoc; meta: LawMeta } => ({
  doc: {
    id: '12345', kind: 'ordin', title: '한빛시 위원회 운영 조례', effectiveAt: '2026-01-01',
    url: 'https://www.law.go.kr/자치법규/한빛시위원회운영조례',
    articles: [
      { label: '제1조', title: '목적', text: '이 조례는 위원회 운영에 필요한 사항을 정한다.' },
      { label: '제2조', title: '구성', text: '위원회는 위원장 1명을 포함하여 10명 이내의 위원으로 구성한다.\n② 위원장은 시장이 된다.' },
    ],
  },
  meta: { via: 'live', fetchedAt: '2026-10-23T10:00:00.000Z', partial: true, note: '조문 본문을 조회했습니다.' },
});

describe('4개 규정의 조문 대응과 복사', () => {
  it('번호가 달라도 3·4번째 규정의 같은 제목을 함께 비교하며 모든 본문을 보존한다', () => {
    const references = [
      reference([{ label: '제1조', title: '목적', text: '첫 규정의 목적' }, { label: '제2조', title: '정의', text: '첫 규정의 정의' }]),
      reference([{ label: '제1조', title: '지원 대상', text: '두 번째만 있는 대상' }, { label: '제3조', title: '목적', text: '두 번째 목적' }]),
      reference([{ label: '제2조', title: '목적', text: '세 번째 목적' }, { label: '제4조', title: '공개', text: '세 번째 공개' }]),
      reference([{ label: '제1조', title: '목적', text: '네 번째 목적' }, { label: '제5조', title: '공개', text: '네 번째 공개' }]),
    ];
    const matrix = buildSimilarMatrix(references);
    expect(matrix.find(row => row.heading === '목적')?.articles.map(article => article?.label)).toEqual(['제1조', '제3조', '제2조', '제1조']);
    expect(matrix.find(row => row.heading === '공개')?.articles.map(article => article?.label)).toEqual([undefined, undefined, '제4조', '제5조']);
    expect(matrix.flatMap(row => row.articles).filter(Boolean)).toHaveLength(8);
    const copied = similarComparisonText(references);
    for (const source of references) for (const article of source.doc.articles) expect(copied).toContain(article.text);
    expect(copied).toContain('네 번째 목적');
    expect(copied).toContain('4. 한빛시');
  });

  it('중복 제목과 빈 제목을 다른 규정 조문에 임의 대응하지 않는다', () => {
    const matrix = buildSimilarMatrix([
      reference([{ label: '제1조', title: '특례', text: '첫째 특례' }, { label: '제2조', title: '특례', text: '둘째 특례' }]),
      reference([{ label: '제3조', title: '특례', text: '다른 규정 특례' }]),
      reference([{ label: '제4조', title: '특례', text: '세 번째 규정 특례' }, { label: '제5조', title: '', text: '제목 없음' }]),
    ]);
    expect(matrix.slice(0, 2).every(row => !row.matched && row.articles.filter(Boolean).length === 1)).toBe(true);
    expect(matrix[2].articles.map(article => article?.label)).toEqual([undefined, '제3조', '제4조']);
    expect(matrix.flatMap(row => row.articles).filter(Boolean)).toHaveLength(5);
  });

  it('최대 개수를 넘으면 조용히 원문을 버리지 않고 알린다', () => {
    expect(() => buildSimilarMatrix(Array.from({ length: 5 }, () => reference()))).toThrow(/최대 4/);
    expect(() => similarComparisonText(Array.from({ length: 5 }, () => reference()))).toThrow(/최대 4/);
    expect(buildSimilarMatrix([])).toEqual([]);
  });

  it('4개 참고 원문을 제정·개정 근거로 전달하고 다섯 번째 추가가 기존 선택을 지우지 않는다', async () => {
    const sources = Array.from({ length: 5 }, (_, i) => {
      const result = reference(); result.doc.id = String(100 + i); result.hit.id = result.doc.id;
      result.doc.title = `검증${i + 1}시 위원회 조례`; return result;
    });
    const evidence = await Promise.all(sources.map(peerReferenceEvidence));
    const connected = mergePeerEvidence([], evidence.slice(0, 4));
    expect(connected).toHaveLength(4);
    expect(connected.every(item => item.contentHash?.length === 64 && item.note?.includes('위임·수권 근거로 쓰지'))).toBe(true);
    expect(mergePeerEvidence(connected, [evidence[0]])).toHaveLength(4);
    expect(() => mergePeerEvidence(connected, [evidence[4]])).toThrow(/최대 4/);
    expect(connected.map(item => item.lawId)).toEqual(['100', '101', '102', '103']);
  });

  it('공식 본문에 조 번호가 이미 포함되었으면 원문 전달 때 중복하지 않는다', () => {
    const doc = reference([{ label: '제1조', title: '목적', text: '제1조(목적) 원문입니다.' }]).doc;
    expect(referenceBody(doc)).toBe(`${doc.title}\n제1조(목적) 원문입니다.`);
  });
});
function reference(articles?: LawDoc['articles']): SimilarRuleReference {
  const data = payload();
  if (articles) data.doc.articles = articles;
  return parseSimilarReference(data, hit(), NOW);
}

describe('유사 규정 응답·출처 검증', () => {
  it('선택한 실제 규정의 본문과 조회 정보를 유지한다', () => {
    const data = payload();
    const result = parseSimilarReference(data, hit(), NOW);
    expect(result.doc.articles).toEqual(data.doc.articles);
    expect(result.hit.org).toBe('한빛시');
    expect(result.meta.fetchedAt).toBe(data.meta.fetchedAt);
    const titleVariant = payload();
    titleVariant.doc.title = '「한빛시위원회 운영 조례」';
    expect(parseSimilarReference(titleVariant, hit(), NOW).doc.title).toBe(titleVariant.doc.title);
  });

  it.each(['id', 'title', 'kind'] as const)('선택한 규정과 %s가 다른 본문을 차단한다', field => {
    const data = payload();
    if (field === 'id') data.doc.id = '99999';
    if (field === 'title') data.doc.title = '다른시 위원회 운영 조례';
    if (field === 'kind') data.doc.kind = 'admrul';
    expect(() => parseSimilarReference(data, hit(), NOW)).toThrow(/일치/);
  });

  it.each([
    'https://www.law.go.kr.attacker.example/조례',
    'https://user:password@www.law.go.kr/조례',
    'javascript:alert(1)',
    'http://www.law.go.kr/조례',
    'https://www.law.go.kr:8443/조례',
    'https://www.law.go.kr/DRF/lawService.do?OC=private-user',
    'https://www.law.go.kr/DRF/lawService.do?api_key=private-key',
  ])('사칭·비공식·인증값 포함 주소를 차단한다: %s', url => {
    const data = payload();
    data.doc.url = url;
    expect(() => parseSimilarReference(data, hit(), NOW)).toThrow();
  });

  it('출처를 확인한 뒤 공개 규정 주소로 다시 구성한다', () => {
    const data = payload();
    data.doc.url = 'https://law.go.kr/LSW/ordinInfoP.do?ordinSeq=12345&unused=value#content';
    const result = parseSimilarReference(data, hit(), NOW);
    expect(result.doc.url).toBe(`https://www.law.go.kr/자치법규/${encodeURIComponent(data.doc.title)}`);
    expect(result.doc.url).not.toContain('unused');
    expect(officialRuleUrl({ url: 'https://www.law.go.kr/법령/지방자치법', kind: 'law', title: '「지방 자치법」' })).toBe(`https://www.law.go.kr/법령/${encodeURIComponent('지방자치법')}`);
  });

  it('시행예정·잘못된 날짜·검색 후 바뀐 버전을 배제한다', () => {
    for (const date of ['2099-01-01', '2026-02-30', 'not-a-date']) {
      const data = payload(); data.doc.effectiveAt = date;
      expect(() => parseSimilarReference(data, hit(), NOW)).toThrow(/시행/);
    }
    const changed = payload(); changed.doc.effectiveAt = '2026-09-01';
    expect(() => parseSimilarReference(changed, hit(), NOW)).toThrow(/달라/);
    const lost = payload(); lost.doc.effectiveAt = undefined;
    expect(() => parseSimilarReference(lost, hit(), NOW)).toThrow(/달라/);
    const unknown = payload(); unknown.doc.effectiveAt = undefined;
    expect(parseSimilarReference(unknown, { ...hit(), effectiveAt: undefined }, NOW).doc.effectiveAt).toBeUndefined();
  });

  it('저장본 응답을 현재 유사 규정으로 조용히 대체하지 않는다', () => {
    const data = payload(); data.meta.via = 'snapshot'; data.meta.note = '공식 API 연결 실패로 저장본을 반환했습니다.';
    expect(() => parseSimilarReference(data, hit(), NOW)).toThrow(/저장본/);
    const result = parseSimilarSearch({ items: [{ ...hit(), id: 'snap:12345' }], meta: data.meta }, 'ordin', NOW);
    expect(result.items).toEqual([]);
    expect(result.meta.via).toBe('snapshot');
    expect(result.meta.note).toContain('공식 API 연결 실패');
  });

  it('중복 조 번호와 해석할 수 없는 조 번호를 차단한다', () => {
    const duplicate = payload(); duplicate.doc.articles.push({ ...duplicate.doc.articles[0], text: '다른 내용' });
    expect(() => parseSimilarReference(duplicate, hit(), NOW)).toThrow(/중복/);
    const malformed = payload(); malformed.doc.articles[0].label = '제1항';
    expect(() => parseSimilarReference(malformed, hit(), NOW)).toThrow();
  });

  it('검색 종류·식별자를 검증하고 중복·시행예정·잘못된 날짜를 제외한다', () => {
    const meta = payload().meta;
    expect(() => parseSimilarSearch({ items: [{ ...hit(), kind: 'law' }], meta }, 'ordin', NOW)).toThrow(/일치/);
    expect(() => parseSimilarSearch({ items: [{ ...hit(), id: 'arbitrary-value' }], meta }, 'ordin', NOW)).toThrow(/식별자/);
    const result = parseSimilarSearch({ items: [hit(), hit(), { ...hit(), id: '111', effectiveAt: '2099-01-01' }, { ...hit(), id: '222', effectiveAt: '2026-02-30' }], meta }, 'ordin', NOW);
    expect(result.items).toEqual([hit()]);
  });

  it('각 규정 종류에서 실제 API가 쓰는 식별자만 받는다', () => {
    const cases = [
      { kind: 'law' as const, id: 'mst:12345:20260101' },
      { kind: 'admrul' as const, id: 'lid:12345' },
      { kind: 'ordin' as const, id: 'mst:12345' },
    ];
    for (const item of cases) {
      const itemHit = { ...hit(), ...item };
      const data = payload(); data.doc.kind = item.kind; data.doc.id = item.id;
      expect(parseSimilarSearch({ items: [itemHit], meta: data.meta }, item.kind, NOW).items[0].id).toBe(item.id);
      expect(parseSimilarReference(data, itemHit, NOW).doc.id).toBe(item.id);
    }
    expect(() => parseSimilarSearch({ items: [{ ...hit(), kind: 'law', id: 'mst:12345' }], meta: payload().meta }, 'law', NOW)).toThrow();
    expect(() => parseSimilarSearch({ items: [{ ...hit(), kind: 'law', id: 'mst:12345:20260230' }], meta: payload().meta }, 'law', NOW)).toThrow();
  });
});

describe('실제 본문 비교와 복사', () => {
  it('조 번호가 아니라 유일한 동일 조 제목을 기준으로 나란히 배치한다', () => {
    const left = reference();
    const right = reference([
      { label: '제1조', title: '지원 대상', text: '지원 대상은 별도로 정한다.' },
      { label: '제3조', title: '목적', text: '이 조례는 운영의 투명성을 높이는 것을 목적으로 한다.' },
    ]);
    const rows = buildSimilarComparison(left, right);
    expect(rows[0].left?.label).toBe('제1조');
    expect(rows[0].right?.label).toBe('제3조');
    expect(rows[0].matched).toBe(true);
    expect(rows[1].right).toBeUndefined();
    expect(rows[2].left).toBeUndefined();
    expect(rows[2].right?.title).toBe('지원 대상');
  });

  it('중복되거나 빈 제목의 조문은 임의 대응하지 않는다', () => {
    const left = reference([
      { label: '제1조', title: '특례', text: '첫째 특례' },
      { label: '제2조', title: '특례', text: '둘째 특례' },
      { label: '제3조', title: '', text: '제목이 없는 본문' },
    ]);
    const right = reference([
      { label: '제1조', title: '특례', text: '별도 특례' },
      { label: '제3조', title: '', text: '다른 제목 없는 본문' },
    ]);
    const rows = buildSimilarComparison(left, right);
    expect(rows).toHaveLength(5);
    expect(rows.every(row => !row.matched && !(row.left && row.right))).toBe(true);
  });

  it('원문 한 개를 선택했을 때도 전체 조회 본문을 유지한다', () => {
    const source = reference();
    const rows = buildSimilarComparison(source);
    expect(rows.map(row => row.left)).toEqual(source.doc.articles);
    expect(rows.every(row => !row.right && !row.matched)).toBe(true);
    expect(similarComparisonText([])).toBe('');
  });

  it('복사 내용에 실제 본문·출처·조회시각·확인 범위와 권한 검토를 보존한다', () => {
    const source = reference();
    for (const text of [similarReferenceText(source), similarComparisonText([source])]) {
      expect(text).toContain(source.doc.articles[1].text);
      expect(text).toContain(source.doc.url);
      expect(text).toContain(source.meta.fetchedAt);
      expect(text).toContain('부칙·별표·별지서식');
      expect(text).toContain('미시행 개정');
      expect(text).toContain('위임 근거');
      expect(text).toContain('한빛시');
    }
  });
});
