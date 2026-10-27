import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getOrdinanceVersion, parseHistoryPage, searchOrdinanceHistory } from '@/server/ordinance-history';
import {
  changeGroup, compareOrdinanceVersions, historyCounts, historyQueryKey, historyYears, mergeHistoryResults,
  mergeOrdinanceEvents, ordinanceVersionUrl, seoulToday, validateOrdinanceHandoff,
  type HistoryCoverage, type HistoryResult, type HistoryVersion, type OrdinanceEvent,
} from '@/lib/ordinance-history';
import type { SimilarRuleReference } from '@/lib/similar-rules';
import { GET, POST } from '@/app/api/law/history/route';

const now = Date.UTC(2026, 9, 25, 5);
const row = (overrides: Record<string, unknown> = {}) => ({ 자치법규ID: '2035792', 자치법규일련번호: '1972513', 자치법규명: '검증시 주민참여예산제 운영 조례', 지자체기관명: '검증시', 공포일자: '20240930', 시행일자: '20240930', 공포번호: '1880', 제개정구분명: '일부개정', 자치법규종류: '조례', 자치법규상세링크: '/DRF/lawService.do?OC=private-test-value&MST=1972513&type=HTML', ...overrides });
const page = (rows: unknown[] | unknown = row(), total = 1, number = 1) => ({ OrdinSearch: { law: rows, totalCnt: String(total), page: String(number), resultCode: '00' } });
const reply = (data: unknown) => new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } });
const event = (overrides: Partial<OrdinanceEvent> = {}) => ({ ...parseHistoryPage(page(), 2024, 'history', 1, '2026-10-25').items[0], ...overrides });
const query = { query: '주민참여예산', endYear: 2026, org: '6130000', sborg: '5810000' };
function batch(overrides: Partial<HistoryResult> = {}): HistoryResult {
  const coverage: Record<string, HistoryCoverage> = {};
  for (const year of historyYears(2026)) for (const scope of ['current', 'history'] as const) coverage[`${year}:${scope}`] = { key: `${year}:${scope}`, year, scope, page: 1, nextPage: null, complete: true, skipped: false, count: 0, total: 0, excluded: 0 };
  return { query, queryKey: historyQueryKey(query), years: historyYears(2026), from: '2022-01-01', to: '2026-10-25', asOf: '2026-10-25', items: [], coverage, complete: true, more: false, fetchedAt: new Date(now).toISOString(), warnings: [], ...overrides };
}
function version(overrides: Partial<HistoryVersion> = {}): HistoryVersion {
  return { documentId: '2035792', mst: '1972513', title: '검증 조례', org: '검증시', promulgatedAt: '2024-09-30', promulgationNumber: '1880', effectiveAt: '2024-09-30', amendment: '일부개정', url: ordinanceVersionUrl('1972513'), articles: [{ label: '제1조', title: '목적', text: '주민의 참여를 보장한다.' }], addenda: [], reasons: [], fetchedAt: new Date(now).toISOString(), via: 'live', note: '', ...overrides };
}
function reference(): SimilarRuleReference {
  return { hit: { id: '2035792', kind: 'ordin', title: '검증 조례', effectiveAt: '2026-01-01' }, doc: { id: '2035792', kind: 'ordin', title: '검증 조례', effectiveAt: '2026-01-01', url: 'https://www.law.go.kr/자치법규/검증조례', articles: [{ label: '제1조', title: '목적', text: '확인한다.' }] }, meta: { via: 'live', fetchedAt: new Date(now).toISOString(), partial: true } };
}
beforeEach(() => { vi.stubEnv('LAW_OC', 'test-key-not-a-secret'); vi.stubEnv('LAW_RELAY_URL', ''); vi.stubEnv('LAW_RELAY_SECRET', ''); });
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('5개년 공포 기록의 의미와 중복', () => {
  it('서울시간 연도 경계와 5개년 범위를 맞춘다', () => {
    expect(seoulToday(Date.UTC(2025, 11, 31, 16))).toBe('2026-01-01');
    expect(historyYears(2026)).toEqual([2022, 2023, 2024, 2025, 2026]);
  });
  it.each([['제정', 'enacted'], ['전부개정', 'amended'], ['타법개정', 'amended'], ['일괄폐지', 'repealed'], ['폐지제정', 'replaced'], ['', 'other']])('공식 구분 %s을 %s로 집계한다', (input, output) => { expect(changeGroup(input)).toBe(output); });
  it('단건·배열 공식 목록을 읽고 공포일과 시행일을 분리한다', () => {
    const data = row({ 시행일자: '20250701' });
    for (const value of [data, [data]]) {
      const result = parseHistoryPage(page(value), 2024, 'history', 1, '2026-10-25');
      expect(result.items[0]).toMatchObject({ promulgatedAt: '2024-09-30', effectiveAt: '2025-07-01', year: 2024, documentId: '2035792' });
      expect(JSON.stringify(result)).not.toContain('private-test-value');
      expect(result.items[0].url).toBe('https://www.law.go.kr/ordinInfoP.do?ordinSeq=1972513');
    }
  });
  it('공포일 누락·다른 연도·날짜 오류·규칙을 집계하지 않는다', () => {
    const rows = [row({ 공포일자: '' }), row({ 공포일자: '20250101' }), row({ 공포일자: '20240230' }), row({ 자치법규종류: '규칙' })];
    const result = parseHistoryPage(page(rows, 4), 2024, 'history', 1, '2026-10-25');
    expect(result).toMatchObject({ items: [], excluded: 4, complete: false });
  });
  it('현행·연혁 중복은 한 공포로 세고 서로 다른 날짜의 개정은 유지한다', () => {
    const same = event();
    const items = mergeOrdinanceEvents([same, { ...same, scopes: ['current'] }, event({ eventId: 'later', mst: '2029315', promulgatedAt: '2025-04-15', year: 2025, versions: [{ mst: '2029315', url: ordinanceVersionUrl('2029315') }] })]);
    expect(items).toHaveLength(2);
    expect(items[1].scopes.sort()).toEqual(['current', 'history']);
    expect(historyCounts(items, [2024, 2025]).map(count => count.amended)).toEqual([1, 1]);
  });
  it('같은 공포의 여러 MST는 원문 링크를 모두 보존한다', () => {
    const first = event({ promulgationNumber: '', eventId: 'uncertain', identityUncertain: true });
    const second = { ...first, mst: '1999999', versions: [{ mst: '1999999', url: ordinanceVersionUrl('1999999') }] };
    const items = mergeOrdinanceEvents([first, second]);
    expect(items).toHaveLength(1); expect(items[0].versions).toHaveLength(2); expect(items[0].identityUncertain).toBe(true);
  });
  it('0건과 구조 오류를 구별하며 다른 페이지 응답을 거절한다', () => {
    expect(parseHistoryPage({ OrdinSearch: { totalCnt: '0', page: '1' } }, 2024, 'current', 1, '2026-10-25').complete).toBe(true);
    expect(() => parseHistoryPage({}, 2024, 'current', 1, '2026-10-25')).toThrow();
    expect(() => parseHistoryPage(page(row(), 1, 1), 2024, 'current', 2, '2026-10-25')).toThrow('페이지');
  });
});

