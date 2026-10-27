'use client';
import Jomoki from '@/components/Jomoki';
import { useEffect, useMemo, useRef, useState } from 'react';
import PaperDoc from '@/components/PaperDoc';
import AiProgress from '@/components/AiProgress';
import { SourceBadge } from '@/components/Badges';
import { buildAmendDocs, buildEnactDocs, type DocModel } from '@/lib/docs';
import { buildDownloadSet, copyForHangul, createDownloadFile, startDownload, fileName, toDocx, toHwpx, type DownloadFile } from '@/lib/export';
import { documentForExport, documentReadiness, preparedDownloadVersion, uniqueExportNotices } from '@/lib/export-readiness';
import { enactReasonReady, runReason } from '@/lib/pipeline';
import { mergeKnowledge, knowledgeRecordText } from '@/lib/knowledge';
import { migrateLegacyReasonReview, reasonInputHash } from '@/lib/review';
import { serializeProjectBackup } from '@/lib/project-transfer';
import { evidenceRecordText } from '@/lib/evidence';
import { pilotCsv } from '@/lib/evaluation';
import { CHECK_RESULTS, draftingChecks, type DocumentSettings } from '@/lib/document-settings';
import { useWork } from './ctx';
import styles from './DocsTab.module.css';
import TransitionPanel from './TransitionPanel';
import { amendmentKind, workMethodLabel } from '@/lib/amendment-method';
import { transitionReviewText } from '@/lib/transition-review';
import ProcedurePanel from './ProcedurePanel';

type PreparedDocumentFile = DownloadFile & { version: string; generatedAt: number; documentLabel: string };

