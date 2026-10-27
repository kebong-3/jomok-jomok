'use client';

import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import SimilarRules from './SimilarRules';
import { parseSimilarReference, type SimilarRuleReference } from '@/lib/similar-rules';
import { loadSettings } from '@/lib/settings';
import { wordHunks, underlineOld, underlineNew } from '@/engine/diff';
import {
  CHANGE_LABELS, compareOrdinanceVersions, historyCounts, mergeHistoryResults, ordinanceVersionUrl,
  seoulToday, writeOrdinanceHandoff, yearComplete,
  type ChangeGroup, type HistoryQuery, type HistoryResult, type HistoryVersion, type OrdinanceEvent,
} from '@/lib/ordinance-history';
import type { LawArticle, LawDoc, LawMeta } from '@/server/law';
import styles from './OrdinanceHistory.module.css';

const errorText = (error: unknown) => error instanceof Error ? error.message : '조례 조회를 마치지 못했습니다. 다시 시도해 주세요.';
const compactTitle = (value: string) => value.normalize('NFC').replace(/\s/g, '');
async function request<T>(url: string, controller: AbortController, body?: unknown): Promise<T> {
  const timeout = setTimeout(() => controller.abort(), url.includes('history') && !url.includes('mst=') ? 115_000 : 28_000);
  try {
    const response = await fetch(url, { method: body ? 'POST' : 'GET', ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}), signal: controller.signal, cache: 'no-store' });
    const payload = await response.json().catch(() => { throw new Error('서버 응답을 읽을 수 없습니다. 잠시 후 다시 조회해 주세요.'); });
    if (!response.ok) throw new Error(payload?.error?.message || `조례 조회 오류 (HTTP ${response.status})`);
    return payload as T;
  } finally { clearTimeout(timeout); }
}
function VersionText({ article, other, side }: { article?: LawArticle; other?: LawArticle; side: 'before' | 'after' }) {
  if (!article) return <p className={styles.muted}>대응 조문 미확정</p>;
  const old = side === 'before' ? article : other; const next = side === 'after' ? article : other;
  const hunks = old && next ? wordHunks(old.text, next.text) : [];
  const segments = side === 'before' ? underlineOld(article.text, hunks) : underlineNew(article.text, hunks);
  return <><strong>{article.label}{article.title ? `(${article.title})` : ''}</strong><p className={styles.articleText}>{segments.map((segment, index) => segment.underline ? <mark key={index} className={side === 'before' ? styles.oldMark : styles.newMark}>{segment.text}</mark> : <span key={index}>{segment.text}</span>)}</p></>;
}