describe('현행과 연혁을 균등하게 조회하고 이어 보기', () => {
  it('5개 연도별 nw1·nw2, 공포범위·지역·조례 필터를 각각 요청한다', async () => {
    const fetch = vi.fn().mockImplementation(async (url: string) => {
      const params = new URL(url).searchParams;
      return reply({ OrdinSearch: { totalCnt: '0', page: params.get('page') } });
    });
    vi.stubGlobal('fetch', fetch);
    const result = await searchOrdinanceHistory(query, undefined, false, now);
    expect(result.complete).toBe(true); expect(fetch).toHaveBeenCalledTimes(10);
    const requests = fetch.mock.calls.map(call => new URL(call[0]).searchParams);
    for (const year of historyYears(2026)) for (const nw of ['1', '2']) expect(requests.some(params => params.get('nw') === nw && params.get('ancYd') === `${year}0101~${year === 2026 ? '20261025' : `${year}1231`}`)).toBe(true);
    for (const params of requests) { expect(params.get('org')).toBe('6130000'); expect(params.get('sborg')).toBe('5810000'); expect(params.get('knd')).toBe('30001'); }
  });
  it('인증 실패를 0건 완료로 숨기지 않고 재시도 위치를 남긴다', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => new Response('Unauthorized', { status: 401 })));
    const result = await searchOrdinanceHistory(query, undefined, false, now);
    expect(result.complete).toBe(false); expect(result.more).toBe(true);
    expect(Object.values(result.coverage).every(scope => scope.error?.includes('LAW_AUTH') && scope.nextPage === 1)).toBe(true);
  });
  it('다음 페이지가 남으면 일부 조회로 표시한다', () => {
    const result = parseHistoryPage(page(Array.from({ length: 30 }, (_, i) => row({ 자치법규일련번호: String(1972513 + i) })), 31), 2024, 'history', 1, '2026-10-25');
    expect(result.nextPage).toBe(2); expect(result.complete).toBe(false);
  });
  it('중간 페이지가 짧으면 다음으로 넘어가지 않고 누락 오류를 낸다', () => {
    expect(() => parseHistoryPage(page(Array.from({ length: 10 }, (_, i) => row({ 자치법규일련번호: String(1972513 + i) })), 31), 2024, 'history', 1, '2026-10-25')).toThrow('같은 페이지');
  });
  it('앞 페이지의 제외 기록을 마지막 페이지 완료가 지우지 않는다', () => {
    const first = batch(); first.coverage['2024:history'] = { ...first.coverage['2024:history'], excluded: 1, complete: false, nextPage: 2 };
    const second = batch(); second.coverage['2024:history'] = { ...second.coverage['2024:history'], page: 2 };
    const result = mergeHistoryResults(mergeHistoryResults(null, first), second);
    expect(result.complete).toBe(false); expect(result.coverage['2024:history'].excluded).toBe(1);
  });
  it('실패 페이지 재시도 성공은 회복하고 최초 페이지를 건너뛰면 완료를 주장하지 않는다', () => {
    const first = batch(); first.coverage['2024:history'] = { ...first.coverage['2024:history'], error: '실패', complete: false, nextPage: 1 };
    expect(mergeHistoryResults(mergeHistoryResults(null, first), batch()).complete).toBe(true);
    const skipped = batch(); skipped.coverage['2024:history'].page = 2;
    expect(mergeHistoryResults(null, skipped).complete).toBe(false);
  });
  it('서로 다른 검색 범위의 결과를 이어 붙이지 않는다', () => { expect(() => mergeHistoryResults(batch(), batch({ queryKey: 'another' }))).toThrow('조회 조건'); });
});

