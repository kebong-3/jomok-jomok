import { z } from 'zod';
import type { LawArticle, LawDoc, LawHit, LawKind, LawMeta } from '@/server/law';

export interface SimilarRuleReference { hit: LawHit; doc: LawDoc; meta: LawMeta }
export interface SimilarRuleSearch { items: LawHit[]; meta: LawMeta }
export const MAX_SIMILAR_REFERENCES = 4;
export interface SimilarRuleMatrixRow {
  key: string;
  heading: string;
  matched: boolean;
  articles: (LawArticle | undefined)[];
}
export interface SimilarRuleRow {
  key: string;
  heading: string;
  matched: boolean;
  left?: LawArticle;
  right?: LawArticle;
}

const kindSchema = z.enum(['law', 'admrul', 'ordin']);
const hitSchema = z.object({
  id: z.string().min(1).max(100), title: z.string().min(1).max(300), kind: kindSchema,
  org: z.string().max(500).optional(), effectiveAt: z.string().max(30).optional(),
});
const metaSchema = z.object({
  via: z.enum(['live', 'relay', 'snapshot']), fetchedAt: z.string().datetime(),
  snapshotDate: z.string().max(40).optional(), note: z.string().max(4000).optional(),
  partial: z.boolean().optional(), errorCode: z.string().max(100).optional(),
});
const articleSchema = z.object({
  label: z.string().regex(/^제[1-9]\d*조(?:의[1-9]\d*)?$/),
  title: z.string().max(1000), text: z.string().min(1).max(200000),
});
const docSchema = z.object({
  id: z.string().min(1).max(100), title: z.string().min(1).max(300), kind: kindSchema,
  effectiveAt: z.string().max(30).optional(), url: z.string().min(1).max(3000),
  articles: z.array(articleSchema).min(1).max(5000),
});
const cleanTitle = (value: string) => value.normalize('NFC').replace(/[\s「」]/g, '');
const cleanHeading = (value: string) => value.normalize('NFC').trim().replace(/\s+/g, ' ');
const todayInSeoul = (now: number) => new Date(now + 9 * 3600000).toISOString().slice(0, 10);

function validDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const value = new Date(`${date}T00:00:00.000Z`);
  return Number.isFinite(value.getTime()) && value.toISOString().slice(0, 10) === date;
}
function dateAllowed(date: string | undefined, now: number): boolean {
  return !date || (validDate(date) && date <= todayInSeoul(now));
}
function validId(kind: LawKind, id: string): boolean {
  if (/^\d+$/.test(id)) return true;
  if (kind === 'admrul') return /^lid:\d+$/.test(id);
  if (kind === 'ordin') return /^mst:\d+$/.test(id);
  const match = id.match(/^mst:\d+:(\d{4})(\d{2})(\d{2})$/);
  return !!match && validDate(`${match[1]}-${match[2]}-${match[3]}`);
}
function fail(message: string): never { throw new Error(message); }

/** Validate the response before exposing a source URL in the browser. Returned
 * addresses are public, reconstructed links; API credentials are never copied. */
export function officialRuleUrl(doc: Pick<LawDoc, 'url' | 'kind' | 'title'>): string {
  let url: URL;
  try { url = new URL(doc.url); } catch { return fail('공식 원문 주소를 확인할 수 없습니다.'); }
  if (url.protocol !== 'https:' || !['law.go.kr', 'www.law.go.kr'].includes(url.hostname)
    || url.username || url.password || url.port) return fail('공식 국가법령정보센터 HTTPS 주소가 아닙니다.');
  const secrets = new Set(['oc', 'key', 'apikey', 'token', 'accesstoken', 'password', 'secret', 'auth', 'authorization', 'signature', 'xapikey']);
  for (const key of url.searchParams.keys()) {
    if (secrets.has(key.toLowerCase().replace(/[^a-z]/g, ''))) return fail('인증값이 포함된 주소는 참고자료로 사용할 수 없습니다.');
  }
  if (!kindSchema.safeParse(doc.kind).success || !doc.title.trim()) return fail('공식 규정 종류와 제목을 확인해 주세요.');
  const path = doc.kind === 'law' ? '법령' : doc.kind === 'admrul' ? '행정규칙' : '자치법규';
  const title = doc.kind === 'law' ? cleanTitle(doc.title) : doc.title.normalize('NFC').trim();
  return `https://www.law.go.kr/${path}/${encodeURIComponent(title)}`;
}

