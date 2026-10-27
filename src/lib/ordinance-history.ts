import { z } from 'zod';
import type { LawArticle } from '@/server/law';
import { parseSimilarReference, type SimilarRuleReference } from './similar-rules';

export type HistoryScope = 'current' | 'history';
export type ChangeGroup = 'enacted' | 'amended' | 'repealed' | 'replaced' | 'other';
export const CHANGE_LABELS: Record<ChangeGroup, string> = { enacted: '제정', amended: '개정', repealed: '폐지', replaced: '폐지제정', other: '기타·미확인' };
export interface OrdinanceEvent {
  eventId: string; documentId: string; mst: string; title: string; org: string;
  promulgatedAt: string; promulgationNumber: string; effectiveAt: string;
  amendment: string; changeGroup: ChangeGroup; year: number; url: string;
  scopes: HistoryScope[]; versions: { mst: string; url: string }[]; identityUncertain: boolean;
}
export interface HistoryQuery { query: string; endYear: number; org?: string; sborg?: string }
export interface HistoryCoverage {
  key: string; year: number; scope: HistoryScope; page: number; nextPage: number | null;
  complete: boolean; skipped: boolean; count: number; total: number | null;
  excluded: number; via?: 'live' | 'relay'; error?: string;
  pagesRead?: number[]; excludedPages?: Record<string, number>;
}
export interface HistoryResult {
  query: HistoryQuery; queryKey: string; years: number[]; from: string; to: string; asOf: string;
  items: OrdinanceEvent[]; coverage: Record<string, HistoryCoverage>;
  complete: boolean; more: boolean; fetchedAt: string; warnings: string[];
}
export interface HistoryVersion {
  documentId: string; mst: string; title: string; org: string;
  promulgatedAt: string; promulgationNumber: string; effectiveAt: string; amendment: string;
  url: string; articles: LawArticle[]; addenda: string[]; reasons: string[];
  fetchedAt: string; via: 'live' | 'relay'; note: string;
}
export interface VersionComparisonRow {
  key: string; heading: string; before?: LawArticle; after?: LawArticle;
  status: 'same' | 'changed' | 'unmatched';
}

export const seoulToday = (now = Date.now()) => new Date(now + 9 * 3600000).toISOString().slice(0, 10);
export const historyYears = (endYear: number) => Array.from({ length: 5 }, (_, i) => endYear - 4 + i);
export function changeGroup(amendment: string): ChangeGroup {
  const value = amendment.replace(/\s/g, '');
  if (value === '제정') return 'enacted';
  if (value === '폐지제정') return 'replaced';
  if (['일부개정', '전부개정', '일괄개정', '타법개정', '개정'].includes(value)) return 'amended';
  if (['폐지', '일괄폐지', '타법폐지'].includes(value)) return 'repealed';
  return 'other';
}
export function historyQueryKey(query: HistoryQuery): string { return JSON.stringify([query.query.trim(), query.endYear, query.org || '', query.sborg || '']); }
export function ordinanceVersionUrl(mst: string): string {
  if (!/^\d+$/.test(mst)) throw new Error('조례 버전 번호가 올바르지 않습니다.');
  return `https://www.law.go.kr/ordinInfoP.do?ordinSeq=${mst}`;
}

/** nw=2 can include a version also returned by nw=1. Count promulgation events,
 * not the sum of the two result sets; retain every distinct version link. */
