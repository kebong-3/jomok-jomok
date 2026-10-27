'use client';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Header, { useModels } from '@/components/Header';
import { SourceBadge } from '@/components/Badges';
import { derive, lintRule, parseRule, renderRule, RULE_KIND_LABEL, type SpecOp } from '@/engine';
import { projectProfile } from '@/config/profiles';
import { loadProject, saveProject, newId, emptySpec, type Evidence, type Project } from '@/lib/project';
import { enactRule as toEnactRule, initialLog, runAmendPipeline, runCompare, runEnactOutline } from '@/lib/pipeline';
import { loadSettings } from '@/lib/settings';
import { Ctx, type WorkCtx } from '@/components/work/ctx';
import ArticlesTab from '@/components/work/ArticlesTab';
import LintTab from '@/components/work/LintTab';
import DocsTab from '@/components/work/DocsTab';
import EnactTab from '@/components/work/EnactTab';
import { CompareModal, EvidenceDrawer, LogPanel } from '@/components/work/Side';
import KnowledgePanel from '@/components/work/KnowledgePanel';
import { mergeKnowledge } from '@/lib/knowledge';
import { ProjectBackupButton } from '@/components/ProjectTransfer';
import PilotPanel from '@/components/work/PilotPanel';
import ReviewSummary from '@/components/work/ReviewSummary';
import AiProgress from '@/components/AiProgress';
import type { AiProgressEvent } from '@/lib/ai-protocol';
import NextSteps from '@/components/work/NextSteps';
import WorkReview from '@/components/work/WorkReview';
import AmendmentPanel from '@/components/work/AmendmentPanel';
import ProcedureTracker from '@/components/work/ProcedureTracker';
import { formatKoreanDate, keyDeadlines, trackSummary } from '@/lib/procedure-track';
import JomokiCompanion from '@/components/companion/JomokiCompanion';
import { workBrief, workReaction, type CompanionActionId, type CompanionBrief, type WorkSnapshot } from '@/lib/companion';
import { authorityArticleReviews } from '@/lib/authority-review';
import { opTitle } from '@/lib/opconv';
import AuthorityPanel from '@/components/work/AuthorityPanel';
import LinkedRegulationsPanel from '@/components/work/LinkedRegulationsPanel';
import { amendmentKind, deriveProject, workMethodLabel } from '@/lib/amendment-method';

type Tab = 'articles' | 'lint' | 'docs' | 'procedure';