export default function OrdinanceHistory() {
  const router = useRouter();
  const currentYear = Number(seoulToday().slice(0, 4));
  const [tab, setTab] = useState<'history' | 'search'>('history');
  const [query, setQuery] = useState('');
  const [endYear, setEndYear] = useState(currentYear);
  const [region, setRegion] = useState('seogu');
  const [org, setOrg] = useState(''); const [sborg, setSborg] = useState('');
  const [result, setResult] = useState<HistoryResult | null>(null);
  const [year, setYear] = useState('all'); const [change, setChange] = useState('all');
  const [references, setReferences] = useState<SimilarRuleReference[]>([]);
  const [versions, setVersions] = useState<HistoryVersion[]>([]);
  const [showSame, setShowSame] = useState(false);
  const [busy, setBusy] = useState<string | null>(null); const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  const epoch = useRef(0); const pending = useRef<AbortController | null>(null);
  const versionSection = useRef<HTMLElement | null>(null);
  useEffect(() => () => { epoch.current++; pending.current?.abort(); }, []);
  useEffect(() => { if (!busy) return; const start = Date.now(); const timer = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 1000); return () => clearInterval(timer); }, [busy]);
  function begin(label: string) { epoch.current++; pending.current?.abort(); const controller = new AbortController(); pending.current = controller; setBusy(label); setElapsed(0); setError(''); setNotice(''); return { controller, version: epoch.current }; }
  function stop() { epoch.current++; pending.current?.abort(); pending.current = null; setBusy(null); setNotice('조회를 중단했습니다. 이미 받은 목록과 선택한 참고자료는 남아 있습니다.'); }
  function finished(version: number) { if (version === epoch.current) { setBusy(null); pending.current = null; } }
  const chosenQuery = (): HistoryQuery => ({ query: query.trim(), endYear, ...(region === 'seogu' ? { org: '6130000', sborg: '5810000' } : region === 'custom' ? { org: org.trim() || undefined, sborg: sborg.trim() || undefined } : {}) });
  async function searchHistory(event?: FormEvent, more = false) {
    event?.preventDefault();
    const input = more && result ? result.query : chosenQuery();
    if ((input.org && !/^\d{7}$/.test(input.org)) || (input.sborg && (!input.org || !/^\d{7}$/.test(input.sborg)))) { setError('공식 시도·시군구 코드는 숫자 7자리로 입력해 주세요. 시군구를 입력할 때는 시도 코드도 필요합니다.'); return; }
    const previous = more ? result : null;
    const task = begin(more ? '남은 현행·연혁 목록을 이어 읽고 있어요' : '5개년 현행·연혁 목록을 함께 읽고 있어요');
    if (!more) { setResult(null); setVersions([]); setYear('all'); setChange('all'); }
    try {
      const cursors = previous ? Object.fromEntries(Object.entries(previous.coverage).map(([key, scope]) => [key, scope.nextPage])) : undefined;
      const next = await request<HistoryResult>('/api/law/history', task.controller, { ...input, cursors, offline: loadSettings().forceLawOffline });
      if (task.version !== epoch.current) return;
      const merged = mergeHistoryResults(previous, next); setResult(merged);
      setNotice(`${merged.items.length}개 공포 기록을 확인했습니다. ${merged.complete ? '선택한 범위의 현행·연혁 목록 조회를 마쳤습니다.' : '남은 목록이나 미확인 범위가 있습니다.'}`);
    } catch (cause) { if (task.version === epoch.current) setError(task.controller.signal.aborted ? '공식 목록 응답을 기다리는 시간이 길어졌습니다. 받은 목록은 보존되며 다시 이어서 조회할 수 있습니다.' : errorText(cause)); }
    finally { finished(task.version); }
  }
  function addReference(reference: SimilarRuleReference) {
    addReferences([reference]);
  }
  function addReferences(incoming: SimilarRuleReference[]) {
    const merged = new Map([...references, ...incoming].map(reference => [`${reference.hit.kind}:${reference.hit.id}`, reference]));
    if (merged.size > 4) throw new Error('입안 참고는 최대 4개까지 담을 수 있습니다. 아래에서 하나를 빼고 추가해 주세요.');
    setReferences([...merged.values()]);
    setNotice(`${incoming.length}개 현행 원문을 입안 참고에 담았습니다.`); setError('');
  }
  function historyNote() {
    const lines = result ? [`5개년 조례 조사: ${result.query.query || '전체 조례'}`, `공포기간: ${result.from}~${result.to}`, `조회 지역 코드: ${result.query.org || '전국'}${result.query.sborg ? ` / ${result.query.sborg}` : ''}`, `확인한 공포 ${result.items.length}건 · ${result.complete ? '해당 범위 목록 조회 완료' : '일부 조회·전체 건수 미확정'}`, `조회시각: ${result.fetchedAt}`] : ['현행 조례 검색에서 입안 참고자료를 선택했습니다.'];
    for (const reference of references) lines.push(`현행 참고: 「${reference.doc.title}」 · 시행 ${reference.doc.effectiveAt || '미확인'} · 조회 ${reference.meta.fetchedAt} · ${reference.doc.url}`);
    for (const version of versions) lines.push(`비교한 공포 버전: 「${version.title}」 ${version.promulgatedAt} · MST ${version.mst} · ${ordinanceVersionUrl(version.mst)}`);
    return lines.join('\n');
  }
  function handoff(mode: 'enact' | 'amend', source?: SimilarRuleReference) {
    try { writeOrdinanceHandoff({ mode, references, source, historyNote: historyNote() }); router.push(`/start?mode=${mode}&from=law`); }
    catch (cause) { setError(errorText(cause)); }
  }
  async function currentReference(item: OrdinanceEvent, action: 'reference' | 'amend') {
    if (busy) return;
    if (action === 'reference' && references.length >= 4 && !references.some(ref => ref.hit.kind === 'ordin' && ref.hit.id === item.documentId)) { setError('참고 조례를 최대 4개까지 담을 수 있습니다.'); return; }
    const task = begin('작업에 사용할 현행 조례 원문을 다시 확인하고 있어요');
    const params = new URLSearchParams({ kind: 'ordin', id: item.documentId });
    if (loadSettings().forceLawOffline) params.set('offline', '1');
    try {
      // Historical titles can have changed. Resolve the current ID afresh and
      // retain the returned current title/date, never the historical text.
      const response = await request<{ doc: LawDoc; meta: LawMeta }>(`/api/law/text?${params}`, task.controller);
      if (task.version !== epoch.current) return;
      if (response.doc?.id !== item.documentId || response.doc?.kind !== 'ordin') throw new Error('선택한 조례와 현행 원문의 식별자가 다릅니다.');
      const reference = parseSimilarReference(response, { id: item.documentId, title: response.doc.title, kind: 'ordin', org: item.org, effectiveAt: response.doc.effectiveAt });
      if (action === 'amend') handoff('amend', reference); else addReference(reference);
    } catch (cause) { if (task.version === epoch.current) setError(task.controller.signal.aborted ? '현행 원문 응답이 늦어졌습니다. 다시 조회해 주세요.' : errorText(cause)); }
    finally { finished(task.version); }
  }
  async function selectVersion(item: OrdinanceEvent, mst = item.mst) {
    if (busy || versions.some(version => version.mst === mst)) return;
    if (versions.length >= 2) { setError('두 시점 비교를 위해 선택한 버전 하나를 먼저 빼 주세요.'); return; }
    if (versions.some(version => version.documentId !== item.documentId)) { setError('시점별 비교는 같은 조례의 두 버전을 선택해 주세요. 다른 조례끼리의 비교는 현행 조례 찾기 탭에서 할 수 있습니다.'); return; }
    const task = begin(`${item.promulgatedAt} 공포 버전의 조문을 읽고 있어요`);
    const params = new URLSearchParams({ mst, id: item.documentId });
    if (loadSettings().forceLawOffline) params.set('offline', '1');
    try {
      const version = await request<HistoryVersion>(`/api/law/history?${params}`, task.controller);
      if (task.version !== epoch.current) return;
      if (version.documentId !== item.documentId || version.mst !== mst || version.promulgatedAt !== item.promulgatedAt || compactTitle(version.title) !== compactTitle(item.title)) throw new Error('선택한 공포 기록과 원문의 제목·날짜·버전이 맞지 않습니다. 다시 조회해 주세요.');
      if (!version.articles?.length) throw new Error('이 공포 버전에서 비교할 조문 본문을 확인하지 못했습니다. 폐지된 조례나 비조문식 문서는 해당 버전의 공식 원문·개정문·부칙을 확인해 주세요.');
      setVersions(previous => [...previous, version].sort((a, b) => a.promulgatedAt.localeCompare(b.promulgatedAt) || a.effectiveAt.localeCompare(b.effectiveAt) || a.mst.localeCompare(b.mst, undefined, { numeric: true })));
      setNotice('공포 버전 원문을 담았습니다. 같은 조례의 다른 공포 버전과 나란히 비교할 수 있습니다.');
      requestAnimationFrame(() => versionSection.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    } catch (cause) { if (task.version === epoch.current) setError(task.controller.signal.aborted ? '버전 원문 응답이 늦어졌습니다. 다시 선택해 주세요.' : errorText(cause)); }
    finally { finished(task.version); }
  }
  const counts = result ? historyCounts(result.items, result.years) : [];
  const filtered = result?.items.filter(item => (year === 'all' || item.year === Number(year)) && (change === 'all' || item.changeGroup === change)) ?? [];
  const comparisons = useMemo(() => versions.length === 2 ? compareOrdinanceVersions(versions[0], versions[1]) : [], [versions]);
  const regionLabel = result ? result.query.org === '6130000' && result.query.sborg === '5810000' ? '전남광주통합특별시 서구' : result.query.org ? `지역 코드 ${result.query.org}${result.query.sborg ? ` / ${result.query.sborg}` : ''}` : '전국' : '';

  return <main className={styles.page}>
    <header className={styles.hero}>
      <div><p className={styles.eyebrow}>조례 조사에서 입안까지</p><h1>근거와 바뀐 조례를 함께 살펴요</h1><p>5개년 제·개정 기록에서 흐름을 찾고, 필요한 현행 조례를 담아 새 규정과 개정안으로 이어 가세요.</p></div>
      <ol className={styles.flow} aria-label="조례 조사 활용 순서"><li><b>01</b> 변경 기록 조사</li><li><b>02</b> 조문·사례 비교</li><li><b>03</b> 제정·개정 시작</li></ol>
    </header>
    <div className={styles.tabs} role="group" aria-label="조례 조사 방식">
      <button type="button" aria-pressed={tab === 'search'} onClick={() => setTab('search')} disabled={!!busy}>현행 조례 찾기</button>
      <button type="button" aria-pressed={tab === 'history'} onClick={() => setTab('history')} disabled={!!busy}>5개년 제·개정 비교</button>
    </div>
    {busy && <div className={styles.loading} role="status"><span className={styles.loader} aria-hidden>§</span><div><b>{busy}</b><p>응답을 기다리는 중입니다 · {elapsed}초{elapsed >= 20 ? ' · 기관 응답이 늦어도 받은 기록은 유지합니다.' : ''}</p></div><button className="btn small" type="button" onClick={stop}>조회 중단</button></div>}
    {error && <p className={styles.error} role="alert">{error}</p>}
    {notice && <p className={styles.notice} role="status">{notice}</p>}
    {tab === 'search' ? <section className={styles.card}><SimilarRules initialKind="ordin" allowedKinds={['ordin']} initialReferences={references} onUseReference={addReference} onUseReferences={addReferences} /><p className="help">선택한 참고자료는 아래에 모입니다. 우리 기관의 제정 권한·위임 범위는 별도로 확인하세요.</p></section> : <>
      <section className={styles.card} aria-labelledby="history-form-title">
        <h2 id="history-form-title">언제, 어떤 조례가 바뀌었을까요?</h2>
        <p className={styles.muted}>새로 제정되거나 개정·폐지된 조례를 공포연도별로 비교합니다. 현행 목록과 연혁 목록을 함께 조회합니다.</p>
        <form onSubmit={event => searchHistory(event)} className={styles.form}>
          <label className={styles.query}>조례 이름·주제어<input className="field" value={query} onChange={event => setQuery(event.target.value)} maxLength={120} placeholder="예) 주민참여예산, 반도체, 위원회 · 빈칸은 전체 조례" disabled={!!busy} /></label>
          <label>비교 기간<select className="field" value={endYear} onChange={event => setEndYear(Number(event.target.value))} disabled={!!busy}>{Array.from({ length: 10 }, (_, i) => currentYear - i).map(value => <option value={value} key={value}>{value - 4}~{value}년</option>)}</select></label>
          <label>조회 지역<select className="field" value={region} onChange={event => setRegion(event.target.value)} disabled={!!busy}><option value="seogu">전남광주통합특별시 서구</option><option value="all">전국</option><option value="custom">다른 기관 코드 직접 입력</option></select></label>
          {region === 'custom' && <><label>시도 코드<input className="field" value={org} onChange={event => setOrg(event.target.value)} placeholder="공식 숫자 7자리" inputMode="numeric" maxLength={7} disabled={!!busy} /></label><label>시군구 코드 <small>선택</small><input className="field" value={sborg} onChange={event => setSborg(event.target.value)} placeholder="공식 숫자 7자리" inputMode="numeric" maxLength={7} disabled={!!busy} /></label><p className={styles.formNote}>법제처의 지역 코드로 조회합니다. <a href="https://www.law.go.kr/ordinSc.do?menuId=3&subMenuId=39&tabMenuId=177" target="_blank" rel="noopener noreferrer">공식 자치법규 검색에서 지역 확인 ↗</a></p></>}
          <button className="btn primary" type="submit" disabled={!!busy}>5개년 조회</button>
        </form>
        <div className={styles.examples}><span>주제 예시</span>{['주민참여예산', '위원회', '반도체', '경로당', '청년'].map(value => <button type="button" key={value} onClick={() => setQuery(value)} disabled={!!busy}>{value}</button>)}</div>
      </section>
      {!result && !busy && <div className={styles.intro}><span aria-hidden>⌕</span><div><h2>{endYear - 4}~{endYear}년 기록을 한눈에</h2><p>검색어를 비우면 선택한 지역의 전체 조례를 조회합니다. 한 번에 읽지 못한 목록은 ‘남은 변경 목록 이어 보기’로 계속 확인할 수 있습니다.</p></div></div>}
      {result && <>
        <section className={styles.card} aria-labelledby="history-result-title">
          <div className={styles.resultHeading}><div><p className={styles.eyebrow}>{regionLabel} · 공포일 기준</p><h2 id="history-result-title">{result.complete ? '조회 범위에서 확인한' : '지금까지 확인한'} 공포 {result.items.length}건</h2></div><span className={result.complete ? styles.complete : styles.partial}>{result.complete ? '목록 조회 완료' : '일부 조회'}</span></div>
          <p className={styles.muted}>{result.from}~{result.to} · {result.query.query || '전체 조례'} · {new Date(result.fetchedAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })} 조회</p>
          {!result.complete && <p className={styles.caution}>아래는 현재 확인한 공포 건수입니다. 남은 목록·조회 실패가 있으면 연도별 전체 건수나 증가·감소로 해석하지 마세요. ‘미확인’은 변경이 없다는 뜻이 아닙니다.</p>}
          <div className={styles.years}>{counts.map(count => <button type="button" key={count.year} aria-pressed={year === String(count.year)} className={styles.yearCard} onClick={() => setYear(year === String(count.year) ? 'all' : String(count.year))}><span>{count.year}년{count.year === currentYear ? ' · 조회일까지' : ''}</span><strong>{count.total || yearComplete(result, count.year) ? `${count.total}건` : '미확인'}</strong><small>{Object.entries(CHANGE_LABELS).filter(([key]) => !['replaced', 'other'].includes(key) || count[key as ChangeGroup] > 0).map(([key, label]) => `${label} ${count[key as ChangeGroup] === 0 && !yearComplete(result, count.year) ? '미확인' : count[key as ChangeGroup]}`).join(' · ')}</small><em>{yearComplete(result, count.year) ? '해당 연도 목록 완료' : '추가 확인 필요'}</em></button>)}</div>
          <details className={styles.coverage}><summary>조회 범위와 확인할 점</summary><ul>{result.warnings.map(message => <li key={message}>{message}</li>)}{Object.values(result.coverage).filter(scope => scope.error || scope.excluded).map(scope => <li key={scope.key}>{scope.year}년 {scope.scope === 'current' ? '현행' : '연혁'}: {scope.error || `공포일·식별자·종류가 맞지 않은 ${scope.excluded}개 기록을 제외했습니다.`}</li>)}</ul><div className={styles.tableWrap}><table><caption>연도별 현행·연혁 목록 조회 상태</caption><thead><tr><th>연도</th><th>목록</th><th>마지막 페이지</th><th>응답 전체 건수</th><th>확인 상태</th></tr></thead><tbody>{Object.values(result.coverage).sort((a, b) => a.key.localeCompare(b.key)).map(scope => <tr key={scope.key}><td>{scope.year}</td><td>{scope.scope === 'current' ? '현행' : '연혁'}</td><td>{scope.page}</td><td>{scope.total ?? '미확인'}</td><td>{scope.error ? '조회 실패·재시도 가능' : scope.complete ? '목록 완료' : scope.nextPage ? '다음 목록 있음' : '일부 기록 확인 불가'}</td></tr>)}</tbody></table></div></details>
        </section>
        <section className={styles.card} aria-labelledby="events-title">
          <div className={styles.resultHeading}><h2 id="events-title">공포 기록과 원문</h2><div className={styles.filters}><label>공포연도<select className="field" value={year} onChange={event => setYear(event.target.value)}><option value="all">5개년 전체</option>{result.years.map(value => <option key={value} value={value}>{value}년</option>)}</select></label><label>제·개정 구분<select className="field" value={change} onChange={event => setChange(event.target.value)}><option value="all">모든 변경</option>{Object.entries(CHANGE_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label></div></div>
          <p className={styles.muted}>같은 조례의 공포 버전 2개를 고르면 실제 조문 차이를 볼 수 있습니다. 제정·개정 작업에는 현행판을 새로 확인하여 가져옵니다.</p>
          {filtered.length ? <ul className={styles.events}>{filtered.map(item => <li className={styles.event} key={item.eventId}>
            <div className={styles.eventMeta}><span className={`${styles.change} ${styles[item.changeGroup]}`}>{item.amendment}</span><span>공포 {item.promulgatedAt} · 제{item.promulgationNumber || '미확인'}호</span><span>{item.org}</span></div>
            <h3>{item.title}</h3><p className={styles.muted}>시행 {item.effectiveAt || '미확인'}{item.effectiveAt > result.asOf ? ' · 시행 예정' : ''} · 버전 {item.mst} · {item.scopes.map(scope => scope === 'current' ? '현행 목록' : '연혁 목록').join('·')}에서 확인</p>
            <div className={styles.actions}><a className="btn small" href={ordinanceVersionUrl(item.mst)} target="_blank" rel="noopener noreferrer">해당 버전 원문 ↗</a><button className="btn small" type="button" onClick={() => selectVersion(item)} disabled={!!busy || versions.some(version => version.mst === item.mst)}>{versions.some(version => version.mst === item.mst) ? '시점 비교에 담음' : '시점별 조문 비교에 담기'}</button><button className="btn small" type="button" onClick={() => currentReference(item, 'reference')} disabled={!!busy}>현행판 참고 담기</button><button className="btn small" type="button" onClick={() => currentReference(item, 'amend')} disabled={!!busy}>현행판으로 개정 시작</button></div>
            {item.versions.length > 1 && <details className={styles.coverage}><summary>같은 공포 기록의 문서 버전 {item.versions.length}개{item.identityUncertain ? ' · 동일 공포 여부 확인 필요' : ''}</summary><ul>{item.versions.map(version => <li key={version.mst}><a href={ordinanceVersionUrl(version.mst)} target="_blank" rel="noopener noreferrer">버전 {version.mst} 원문 ↗</a> <button className="btn small" type="button" onClick={() => selectVersion(item, version.mst)} disabled={!!busy || versions.some(selected => selected.mst === version.mst)}>시점 비교에 담기</button></li>)}</ul></details>}
          </li>)}</ul> : <p className={styles.empty}>{result.complete ? '선택한 검색 조건·공포기간·변경 구분에 해당하는 기록을 찾지 못했습니다.' : '현재 읽은 목록에서는 이 조건의 기록을 확인하지 못했습니다. 남은 목록을 이어서 확인하세요.'}</p>}
          {result.more && <button type="button" className={`btn ${styles.more}`} disabled={!!busy} onClick={() => searchHistory(undefined, true)}>남은 변경 목록 이어 보기</button>}
        </section>
        <section className={styles.card} ref={versionSection} aria-labelledby="version-compare-title">
          <div className={styles.resultHeading}><h2 id="version-compare-title">두 시점의 실제 조문 비교</h2><span className={styles.muted}>{versions.length}/2 선택</span></div>
          {!versions.length ? <p className={styles.empty}>위 공포 기록에서 같은 조례의 서로 다른 버전 2개를 담아 주세요. 조 제목을 우선 대응하고, 반복 제목은 같은 조 번호·본문까지 확인된 경우에만 나란히 보여 줍니다.</p> : <>
            <div className={styles.versionCards}>{versions.map((version, i) => <article key={version.mst}><div className={styles.resultHeading}><span className={styles.eyebrow}>{versions.length === 2 ? i === 0 ? '앞 시점' : '뒤 시점' : '선택한 버전'}</span><button type="button" className="btn small" onClick={() => setVersions(previous => previous.filter(item => item.mst !== version.mst))} disabled={!!busy} aria-label={`${version.promulgatedAt} 버전 빼기`}>빼기</button></div><h3>{version.title}</h3><p>공포 {version.promulgatedAt} · 시행 {version.effectiveAt || '미확인'}</p><p>{version.articles.length}개 조문 · {version.amendment || '구분 미확인'}</p><a href={ordinanceVersionUrl(version.mst)} target="_blank" rel="noopener noreferrer">버전 {version.mst} 원문 ↗</a><details className={styles.coverage}><summary>조회된 부칙·개정 이유 보기</summary><h4>부칙</h4>{version.addenda.length ? version.addenda.map((text, index) => <p className={styles.articleText} key={index}>{text}</p>) : <p>조회 응답에서 부칙 내용을 확인하지 못했습니다.</p>}<h4>개정 이유·개정문</h4>{version.reasons.length ? version.reasons.map((text, index) => <p className={styles.articleText} key={index}>{text}</p>) : <p>조회 응답에서 내용을 확인하지 못했습니다.</p>}</details></article>)}</div>
            {versions.length === 2 && <><p className={styles.caution}>문자·조 번호 차이를 표시합니다. 제목 변경·조 이동으로 대응이 불분명한 조문은 ‘대응 미확정’으로 남기며, 실질적인 권리·의무 변경이나 그 당시 적용 법령까지 자동 판단하지 않습니다. 별표·서식은 공식 원문에서 확인하세요.</p><div className={styles.compareSummary}><span>문자·번호 차이 <b>{comparisons.filter(row => row.status === 'changed').length}</b></span><span>동일 <b>{comparisons.filter(row => row.status === 'same').length}</b></span><span>대응 미확정 <b>{comparisons.filter(row => row.status === 'unmatched').length}</b></span><label><input type="checkbox" checked={showSame} onChange={event => setShowSame(event.target.checked)} /> 동일 조문도 보기</label></div><div className={styles.tableWrap} tabIndex={0} aria-label="두 시점 조문 비교표 가로 스크롤"><table className={styles.versionTable}><caption>{versions[0].promulgatedAt} ↔ {versions[1].promulgatedAt} 공포 버전 조문 비교</caption><thead><tr><th>대응 기준</th><th>{versions[0].promulgatedAt} 공포</th><th>{versions[1].promulgatedAt} 공포</th></tr></thead><tbody>{comparisons.filter(row => showSame || row.status !== 'same').map(row => <tr key={row.key}><th>{row.heading}<small>{row.status === 'same' ? '동일' : row.status === 'changed' ? '문자·번호 차이' : '대응 미확정'}</small></th><td><VersionText article={row.before} other={row.after} side="before" /></td><td><VersionText article={row.after} other={row.before} side="after" /></td></tr>)}</tbody></table>{!showSame && comparisons.every(row => row.status === 'same') && <p className={styles.empty}>대응을 확인한 조문에서 문자·조 번호 차이를 찾지 못했습니다. 부칙·별표·서식은 별도로 확인하세요.</p>}</div></>}
          </>}
        </section>
      </>}
    </>}
    <section className={`${styles.card} ${styles.basket}`} aria-labelledby="research-basket-title"><div className={styles.resultHeading}><div><p className={styles.eyebrow}>조사한 근거를 다음 업무로</p><h2 id="research-basket-title">입안 참고 {references.length}/4</h2></div><button className="btn primary" type="button" onClick={() => handoff('enact')} disabled={!references.length || !!busy}>담은 자료로 새 규정 만들기 →</button></div><p className={styles.muted}>다른 기관의 조례는 참고 사례입니다. 우리 기관의 위임 근거로 자동 채택하지 않습니다. 가져온 원문과 출처를 다음 화면에서 확인할 수 있습니다.</p>{references.length ? <ul className={styles.referenceList}>{references.map(reference => <li key={`${reference.hit.kind}:${reference.hit.id}`}><div><strong>{reference.doc.title}</strong><small>시행 {reference.doc.effectiveAt || '미확인'} · {reference.doc.articles.length}개 조문 · 현행 원문 조회</small></div><button className="btn small" type="button" aria-label={`${reference.doc.title} 참고에서 빼기`} onClick={() => setReferences(previous => previous.filter(item => item !== reference))} disabled={!!busy}>빼기</button></li>)}</ul> : <p className={styles.empty}>‘현행판 참고 담기’ 또는 현행 조례 찾기의 ‘참고자료로 사용’으로 자료를 모아 보세요.</p>}</section>
    <p className={styles.footer}>출처: 법제처 국가법령정보센터 · 공포일과 시행일은 서로 다를 수 있습니다. <a href="https://open.law.go.kr/LSO/openApi/guideResult.do?htmlName=ordinListGuide" target="_blank" rel="noopener noreferrer">현행·연혁 목록 API 안내 ↗</a></p>
  </main>;
}
