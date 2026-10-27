'use client';

import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import type { LawArticle, LawHit, LawKind, LawMeta } from '@/server/law';
import { loadSettings } from '@/lib/settings';
import {
  buildSimilarMatrix, MAX_SIMILAR_REFERENCES, officialRuleUrl, parseSimilarReference, parseSimilarSearch,
  similarComparisonText, similarReferenceText, type SimilarRuleReference,
} from '@/lib/similar-rules';
import styles from './SimilarRules.module.css';

export interface SimilarRulesProps {
  initialQuery?: string;
  initialKind?: LawKind;
  initialReferences?: SimilarRuleReference[];
  allowedKinds?: LawKind[];
  onUseReference?: (reference: SimilarRuleReference) => void | Promise<void>;
  onUseReferences?: (references: SimilarRuleReference[]) => void | Promise<void>;
}
const EMPTY_REFERENCES: SimilarRuleReference[] = [];
const ALL_KINDS: LawKind[] = ['ordin', 'admrul', 'law'];
const KIND_LABEL: Record<LawKind, string> = { ordin: '자치법규', admrul: '행정규칙', law: '법령' };
const sourceLabel = (meta: LawMeta) => meta.via === 'live' ? '공식 API 조회' : meta.via === 'relay' ? '공식 API 중계 조회' : '공식 조회 실패 · 저장본 응답';
function fetchedLabel(value: string) {
  return new Date(value).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', hour12: false });
}
function messageOf(error: unknown) {
  return error instanceof Error ? error.message : '규정 조회를 완료하지 못했습니다. 잠시 후 다시 시도해 주세요.';
}
async function requestJson(url: string, controller: AbortController): Promise<unknown> {
  const timer = setTimeout(() => controller.abort(), 26_000);
  try {
    const response = await fetch(url, { signal: controller.signal, cache: 'no-store' });
    let payload: unknown;
    try { payload = await response.json(); } catch { throw new Error('규정 데이터 대신 읽을 수 없는 응답을 받았습니다. 연결 상태를 확인해 주세요.'); }
    if (!response.ok) {
      const error = payload && typeof payload === 'object' && 'error' in payload ? (payload as { error?: { message?: unknown } }).error : undefined;
      throw new Error(typeof error?.message === 'string' ? error.message : `규정 조회에 실패했습니다. (HTTP ${response.status})`);
    }
    return payload;
  } finally { clearTimeout(timer); }
}

function ArticleCell({ article, expanded }: { article?: LawArticle; expanded: boolean }) {
  if (!article) return <p className={styles.unmatched}>대응 조문 미확정</p>;
  return (
    <details className={styles.article} open={expanded}>
      <summary>{article.label}{article.title ? `(${article.title})` : ''}<span>본문 보기</span></summary>
      <p className={styles.articleText}>{article.text}</p>
    </details>
  );
}

/** A reference search; existence in another institution does not establish
 * authority to adopt the same provision. Selected sources remain explicit. */