function Workroom() {
  const { id } = useParams<{ id: string }>();
  const sp = useSearchParams();
  const router = useRouter();
  const [p, setP] = useState<Project | null>(null);
  const currentProject = useRef<Project | null>(null);
  const [missing, setMissing] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const saveQueue = useRef<Promise<void>>(Promise.resolve());
  const [tab, setTab] = useState<Tab>('articles');
  const [reviewOpen, setReviewOpen] = useState(false);
  const reviewPanel = useRef<HTMLDivElement>(null);
  const [ev, setEv] = useState<Evidence | string | null>(null);
  const [toastMsg, setToast] = useState<{ msg: string; undo?: () => void } | null>(null);
  const [cmp, setCmp] = useState<null | 'loading' | { ops: SpecOp[]; model: string; via: string } | { error: string }>(null);
  const models = useModels();
  const started = useRef<string | null>(null);
  const initialTask = useRef<AbortController | null>(null);
  const [initialProgress, setInitialProgress] = useState<AiProgressEvent>();
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevSnapshot = useRef<WorkSnapshot | undefined>(undefined);
  const [reaction, setReaction] = useState<CompanionBrief | null>(null);

  useEffect(() => {
    let active = true;
    currentProject.current = null;
    setP(null);
    setMissing(false);
    setReviewOpen(false);
    loadProject(id).then((x) => {
      if (!active) return;
      if (!x) { setMissing(true); return; }
      // A persisted running flag cannot resume a disconnected browser request.
      // The completed article batches remain the source of truth for continuing.
      const restored = x.log.some(log => log.status === 'running') ? { ...x, log: x.log.map(log => log.status === 'running' ? { ...log, status: 'skipped' as const, detail: '이전 연결이 종료되었습니다. 저장된 내용을 확인하고 남은 작업을 이어서 실행하세요.' } : log) } : x;
      currentProject.current = restored;
      setP(restored);
    });
    return () => { active = false; initialTask.current?.abort(); };
  }, [id]);

  const update = useCallback((fn: (q: Project) => Project): Promise<boolean> => {
    const current = currentProject.current;
    if (!current) return Promise.resolve(false);
    // Keep mutations outside React's state updater, which can be invoked twice.
    // Every queued snapshot includes preceding edits, in the same save order.
    const next = fn(current);
    currentProject.current = next;
    setP(next);
    const persisted = saveQueue.current.then(() => saveProject(next)).catch(() => false);
    saveQueue.current = persisted.then(saved => {
      if (currentProject.current?.id === next.id) setSaveFailed(!saved);
    });
    return persisted;
  }, []);

  // 처음 들어오면 에이전트 실행
  useEffect(() => {
    if (!p || p.id !== id || started.current === p.id || sp.get('run') !== '1') return;
    started.current = p.id;
    router.replace(`/work/${p.id}`);
    if (p.mode === 'amend') void runAmendPipeline(p, update);
    else {
      const controller = new AbortController(); initialTask.current = controller;
      void runEnactOutline(p, update, { signal: controller.signal, onProgress: setInitialProgress }).finally(() => { if (initialTask.current === controller) initialTask.current = null; });
    }
  }, [p, id, sp, router, update]);

  const prof = useMemo(() => projectProfile(p), [p?.profileId, p?.profileSnapshot]); // eslint-disable-line react-hooks/exhaustive-deps
  const before = useMemo(() => (p && p.mode === 'amend' ? parseRule(p.source.raw, p.kind, p.title) : null), [p?.source.raw, p?.kind, p?.mode]); // eslint-disable-line react-hooks/exhaustive-deps
  const knownLaws = useMemo(() => new Set((p?.evidence ?? []).map((e) => e.label.match(/「(.+?)」/)?.[1]).filter((x): x is string => !!x)), [p?.evidence]);
  const online = (p?.evidence ?? []).some((e) => e.via === 'live' || e.via === 'relay');
  const d = useMemo(() => {
    if (!p || !before) return null;
    return deriveProject(p, before, { style: prof.style, excludedFixes: new Set(p.excludedFixes), lint: { institution: prof.name, knownLaws, online } });
  }, [p?.spec, p?.excludedFixes, p?.amendmentKind, p?.replacementDraft, before, prof, knownLaws, online]); // eslint-disable-line react-hooks/exhaustive-deps
  const enactRule = useMemo(() => (p && p.mode === 'enact' && p.enact?.outlineConfirmed ? toEnactRule(p) : null), [p]);
  const enactLint = useMemo(() => (enactRule ? lintRule(enactRule, { institution: prof.name, knownLaws, online }) : []), [enactRule, prof, knownLaws, online]);

  // 조목이 동행 도우미가 말할 현재 상태(이미 계산된 값만 사용)
  const snapshot = useMemo<WorkSnapshot | null>(() => {
    if (!p) return null;
    const enactMode = p.mode === 'enact';
    const own = p.spec.ops.filter(o => !o.derivedFrom);
    const firstOp = own.find(o => o.status === 'proposed');
    const issues = enactMode ? enactLint : (d?.lint ?? []).filter(i => i.origin === 'introduced');
    const rule = enactRule ?? d?.after;
    const outline = p.enact?.outline ?? [];
    const summary = trackSummary(p.kind, prof, p.procedureTrack, p.mode);
    const today = new Date().toISOString().slice(0, 10);
    const upcoming = keyDeadlines(p.kind, prof, p.procedureTrack?.dates).find(x => x.date >= today);
    let authorityPending = 0;
    try { authorityPending = rule ? authorityArticleReviews(p, rule).filter(r => r.status !== 'reviewed').length : 0; } catch { authorityPending = 0; }
    return {
      mode: p.mode, method: enactMode ? 'enact' : (p.amendmentKind ?? 'partial'), stage: tab, title: p.enact?.title ?? p.title, kindLabel: RULE_KIND_LABEL[p.kind],
      running: p.log.some(l => l.status === 'running'), runningLabel: p.log.find(l => l.status === 'running')?.label, planError: p.planError,
      viaExample: p.planVia === 'cassette' || p.enact?.via === 'cassette',
      proposed: own.filter(o => o.status === 'proposed').length, accepted: own.filter(o => o.status === 'accepted').length,
      firstProposal: firstOp ? { label: opTitle(firstOp.change), why: firstOp.why ? firstOp.why.split(/(?<=[.다요])\s/)[0] : undefined } : undefined,
      autoFixes: (d?.fixes ?? []).filter(f => f.reason === 'moved').length,
      must: issues.filter(i => i.tier === 'must').length, check: issues.filter(i => i.tier === 'check').length,
      outlineReady: !!p.enact?.outlineConfirmed, enactArticles: outline.length,
      enactMissing: outline.filter(a => !a.paragraphs.some(t => t.trim())).length, enactUnreviewed: outline.filter(a => a.provenance === 'ai').length,
      authorityPending, reasonReady: !!p.prose?.reviewed, noticeDeadlineSet: !!p.documentSettings?.notice?.deadline,
      trackDone: summary.done, trackTotal: summary.total, currentStep: summary.current?.step.name,
      nextDeadline: upcoming ? { label: upcoming.label.split(' · ')[0].replace(/\(.*\)$/, ''), date: formatKoreanDate(upcoming.date) } : undefined,
    };
  }, [p, d, tab, enactRule, enactLint, prof]);
  const brief = useMemo(() => (snapshot ? workBrief(snapshot) : null), [snapshot]);
  useEffect(() => {
    if (!snapshot) return;
    const next = workReaction(prevSnapshot.current, snapshot);
    prevSnapshot.current = snapshot;
    if (next) setReaction(next);
  }, [snapshot]);

  const toast = useCallback((msg: string, undo?: () => void) => {
    setToast({ msg, undo });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), undo ? 6000 : 3500);
  }, []);

  const doCompare = async () => {
    if (!p || !before) return;
    setCmp('loading');
    try {
      if (loadSettings().connection !== 'default') throw new Error('두 AI 비교는 기본 연결에 설정된 서로 다른 모델로 실행합니다. 설정·진단에서 기본 연결을 선택하세요.');
      const firstModel = models?.find((m) => m.id === p.planModelId || m.label === p.planModel);
      const choices = (models ?? []).filter((m) => (m.configured ?? m.connected) && m.id !== (p.planModelId ?? firstModel?.id));
      const other = choices.find((m) => m.family !== (p.planFamily ?? firstModel?.family)) ?? choices[0];
      if (!other) throw new Error('비교할 두 번째 모델이 설정되지 않았습니다. 설정·진단에서 확인하세요.');
      const r = await runCompare(p, before, other.id);
      setCmp(r);
      update((q) => ({ ...q, knowledge: mergeKnowledge(q.knowledge, r.knowledge), compare: { otherModel: r.model, ops: r.ops, via: r.via } }));
    } catch (e) {
      setCmp({ error: `다른 AI에 연결하지 못했습니다. (${(e as Error).message})` });
    }
  };

  const retryAsNew = async () => {
    if (!p) return;
    const next: Project = { ...p, id: newId(), createdAt: Date.now(), updatedAt: Date.now(), spec: emptySpec(), excludedFixes: [], log: initialLog(p.mode), enact: undefined, prose: undefined, compare: undefined, evaluation: undefined, knowledge: undefined, workReview: undefined, planVia: undefined, planError: undefined, planModel: undefined, planModelId: undefined, planFamily: undefined, planTrace: undefined };
    if (await saveProject(next)) router.push(`/work/${next.id}?run=1`);
    else toast('새 작업을 저장하지 못했습니다. 브라우저 저장소를 확인하세요.');
  };

  if (missing) {
    return (
      <>
        <Header />
        <div className="start"><h1>작업을 찾지 못했습니다</h1><p className="sub">이 브라우저에 저장된 작업이 아니거나 지워졌습니다.</p><Link className="btn primary" href="/">처음으로</Link></div>
      </>
    );
  }
  if (!p) return <><Header /><div className="start"><p className="sub">불러오는 중…</p></div></>;

  const track = trackSummary(p.kind, prof, p.procedureTrack, p.mode);
  const ctx: WorkCtx = { p, update, before, d, enactRule, enactLint, prof, openEvidence: setEv, toast, setTab };
  const enact = p.mode === 'enact';
  const lintList = enact ? enactLint : (d?.lint ?? []).filter((i) => i.origin === 'introduced');
  const mustN = lintList.filter((i) => i.tier === 'must').length;
  const ops = p.spec.ops.filter((o) => !o.derivedFrom);
  const running = p.log.some((l) => l.status === 'running');
  const openReview = () => {
    if (running) { toast('작성 중인 묶음이 끝나면 현재 초안을 함께 검토할 수 있어요.'); return; }
    setReviewOpen(true);
    requestAnimationFrame(() => {
      reviewPanel.current?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' });
      reviewPanel.current?.focus({ preventScroll: true });
    });
  };
  const companionAction = (action: CompanionActionId) => {
    const stageOf: Partial<Record<CompanionActionId, Tab>> = { 'go-articles': 'articles', 'go-lint': 'lint', 'go-docs': 'docs', 'go-procedure': 'procedure' };
    const target = stageOf[action];
    if (target) { setTab(target); requestAnimationFrame(() => document.getElementById('work-stage-content')?.scrollIntoView({ block: 'start', behavior: 'smooth' })); return; }
    if (action === 'review') { if (tab === 'procedure') setTab('articles'); openReview(); return; }
    if (action === 'retry-ai') { void retryAsNew(); return; }
    if (action === 'go-settings') { router.push('/settings'); return; }
    if (action === 'accept-all') {
      const n = p.spec.ops.filter(o => o.status === 'proposed').length;
      if (!n) return;
      if (!confirm(`아직 수락하지 않은 제안 ${n}건을 모두 수락할까요? 근거를 확인하지 않은 수락은 입안 점검표에 그대로 기록됩니다.`)) return;
      void update(q => ({ ...q, spec: { ...q.spec, ops: q.spec.ops.map(o => (o.status === 'proposed' ? { ...o, status: 'accepted', provenance: o.provenance === 'ai' ? 'ai_accepted' : o.provenance } : o)) } }));
    }
  };
  const enactIncomplete = enact && (!p.enact?.outlineConfirmed || !p.enact.outline.length || p.enact.outline.some(a => !a.paragraphs.some(text => text.trim())));
  const enactWithoutStructure = enact && (!p.enact?.outlineConfirmed || !p.enact.outline.length);
  const viaTape = p.planVia === 'cassette' || p.enact?.via === 'cassette';
  const ruleSrc = p.source.type === 'law' ? p.evidence.find((e) => e.kind === 'rule') : undefined;
  const shownIntent = p.impact
    ? `「${p.impact.upperTitle}」의 변경을 ${[...new Set(p.impact.candidates.filter(c => p.impact!.selectedIds.includes(c.id)).map(c => c.target))].join(', ')}에 반영하는 초안을 검토합니다.`
    : p.intent;

  return (
    <Ctx.Provider value={ctx}>
      <Header />
      <div className="work-head">
        <div className="wrap-wide">
          <h1 className="work-title">
            {enact ? p.enact?.title ?? p.title : before?.title ?? p.title}
            <small>{RULE_KIND_LABEL[p.kind]} · {workMethodLabel(p)} · {prof.name}</small>
          </h1>
          <div className="work-tools">
            {p.planVia === 'live' && <span className="badge b-law">실제 AI · {p.planModel}</span>}
            {viaTape && <SourceBadge via="cassette" />}
            {ruleSrc && <SourceBadge via={ruleSrc.via} date={ruleSrc.date} />}
            {!running && <button className="btn small" onClick={retryAsNew} title="같은 입력으로 새 작업을 만들어 AI를 다시 실행합니다">AI 다시 실행</button>}
            <ProjectBackupButton project={p} className="btn small" />
            <Link className="btn small" href="/">처음으로</Link>
          </div>
        </div>
      </div>
      {!enact && p.intent && (
        <div className="progress">
          <div className="wrap-wide"><span>개정 의도</span><b style={{ fontWeight: 600 }}>{shownIntent}</b></div>
        </div>
      )}
      {viaTape && (
        <div className="notice-bar no-print">
          <div className="wrap-wide">{enact ? 'AI 대신 미리 만들어 둔 예시 응답으로 조문 체계와 초안을 채웠습니다. 형식 점검과 문서는 규칙 엔진이 실제로 계산한 결과입니다.' : 'AI 대신 미리 만들어 둔 예시 응답을 쓰고 있습니다. 대비표·개정문·인용 정정·점검은 규칙 엔진이 실제로 계산한 결과입니다.'}</div>
        </div>
      )}
      {p.planError && <div className="notice-bar no-print" role="alert"><div className="wrap-wide"><b>AI 실행을 완료하지 못했습니다.</b> {p.planError} <Link href="/settings">설정·진단에서 확인</Link></div></div>}
      {saveFailed && <div className="notice-bar no-print" role="alert"><div className="wrap-wide"><b>이 브라우저에 변경을 저장하지 못했습니다.</b> 화면을 닫기 전에 ‘작업 보관’으로 파일을 받아 주세요. <button className="btn small" onClick={async () => setSaveFailed(!(await saveProject(p)))}>저장 다시 시도</button></div></div>}
      <nav className="tabs" role="tablist" aria-label="작업 단계">
        <div className="wrap-wide">
          <button className="tab" role="tab" aria-selected={tab === 'articles'} onClick={() => setTab('articles')}>
            <span className="num">①</span> 조문 {running ? <span className="help" style={{ margin: 0 }}>작업 중…</span> : !enact && <span className="count zero">{ops.length}</span>}
          </button>
          <button className="tab" role="tab" aria-selected={tab === 'lint'} disabled={running} onClick={() => setTab('lint')}>
            <span className="num">②</span> 점검 <span className={`count ${mustN ? '' : 'zero'}`}>{running || enactIncomplete ? '대기' : mustN || '✓'}</span>
          </button>
          <button className="tab" role="tab" aria-selected={tab === 'docs'} disabled={running} onClick={() => setTab('docs')}>
            <span className="num">③</span> 문서 받기
          </button>
          <button className="tab" role="tab" aria-selected={tab === 'procedure'} disabled={running} onClick={() => setTab('procedure')}>
            <span className="num">④</span> 절차·일정 <span className={`count ${track.done === track.total && track.total ? '' : 'zero'}`}>{track.done}/{track.total}</span>
          </button>
        </div>
      </nav>
      <div className="wrap-wide">
        {tab !== 'procedure' && <NextSteps stage={tab} onReview={running ? undefined : openReview} />}
        <ReviewSummary />
        {p.evaluation && <PilotPanel />}
        <div className="work">
          <main id="work-stage-content" tabIndex={-1} style={{ scrollMarginTop: 80, outline: 'none' }}>
            {tab === 'procedure' && <ProcedureTracker />}
            {reviewOpen && tab !== 'procedure' && <div ref={reviewPanel} tabIndex={-1} className="no-print" style={{ scrollMarginTop: 80, outline: 'none', marginBottom: 24 }}><WorkReview key={tab} stage={tab as 'articles' | 'lint' | 'docs'} onClose={() => { setReviewOpen(false); document.getElementById('work-stage-content')?.focus(); }} /></div>}
            {tab === 'articles' && <>{!enact && <AmendmentPanel />}{enact ? running && !p.enact ? <AiProgress title="목적에 맞는 조문 체계를 정리하고 있어요" detail={p.log.find(log => log.status === 'running')?.label} modelLabel={initialProgress?.modelLabel} phase={initialProgress?.phase} onCancel={() => initialTask.current?.abort()} /> : <EnactTab /> : running && !ops.length ? <AiProgress title="개정 의도와 원문을 함께 살펴보고 있어요" detail={p.log.find(log => log.status === 'running')?.label} /> : amendmentKind(p) === 'repeal' ? <div className="panel panel-b"><h3>폐지 이유와 계속 처리할 업무를 확인해 주세요</h3><p>개별 조문을 삭제하지 않아도 폐지안이 만들어집니다. 점검 단계에서 근거와 종전 부칙을 확인한 뒤 문서 단계로 이동하세요.</p><button className="btn primary" onClick={() => setTab('lint')}>폐지 전 확인하기</button></div> : amendmentKind(p) === 'full' && p.replacementDraft ? <button className="btn primary" onClick={() => setTab('lint')}>전부개정 본문 점검하기</button> : <ArticlesTab />}</>}
            {tab === 'lint' && (enactIncomplete ? <div className="panel empty">조문 체계를 확정하고 모든 조의 본문을 작성하면 점검할 수 있습니다.<p><button className="btn" onClick={() => setTab('articles')}>조문 이어 쓰기</button></p></div> : <LintTab />)}
            {tab === 'lint' && !enactIncomplete && <AuthorityPanel />}
            {tab === 'lint' && !enactIncomplete && <LinkedRegulationsPanel />}
            {tab === 'docs' && (enactWithoutStructure ? <div className="panel empty">먼저 조문 제목과 순서를 정해 주세요. 체계를 확정하면 작성 중인 내용도 검토용 초안으로 받을 수 있습니다.<p><button className="btn" onClick={() => setTab('articles')}>조문 체계 정하기</button></p></div> : <DocsTab />)}
          </main>
          <div className="no-print"><KnowledgePanel records={p.knowledge} question={p.intent} kind={p.kind} document={enact ? (enactRule ? renderRule(enactRule) : '') : (d?.fullText ?? p.source.raw)} documentLabel={enact ? '작성한 제정 초안' : '현재 수락한 변경을 반영한 본문'} onReview={openReview} reviewDisabled={running} /><LogPanel p={p} canCompare={!enact && !running && ops.length > 0} onCompare={doCompare} onEvidence={setEv} /></div>
        </div>
      </div>
      {ev && <EvidenceDrawer ev={ev} onClose={() => setEv(null)} />}
      {cmp && (
        <CompareModal
          p={p}
          mine={ops.filter((o) => o.provenance !== 'human' && o.provenance !== 'engine')}
          other={cmp}
          onClose={() => setCmp(null)}
          onAdopt={(o) => { update((q) => ({ ...q, spec: { ...q.spec, ops: [...q.spec.ops, { ...o, id: `${o.id}-b`, status: 'proposed' }] } })); toast('다른 AI의 제안을 가져왔습니다. 조문 탭에서 수락하세요.'); }}
        />
      )}
      {toastMsg && (
        <div className="toast" role="status">
          {toastMsg.msg}
          {toastMsg.undo && <button onClick={() => { toastMsg.undo?.(); setToast(null); }}>되돌리기</button>}
        </div>
      )}
      <span className="sr" aria-live="polite">{running ? '작업 중' : ''}</span>
      <div style={{ height: 120 }} aria-hidden="true" />
      {brief && <JomokiCompanion brief={brief} reaction={reaction} onAction={companionAction} stage={tab} mode={p.mode} kind={p.kind} kindLabel={RULE_KIND_LABEL[p.kind]} storageKey={`jj:companion:${p.id}`}
        getDocument={() => (enact ? (enactRule ? renderRule(enactRule) : '') : (d?.fullText ?? p.source.raw))} />}
    </Ctx.Provider>
  );
}

export default function Page() {
  return (
    <Suspense fallback={null}>
      <Workroom />
    </Suspense>
  );
}
