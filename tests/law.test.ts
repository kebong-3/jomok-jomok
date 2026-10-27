import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { diag, getLawText, searchLaw } from '@/server/law';
import { evidenceText, gatherEvidence } from '@/lib/evidence';

const reply = (data: unknown) => new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } });
const list = (item: Record<string, unknown>) => ({ LawSearch: { totalCnt: '1', law: item } });
const articleDoc = (title = '검증법') => ({ 법령: { 기본정보: { 법령명_한글: title, 시행일자: '20260101' }, 조문: { 조문단위: { 조문번호: '1', 조문제목: '목적', 조문내용: '제1조(목적)', 항: [{ 항내용: '① 원본을 보존한다.', 호: [{ 호내용: '1. 확인한다.' }] }, { 항내용: '② 결과를 검토한다.' }] } } } });
beforeEach(() => { vi.stubEnv('LAW_OC', 'mock-key'); vi.stubEnv('LAW_RELAY_URL', ''); vi.stubEnv('LAW_RELAY_SECRET', ''); });
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('법령 조회의 출처와 원문 정확성', () => {
  it('키 없음의 원인을 중계 설정 오류로 덮지 않는다', async () => {
    vi.stubEnv('LAW_OC', '');
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    expect((await diag()).law).toMatchObject({ ok: false, code: 'LAW_NO_KEY' });
    expect(fetch).not.toHaveBeenCalled();
  });
  it('HTTP 200 오류 JSON을 연결 성공으로 표시하지 않는다', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply({ error: 'invalid key' })));
    expect((await diag()).law).toMatchObject({ ok: false, code: 'LAW_FORMAT' });
  });
  it('명시적 자동접속 차단을 따라가거나 중계로 우회하지 않는다', async () => {
    vi.stubEnv('LAW_RELAY_URL', 'https://relay.example'); vi.stubEnv('LAW_RELAY_SECRET', 'mock-relay');
    const fetch = vi.fn().mockResolvedValue(new Response('<script>location.href="/bot-token"</script>', { headers: { 'content-type': 'text/html' } }));
    vi.stubGlobal('fetch', fetch);
    expect((await diag()).law).toMatchObject({ ok: false, code: 'LAW_ANTIBOT' });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][1].redirect).toBe('error');
  });
  it('법령 검색은 시행일 기준 현행만 요청하고 단건 객체도 보존한다', async () => {
    const fetch = vi.fn().mockResolvedValue(reply(list({ 법령ID: '001362', 법령일련번호: '239291', 법령명한글: '행정절차법', 시행일자: '20220712' })));
    vi.stubGlobal('fetch', fetch);
    const r = await searchLaw('law', '행정절차법');
    expect(r.items[0]).toMatchObject({ id: '001362', effectiveAt: '2022-07-12' });
    const u = new URL(fetch.mock.calls[0][0]);
    expect(u.searchParams.get('target')).toBe('eflaw'); expect(u.searchParams.get('nw')).toBe('3');
  });
  it('검색상 빈 결과와 손상된 응답을 구분한다', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply({ LawSearch: { totalCnt: '0' } })));
    expect(await searchLaw('law', '없는법')).toMatchObject({ items: [], meta: { via: 'live' } });
  });
  it.each([false, true])('공식 OrdinSearch.law 응답의 자치법규 단건·배열을 읽는다 (배열=%s)', async (array) => {
    // 공식 ordinListGuide의 JSON 샘플 구조: OrdinSearch.law (root.ordin이 아님).
    const item = { 자치법규ID: '2200001', 자치법규일련번호: '1900001', 자치법규명: '검증시 위원회 운영 조례', 지자체기관명: '검증시', 시행일자: '20260101' };
    const fetch = vi.fn().mockResolvedValue(reply({ OrdinSearch: { totalCnt: '1', law: array ? [item] : item } }));
    vi.stubGlobal('fetch', fetch);
    const r = await searchLaw('ordin', '위원회 운영');
    expect(r).toMatchObject({ items: [{ id: '2200001', title: '검증시 위원회 운영 조례', kind: 'ordin', org: '검증시', effectiveAt: '2026-01-01' }], meta: { via: 'live' } });
    const u = new URL(fetch.mock.calls[0][0]); expect(u.searchParams.get('target')).toBe('ordin'); expect(u.searchParams.get('nw')).toBe('1');
  });
  it('공식 AdmRulSearch 대소문자를 읽고 현행 행정규칙만 요청한다', async () => {
    const fetch = vi.fn().mockResolvedValue(reply({ AdmRulSearch: { totalCnt: '1', admrul: { 행정규칙일련번호: '2100000259890', 행정규칙ID: '42475', 행정규칙명: '검증기관 위원회 운영규정', 시행일자: '20250501' } } }));
    vi.stubGlobal('fetch', fetch);
    const r = await searchLaw('admrul', '위원회 운영');
    expect(r).toMatchObject({ items: [{ id: '2100000259890', kind: 'admrul' }], meta: { via: 'live' } });
    expect(new URL(fetch.mock.calls[0][0]).searchParams.get('nw')).toBe('1');
  });
  it('공식 LawService의 조문.조·조내용과 인코딩된 조 번호를 정확히 읽는다', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply({ LawService: {
      자치법규기본정보: { 자치법규ID: '2200001', 자치법규일련번호: '1900001', 자치법규명: '검증조례', 시행일자: '20260101' },
      조문: { 조: [
        { 조문번호: '000000', 조문여부: 'N', 조내용: '제1장 총칙' },
        { 조문번호: ['000100', '000100'], 조제목: '목적', 조문여부: 'Y', 조내용: '제1조(목적) 원문을 보존한다.' },
        { 조문번호: ['000102', '000102'], 조제목: '적용', 조문여부: 'Y', 조내용: '제1조의2(적용) 범위를 확인한다.' },
        { 조문번호: '000200', 조제목: '절차', 조문여부: 'Y', 조내용: '절차를 따른다.' },
      ] },
    } })));
    const r = await getLawText('ordin', '2200001', '검증조례');
    expect(r.doc.articles).toEqual([{ label: '제1조', title: '목적', text: '원문을 보존한다.' }, { label: '제1조의2', title: '적용', text: '범위를 확인한다.' }, { label: '제2조', title: '절차', text: '절차를 따른다.' }]);
    expect(r.meta).toMatchObject({ via: 'live', partial: true });
  });
  it('공식 AdmRulService의 조문내용 배열을 조문으로 보존한다', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply({ AdmRulService: {
      행정규칙기본정보: { 행정규칙일련번호: '2100000259890', 행정규칙명: '검증훈령', 시행일자: '20250501', 현행여부: 'Y', 조문형식여부: 'Y' },
      조문내용: ['제1조(목적) 원문을 보존한다.', '제2조(검토) ① 자료를 확인한다.\n② 결과를 기록한다.'],
    } })));
    const r = await getLawText('admrul', '2100000259890', '검증훈령');
    expect(r.doc.articles).toEqual([{ label: '제1조', title: '목적', text: '원문을 보존한다.' }, { label: '제2조', title: '검토', text: '① 자료를 확인한다.\n② 결과를 기록한다.' }]);
    expect(r.meta.via).toBe('live');
  });
  it('HTML을 텍스트화하면서 삭제·개정·신설 표시는 원문 그대로 보존한다', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply({ AdmRulService: {
      행정규칙기본정보: { 행정규칙명: '검증훈령', 현행여부: 'Y', 조문형식여부: 'Y' },
      조문내용: ['<p>제1조(구성) <b>위원</b>은 다음과 같다.<br>1. &lt;삭제&gt;<br>2. 위원장 <개정 2025. 5. 1.><br>3. 간사 <신설 2026. 1. 1.></p><!-- 주석 --><script>alert("실행 금지");</script><style>p { display: none }</style>'],
    } })));
    const r = await getLawText('admrul', '2100000259890', '검증훈령');
    expect(r.doc.articles).toEqual([{ label: '제1조', title: '구성', text: '위원은 다음과 같다.\n1. <삭제>\n2. 위원장 <개정 2025. 5. 1.>\n3. 간사 <신설 2026. 1. 1.>' }]);
    expect(r.doc.articles[0].text).not.toMatch(/script|alert|display|주석/);
  });
  it('제목이 같아도 원문 ID가 다르면 현행 근거로 채택하지 않는다', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply({ LawService: { 자치법규기본정보: { 자치법규ID: '2200002', 자치법규명: '검증조례' }, 조문: { 조: { 조문번호: '000100', 조내용: '제1조(목적) 확인한다.' } } } })));
    await expect(getLawText('ordin', '2200001', '검증조례')).rejects.toMatchObject({ code: 'LAW_ID_MISMATCH' });
  });
  it.each([{ 현행여부: 'N' }, { 제개정구분명: '폐지' }])('연혁·폐지 표시가 있는 행정규칙을 현행으로 반환하지 않는다 (%j)', async (status) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply({ AdmRulService: { 행정규칙기본정보: { 행정규칙명: '검증훈령', 시행일자: '20250501', ...status }, 조문내용: ['제1조(목적) 확인한다.'] } })));
    await expect(getLawText('admrul', '2100000259890', '검증훈령')).rejects.toMatchObject({ code: 'LAW_NOT_CURRENT' });
  });
  it('비조문식 행정규칙에 가상의 제1조를 붙이지 않는다', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply({ AdmRulService: { 행정규칙기본정보: { 행정규칙명: '검증지침', 현행여부: 'Y', 조문형식여부: 'N' }, 조문: { 조문번호: '0000', 조문내용: '1. 목적 이 지침은 업무를 정한다.' } } })));
    await expect(getLawText('admrul', '2000000091702', '검증지침')).rejects.toMatchObject({ code: 'LAW_UNSTRUCTURED' });
  });
  it('단일 조문에서도 항과 호의 본문을 빠뜨리지 않는다', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply(articleDoc())));
    const r = await getLawText('law', '999999', '검증법');
    expect(r.doc.articles).toEqual([{ label: '제1조', title: '목적', text: '① 원본을 보존한다.\n1. 확인한다.\n② 결과를 검토한다.' }]);
    expect(r.meta.partial).toBe(true);
  });
  it('다른 제목을 첫 번째 검색 결과라는 이유로 가져오지 않는다', async () => {
    const fetch = vi.fn().mockResolvedValue(reply(list({ 법령ID: '999999', 법령명한글: '검증법 시행령' })));
    vi.stubGlobal('fetch', fetch);
    await expect(getLawText('law', 'none', '검증법')).rejects.toMatchObject({ code: 'LAW_NOT_FOUND' });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('제목만 있고 조문이 없는 응답을 정상 원문으로 반환하지 않는다', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply({ 법령: { 기본정보: { 법령명_한글: '검증법' }, 조문: {} } })));
    await expect(getLawText('law', '999999', '검증법')).rejects.toMatchObject({ code: 'LAW_EMPTY' });
  });
  it('시행예정본을 현행 근거로 섞지 않는다', async () => {
    const data = articleDoc(); data.법령.기본정보.시행일자 = '29990101';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply(data)));
    await expect(getLawText('law', '999999', '검증법')).rejects.toMatchObject({ code: 'LAW_FUTURE' });
  });
  it('기존 2027년 지방자치법 저장본을 현행으로 반환하지 않는다', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.UTC(2026, 9, 20));
    await expect(getLawText('law', 'snap:001656')).rejects.toMatchObject({ code: 'LAW_FUTURE' });
    const r = await searchLaw('law', '지방자치법', undefined, true);
    expect(r.items).toEqual([]);
  });
  it('자치법규 일련번호는 ID가 아니라 MST로 전송한다', async () => {
    const fetch = vi.fn().mockResolvedValue(reply({ 자치법규: { 기본정보: { 자치법규명: '검증조례', 시행일자: '20260101' }, 조문: { 조문단위: { 조문번호: 1, 조문제목: '목적', 조문내용: '제1조(목적) 검증한다.' } } } }));
    vi.stubGlobal('fetch', fetch);
    const r = await getLawText('ordin', 'mst:12345', '검증조례');
    expect(r.doc.title).toBe('검증조례');
    const u = new URL(fetch.mock.calls[0][0]); expect(u.searchParams.get('MST')).toBe('12345'); expect(u.searchParams.has('ID')).toBe(false);
  });
  it('법령명이 정규식 문자를 포함해도 직접 인용을 정확히 찾는다', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply({ doc: { id: '1', title: '검증(시험)법', url: 'https://www.law.go.kr', articles: [{ label: '제1조', title: '목적', text: '원본을 보존한다.' }] }, meta: { via: 'live', fetchedAt: '2026-10-20T00:00:00Z' } })));
    const r = await gatherEvidence('「검증(시험)법」 제1조에 따른다.', '');
    expect(r.evidence).toHaveLength(1);
  });
  it('AI에 전달할 근거에도 저장본 여부와 생략 사실을 보존한다', () => {
    const text = evidenceText([{ id: 'E1', kind: 'law', label: '법 제1조', text: '가'.repeat(3100), via: 'snapshot', date: '2026-10-20' }]);
    expect(text).toContain('저장본·현행 여부 별도 확인'); expect(text).toContain('이하 생략');
  });
});