export default function DocsTab() {
  const { p, update, before, d, enactRule, enactLint, prof, toast, setTab } = useWork();
  const [cur, setCur] = useState(0);
  const [fmt, setFmt] = useState<'hwpx' | 'docx' | 'both'>('both');
  const [busy, setBusy] = useState(false);
  const [preparedFile, setPreparedFile] = useState<PreparedDocumentFile | null>(null);
  const preparedFileRef = useRef<PreparedDocumentFile | null>(null);
  const [downloadNotice, setDownloadNotice] = useState('');
  const [reasonBusy, setReasonBusy] = useState(false);
  const [reasonError, setReasonError] = useState('');
  const [reasonRetry, setReasonRetry] = useState(0);
  const [reasonStarted, setReasonStarted] = useState<number>();
  const [reasonPhase, setReasonPhase] = useState<'preparing' | 'requesting' | 'repairing' | 'validating' | 'waiting'>('preparing');
  const reasonController = useRef<AbortController | null>(null);
  const reasonEpoch = useRef(0);
  const enact = p.mode === 'enact';
  const specHash = reasonInputHash(p, d?.specHash);
  const stale = !p.prose || p.prose.specHash !== specHash;
  const asked = useRef<string>('');
  const latest = useRef({ id: p.id, specHash });
  latest.current = { id: p.id, specHash };

  useEffect(() => () => { reasonEpoch.current++; reasonController.current?.abort(); }, []);
  useEffect(() => () => {
    const previous = preparedFileRef.current;
    if (previous) setTimeout(previous.revoke, 60_000);
  }, []);

  // 제정·개정이유: 현재 조문/변경명세가 바뀌면 다시 씀
  useEffect(() => {
    if (!stale || reasonBusy || asked.current === specHash) return;
    const migrated = migrateLegacyReasonReview(p, d?.specHash);
    if (migrated) {
      update((q) => q.id === p.id && q.prose?.specHash === p.prose?.specHash ? { ...q, prose: migrated } : q);
      return;
    }
    if (enact && (!enactRule || !enactReasonReady(p))) return;
    if (!enact && (!before || !d || (amendmentKind(p) === 'partial' && !p.spec.ops.some((o) => o.status === 'accepted')) || (amendmentKind(p) === 'full' && !p.replacementDraft))) return;
    asked.current = specHash;
    const controller = new AbortController();
    reasonController.current?.abort();
    reasonController.current = controller;
    const epoch = ++reasonEpoch.current;
    setReasonBusy(true);
    setReasonError('');
    setReasonStarted(Date.now());
    setReasonPhase('preparing');
    (async () => {
      try {
        const { knowledge, ...r } = await runReason(p, enact ? enactRule! : before!, { signal: controller.signal, onProgress: progress => { if (reasonEpoch.current === epoch) setReasonPhase(progress.phase); } });
        if (controller.signal.aborted || reasonEpoch.current !== epoch || latest.current.id !== p.id || latest.current.specHash !== specHash) return;
        update((q) => q.id === p.id && reasonInputHash(q, d?.specHash) === specHash ? ({ ...q, knowledge: mergeKnowledge(q.knowledge, knowledge), prose: { ...r, specHash, reviewed: false } }) : q);
      } catch (error) {
        if (reasonEpoch.current === epoch) setReasonError(controller.signal.aborted ? '이유서 작성을 중지했습니다. 작성한 조문은 보관되어 있습니다.' : (error as Error).message || '이유서를 작성하지 못했습니다. 다시 시도해 주세요.');
      } finally {
        if (reasonEpoch.current === epoch) { reasonController.current = null; setReasonBusy(false); }
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [specHash, stale, reasonBusy, p.enact?.outlineConfirmed, reasonRetry]);

  const docs: DocModel[] = useMemo(() => {
    if (enact) return enactRule ? buildEnactDocs(p, enactRule, enactLint, prof, specHash) : [];
    return before && d ? buildAmendDocs(p, before, d, prof) : [];
  }, [enact, enactRule, enactLint, p, prof, specHash, before, d]);

  const must = (enact ? enactLint : d?.lint ?? []).filter((i) => i.tier === 'must' && (enact || i.origin === 'introduced')).length;
  const aiUnreviewed = p.spec.ops.filter((o) => o.status === 'proposed').length;
  const enactUnreviewed = enact ? (p.enact?.outline ?? []).filter((a) => a.provenance === 'ai' || !a.paragraphs.some((t) => t.trim())).length : 0;
  const rejected = enact ? 0 : d?.rejected.length ?? 0;
  const noAccepted = !enact && amendmentKind(p) === 'partial' && !p.spec.ops.some((o) => o.status === 'accepted');
  const reasonUnreviewed = !p.prose?.reason.trim() || !p.prose.reviewed;
  const readiness = docs.map(doc => documentReadiness(doc, p, { amendmentHash: d?.specHash, reasonBusy, must, rejected }));
  const exportDocs = docs.map((doc, index) => documentForExport(doc, readiness[index]));
  const setNotices = uniqueExportNotices(readiness);
  const setIsDraft = readiness.some(state => state.draft);
  const setAvailable = docs.length > 0 && readiness.every(state => state.available);
  const base = (enact ? p.enact?.title ?? p.title : `${before?.title ?? p.title} ${workMethodLabel(p)}`).replace(/\s+/g, '');
  const index = Math.min(cur, docs.length - 1);
  const doc = docs[index];
  const exportDoc = exportDocs[index];
  const currentReadiness = readiness[index];
  const downloadVersion = preparedDownloadVersion(p, exportDocs, doc?.id ?? '', fmt);
  const latestDownloadVersion = useRef(downloadVersion);
  latestDownloadVersion.current = downloadVersion;

  useEffect(() => {
    const previous = preparedFileRef.current;
    if (previous && previous.version !== downloadVersion) {
      preparedFileRef.current = null;
      setPreparedFile(null);
      setDownloadNotice('문서 내용이나 선택이 바뀌었어요. 위의 파일 받기 버튼으로 현재 내용을 새로 저장해 주세요.');
      setTimeout(previous.revoke, 60_000);
    }
  }, [downloadVersion]);

  const offerDownload = (name: string, bytes: Uint8Array, type: string, documentLabel: string) => {
    if (latestDownloadVersion.current !== downloadVersion) {
      setDownloadNotice('파일을 만드는 동안 내용이 바뀌었어요. 파일 받기를 다시 눌러 현재 내용으로 저장해 주세요.');
      return false;
    }
    const file: PreparedDocumentFile = { ...createDownloadFile(name, bytes, type), version: downloadVersion, generatedAt: Date.now(), documentLabel };
    const previous = preparedFileRef.current;
    if (previous) setTimeout(previous.revoke, 60_000);
    preparedFileRef.current = file;
    setPreparedFile(file);
    setDownloadNotice('');
    try { startDownload(file); }
    catch { /* A genuine user-click link below remains available if automatic download is blocked. */ }
    toast(`${name} 파일을 준비했습니다. 다운로드가 시작되지 않으면 '준비된 파일 다시 저장'을 눌러 주세요.`);
    return true;
  };

  const doDownload = async () => {
    if (busy || !setAvailable) { toast('아직 내려받을 문서가 준비되지 않았습니다. 조문을 먼저 작성해 주세요.'); return; }
    setBusy(true);
    try {
      const exported = p.evaluation ? { ...p, evaluation: { ...p.evaluation, exportCount: p.evaluation.exportCount + 1, firstExportAt: p.evaluation.firstExportAt ?? Date.now() } } : p;
      const extras: Record<string, string> = {
        '작업백업.jomok.json': await serializeProjectBackup(exported),
        '입안참고자료_검색기록.txt': knowledgeRecordText(exported.knowledge),
        '문서검토상태.txt': setNotices.length ? `검토용 초안\n${setNotices.map(item => `- ${item.message}`).join('\n')}\n\n다운로드해도 담당자의 검토·수락 상태는 바뀌지 않습니다.\n` : '현재 저장된 초안입니다. 기관의 제출·결재·공고 요건을 확인한 뒤 사용하세요.\n',
        '근거원문.txt': p.evidence.length ? p.evidence.map(e => `${evidenceRecordText(e)}\n\n[조회·입력 당시 보존한 원문]\n${e.text}`).join('\n\n────────────────────\n\n') : '이 작업에 보존한 근거 원문이 없습니다. 상위 법령과 적용 근거는 담당자가 확인하세요.\n',
        '기존업무_적용관계기록.txt': transitionReviewText(enactRule ?? d?.after ?? before!, p.spec.addenda, { priorRule: before ?? undefined, method: p.mode === 'amend' ? amendmentKind(p) : 'enact' }),
      };
      if (exported.evaluation) extras['사용기록.csv'] = pilotCsv(exported);
      const file = await buildDownloadSet(base, exportDocs, fmt, extras);
      const offered = offerDownload(setIsDraft ? file.name.replace('_문서세트.zip', '_검토용문서세트.zip') : file.name, file.bytes, 'application/zip', `문서 세트 ${docs.length}종 · ${fmt === 'both' ? 'HWPX·DOCX' : fmt.toUpperCase()}`);
      if (offered && p.evaluation) update(q => ({ ...q, evaluation: q.evaluation ? { ...q.evaluation, exportCount: q.evaluation.exportCount + 1, firstExportAt: q.evaluation.firstExportAt ?? Date.now() } : undefined }));
    } catch (e) {
      toast(`문서를 만들지 못했습니다: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const doCopy = async (doc: DocModel) => {
    if (busy) return;
    try {
      await copyForHangul(doc);
      toast(`${doc.name}을 복사했습니다. 한글에서 Ctrl+V로 붙여 넣으세요.`);
    } catch {
      toast('복사하지 못했습니다. 브라우저의 클립보드 권한을 확인하세요.');
    }
  };

  const doDownloadOne = async (item: DocModel, format: 'hwpx' | 'docx') => {
    if (busy) return;
    setBusy(true);
    try {
      const data = format === 'hwpx' ? toHwpx(item) : await toDocx(item);
      offerDownload(fileName(base, item, format), data, format === 'hwpx' ? 'application/hwp+zip' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', `${item.name} · ${format.toUpperCase()}`);
    } catch (error) { toast(`문서를 만들지 못했습니다: ${(error as Error).message}`); }
    finally { setBusy(false); }
  };

  const setNotice = (key: keyof NonNullable<DocumentSettings['notice']>, value: string) => update(q => ({ ...q, documentSettings: { ...q.documentSettings, notice: { ...q.documentSettings?.notice, [key]: value } } }));
  const setReference = (key: keyof NonNullable<DocumentSettings['reference']>, value: string) => update(q => ({ ...q, documentSettings: { ...q.documentSettings, reference: { ...q.documentSettings?.reference, [key]: value } } }));
  const setCheck = (id: string, patch: Partial<NonNullable<DocumentSettings['checks']>[number]>) => update(q => {
    const entries = q.documentSettings?.checks ?? [];
    const entry = entries.find(e => e.id === id) ?? { id, result: 'unreviewed' as const, note: '' };
    return { ...q, documentSettings: { ...q.documentSettings, checks: [...entries.filter(e => e.id !== id), { ...entry, ...patch, ...(patch.result ? { sourceHash: specHash } : {}) }] } };
  });

  const ad = p.spec.addenda;
  const issuance = ['directive', 'established_rule', 'notice', 'guideline'].includes(p.kind) ? '발령' : '공포';
  const setAd = (patch: Partial<typeof ad>) => update((q) => ({ ...q, spec: { ...q.spec, addenda: { ...q.spec.addenda, ...patch } } }));

  if (!docs.length) return <section className="panel"><div className="panel-b"><h3>문서로 만들 조문을 기다리고 있어요</h3><p>조문을 작성하면 HWPX·DOCX로 받을 수 있습니다.</p><button className="btn primary" onClick={() => setTab('articles')}>조문 작성으로 가기</button></div></section>;

  return (
    <div className={styles.documents}>
      <div className="panel" id="document-downloads" tabIndex={-1} style={{ marginBottom: 16 }}>
        <div className="panel-h">
          <h3>문서 {docs.length}종 한 벌</h3>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <div className="view-toggle" role="group" aria-label="파일 형식">
              <button aria-pressed={fmt === 'both'} onClick={() => setFmt('both')}>한글+워드</button>
              <button aria-pressed={fmt === 'hwpx'} onClick={() => setFmt('hwpx')}>한글(HWPX)</button>
              <button aria-pressed={fmt === 'docx'} onClick={() => setFmt('docx')}>워드(DOCX)</button>
            </div>
            <button className="btn primary" onClick={doDownload} disabled={busy || !setAvailable}>{busy ? '파일 만드는 중…' : setIsDraft ? '검토용 문서 세트 받기' : '문서 세트 받기'}</button>
          </div>
        </div>
        <div className="panel-b" style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: '1.45rem', color: 'var(--ink-2)' }}>
          <span>반드시 고칠 문제 <b style={{ color: must ? 'var(--seal)' : 'var(--ok)' }}>{must}건</b>{must > 0 && <> · <button className="btn ghost small" onClick={() => setTab('lint')}>점검으로</button></>}</span>
          {!enact && <span>검토 안 한 AI 제안 <b>{aiUnreviewed}건</b>(문서에 반영 안 됨)</span>}
          {noAccepted && <span>수락된 개정이 없어 현재 원문과 서식이 포함된 검토용 초안으로 받습니다.</span>}
          {rejected > 0 && <span role="status">수락했지만 적용하지 못한 변경 <b>{rejected}건</b>은 문서에 반영되지 않았습니다.</span>}
          {enact && enactUnreviewed > 0 && <span>조문 작성·확인 <b>{enactUnreviewed}개 남음</b> · 지금은 검토용 초안으로 받을 수 있습니다.</span>}
          {!reasonBusy && reasonUnreviewed && <span>이유서 검토가 남아 있어도 현재 문서를 내려받아 편집할 수 있습니다.</span>}
          <span>HWPX·DOCX 모두 한글에서 수정할 수 있는 문서입니다. 서식 입력값은 문서 세트와 작업 백업에 함께 반영됩니다.</span>
          <span>ZIP에 작업 백업과 조회·입력 당시의 근거 원문이 함께 들어갑니다.</span>
        </div>
      </div>

      {(
        <div className="panel" style={{ marginBottom: 16 }}>
          <div className="panel-h"><h3>부칙</h3><span className="badge b-rule">규칙</span><span className="help" style={{ margin: 0 }}>고르면 부칙 문장이 자동으로 바뀝니다</span></div>
          <div className="panel-b grid2">
            <label>
              <span className="help" style={{ display: 'block', margin: '0 0 6px' }}>시행일</span>
              <select className="field" value={ad.effective} onChange={(e) => setAd({ effective: e.target.value as typeof ad.effective })}>
                <option value="promulgation">{issuance}한 날부터</option>
                <option value="months">{issuance} 후 몇 개월 뒤</option>
                <option value="date">날짜 정하기</option>
              </select>
            </label>
            {ad.effective === 'months' && (
              <label><span className="help" style={{ display: 'block', margin: '0 0 6px' }}>개월</span><input className="field" type="number" min={1} max={24} value={ad.months ?? 3} onChange={(e) => setAd({ months: Number(e.target.value) })} /></label>
            )}
            {ad.effective === 'date' && (
              <label><span className="help" style={{ display: 'block', margin: '0 0 6px' }}>시행 날짜</span><input className="field" type="date" value={ad.date ?? ''} onChange={(e) => setAd({ date: e.target.value })} /></label>
            )}
            <label style={{ gridColumn: '1 / -1' }}>
              <span className="help" style={{ display: 'block', margin: '0 0 6px' }}>경과조치(필요할 때만)</span>
              <input className="field" value={ad.transitional ?? ''} onChange={(e) => setAd({ transitional: e.target.value })} placeholder="예) 이 규칙 시행 전에 출장을 시작한 경우에는 종전의 규정에 따른다." />
            </label>
            {['directive', 'established_rule', 'notice', 'guideline'].includes(p.kind) && (
              <p className="help">재검토기한·유효기간은 아래에서 적용 대상을 확인한 뒤 본칙 마지막 조문으로 작성합니다.</p>
            )}
          </div>
        </div>
      )}
      {(enactRule ?? d?.after) && <TransitionPanel project={p} update={update} rule={(enactRule ?? d?.after)!} />}
      <details className="panel" style={{ marginBottom: 16 }}><summary style={{ padding: 18, fontWeight: 700, cursor: 'pointer' }}>의견제시 요청·예고 후 의견 처리가 필요한가요?</summary><ProcedurePanel /></details>

      <div className="panel" id="reason-editor" tabIndex={-1} style={{ marginBottom: 16 }}>
        <div className="panel-h">
          <h3>{enact ? '제정이유' : amendmentKind(p) === 'repeal' ? '폐지이유' : '개정이유'}와 주요내용</h3>
          {reasonBusy ? <span className="help" style={{ margin: 0 }}>AI가 쓰는 중…</span> : p.prose && (p.prose.via === 'cassette' ? <SourceBadge via="cassette" /> : p.prose.via === 'live' ? <span className="badge b-ai" title={p.prose.model}>AI</span> : <span className="badge b-rule">규칙(틀)</span>)}
          {p.prose && !reasonBusy && (
            <button className="btn ghost small" style={{ marginLeft: 'auto' }} onClick={() => { asked.current = ''; update((q) => ({ ...q, prose: q.prose && { ...q.prose, specHash: 'stale' } })); }}>다시 쓰기</button>
          )}
        </div>
        <div className="panel-b">
          {reasonBusy && <AiProgress title="이유서와 주요내용을 정리하고 있어요" detail="확정한 조문을 읽고 필요한 설명을 쓰는 중입니다. 완료되면 아래에 나타납니다." startedAt={reasonStarted} phase={reasonPhase} onCancel={() => reasonController.current?.abort()} />}
          {!reasonBusy && reasonError && <div role="status"><p className="help">{reasonError}</p><button className="btn small" onClick={() => { asked.current = ''; setReasonError(''); setReasonRetry(value => value + 1); }}>이유서 다시 작성</button></div>}
          {p.prose ? (
            <>
              {p.prose.note && <p className="help" role="status">{p.prose.note}</p>}
              <textarea className="field" disabled={reasonBusy} style={{ minHeight: 80 }} value={p.prose.reason} onChange={(e) => update((q) => ({ ...q, prose: q.prose && { ...q.prose, reason: e.target.value, reviewed: false } }))} aria-label="이유" placeholder="제정·개정의 필요성과 목적을 작성해 주세요." />
              {p.prose.mainPoints.map((m, i) => (
                <div key={i} style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'baseline' }}>
                  <span style={{ fontFamily: 'var(--doc)', fontWeight: 700 }}>{'가나다라마바사아자차카타파하'[i]}.</span>
                  <input className="field" disabled={reasonBusy} value={m} onChange={(e) => update((q) => ({ ...q, prose: q.prose && { ...q.prose, mainPoints: q.prose.mainPoints.map((x, j) => (j === i ? e.target.value : x)), reviewed: false } }))} aria-label={`주요내용 ${i + 1}`} />
                </div>
              ))}
              <p className="help">이유와 주요내용을 검토한 뒤 확인해 주세요. 수정하면 다시 확인해야 합니다.</p>
              <button className="btn small" disabled={reasonBusy || stale || !p.prose.reason.trim() || p.prose.reviewed} onClick={() => update((q) => ({ ...q, prose: q.prose && { ...q.prose, reviewed: true } }))}>{p.prose.reviewed ? '이유서 확인 완료' : '이유서 확인함'}</button>
            </>
          ) : (
            !reasonBusy && !reasonError && <p className="help" style={{ margin: 0 }}>{enact ? '조문 초안이 생기면 자동으로 씁니다.' : amendmentKind(p) === 'full' ? '전부개정 본문을 작성하면 이유서 작성을 시작합니다.' : amendmentKind(p) === 'repeal' ? '폐지 이유와 계속 처리할 업무를 확인해 주세요.' : '변경을 하나 이상 수락하면 자동으로 씁니다.'}</p>
          )}
        </div>
      </div>

      <div className="doc-tabs" role="group" aria-label="문서 선택">
        {docs.map((x, i) => (
          <button key={x.id} aria-pressed={i === cur} onClick={() => setCur(i)}>{x.name.replace(/및/g, '·')}</button>
        ))}
      </div>
      <section className={styles.exportBar} aria-label="선택한 문서 내려받기" aria-busy={busy}>
        <div className={styles.exportHeading}><div><span className={styles.eyebrow}>지금 보고 있는 문서</span><h3>{doc.name.replace(/및/g, '·')}</h3></div><span className={`${styles.state} ${currentReadiness.draft ? styles.draft : ''}`}>{currentReadiness.draft ? '검토용 초안' : '현재 저장된 초안'}</span></div>
        <p className={styles.exportHelp}>{currentReadiness.available ? '확인이 남아 있어도 내려받아 편집할 수 있어요. 미완료 항목은 파일에 표시하며, 다운로드해도 검토·수락 상태는 바뀌지 않습니다.' : currentReadiness.unavailableReason}</p>
        <div className={styles.exportActions}>
          <button className="btn primary" disabled={!currentReadiness.available || busy} onClick={() => doDownloadOne(exportDoc, 'hwpx')}>이 문서 HWPX 받기</button>
          <button className="btn" disabled={!currentReadiness.available || busy} onClick={() => doDownloadOne(exportDoc, 'docx')}>DOCX 받기</button>
          <button className="btn" disabled={!currentReadiness.available || busy} onClick={() => doCopy(exportDoc)} title="밑줄·표 테두리를 살려 복사합니다">한글에 붙여넣기용 복사</button>
          <button className="btn" disabled={!currentReadiness.available || busy} onClick={() => window.print()}>인쇄</button>
        </div>
        {busy && <p className={styles.preparing} role="status">파일을 만들고 있어요. 완성되면 아래에 직접 저장 링크도 나타납니다.</p>}
        {!!currentReadiness.notices.length && <details className={styles.reviewNotices}><summary>이 문서에 남은 확인사항 {currentReadiness.notices.length}개</summary><ul>{currentReadiness.notices.map(item => <li key={item.id}>{item.message}{item.destination === 'articles' || item.destination === 'lint' ? <button className="btn ghost small" onClick={() => setTab(item.destination as 'articles' | 'lint')}>{item.destination === 'articles' ? '조문에서 확인' : '점검에서 확인'}</button> : item.destination === 'reason' ? <a href="#reason-editor">이유서 확인</a> : <a href={item.destination === 'procedure' ? '#procedure-records' : item.destination === 'transitions' ? '#transition-review' : '#document-fields'}>입력·검토 항목 확인</a>}</li>)}</ul></details>}
        {downloadNotice && <p className={styles.preparing} role="status">{downloadNotice}</p>}
        {preparedFile && preparedFile.version === downloadVersion && <div className={styles.downloadReady} role="status"><Jomoki size={58} mood="celebrate" /><div><strong>파일 준비 완료 · 현재 내용으로 만든 생성본</strong><span>{preparedFile.documentLabel}</span><span>{new Date(preparedFile.generatedAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', hour12: false })} 생성</span><span>{preparedFile.name}</span><p>저장 창이 뜨지 않았거나 파일을 찾기 어려우면 이 링크를 눌러 주세요. 내용을 수정하면 새로 받아야 합니다.</p></div><a className="btn" href={preparedFile.url} download={preparedFile.name}>준비된 파일 다시 저장</a></div>}
      </section>
      {doc.formSource && <p className="help"><a href={doc.formSource.url} target="_blank" rel="noopener noreferrer">{doc.formSource.label}</a> · {doc.formSource.adaptation}{doc.layout && doc.layout !== 'support' && ' · 신명조 미설치 시 대체 글꼴로 표시될 수 있습니다.'}</p>}
      {doc.id === 'notice' && <section className="panel" id="document-fields" style={{ marginBottom: 16 }} aria-label="예고문 서식 입력">
        <div className="panel-h"><h3>예고문에 들어갈 정보</h3><span className="help" style={{ margin: 0 }}>한 번 입력하면 미리보기·HWPX·DOCX에 함께 반영돼요</span></div>
        <div className="panel-b grid2">
          {([
            ['number', '공고번호 또는 문서번호', 'text', 200], ['issuer', '공고·발령 기관장', 'text', 120],
            ['date', '공고일 또는 의견조회일', 'date', 10], ['deadline', '의견 제출 기한', 'date', 10],
            ['department', '의견 접수기관·담당부서', 'text', 200], ['phone', '문의 전화', 'tel', 100],
            ['address', '우편·방문 제출 주소', 'text', 500], ['email', '의견 접수 전자우편', 'email', 200],
            ['method', '제출 방법', 'text', 500], ['website', '예고안 전문 공개 누리집·공유 위치', 'text', 1000],
          ] as const).map(([key, label, type, max]) => <label key={key}><span className="help" style={{ display: 'block', margin: '0 0 6px' }}>{label}</span><input className="field" type={type} maxLength={max} value={p.documentSettings?.notice?.[key] ?? ''} onChange={e => setNotice(key, e.target.value)} placeholder={key === 'department' ? prof.opinionContact : label} /></label>)}
          <label style={{ gridColumn: '1 / -1' }}><span className="help">그 밖의 안내사항</span><textarea className="field" maxLength={2000} value={p.documentSettings?.notice?.extra ?? ''} onChange={e => setNotice('extra', e.target.value)} /></label>
          <p className="help" style={{ gridColumn: '1 / -1', margin: 0 }}>예고 대상·기간은 자동 확정하지 않습니다. 기관 절차에 따라 확인한 일자와 제출 방법을 입력하세요. 빈 항목은 문서에 작성란으로 남습니다.</p>
          {p.documentSettings?.notice?.date && p.documentSettings.notice.deadline && p.documentSettings.notice.deadline < p.documentSettings.notice.date && <p role="alert" style={{ gridColumn: '1 / -1', color: 'var(--seal)' }}>의견 제출 기한이 공고일보다 앞섭니다. 날짜를 확인해 주세요.</p>}
        </div>
      </section>}
      {doc.id === 'reason' && <section className="panel" id="document-fields" style={{ marginBottom: 16 }} aria-label="이유서 참고사항 입력"><div className="panel-h"><h3>이유서 참고사항</h3><span className="help" style={{ margin: 0 }}>필요한 항목만 작성하세요</span></div><div className="panel-b">
        {([['budget', '예산조치·비용추계'], ['consultation', '관계부서·기관 협의'], ['other', '그 밖의 참고사항']] as const).map(([key, label]) => <label key={key} style={{ display: 'block', marginBottom: 12 }}><span className="help">{label}</span><textarea className="field" maxLength={2000} value={p.documentSettings?.reference?.[key] ?? ''} onChange={e => setReference(key, e.target.value)} /></label>)}
      </div></section>}
      {doc.id === 'checklist' && <section className="panel" id="document-fields" style={{ marginBottom: 16 }} aria-label="매뉴얼 체크리스트 기록"><div className="panel-h"><h3>매뉴얼 검토 기록</h3><span className="help" style={{ margin: 0 }}>선택 사항 · 확인하지 않은 항목은 미확인으로 남아요</span></div><div className="panel-b">
        {draftingChecks(p.kind).map((item, index) => { const saved = p.documentSettings?.checks?.find(x => x.id === item.id); return <div key={item.id} style={{ borderBottom: '1px solid var(--line)', padding: '12px 0' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}><b style={{ flex: '1 1 260px' }}>{index + 1}. {item.question}</b><select className="field" style={{ width: 'auto', minWidth: 140 }} aria-label={`${item.question} 검토 상태`} value={saved?.result ?? 'unreviewed'} onChange={e => setCheck(item.id, { result: e.target.value as keyof typeof CHECK_RESULTS })}>{Object.entries(CHECK_RESULTS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
          <p className="help" style={{ margin: '6px 0' }}>{item.detail}</p>
          {saved && saved.result !== 'unreviewed' && saved.sourceHash !== specHash && <p className="help" role="status">초안이 바뀌기 전의 기록입니다. 검토 후 상태를 다시 선택하세요.</p>}
          <textarea className="field" style={{ minHeight: 52 }} aria-label={`${item.question} 검토 메모`} maxLength={2000} placeholder="근거 조문·판단 이유·보완사항(선택)" value={saved?.note ?? ''} onChange={e => setCheck(item.id, { note: e.target.value })} />
        </div>; })}
      </div></section>}
      <div className={styles.printDocument}><PaperDoc doc={exportDoc} /></div>

    </div>
  );
}