export default function SimilarRules({ initialQuery = '', initialKind = 'ordin', initialReferences = EMPTY_REFERENCES, allowedKinds = ALL_KINDS, onUseReference, onUseReferences }: SimilarRulesProps) {
  const inputId = useId();
  const [query, setQuery] = useState(initialQuery);
  const [kind, setKind] = useState<LawKind>(initialKind);
  const [org, setOrg] = useState('');
  const [items, setItems] = useState<LawHit[]>([]);
  const [meta, setMeta] = useState<LawMeta | null>(null);
  const [selected, setSelected] = useState<SimilarRuleReference[]>(initialReferences.slice(0, MAX_SIMILAR_REFERENCES));
  const [expanded, setExpanded] = useState(false);
  const [using, setUsing] = useState(false);
  const [busy, setBusy] = useState<'search' | 'doc' | null>(null);
  const [loadingId, setLoadingId] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const epoch = useRef(0);
  const pending = useRef<AbortController | null>(null);

  useEffect(() => () => { epoch.current++; pending.current?.abort(); }, []);
  useEffect(() => {
    if (initialReferences.length) setSelected(previous => [...new Map([...previous, ...initialReferences].map(reference => [`${reference.hit.kind}:${reference.hit.id}`, reference])).values()].slice(0, MAX_SIMILAR_REFERENCES));
  }, [initialReferences]);

  function invalidate() {
    epoch.current++;
    pending.current?.abort();
    pending.current = null;
    return epoch.current;
  }
  function clearSearch() {
    invalidate();
    setItems([]); setMeta(null); setBusy(null); setLoadingId(''); setError(''); setNotice('');
  }
  async function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    clearSearch();
    const q = query.trim();
    const orgCode = org.trim();
    if (!q || q.length > 200) { setError('규정명이나 주제어를 1~200자로 입력해 주세요.'); return; }
    if (orgCode && !/^\d{2,10}$/.test(orgCode)) { setError('기관 필터는 알고 있는 공식 기관코드(숫자 2~10자리)로 입력해 주세요. 모르면 비워 두세요.'); return; }
    const requestEpoch = epoch.current;
    const controller = new AbortController();
    pending.current = controller;
    setBusy('search');
    const params = new URLSearchParams({ q, kind });
    if (orgCode) params.set('org', orgCode);
    if (loadSettings().forceLawOffline) params.set('offline', '1');
    try {
      const response = parseSimilarSearch(await requestJson(`/api/law/search?${params}`, controller), kind);
      if (requestEpoch !== epoch.current) return;
      setItems(response.items); setMeta(response.meta);
    } catch (cause) {
      if (requestEpoch !== epoch.current) return;
      setError(controller.signal.aborted ? '검색 응답 시간이 초과되었습니다. 연결 상태를 확인한 뒤 다시 검색해 주세요.' : messageOf(cause));
    } finally {
      if (requestEpoch === epoch.current) { setBusy(null); pending.current = null; }
    }
  }
  async function select(hit: LawHit) {
    if (busy || selected.length >= MAX_SIMILAR_REFERENCES || selected.some(ref => ref.hit.kind === hit.kind && ref.hit.id === hit.id)) return;
    const requestEpoch = invalidate();
    const controller = new AbortController();
    pending.current = controller;
    setBusy('doc'); setLoadingId(hit.id); setError(''); setNotice('');
    const params = new URLSearchParams({ kind: hit.kind, id: hit.id, title: hit.title });
    if (loadSettings().forceLawOffline) params.set('offline', '1');
    try {
      const reference = parseSimilarReference(await requestJson(`/api/law/text?${params}`, controller), hit);
      if (requestEpoch !== epoch.current) return;
      setSelected(previous => previous.length < MAX_SIMILAR_REFERENCES ? [...previous, reference] : previous);
    } catch (cause) {
      if (requestEpoch !== epoch.current) return;
      setError(controller.signal.aborted ? '원문 응답 시간이 초과되었습니다. 공식 원문 연결을 확인해 주세요.' : messageOf(cause));
    } finally {
      if (requestEpoch === epoch.current) { setBusy(null); setLoadingId(''); pending.current = null; }
    }
  }
  function remove(reference: SimilarRuleReference) {
    invalidate();
    setBusy(null); setLoadingId(''); setError(''); setNotice('');
    setSelected(previous => previous.filter(item => item.hit.kind !== reference.hit.kind || item.hit.id !== reference.hit.id));
  }
  async function copy(text: string, label: string) {
    const requestEpoch = epoch.current;
    setNotice(''); setError('');
    try {
      if (!navigator.clipboard?.writeText) throw new Error('이 브라우저에서 클립보드 복사를 사용할 수 없습니다. 화면의 본문을 선택하여 복사해 주세요.');
      await navigator.clipboard.writeText(text);
      if (requestEpoch === epoch.current) setNotice(`${label}를 출처·조회 범위와 함께 복사했습니다.`);
    } catch (cause) { if (requestEpoch === epoch.current) setError(messageOf(cause)); }
  }
  async function useReference(reference: SimilarRuleReference) {
    if (!onUseReference) return;
    setUsing(true); setError('');
    try { await onUseReference(reference); setNotice('선택한 원문을 참고자료로 전달했습니다. 적용 권한과 위임 근거를 함께 검토해 주세요.'); }
    catch (cause) { setError(messageOf(cause)); }
    finally { setUsing(false); }
  }
  async function useAll() {
    if (!onUseReferences) return;
    setUsing(true); setError('');
    try { await onUseReferences(selected); setNotice(`선택한 규정 ${selected.length}개를 이 작업의 참고자료로 연결했습니다.`); }
    catch (cause) { setError(messageOf(cause)); }
    finally { setUsing(false); }
  }
  const comparison = buildSimilarMatrix(selected);

  return (
    <section className={styles.root} aria-labelledby={`${inputId}-heading`}>
      <div className={styles.heading}>
        <div><h2 id={`${inputId}-heading`}>유사 규정 찾아 비교하기</h2><p>같은 업무를 다루는 실제 조문을 최대 4개까지 나란히 확인해요. 먼저 3개를 골라 비교하고, 필요할 때 하나 더 추가하세요.</p></div>
        <span className={styles.sourceBadge}>국가법령정보센터</span>
      </div>
      <form className={styles.form} onSubmit={search}>
        <div className={styles.queryField}>
          <label htmlFor={`${inputId}-query`}>주제 또는 규정명</label>
          <input id={`${inputId}-query`} className="field" type="search" value={query} maxLength={200} placeholder="예: 위원회 운영, 공공시설 사용료" onChange={event => { clearSearch(); setQuery(event.target.value); }} />
        </div>
        <div className={styles.kindField}>
          <label htmlFor={`${inputId}-kind`}>검색 대상</label>
          <select id={`${inputId}-kind`} className="field" value={kind} disabled={allowedKinds.length === 1} onChange={event => { clearSearch(); setKind(event.target.value as LawKind); }}>
            {allowedKinds.map(value => <option value={value} key={value}>{KIND_LABEL[value]}</option>)}
          </select>
        </div>
        <div className={styles.orgField}>
          <label htmlFor={`${inputId}-org`}>공식 기관코드 <span>(선택)</span></label>
          <input id={`${inputId}-org`} className="field" value={org} inputMode="numeric" maxLength={10} placeholder="알고 있는 코드만 입력" aria-describedby={`${inputId}-org-help`} onChange={event => { clearSearch(); setOrg(event.target.value); }} />
        </div>
        <button className="btn primary" type="submit" disabled={busy === 'search' || !query.trim()}>{busy === 'search' ? '검색 중…' : '유사 규정 검색'}</button>
        <p id={`${inputId}-org-help`} className={styles.formHelp}>기관코드를 모르면 비워 두고 결과에 표시된 기관을 확인하세요. 기관명으로 코드를 추정하지 않습니다.</p>
      </form>

      <p className={styles.caution}>유사 규정의 존재만으로 우리 기관의 제정 권한이 확인되지는 않습니다. 기관·적용대상·상위법 위임 근거를 따로 검토해 주세요.</p>
      {error && <p className={styles.error} role="alert">{error}</p>}
      {notice && <p className={styles.notice} role="status">{notice}</p>}
      {busy && <p className={styles.status} role="status">{busy === 'search' ? '공식 검색 결과를 조회하고 있습니다…' : '선택한 규정의 식별자·제목·시행일과 실제 본문을 확인하고 있습니다…'}</p>}
      {meta && <div className={styles.searchMeta}><span>{sourceLabel(meta)}</span><span>조회 {fetchedLabel(meta.fetchedAt)} (한국 시간)</span>{meta.note && <p>{meta.note}</p>}</div>}
      {meta?.via === 'snapshot' && <p className={styles.caution}>현재 공식 규정 검색을 완료하지 못했습니다. 저장본을 유사 규정으로 표시하지 않습니다. <a href="/settings">연결 설정</a>에서 법제처 상태를 확인해 주세요.</p>}
      {meta && meta.via !== 'snapshot' && !items.length && <p className={styles.empty}>조회한 범위에서 사용할 수 있는 현재 규정을 찾지 못했습니다. 주제어를 줄이거나 기관 필터를 비워 다시 검색해 주세요.</p>}
      {!!items.length && (
        <div className={styles.results}>
          <div className={styles.resultHeading}><h3>공식 검색 결과 <span>{items.length}건</span></h3><span>선택 {selected.length}/4 · 검색어를 바꿔도 선택은 유지돼요</span></div>
          <ul className={styles.resultList}>
            {items.map(hit => {
              const chosen = selected.some(reference => reference.hit.kind === hit.kind && reference.hit.id === hit.id);
              return <li key={`${hit.kind}:${hit.id}`} className={styles.resultItem}>
                <div><strong>{hit.title}</strong><p>{KIND_LABEL[hit.kind]} · {hit.org || '기관 미확인'} · 시행일 {hit.effectiveAt || '미확인'}</p></div>
                <button type="button" className="btn small" disabled={!!busy || chosen || selected.length >= MAX_SIMILAR_REFERENCES} onClick={() => { void select(hit); }}>{chosen ? '선택됨' : loadingId === hit.id ? '원문 확인 중…' : '원문 비교에 추가'}</button>
              </li>;
            })}
          </ul>
        </div>
      )}
      {!!selected.length && (
        <div className={styles.comparison}>
          <div className={styles.resultHeading}><h3>선택한 원문 비교 <span>{selected.length}/4</span></h3><div className={styles.actions}><button type="button" className="btn small" onClick={() => { void copy(similarComparisonText(selected), '비교 내용'); }}>비교 내용 복사</button>{onUseReferences && <button type="button" className="btn small primary" disabled={using} onClick={() => { void useAll(); }}>선택한 {selected.length}개 모두 참고</button>}</div></div>
          <div className={styles.referenceCards}>
            {selected.map((reference, index) => <article className={styles.referenceCard} key={`${reference.hit.kind}:${reference.hit.id}`}>
              <div className={styles.cardHeading}><strong>{index + 1}. {reference.doc.title}</strong><button className="btn small" type="button" aria-label={`${reference.doc.title} 비교에서 제외`} onClick={() => remove(reference)}>제외</button></div>
              <dl className={styles.facts}>
                <div><dt>기관</dt><dd>{reference.hit.org || '미확인'}</dd></div>
                <div><dt>시행일</dt><dd>{reference.doc.effectiveAt || '미확인'}</dd></div>
                <div><dt>조회</dt><dd>{fetchedLabel(reference.meta.fetchedAt)} (한국 시간)</dd></div>
                <div><dt>범위</dt><dd>조회된 본문 {reference.doc.articles.length}개 조문</dd></div>
              </dl>
              <p className={styles.cardNote}>{sourceLabel(reference.meta)}. {reference.meta.note || '조회된 조문을 표시합니다.'}</p>
              <div className={styles.actions}>
                <a className="btn small" href={officialRuleUrl(reference.doc)} target="_blank" rel="noopener noreferrer">공식 원문 열기 ↗</a>
                <button type="button" className="btn small" onClick={() => { void copy(similarReferenceText(reference), '참고 원문'); }}>원문·출처 복사</button>
                {onUseReference && <button type="button" className="btn small" disabled={using} onClick={() => { void useReference(reference); }}>참고자료로 사용</button>}
              </div>
            </article>)}
          </div>
          <p className={styles.caution}>조문 본문을 비교합니다. 부칙·별표·별지서식·공포 후 미시행 개정은 공식 원문에서 별도로 확인해야 합니다.</p>
          <p className={styles.compareHelp}>각 규정에서 유일하게 나타나는 동일 조 제목만 나란히 배치했습니다. 같은 제목도 실질적 내용의 일치를 뜻하지 않습니다. 대응이 불명확한 조문은 따로 표시합니다.</p>
          {selected.length === 1 && <p className={styles.compareHelp}>검색 결과에서 원문 1개를 더 선택하면 두 규정을 나란히 비교할 수 있습니다.</p>}
          <div className={styles.actions}><button className="btn small" type="button" onClick={() => setExpanded(value => !value)}>{expanded ? '조문 본문 모두 접기' : '조문 본문 모두 펼치기'}</button>{selected.length >= 3 && <span className={styles.compareHelp}>가로로 이동하면 선택한 모든 규정을 볼 수 있어요.</span>}</div>
          <div className={styles.tableWrap} tabIndex={0} role="region" aria-label="선택한 유사 규정의 조문 비교표">
            <table className={styles.table} style={{ minWidth: `${Math.max(560, 150 + selected.length * 260)}px` }}>
              <thead><tr><th scope="col">조 제목</th>{selected.map(reference => <th key={`${reference.hit.kind}:${reference.hit.id}`} scope="col">{reference.doc.title}</th>)}</tr></thead>
              <tbody>{comparison.map(row => <tr key={row.key}>
                <th scope="row"><span>{row.heading}</span><small>{row.matched ? '동일 제목' : '대응 미확정'}</small></th>
                {selected.map((reference, index) => <td key={`${reference.hit.kind}:${reference.hit.id}`}><ArticleCell article={row.articles[index]} expanded={expanded} /></td>)}
              </tr>)}</tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}