export function mergeOrdinanceEvents(items: OrdinanceEvent[]): OrdinanceEvent[] {
  const merged = new Map<string, OrdinanceEvent>();
  for (const item of items) {
    const previous = merged.get(item.eventId);
    if (!previous) { merged.set(item.eventId, { ...item, scopes: [...item.scopes], versions: [...item.versions] }); continue; }
    const versions = new Map([...previous.versions, ...item.versions].map(version => [version.mst, version]));
    merged.set(item.eventId, {
      ...previous, scopes: [...new Set([...previous.scopes, ...item.scopes])], versions: [...versions.values()],
      identityUncertain: previous.identityUncertain || item.identityUncertain || (!item.promulgationNumber && versions.size > 1),
    });
  }
  return [...merged.values()].sort((a, b) => b.promulgatedAt.localeCompare(a.promulgatedAt) || a.title.localeCompare(b.title, 'ko') || a.eventId.localeCompare(b.eventId));
}
export function mergeHistoryResults(previous: HistoryResult | null, next: HistoryResult): HistoryResult {
  if (previous && previous.queryKey !== next.queryKey) throw new Error('조회 조건이 바뀌었습니다. 처음부터 다시 조회해 주세요.');
  const coverage = { ...(previous?.coverage ?? {}) };
  for (const [key, value] of Object.entries(next.coverage)) {
    if (value.skipped && coverage[key]) continue;
    const earlier = coverage[key];
    const pagesRead = [...new Set([...(earlier?.pagesRead ?? (earlier && !earlier.error && !earlier.skipped ? [earlier.page] : [])), ...(!value.error && !value.skipped ? [value.page] : [])])].sort((a, b) => a - b);
    const excludedPages: Record<string, number> = { ...(earlier?.excludedPages ?? (earlier ? { [earlier.page]: earlier.excluded } : {})), ...(!value.error ? { [value.page]: value.excluded } : {}) };
    const excluded = Object.values(excludedPages).reduce((sum, count) => sum + count, 0);
    const fullyRead = pagesRead.length === value.page && pagesRead.every((page, index) => page === index + 1);
    coverage[key] = { ...value, pagesRead, excludedPages, excluded, complete: value.complete && fullyRead && excluded === 0 };
  }
  const items = mergeOrdinanceEvents([...(previous?.items ?? []), ...next.items]);
  const expected = next.years.flatMap(year => ['current', 'history'].map(scope => `${year}:${scope}`));
  const complete = expected.every(key => coverage[key]?.complete === true && !coverage[key]?.error);
  return { ...next, items, coverage, complete, more: Object.values(coverage).some(scope => scope.nextPage !== null), warnings: [...new Set([...(previous?.warnings ?? []), ...next.warnings])] };
}
export function yearComplete(result: HistoryResult, year: number): boolean { return ['current', 'history'].every(scope => result.coverage[`${year}:${scope}`]?.complete); }
export function historyCounts(items: OrdinanceEvent[], years: number[]) {
  return years.map(year => {
    const selected = items.filter(item => item.year === year);
    return { year, total: selected.length, ...Object.fromEntries(Object.keys(CHANGE_LABELS).map(key => [key, selected.filter(item => item.changeGroup === key).length])) } as { year: number; total: number } & Record<ChangeGroup, number>;
  });
}

/** Match unique headings with only spacing/middle-dot glyph normalization.
 * Repeated headings can pair only with the same article label and equal
 * normalized body, uniquely on both sides. Original texts remain untouched. */
