// 국가법령정보 공동활용 API. 차단 페이지의 스크립트는 실행하거나 따라가지 않는다.
// 법령은 공포일 기준이 아닌 시행일 기준(eflaw)으로 조회한다.
import { createHmac } from 'node:crypto';
import travel from '@/data/snapshots/travel-expenses.json';
import local from '@/data/snapshots/local-autonomy.json';
import admin from '@/data/snapshots/admin-procedure.json';
import property from '@/data/snapshots/public-property.json';

export type LawKind = 'law' | 'admrul' | 'ordin';
export type LawVia = 'live' | 'relay' | 'snapshot';
export interface LawArticle { label: string; title: string; text: string }
export interface LawDoc { id: string; title: string; kind: LawKind; effectiveAt?: string; url: string; articles: LawArticle[] }
export interface LawHit { id: string; title: string; kind: LawKind; org?: string; effectiveAt?: string }
export interface LawMeta { via: LawVia; fetchedAt: string; snapshotDate?: string; note?: string; partial?: boolean; errorCode?: string }
interface Snapshot { title: string; mst: string; lawId: string; effectiveAt: string; source: string; snapshotDate: string; articles: LawArticle[] }
const SNAPSHOTS: Snapshot[] = [travel, local, admin, property] as Snapshot[];
const TARGET: Record<LawKind, string> = { law: 'eflaw', admrul: 'admrul', ordin: 'ordin' };
export class LawError extends Error {
  constructor(public code: string, message: string) { super(message); }
}
export const isLawKind = (value: string): value is LawKind => ['law', 'admrul', 'ordin'].includes(value);
const obj = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
const rows = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v : [v]).filter((x) => x && typeof x === 'object' && !Array.isArray(x)) as Record<string, unknown>[];
const scalar = (v: unknown): string => typeof v === 'string' || typeof v === 'number' ? String(v) : scalarValue(obj(v));
function scalarValue(v: Record<string, unknown>): string { for (const k of ['#text', 'content', '_']) if (typeof v[k] === 'string' || typeof v[k] === 'number') return String(v[k]); return ''; }
function pick(o: Record<string, unknown>, keys: string[]): string { for (const k of keys) { const v = scalar(o[k]); if (v) return v; } return ''; }
const normalizeTitle = (s: string) => s.replace(/[\s「」]/g, '');
const dateText = (v: string) => /^\d{8}$/.test(v) ? `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6)}` : v;
function future(date: string) { const d = dateText(date); return /^\d{4}-\d{2}-\d{2}$/.test(d) && d > new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10); }
function safeError(e: unknown): LawError { return e instanceof LawError ? e : new LawError('LAW_DOWN', '법제처 응답을 받지 못했습니다. 잠시 후 다시 확인해 주세요.'); }

