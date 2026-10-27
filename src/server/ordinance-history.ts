import { LawError, lawApiCall, parseLawArticles, cleanLawText } from './law';
import {
  changeGroup, historyQueryKey, historyYears, mergeOrdinanceEvents, ordinanceVersionUrl, seoulToday,
  type HistoryCoverage, type HistoryQuery, type HistoryResult, type HistoryScope, type HistoryVersion, type OrdinanceEvent,
} from '@/lib/ordinance-history';

const PAGE_SIZE = 30;
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const scalar = (value: unknown) => typeof value === 'string' || typeof value === 'number' ? String(value) : '';
const numeric = (value: unknown) => /^\d+$/.test(scalar(value)) ? Number(value) : null;
const array = (value: unknown): Record<string, unknown>[] => (Array.isArray(value) ? value : value == null ? [] : [value]).map(object);
function isoDate(value: unknown): string {
  const digits = scalar(value).replace(/[.\-\s]/g, '');
  if (!/^\d{8}$/.test(digits)) return '';
  const iso = `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
  const time = Date.parse(`${iso}T00:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === iso ? iso : '';
}
export function parseHistoryPage(data: unknown, year: number, scope: HistoryScope, page: number, asOf: string) {
  const root = object(object(data).OrdinSearch ?? object(data).ordinSearch);
  const total = numeric(root.totalCnt);
  if (total === null || (root.resultCode && scalar(root.resultCode) !== '00')) throw new LawError('LAW_FORMAT', '조례 목록의 전체 건수·조회 상태를 확인할 수 없습니다.');
  const responsePage = numeric(root.page);
  if (responsePage !== null && responsePage !== page) throw new LawError('LAW_PAGE_MISMATCH', '요청한 페이지와 응답 페이지가 다릅니다. 목록을 다시 조회해 주세요.');
  const records = array(root.law ?? root.ordin);
  if (total > 0 && !records.length) throw new LawError('LAW_FORMAT', '검색 건수는 있으나 조례 목록을 받지 못했습니다.');
  if (records.length > PAGE_SIZE || records.length > total) throw new LawError('LAW_FORMAT', '응답 건수와 조례 목록의 길이가 맞지 않습니다.');
  const expectedCount = Math.min(PAGE_SIZE, Math.max(0, total - (page - 1) * PAGE_SIZE));
  if (records.length !== expectedCount) throw new LawError('LAW_PAGE_GAP', '예상한 목록 개수보다 적거나 많은 기록을 받았습니다. 누락을 막기 위해 같은 페이지를 다시 조회합니다.');
  const from = `${year}-01-01`; const to = `${year}-12-31` < asOf ? `${year}-12-31` : asOf;
  const items: OrdinanceEvent[] = [];
  let excluded = 0;
  const seenVersions = new Set<string>();
  for (const row of records) {
    const documentId = scalar(row['자치법규ID']); const mst = scalar(row['자치법규일련번호']);
    const title = scalar(row['자치법규명']); const org = scalar(row['지자체기관명']);
    const promulgatedAt = isoDate(row['공포일자']); const effectiveAt = isoDate(row['시행일자']);
    const type = scalar(row['자치법규종류']);
    if (!/^\d+$/.test(documentId) || !/^\d+$/.test(mst) || !title || !promulgatedAt || promulgatedAt < from || promulgatedAt > to || (type && type !== '조례' && type !== 'C0001' && type !== '30001')) { excluded++; continue; }
    if (seenVersions.has(mst)) { excluded++; continue; }
    seenVersions.add(mst);
    const amendment = scalar(row['제개정구분명']) || '구분 미확인';
    const promulgationNumber = scalar(row['공포번호']);
    const url = ordinanceVersionUrl(mst);
    items.push({
      eventId: JSON.stringify([documentId, promulgatedAt, promulgationNumber, amendment]), documentId, mst, title, org,
      promulgatedAt, promulgationNumber, effectiveAt, amendment, changeGroup: changeGroup(amendment), year, url,
      scopes: [scope], versions: [{ mst, url }], identityUncertain: !promulgationNumber,
    });
  }
  // Do not trust a short non-terminal page to mean exhaustion. Provider total is
  // retained separately from our deduplicated and validated event count.
  const nextPage = page * PAGE_SIZE < total ? page + 1 : null;
  return { items, total, nextPage, excluded, count: records.length, complete: nextPage === null && excluded === 0 };
}