export function parseSimilarSearch(payload: unknown, kind: LawKind, now = Date.now()): SimilarRuleSearch {
  const parsed = z.object({ items: z.array(hitSchema).max(200), meta: metaSchema }).safeParse(payload);
  if (!parsed.success) return fail('규정 검색 응답의 형식을 확인할 수 없습니다. 다시 검색해 주세요.');
  const { items, meta } = parsed.data;
  // Snapshot IDs intentionally have a different form. They are not current peer
  // regulations and must never be presented as successful official search.
  if (meta.via === 'snapshot') return { items: [], meta };
  if (items.some(hit => hit.kind !== kind || !validId(hit.kind, hit.id) || !hit.title.trim())) {
    return fail('검색한 규정 종류 또는 식별자와 응답이 일치하지 않습니다.');
  }
  const seen = new Set<string>();
  return {
    items: items.filter(hit => {
      if (!dateAllowed(hit.effectiveAt, now)) return false;
      const key = `${hit.kind}:${hit.id}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }),
    meta,
  };
}

export function parseSimilarReference(payload: unknown, hit: LawHit, now = Date.now()): SimilarRuleReference {
  const parsed = z.object({ doc: docSchema, meta: metaSchema }).safeParse(payload);
  if (!parsed.success) return fail('규정 본문 응답의 형식을 확인할 수 없습니다. 공식 원문을 확인해 주세요.');
  const { doc, meta } = parsed.data;
  if (meta.via === 'snapshot') return fail(meta.note || '현재 규정의 공식 조회 대신 저장본을 받았습니다. 공식 연결을 확인한 뒤 다시 선택해 주세요.');
  if (!validId(hit.kind, hit.id) || !validId(doc.kind, doc.id) || doc.kind !== hit.kind || doc.id !== hit.id
    || cleanTitle(doc.title) !== cleanTitle(hit.title)) {
    return fail('선택한 규정과 본문의 종류·식별자·제목이 일치하지 않습니다. 다시 검색해 주세요.');
  }
  if (!dateAllowed(hit.effectiveAt, now) || !dateAllowed(doc.effectiveAt, now)) {
    return fail('시행예정본이거나 시행일을 해석할 수 없는 응답입니다. 공식 원문을 확인해 주세요.');
  }
  if (hit.effectiveAt && hit.effectiveAt !== doc.effectiveAt) {
    return fail('검색 후 규정의 시행일이 달라졌습니다. 다시 검색하여 버전을 확인해 주세요.');
  }
  if (new Set(doc.articles.map(article => article.label)).size !== doc.articles.length
    || doc.articles.some(article => !article.text.trim())) {
    return fail('본문의 조 번호가 중복되었거나 빈 조문이 있어 비교할 수 없습니다.');
  }
  return { hit: { ...hit }, doc: { ...doc, url: officialRuleUrl(doc) }, meta };
}

/** Identical article numbers in separate regulations do not establish alignment.
 * Only unique, identical headings are paired; even those require human review. */
export function buildSimilarComparison(left: SimilarRuleReference, right?: SimilarRuleReference): SimilarRuleRow[] {
  const counts = (articles: LawArticle[]) => {
    const map = new Map<string, number>();
    for (const article of articles) {
      const heading = cleanHeading(article.title);
      if (heading) map.set(heading, (map.get(heading) ?? 0) + 1);
    }
    return map;
  };
  const leftCounts = counts(left.doc.articles);
  const rightArticles = right?.doc.articles ?? [];
  const rightCounts = counts(rightArticles);
  const paired = new Set<number>();
  const rows: SimilarRuleRow[] = left.doc.articles.map((article, index) => {
    const heading = cleanHeading(article.title);
    const rightIndex = heading && leftCounts.get(heading) === 1 && rightCounts.get(heading) === 1
      ? rightArticles.findIndex(candidate => cleanHeading(candidate.title) === heading) : -1;
    if (rightIndex >= 0) paired.add(rightIndex);
    return {
      key: `left-${index}-${article.label}`, heading: heading || '조 제목 없음',
      matched: rightIndex >= 0, left: article, right: rightIndex >= 0 ? rightArticles[rightIndex] : undefined,
    };
  });
  rightArticles.forEach((article, index) => {
    if (!paired.has(index)) rows.push({ key: `right-${index}-${article.label}`, heading: cleanHeading(article.title) || '조 제목 없음', matched: false, right: article });
  });
  return rows;
}

/** A multi-source matrix preserves every article exactly once. A heading may
 * align only where it occurs once in that source; duplicate/untitled articles
 * stay separate instead of implying a legal equivalence from article numbers. */
export function buildSimilarMatrix(references: SimilarRuleReference[]): SimilarRuleMatrixRow[] {
  if (references.length > MAX_SIMILAR_REFERENCES) throw new Error('규정 비교는 최대 4개까지 가능합니다.');
  const counts = references.map(reference => {
    const result = new Map<string, number>();
    for (const article of reference.doc.articles) {
      const heading = cleanHeading(article.title);
      if (heading) result.set(heading, (result.get(heading) ?? 0) + 1);
    }
    return result;
  });
  const rows: SimilarRuleMatrixRow[] = [];
  const uniqueRows = new Map<string, SimilarRuleMatrixRow>();
  references.forEach((reference, sourceIndex) => {
    reference.doc.articles.forEach((article, articleIndex) => {
      const heading = cleanHeading(article.title);
      const unique = !!heading && counts[sourceIndex].get(heading) === 1;
      let row = unique ? uniqueRows.get(heading) : undefined;
      if (!row) {
        row = { key: `source-${sourceIndex}-${articleIndex}-${article.label}`, heading: heading || '조 제목 없음', matched: false, articles: Array(references.length).fill(undefined) };
        rows.push(row);
        if (unique) uniqueRows.set(heading, row);
      }
      row.articles[sourceIndex] = article;
      row.matched = row.articles.filter(Boolean).length > 1;
    });
  });
  return rows;
}

const scopeNote = '조회 범위: 조회된 조문 본문입니다. 부칙·별표·별지서식·공포 후 미시행 개정은 공식 원문에서 별도로 확인해야 합니다.';
const useNote = '타 기관의 유사 규정은 참고 사례입니다. 우리 기관의 권한·위임 근거와 적용대상이 같은지는 별도로 검토해야 합니다.';
const articleText = (article: LawArticle) => `${article.label}${article.title ? `(${article.title})` : ''}\n${article.text}`;

export function similarReferenceText(reference: SimilarRuleReference): string {
  const { hit, doc, meta } = reference;
  return [
    `유사 규정 참고 원문: ${doc.title}`, `기관: ${hit.org || '미확인'}`,
    `시행일: ${doc.effectiveAt || '미확인'}`, `조회시각: ${meta.fetchedAt}`,
    `조회 경로: ${meta.via === 'relay' ? '공식 API 중계' : '공식 API'}`,
    `공식 원문: ${officialRuleUrl(doc)}`, scopeNote, useNote,
    meta.note ? `조회 안내: ${meta.note}` : '', '', ...doc.articles.map(articleText),
  ].filter(line => line !== '').join('\n\n');
}

export function similarComparisonText(references: SimilarRuleReference[]): string {
  if (!references.length) return '';
  const rows = buildSimilarMatrix(references);
  const intro = [
    '유사 규정 조문 비교', '각 규정에서 유일하게 나타나는 동일 조 제목만 나란히 배치했습니다. 제목의 일치는 내용·권한의 동일성을 뜻하지 않습니다.',
    scopeNote, useNote,
    ...references.map((ref, index) => `${index + 1}. ${ref.doc.title} · 기관 ${ref.hit.org || '미확인'} · 시행일 ${ref.doc.effectiveAt || '미확인'}\n조회시각: ${ref.meta.fetchedAt}\n공식 원문: ${officialRuleUrl(ref.doc)}`),
  ];
  const body = rows.map(row => [
    `[${row.heading}] ${row.matched ? '동일 조 제목' : '대응 미확정'}`,
    ...references.map((reference, index) => `[${reference.doc.title}]\n${row.articles[index] ? articleText(row.articles[index]!) : '대응 조문을 확정하지 않았습니다.'}`),
  ].filter(Boolean).join('\n\n'));
  return [...intro, ...body].join('\n\n────────────────────\n\n');
}