describe('두 공포 버전 조문 비교와 현행 작업 연결', () => {
  it('같은 조례의 유일한 동일 제목만 대응시키고 조 이동·문자 차이를 표시한다', () => {
    const old = version();
    const next = version({ mst: '2132533', articles: [{ label: '제2조', title: '목적', text: old.articles[0].text }, { label: '제3조', title: '새 제목', text: '확인한다.' }] });
    expect(compareOrdinanceVersions(old, next).map(row => row.status)).toEqual(['changed', 'unmatched']);
    expect(() => compareOrdinanceVersions(old, { ...next, documentId: '999' })).toThrow('같은 조례');
  });
  it('중복 조 제목은 번호가 같아도 본문이 다르면 대응시키지 않는다', () => {
    const old = version({ articles: [{ label: '제1조', title: '적용', text: '가' }, { label: '제2조', title: '적용', text: '나' }] });
    const next = version({ articles: [{ label: '제1조', title: '적용', text: '다' }] });
    expect(compareOrdinanceVersions(old, next).every(row => row.status === 'unmatched')).toBe(true);
  });
  it.each(['ㆍ', '･'])('가운뎃점 %s 표기 차이에도 위·해촉의 실제 연임 변경을 대응하고 원문은 보존한다', (dot) => {
    const old = version({ articles: [{ label: '제8조', title: '위·해촉', text: '위원은 한 차례만 연임할 수 있다.' }] });
    const next = version({ articles: [{ label: '제8조', title: `위${dot}해촉`, text: '위원은 두 차례만 연임할 수 있다.' }] });
    const rows = compareOrdinanceVersions(old, next);
    expect(rows).toHaveLength(1); expect(rows[0].status).toBe('changed');
    expect(rows[0].before).toBe(old.articles[0]); expect(rows[0].after).toBe(next.articles[0]);
    expect(rows[0].after?.title).toBe(`위${dot}해촉`); expect(rows[0].before?.text).toContain('한 차례'); expect(rows[0].after?.text).toContain('두 차례');
  });
  it('가운뎃점 외의 다른 제목 기호까지 넓혀 맞추지 않는다', () => {
    const old = version({ articles: [{ label: '제8조', title: '위·해촉', text: '같다.' }] });
    const next = version({ articles: [{ label: '제8조', title: '위/해촉', text: '같다.' }] });
    expect(compareOrdinanceVersions(old, next).map(row => row.status)).toEqual(['unmatched', 'unmatched']);
  });
  it('반복 제목은 같은 번호·정규화 본문이 일치할 때만 안전하게 대응한다', () => {
    const old = version({ articles: [{ label: '제1조', title: '기능', text: '검토·확인한다.\n 결과를 보관한다.' }, { label: '제2조', title: '기능', text: '원문을 보존한다.' }] });
    const next = version({ articles: [{ label: '제1조', title: '기능', text: '검토ㆍ확인한다. 결과를 보관한다.' }, { label: '제2조', title: '기능', text: '다른 의무를 부과한다.' }] });
    const rows = compareOrdinanceVersions(old, next);
    expect(rows.map(row => row.status)).toEqual(['changed', 'unmatched', 'unmatched']);
    expect(rows[0].before?.text).toContain('\n'); expect(rows[0].after?.text).toContain('ㆍ');
  });
  it('반복 제목의 동일 본문도 번호가 옮겨지거나 복수 후보이면 확정하지 않는다', () => {
    const old = version({ articles: [{ label: '제1조', title: '기능', text: '동일하다.' }, { label: '제2조', title: '기능', text: '동일하다.' }] });
    const moved = version({ articles: [{ label: '제3조', title: '기능', text: '동일하다.' }, { label: '제4조', title: '기능', text: '동일하다.' }] });
    expect(compareOrdinanceVersions(old, moved).every(row => row.status === 'unmatched')).toBe(true);
    const duplicate = version({ articles: [old.articles[0], { ...old.articles[0] }] });
    const single = version({ articles: [{ ...old.articles[0] }] });
    expect(compareOrdinanceVersions(duplicate, single).every(row => row.status === 'unmatched')).toBe(true);
    const safe = compareOrdinanceVersions(old, { ...old });
    expect(safe).toHaveLength(2); expect(safe.map(row => row.status)).toEqual(['same', 'same']);
    expect(new Set(safe.map(row => row.after?.label)).size).toBe(2);
  });
  it('과거 MST를 직접 요청하고 ID·MST를 둘 다 검증하며 부칙을 보존한다', async () => {
    const fetch = vi.fn().mockImplementation(async () => reply({ LawService: { 자치법규기본정보: { 자치법규ID: '2035792', 자치법규일련번호: '1972513', 자치법규명: '검증 조례', 공포일자: '20240930', 시행일자: '20240930', 제개정정보: '일부개정' }, 조문: { 조: { 조문번호: '000100', 조제목: '목적', 조문여부: 'Y', 조내용: '제1조(목적) 원문을 보존한다.' } }, 부칙: { 부칙내용: '이 조례는 공포한 날부터 시행한다.' } } }));
    vi.stubGlobal('fetch', fetch);
    const result = await getOrdinanceVersion('2035792', '1972513');
    expect(result.addenda).toEqual(['이 조례는 공포한 날부터 시행한다.']);
    expect(new URL(fetch.mock.calls[0][0]).searchParams.get('MST')).toBe('1972513');
    await expect(getOrdinanceVersion('2035792', '999')).rejects.toMatchObject({ code: 'LAW_ID_MISMATCH' });
  });
  it('현행 원문을 검증한 최대4개 참고를 15분간 읽고 출처 훼손·모드오류·시행예정을 거절한다', () => {
    const ref = reference();
    const data = { mode: 'enact', references: [ref], historyNote: '확인한 공포 기록', createdAt: now };
    expect(validateOrdinanceHandoff(data, 'enact', now)?.references).toHaveLength(1);
    expect(validateOrdinanceHandoff(data, 'amend', now)).toBeNull();
    expect(validateOrdinanceHandoff(data, 'enact', now + 16 * 60000)).toBeNull();
    expect(validateOrdinanceHandoff({ ...data, references: Array(5).fill(ref) }, 'enact', now)).toBeNull();
    expect(validateOrdinanceHandoff({ ...data, references: [{ ...ref, doc: { ...ref.doc, url: 'https://evil.example/' } }] }, 'enact', now)).toBeNull();
    expect(validateOrdinanceHandoff({ ...data, references: [{ ...ref, hit: { ...ref.hit, effectiveAt: '2027-01-01' }, doc: { ...ref.doc, effectiveAt: '2027-01-01' } }] }, 'enact', now)).toBeNull();
    expect(validateOrdinanceHandoff({ mode: 'amend', source: ref, references: [], historyNote: '', createdAt: now }, 'amend', now)).not.toBeNull();
    expect(validateOrdinanceHandoff({ mode: 'amend', source: { ...ref, hit: { ...ref.hit, id: 'mst:1972513' }, doc: { ...ref.doc, id: 'mst:1972513' } }, references: [], historyNote: '', createdAt: now }, 'amend', now)).toBeNull();
  });
  it('폐지 버전에 조문이 없으면 식별자 오류와 구분해서 안내한다', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => reply({ LawService: { 자치법규기본정보: { 자치법규ID: '2035792', 자치법규일련번호: '1972513', 자치법규명: '검증 조례', 공포일자: '20240930', 제개정정보: '폐지' }, 조문: {}, 부칙: { 부칙내용: '이 조례는 공포한 날부터 폐지한다.' } } })));
    await expect(getOrdinanceVersion('2035792', '1972513')).rejects.toMatchObject({ code: 'LAW_HISTORY_NO_ARTICLES' });
  });
});

describe('5개년 API 입력 경계', () => {
  it('잘못된 조례 버전·지역·미래 연도를 외부 호출 전에 거절한다', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    for (const url of ['?mst=abc&id=1', '?org=bad', '?sborg=5810000', '?endYear=2999']) expect((await GET(new Request(`https://example.com/api/law/history${url}`))).status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('부분 커서 집합을 거절한다', async () => {
    const response = await POST(new Request('https://example.com/api/law/history', { method: 'POST', body: JSON.stringify({ ...query, cursors: { '2024:history': 2 } }) }));
    expect(response.status).toBe(400);
  });
});