export type HistoryCursors = Record<string, number | null>;
export async function searchOrdinanceHistory(query: HistoryQuery, cursors?: HistoryCursors, offline = false, now = Date.now()): Promise<HistoryResult> {
  const asOf = seoulToday(now); const years = historyYears(query.endYear);
  const jobs = years.flatMap(year => (['current', 'history'] as HistoryScope[]).map(scope => ({ year, scope, key: `${year}:${scope}` })));
  const pages: { items: OrdinanceEvent[]; coverage: HistoryCoverage }[] = [];
  async function read(job: typeof jobs[number]) {
    const { year, scope, key } = job; const cursor = cursors?.[key]; const page = cursor ?? 1;
    if (cursors && cursor === null) return { items: [], coverage: { ...job, page, nextPage: null, complete: false, skipped: true, count: 0, total: null, excluded: 0 } };
    try {
      const to = `${year}-12-31` < asOf ? `${year}-12-31` : asOf;
      const params: Record<string, string> = { target: 'ordin', query: query.query || '*', nw: scope === 'current' ? '1' : '2', knd: '30001', search: '1', ancYd: `${year}0101~${to.replace(/-/g, '')}`, display: String(PAGE_SIZE), page: String(page), sort: 'ddes' };
      if (query.org) params.org = query.org;
      if (query.sborg) params.sborg = query.sborg;
      const response = await lawApiCall('lawSearch', params, offline);
      if (response.via === 'snapshot') throw new LawError('LAW_HISTORY_LIVE_REQUIRED', '연혁 비교에는 공식 현행·연혁 목록 조회가 필요합니다.');
      const parsed = parseHistoryPage(response.data, year, scope, page, asOf);
      return { items: parsed.items, coverage: { ...job, page, nextPage: parsed.nextPage, complete: parsed.complete, skipped: false, count: parsed.count, total: parsed.total, excluded: parsed.excluded, pagesRead: [page], excludedPages: { [page]: parsed.excluded }, via: response.via } };
    } catch (error) {
      return { items: [], coverage: { ...job, page, nextPage: page, complete: false, skipped: false, count: 0, total: null, excluded: 0, error: error instanceof LawError ? `${error.message} (${error.code})` : '조례 변경 목록을 받지 못했습니다. 다시 조회해 주세요.' } };
    }
  }
  // Five years receive the same page budget. At most three upstream requests
  // are active; unfinished or failed scopes keep their own continuation page.
  await Promise.all(Array.from({ length: 3 }, async () => { while (jobs.length) { const job = jobs.shift(); if (job) pages.push(await read(job)); } }));
  const coverage = Object.fromEntries(pages.map(page => [page.coverage.key, page.coverage]));
  const items = mergeOrdinanceEvents(pages.flatMap(page => page.items));
  const complete = !cursors && Object.values(coverage).every(scope => scope.complete && !scope.error);
  const from = `${years[0]}-01-01`; const to = `${query.endYear}-12-31` < asOf ? `${query.endYear}-12-31` : asOf;
  return {
    query, queryKey: historyQueryKey(query), years, from, to, asOf, items, coverage, complete,
    more: Object.values(coverage).some(scope => scope.nextPage !== null), fetchedAt: new Date(now).toISOString(),
    warnings: [
      '공포일 기준입니다. 한 조례가 여러 차례 개정되면 공포 건별로 집계하며 같은 공포의 현행·연혁 중복은 합칩니다.',
      '현재연도는 조회일까지의 기록입니다. 이전 연도 전체와 기간 길이가 다르므로 건수만으로 증가·감소를 판단하지 마세요.',
      '연혁 목록에도 최신 버전이 포함될 수 있습니다. 목록 구분만으로 현행 효력을 판정하지 않으며, 작업에 가져올 때 현행 원문을 다시 조회합니다.',
    ],
  };
}

function namedTexts(value: unknown, fields: Set<string>): string[] {
  if (Array.isArray(value)) return value.flatMap(item => namedTexts(item, fields));
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([key, child]) => {
    if (fields.has(key)) return (Array.isArray(child) ? child : [child]).map(item => cleanLawText(scalar(item))).filter(Boolean);
    return namedTexts(child, fields);
  });
}
export async function getOrdinanceVersion(documentId: string, mst: string, offline = false): Promise<HistoryVersion> {
  const response = await lawApiCall('lawService', { target: 'ordin', MST: mst }, offline);
  if (response.via === 'snapshot') throw new LawError('LAW_HISTORY_LIVE_REQUIRED', '공식 공포 버전 원문을 받지 못했습니다.');
  const data = object(response.data); const root = object(data.LawService ?? data['자치법규'] ?? data.Ordin ?? data);
  const info = object(root['자치법규기본정보'] ?? root['기본정보']);
  if (scalar(info['자치법규ID']) !== documentId || scalar(info['자치법규일련번호']) !== mst) throw new LawError('LAW_ID_MISMATCH', '선택한 조례·공포 버전과 받은 원문의 식별자가 다릅니다. 다시 검색해 주세요.');
  const title = scalar(info['자치법규명']); const promulgatedAt = isoDate(info['공포일자']);
  if (!title || !promulgatedAt) throw new LawError('LAW_FORMAT', '해당 버전의 제목과 공포일을 확인할 수 없습니다.');
  let articles;
  try { articles = parseLawArticles(root, 'ordin'); }
  catch (error) {
    if (error instanceof LawError && error.code === 'LAW_EMPTY') throw new LawError('LAW_HISTORY_NO_ARTICLES', '이 공포 버전에서 비교할 조문 본문을 확인하지 못했습니다. 폐지된 조례나 비조문식 문서는 해당 버전의 공식 원문·개정문·부칙을 확인해 주세요.');
    throw error;
  }
  return {
    documentId, mst, title, org: scalar(info['지자체기관명']), promulgatedAt, promulgationNumber: scalar(info['공포번호']),
    effectiveAt: isoDate(info['시행일자']), amendment: scalar(info['제개정정보']), url: ordinanceVersionUrl(mst),
    articles, addenda: namedTexts(root['부칙'], new Set(['부칙내용'])),
    reasons: namedTexts(root, new Set(['제개정이유내용', '개정문내용'])), fetchedAt: new Date().toISOString(), via: response.via,
    note: '선택한 공포 버전의 조회 가능한 조문·부칙입니다. 현재 효력이 있다는 뜻은 아니며, 별표·별지·첨부파일과 원문 전체는 공식 문서에서 확인해야 합니다.',
  };
}