function parseResponse(body: string, contentType: string): unknown {
  if (/사용자\s*정보\s*검증에\s*실패|IP주소\s*및\s*도메인주소|인증키.*(?:오류|유효하지|실패)/.test(body)) throw new LawError('LAW_AUTH', '법제처 인증값 또는 등록된 접속 정보를 확인해 주세요.');
  if (/location\.(?:href|assign|replace)|자동\s*접속.*차단|접근.*차단|access denied|captcha/i.test(body)) throw new LawError('LAW_ANTIBOT', '법제처에서 자동 접속을 차단했습니다. 공식 서비스의 접속 허용 상태를 확인해 주세요.');
  if (!body.trim()) throw new LawError('LAW_EMPTY', '법제처에서 빈 응답을 받았습니다.');
  if (/text\/html/i.test(contentType) || /^\s*(?:<!doctype\s+html|<html)/i.test(body)) throw new LawError('LAW_FORMAT', '법령 데이터 대신 안내 페이지를 받았습니다.');
  let data: unknown;
  try { data = JSON.parse(body.replace(/^\uFEFF/, '')); } catch { throw new LawError('LAW_FORMAT', '법제처 응답이 올바른 JSON 형식이 아닙니다.'); }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new LawError('LAW_FORMAT', '법제처 응답 구조를 확인할 수 없습니다.');
  return data;
}
async function fetchDirect(ep: 'lawSearch' | 'lawService', params: Record<string, string>): Promise<unknown> {
  const oc = process.env.LAW_OC?.trim();
  if (!oc) throw new LawError('LAW_NO_KEY', '법제처 실시간 연결 키가 아직 없어 저장본을 사용해요. 시스템 담당자에게 서버 환경변수 LAW_OC 설정을 요청해 주세요.');
  const qs = new URLSearchParams({ OC: oc, type: 'JSON', ...params });
  const headers: Record<string, string> = { Accept: 'application/json', 'User-Agent': 'jomokjomok-law-client/1.0' };
  if (process.env.LAW_REFERER?.trim()) headers.Referer = process.env.LAW_REFERER.trim();
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(`https://www.law.go.kr/DRF/${ep}.do?${qs}`, { headers, signal: AbortSignal.timeout(8000), redirect: 'error', cache: 'no-store' });
      const body = await res.text();
      if (res.status === 401 || res.status === 403) throw new LawError('LAW_AUTH', `법제처 인증·접속 허용을 확인해 주세요. (HTTP ${res.status})`);
      if (!res.ok) throw new LawError('LAW_DOWN', `법제처 연결 오류 (HTTP ${res.status})`);
      return parseResponse(body, res.headers.get('content-type') ?? '');
    } catch (e) {
      const err = safeError(e);
      if (attempt || err.code !== 'LAW_DOWN') throw err;
    }
  }
  throw new LawError('LAW_DOWN', '법제처 연결 오류');
}
async function fetchRelay(ep: 'lawSearch' | 'lawService', params: Record<string, string>): Promise<unknown> {
  const base = process.env.LAW_RELAY_URL?.trim();
  const secret = process.env.LAW_RELAY_SECRET?.trim();
  if (!base || !secret) throw new LawError('LAW_RELAY_CONFIG', '법제처 중계 설정이 없습니다.');
  const q = new URLSearchParams({ ep, type: 'JSON', ...params });
  const sorted = [...q.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('&');
  const ts = Math.floor(Date.now() / 1000).toString();
  const sig = createHmac('sha256', secret).update(`${ts}\n${sorted}`).digest('hex');
  const res = await fetch(`${base.replace(/\/$/, '')}/law-relay?${q}`, { headers: { 'X-Relay-Ts': ts, 'X-Relay-Sig': sig }, signal: AbortSignal.timeout(8000), redirect: 'error', cache: 'no-store' });
  const body = await res.text();
  if (!res.ok) throw new LawError('LAW_DOWN', `법제처 중계 연결 오류 (HTTP ${res.status})`);
  return parseResponse(body, res.headers.get('content-type') ?? '');
}
async function call(ep: 'lawSearch' | 'lawService', params: Record<string, string>, offline = false): Promise<{ data: unknown; via: LawVia }> {
  if (offline) throw new LawError('LAW_OFFLINE', '설정에서 법제처 연결 끊기 시험을 선택했습니다.');
  try { return { data: await fetchDirect(ep, params), via: 'live' }; } catch (e) {
    const err = safeError(e);
    // 명시적인 인증 실패/차단을 다른 경로로 우회하지 않는다. 설정 오류의 원인도 보존한다.
    if (['LAW_AUTH', 'LAW_ANTIBOT', 'LAW_FORMAT'].includes(err.code) || !process.env.LAW_RELAY_URL?.trim() || !process.env.LAW_RELAY_SECRET?.trim()) throw err;
    try { return { data: await fetchRelay(ep, params), via: 'relay' }; } catch { throw err; }
  }
}
// Historical research reuses the authenticated transport and article parser,
// while keeping its versioned records separate from current-law evidence.
export { call as lawApiCall, parseArticles as parseLawArticles, cleanText as cleanLawText };
function unwrap(data: unknown, keys: string[]): Record<string, unknown> {
  const root = obj(data);
  for (const key of keys) if (root[key] && typeof root[key] === 'object') return obj(root[key]);
  return root;
}
function searchItems(data: unknown, kind: LawKind): LawHit[] {
  const root = unwrap(data, ['LawSearch', 'lawSearch', 'AdmRulSearch', 'AdmrulSearch', 'admrulSearch', 'OrdinSearch', 'ordinSearch']);
  // 공식 자치법규 JSON은 OrdinSearch.law, 행정규칙은 AdmRulSearch.admrul이다.
  const records = root[kind] ?? (kind === 'ordin' ? root.law : undefined) ?? root[kind === 'law' ? '법령' : kind === 'admrul' ? '행정규칙' : '자치법규'];
  const list = rows(records);
  if (!list.length && scalar(root.totalCnt) !== '0') throw new LawError('LAW_FORMAT', '법제처 검색 응답에 검색 결과 구조가 없습니다.');
  const items = list.map((o) => {
    const lid = pick(o, kind === 'law' ? ['법령ID'] : kind === 'ordin' ? ['자치법규ID'] : ['행정규칙일련번호']);
    const mst = pick(o, kind === 'law' ? ['법령일련번호'] : kind === 'ordin' ? ['자치법규일련번호'] : ['행정규칙ID']);
    const effectiveAt = dateText(pick(o, ['시행일자']));
    return { id: lid || (mst ? `${kind === 'admrul' ? 'lid' : 'mst'}:${mst}${kind === 'law' ? `:${effectiveAt.replace(/-/g, '')}` : ''}` : ''), title: pick(o, ['법령명한글', '법령명', '행정규칙명', '자치법규명']), kind, org: pick(o, ['소관부처명', '지자체기관명', '소관부처']), effectiveAt };
  }).filter((x) => x.id && x.title);
  if (list.length && !items.length) throw new LawError('LAW_FORMAT', '검색 결과의 법령 식별자와 제목을 확인할 수 없습니다.');
  return items.filter((x) => !future(x.effectiveAt));
}
export async function searchLaw(kind: LawKind, query: string, org?: string, offline = false): Promise<{ items: LawHit[]; meta: LawMeta }> {
  const fetchedAt = new Date().toISOString();
  try {
    const params: Record<string, string> = { target: TARGET[kind], query, display: '20' };
    if (kind === 'law') params.nw = '3';
    if (kind !== 'law') params.nw = '1';
    if (org) params.org = org;
    const { data, via } = await call('lawSearch', params, offline);
    return { items: searchItems(data, kind), meta: { via, fetchedAt } };
  } catch (e) {
    const err = safeError(e);
    const items = SNAPSHOTS.filter((s) => kind === 'law' && !future(s.effectiveAt) && normalizeTitle(s.title).includes(normalizeTitle(query))).map((s) => ({ id: `snap:${s.lawId}`, title: s.title, kind, effectiveAt: s.effectiveAt }));
    return { items, meta: { via: 'snapshot', fetchedAt, partial: true, errorCode: err.code, note: `${err.message} 저장본은 일부 법령·조문만 포함하며 현행 여부는 공식 원문에서 확인해야 합니다.${items.length ? '' : ' 일치하는 저장본도 없습니다.'}` } };
  }
}
export function snapshotByTitle(title: string): Snapshot | undefined { return SNAPSHOTS.find((s) => normalizeTitle(s.title) === normalizeTitle(title)); }
function cleanText(s: string): string {
  // <삭제>, <개정 ...>, <신설 ...>은 법령 원문이다. 실제 HTML 태그만 제거한다.
  return s.replace(/<!--([\s\S]*?)-->/g, '')
    .replace(/<(script|style)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$)/gi, '')
    .replace(/<br\s*\/?\s*>|<\/p>|<\/div>/gi, '\n')
    .replace(/<\/?(?:html|head|body|title|meta|link|base|a|abbr|address|area|article|aside|audio|b|bdi|bdo|blockquote|br|button|canvas|caption|center|cite|code|col|colgroup|data|datalist|dd|del|details|dfn|dialog|div|dl|dt|em|embed|fieldset|figcaption|figure|font|footer|form|h[1-6]|header|hgroup|hr|i|iframe|img|input|ins|kbd|label|legend|li|main|map|mark|menu|nav|noscript|object|ol|optgroup|option|output|p|picture|pre|progress|q|rp|rt|ruby|s|samp|script|search|section|select|slot|small|source|span|strong|style|sub|summary|sup|table|tbody|td|template|textarea|tfoot|th|thead|time|tr|track|u|ul|var|video|wbr)(?:\s[^<>]*?)?\s*\/?>/gi, '')
    .replace(/&nbsp;|&#160;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').trim();
}
function flattenText(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string' || typeof v === 'number') return cleanText(String(v));
  if (Array.isArray(v)) return v.map(flattenText).filter(Boolean).join('\n');
  const o = obj(v);
  return [pick(o, ['조문내용', '조내용', '항내용', '호내용', '목내용']), ...['항', '호', '목'].map((k) => flattenText(o[k]))].filter(Boolean).map(cleanText).join('\n');
}
function parseArticles(root: Record<string, unknown>, kind: LawKind): LawArticle[] {
  const section = root['조문'] ?? root['조문단위'];
  const nested = obj(section);
  const units = rows(nested['조문단위'] ?? nested['조'] ?? section);
  const result: LawArticle[] = [];
  for (const unit of units) {
    if (['전문', 'N'].includes(pick(unit, ['조문여부']))) continue;
    const raw = flattenText(unit);
    let no = pick(unit, ['조문번호', '조번호']);
    let br = pick(unit, ['조문가지번호', '조가지번호']);
    if (kind === 'ordin') {
      // 자치법규의 조문번호는 000100처럼 인코딩되거나 중복 배열로 온다.
      // 원문의 명시된 조 번호를 먼저 사용하여 제100조로 오독하지 않는다.
      const heading = raw.match(/^제\s*(\d+)\s*조(?:\s*의\s*(\d+))?/);
      if (heading) { no = heading[1]; br = heading[2] ?? ''; }
      else if (/^\d{6}$/.test(no)) { br = no.slice(4); no = no.slice(0, 4); }
    }
    if (/^\d+$/.test(no) && Number(no) > 0) {
      const label = `제${Number(no)}조${br && Number(br) > 0 ? `의${Number(br)}` : ''}`;
      const title = pick(unit, ['조문제목', '조제목']);
      const text = raw.replace(/^제\s*\d+\s*조(?:\s*의\s*\d+)?\s*(?:\([^)]*\))?\s*/, '');
      if (text) result.push({ label, title, text });
    } else if (raw) result.push(...parseFlatArticles(raw));
  }
  if (!result.length) result.push(...parseFlatArticles(flattenText(root['조문내용'] ?? section)));
  if (!result.length) throw new LawError('LAW_EMPTY', '조문 구조를 읽을 수 없는 원문입니다. 공식 원문을 확인하여 직접 붙여넣어 주세요.');
  if (new Set(result.map((a) => a.label)).size !== result.length) throw new LawError('LAW_FORMAT', '중복된 조 번호가 있어 원문을 자동으로 읽지 못했습니다.');
  return result;
}
function parseFlatArticles(text: string): LawArticle[] {
  const chunks = cleanText(text).split(/(?=^\s*제\d+조(?:의\d+)?\s*\()/m);
  return chunks.flatMap((chunk) => { const m = chunk.trim().match(/^(제\d+조(?:의\d+)?)\s*\(([^)]*)\)\s*([\s\S]*)$/); return m && m[3].trim() ? [{ label: m[1], title: m[2], text: m[3].trim() }] : []; });
}
function docUrl(kind: LawKind, title: string): string {
  if (kind === 'law') return `https://www.law.go.kr/법령/${encodeURIComponent(normalizeTitle(title))}`;
  if (kind === 'admrul') return `https://www.law.go.kr/행정규칙/${encodeURIComponent(title)}`;
  return `https://www.law.go.kr/자치법규/${encodeURIComponent(title)}`;
}
export async function getLawText(kind: LawKind, id: string, titleHint?: string, offline = false): Promise<{ doc: LawDoc; meta: LawMeta }> {
  const fetchedAt = new Date().toISOString();
  const fromSnap = (s: Snapshot, reason?: string) => {
    if (kind !== 'law' || future(s.effectiveAt)) throw new LawError('LAW_FUTURE', `「${s.title}」 저장본은 ${s.effectiveAt} 시행예정본이어서 현행 근거로 사용하지 않습니다. 공식 원문을 확인해 주세요.`);
    return { doc: { id: `snap:${s.lawId}`, title: s.title, kind, effectiveAt: s.effectiveAt, url: s.source, articles: s.articles }, meta: { via: 'snapshot' as const, fetchedAt, snapshotDate: s.snapshotDate, partial: true, note: `${reason ? `${reason} ` : ''}${s.snapshotDate} 저장본의 일부 조문입니다. 부칙·별표가 빠질 수 있으며 현행 여부는 공식 원문에서 확인해 주세요.` } };
  };
  if (id.startsWith('snap:')) { const s = SNAPSHOTS.find((x) => `snap:${x.lawId}` === id); if (s) return fromSnap(s); throw new LawError('LAW_NOT_FOUND', '해당 저장본을 찾지 못했습니다.'); }
  try {
    let realId = id;
    if ((!id || id === 'none') && titleHint) {
      const r = await searchLaw(kind, titleHint.replace(/[「」]/g, ''), undefined, offline);
      if (r.meta.via === 'snapshot') throw new LawError(r.meta.errorCode ?? 'LAW_DOWN', r.meta.note ?? '법제처 검색에 연결하지 못했습니다.');
      const hit = r.items.find((x) => normalizeTitle(x.title) === normalizeTitle(titleHint));
      if (!hit) throw new LawError('LAW_NOT_FOUND', `「${titleHint}」와 정확히 일치하는 현행 원문을 찾지 못했습니다.`);
      realId = hit.id;
    }
    const params: Record<string, string> = { target: TARGET[kind] };
    if (realId.startsWith('mst:')) { const [, mst, efYd] = realId.split(':'); params.MST = mst; if (kind === 'law') { if (!/^\d{8}$/.test(efYd ?? '')) throw new LawError('LAW_BAD_ID', '법령 일련번호 조회에는 시행일이 함께 필요합니다. 다시 검색해 주세요.'); params.efYd = efYd; } }
    else if (realId.startsWith('lid:') && kind === 'admrul') params.LID = realId.slice(4);
    else if (/^\d+$/.test(realId)) params.ID = realId;
    else throw new LawError('LAW_BAD_ID', '법령 식별자가 올바르지 않습니다. 다시 검색해 주세요.');
    const { data, via } = await call('lawService', params, offline);
    const root = unwrap(data, ['법령', '행정규칙', '자치법규', 'LawService', 'AdmRulService', 'AdmRul', 'Ordin', 'Law']);
    const info = obj(root['기본정보'] ?? root['행정규칙기본정보'] ?? root['자치법규기본정보'] ?? root);
    const title = pick(info, ['법령명_한글', '법령명한글', '행정규칙명', '자치법규명']);
    if (!title || (titleHint && normalizeTitle(title) !== normalizeTitle(titleHint))) throw new LawError('LAW_TITLE_MISMATCH', '요청한 규정과 원문 제목이 일치하는지 확인할 수 없습니다.');
    const requestedId = realId.startsWith('mst:') ? realId.split(':')[1] : realId.startsWith('lid:') ? realId.slice(4) : realId;
    const idField = realId.startsWith('mst:') ? (kind === 'law' ? '법령일련번호' : '자치법규일련번호') : realId.startsWith('lid:') ? '행정규칙ID' : kind === 'law' ? '법령ID' : kind === 'ordin' ? '자치법규ID' : '행정규칙일련번호';
    const receivedId = pick(info, [idField]);
    if (receivedId && receivedId !== requestedId) throw new LawError('LAW_ID_MISMATCH', '요청한 규정 식별자와 응답 원문의 식별자가 다릅니다. 다시 검색해 주세요.');
    if (pick(info, ['현행여부']) === 'N' || pick(info, ['현행연혁구분']) === '연혁' || ['폐지', '일괄폐지', '타법폐지'].includes(pick(info, ['제개정구분명', '제개정정보']))) throw new LawError('LAW_NOT_CURRENT', '이 원문은 연혁 또는 폐지된 규정으로 표시되어 현행 근거로 사용하지 않습니다. 다시 검색해 주세요.');
    const effectiveAt = dateText(pick(info, ['시행일자']));
    if (future(effectiveAt)) throw new LawError('LAW_FUTURE', `「${title}」는 ${effectiveAt} 시행예정본으로, 현행 근거로 사용하지 않습니다.`);
    if (kind === 'admrul' && pick(info, ['조문형식여부']) === 'N') throw new LawError('LAW_UNSTRUCTURED', '이 행정규칙은 제1조 형태의 조문식 원문이 아닙니다. 공식 원문을 내려받아 검토 범위를 직접 입력해 주세요. 조 번호는 자동으로 만들지 않습니다.');
    const articles = parseArticles(root, kind);
    return { doc: { id: realId, title, kind, effectiveAt, url: docUrl(kind, title), articles }, meta: { via, fetchedAt, partial: true, note: '조문 본문을 조회했습니다. 부칙·별표·별지서식은 공식 원문에서 별도로 확인해 주세요.' } };
  } catch (e) {
    const err = safeError(e);
    if (['LAW_TITLE_MISMATCH', 'LAW_ID_MISMATCH', 'LAW_NOT_CURRENT', 'LAW_FUTURE', 'LAW_BAD_ID', 'LAW_UNSTRUCTURED'].includes(err.code)) throw err;
    const s = kind === 'law' && titleHint ? snapshotByTitle(titleHint) : undefined;
    if (s && !future(s.effectiveAt)) return fromSnap(s, err.message);
    throw new LawError(err.code, `${err.message} 사용할 수 있는 저장본도 없습니다.`);
  }
}
export async function diag() {
  const t0 = Date.now();
  let law: { ok: boolean; via?: LawVia; ms: number; note?: string; code?: string };
  try {
    const r = await call('lawSearch', { target: 'eflaw', query: '행정절차법', display: '5', nw: '3' });
    if (!searchItems(r.data, 'law').some((x) => normalizeTitle(x.title) === '행정절차법')) throw new LawError('LAW_EMPTY', '연결 응답은 왔지만 진단용 현행 법령을 확인하지 못했습니다.');
    law = { ok: true, via: r.via, ms: Date.now() - t0 };
  } catch (e) { const err = safeError(e); law = { ok: false, ms: Date.now() - t0, note: err.message, code: err.code }; }
  return { law, hasOC: !!process.env.LAW_OC?.trim(), hasRelay: !!process.env.LAW_RELAY_URL?.trim() && !!process.env.LAW_RELAY_SECRET?.trim(), snapshots: SNAPSHOTS.map((s) => ({ title: s.title, date: s.snapshotDate, effectiveAt: s.effectiveAt, usable: !future(s.effectiveAt), articles: s.articles.length })) };
}