export function compareOrdinanceVersions(before: HistoryVersion, after: HistoryVersion): VersionComparisonRow[] {
  if (before.documentId !== after.documentId) throw new Error('같은 조례의 두 공포 버전을 선택해 주세요.');
  const normalize = (value: string) => value.normalize('NFC').trim().replace(/\s+/g, ' ').replace(/[·ㆍ･]/g, '·');
  const heading = (article: LawArticle) => normalize(article.title);
  const displayedHeading = (article: LawArticle) => article.title.normalize('NFC').trim().replace(/\s+/g, ' ');
  const counts = (articles: LawArticle[]) => articles.reduce((map, article) => { const key = heading(article); if (key) map.set(key, (map.get(key) ?? 0) + 1); return map; }, new Map<string, number>());
  const exactKey = (article: LawArticle) => JSON.stringify([article.label, heading(article), normalize(article.text)]);
  const exactCounts = (articles: LawArticle[]) => articles.reduce((map, article) => { const key = exactKey(article); map.set(key, (map.get(key) ?? 0) + 1); return map; }, new Map<string, number>());
  const oldCount = counts(before.articles); const newCount = counts(after.articles); const used = new Set<number>();
  const oldExact = exactCounts(before.articles); const newExact = exactCounts(after.articles);
  const rows: VersionComparisonRow[] = before.articles.map((article, i) => {
    const title = heading(article);
    let nextIndex = title && oldCount.get(title) === 1 && newCount.get(title) === 1 ? after.articles.findIndex(candidate => heading(candidate) === title) : -1;
    if (nextIndex < 0 && title && ((oldCount.get(title) ?? 0) > 1 || (newCount.get(title) ?? 0) > 1)) {
      const key = exactKey(article);
      if (oldExact.get(key) === 1 && newExact.get(key) === 1) nextIndex = after.articles.findIndex(candidate => exactKey(candidate) === key);
    }
    if (used.has(nextIndex)) nextIndex = -1;
    if (nextIndex >= 0) used.add(nextIndex);
    const next = after.articles[nextIndex];
    return { key: `before-${i}`, heading: displayedHeading(article) || '조 제목 없음', before: article, after: next, status: !next ? 'unmatched' : article.label === next.label && article.text === next.text ? 'same' : 'changed' };
  });
  after.articles.forEach((article, i) => { if (!used.has(i)) rows.push({ key: `after-${i}`, heading: displayedHeading(article) || '조 제목 없음', after: article, status: 'unmatched' }); });
  return rows;
}

export interface OrdinanceHandoff {
  mode: 'enact' | 'amend'; references: SimilarRuleReference[]; source?: SimilarRuleReference;
  historyNote: string; createdAt: number;
}
const HANDOFF_KEY = 'jj:ordinance-handoff';
const handoffSchema = z.object({ mode: z.enum(['enact', 'amend']), references: z.array(z.unknown()).max(4), source: z.unknown().optional(), historyNote: z.string().max(12000), createdAt: z.number().finite() });
function validateReference(value: unknown, now: number): SimilarRuleReference {
  if (!value || typeof value !== 'object' || !('hit' in value)) throw new Error('참고 조례 정보를 확인할 수 없습니다.');
  const data = value as SimilarRuleReference;
  return parseSimilarReference(data, data.hit, now);
}
export function validateOrdinanceHandoff(value: unknown, expectedMode: 'enact' | 'amend', now = Date.now()): OrdinanceHandoff | null {
  try {
    const data = handoffSchema.parse(value);
    if (data.mode !== expectedMode || data.createdAt > now + 30000 || now - data.createdAt > 15 * 60 * 1000) return null;
    const references = data.references.map(value => validateReference(value, now));
    const source = data.source ? validateReference(data.source, now) : undefined;
    if (expectedMode === 'amend' && !source) return null;
    if (source && (source.hit.kind !== 'ordin' || !/^\d+$/.test(source.hit.id))) return null;
    return { ...data, references, source };
  } catch { return null; }
}
export function writeOrdinanceHandoff(data: Omit<OrdinanceHandoff, 'createdAt'>): void {
  const payload = { ...data, createdAt: Date.now() };
  if (!validateOrdinanceHandoff(payload, data.mode)) throw new Error('현행 원문을 확인한 조례만 작업으로 가져올 수 있습니다.');
  const raw = JSON.stringify(payload);
  if (raw.length > 1_500_000) throw new Error('선택한 원문이 너무 큽니다. 참고 조례 수를 줄여 주세요.');
  sessionStorage.setItem(HANDOFF_KEY, raw);
}
/** A pure read supports React Strict Mode; expiry prevents stale silent reuse. */
export function readOrdinanceHandoff(expectedMode: 'enact' | 'amend'): OrdinanceHandoff | null {
  try { const raw = sessionStorage.getItem(HANDOFF_KEY); if (!raw || raw.length > 1_500_000) return null; return validateOrdinanceHandoff(JSON.parse(raw), expectedMode); } catch { return null; }
}
