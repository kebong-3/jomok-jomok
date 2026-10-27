'use client';
import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Header from '@/components/Header';
import Jomoki from '@/components/Jomoki';
import SourceReview from '@/components/SourceReview';
import SimilarRules from '@/components/SimilarRules';
import type { SimilarRuleReference } from '@/lib/similar-rules';
import { mergePeerEvidence, peerReferenceEvidence, referenceBody } from '@/lib/reference-evidence';
import { readOrdinanceHandoff } from '@/lib/ordinance-history';
import { SAMPLES } from '@/data/samples';
import { isStatuteKind, RULE_KIND_LABEL, RULE_KINDS, type RuleKind } from '@/engine';
import { availableProfiles, profileById, snapshotProfile, type Profile } from '@/config/profiles';
import { emptySpec, newId, saveProject, sha256, type Project } from '@/lib/project';
import { initialLog } from '@/lib/pipeline';
import { loadSettings, saveSettings } from '@/lib/settings';
import { originalSampleId } from '@/lib/sample-mode';
import { startPilot } from '@/lib/evaluation';
import { extractHwpx, extractTxt, reviewSource, sourceReviewGate, type SourceIssue, type SourcePosition } from '@/lib/source-review';
import type { Evidence } from '@/lib/project';
import { AMENDMENT_LABELS, methodSuggestion, type AmendmentKind } from '@/lib/amendment-method';
import JomokiCompanion from '@/components/companion/JomokiCompanion';
import { startBrief, type CompanionActionId } from '@/lib/companion';

const KINDS: RuleKind[] = [...RULE_KINDS];
/** 규정 종류를 기관 유형별로 묶어 고르기 쉽게 한다. */
const KIND_GROUPS: { label: string; kinds: RuleKind[] }[] = [
  { label: '자치법규', kinds: ['ordinance', 'rule'] },
  { label: '행정규칙', kinds: ['directive', 'established_rule', 'notice', 'guideline'] },
  { label: '공공기관', kinds: ['bylaw'] },
  { label: '국가 법령', kinds: ['act', 'decree', 'ministry_rule'] },
];
function KindSelect({ value, onChange, label }: { value: RuleKind; onChange: (kind: RuleKind) => void; label?: string }) {
  return <select className="field" value={value} onChange={(e) => onChange(e.target.value as RuleKind)} aria-label={label}>
    {KIND_GROUPS.map(g => <optgroup key={g.label} label={g.label}>{g.kinds.map(k => <option key={k} value={k}>{RULE_KIND_LABEL[k]}</option>)}</optgroup>)}
  </select>;
}
const REASONS = ['상위법 개정 반영', '기관·부서 명칭 변경', '금액·기준 변경', '조문 신설', '용어 정비', '위원회 구성 변경'];

function StartInner() {
  const sp = useSearchParams();
  const router = useRouter();
  const pageOpenedAt = useRef(Date.now());
  const sample = SAMPLES.find((s) => s.id === sp.get('sample'));
  const mode: 'amend' | 'enact' = sample?.mode ?? (sp.get('mode') === 'enact' ? 'enact' : 'amend');
  const [src, setSrc] = useState<'sample' | 'paste' | 'law' | 'file'>(sample ? 'sample' : 'law');
  const [raw, setRaw] = useState(sample?.text ?? '');
  const [kind, setKind] = useState<RuleKind>(sample?.kind ?? 'ordinance');
  const [intent, setIntent] = useState(sample?.intent ?? (sp.get('hint') === 'upper' ? '「○○법」 제○조가 바뀌어 우리 규정의 ' : ''));
  const [amendmentMethod, setAmendmentMethod] = useState<AmendmentKind>('partial');
  const [purpose, setPurpose] = useState(sample?.purpose ?? '');
  const [title, setTitle] = useState(sample?.mode === 'enact' ? '' : '');
  const [upper, setUpper] = useState(sample?.upperLaw ?? '');
  const [delegationRaw, setDelegationRaw] = useState('');
  const [peerEvidence, setPeerEvidence] = useState<Evidence[]>([]);
  const peerEvidenceRef = useRef<Evidence[]>([]);
  const [initialReferences, setInitialReferences] = useState<SimilarRuleReference[]>([]);
  const [historyNote, setHistoryNote] = useState('');
  const [profileId, setProfileId] = useState(sample?.profileId ?? 'hanbit-city');
  const [profiles, setProfiles] = useState<Profile[]>(() => availableProfiles());
  const [q, setQ] = useState('');
  const [lawKind, setLawKind] = useState<'ordin' | 'admrul' | 'law'>('ordin');
  const [hits, setHits] = useState<{ id: string; title: string; org?: string; effectiveAt?: string }[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchNote, setSearchNote] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [unsure, setUnsure] = useState(false);
  const [origin, setOrigin] = useState<{ raw: string; type: 'law' | 'file'; name: string; evidence?: Evidence; issues?: SourceIssue[]; positions?: SourcePosition[] } | null>(null);
  const [sourceConfirmed, setSourceConfirmed] = useState(false);
  const [recordTime, setRecordTime] = useState(false);

  useEffect(() => {
    const settings = loadSettings();
    setProfiles(availableProfiles(settings.customProfiles));
    // 예시는 전제한 가상 기관으로 시작한다(국가 법령 예시 → 한빛부).
    setProfileId(sample?.profileId ?? settings.profileId);
  }, [sample?.profileId]);

  useEffect(() => {
    if (sp.get('from') !== 'law') return;
    let active = true;
    const handoff = readOrdinanceHandoff(mode);
    if (!handoff) { setErr('조례 조사 내용의 전달 시간이 지났거나 보관 정보를 읽지 못했습니다. 조례 조사에서 다시 가져와 주세요.'); return; }
    // Preserve the purpose already typed before visiting the research page.
    // Never restore an old source as a newly verified current ordinance.
    try {
      const saved = sessionStorage.getItem('jj:start:research-draft');
      const draft = saved && saved.length <= 120000 ? JSON.parse(saved) : null;
      if (draft?.mode === mode && typeof draft.createdAt === 'number' && Date.now() - draft.createdAt >= 0 && Date.now() - draft.createdAt < 15 * 60 * 1000) {
        const setters = { title: setTitle, purpose: setPurpose, intent: setIntent, upper: setUpper, delegationRaw: setDelegationRaw };
        for (const [key, setter] of Object.entries(setters)) if (typeof draft[key] === 'string' && draft[key].length <= 20000) setter(draft[key]);
        if (KINDS.includes(draft.kind)) setKind(draft.kind);
        if (['partial', 'full', 'repeal'].includes(draft.amendmentMethod)) setAmendmentMethod(draft.amendmentMethod);
      }
    } catch { /* Research sources still load if a previous draft cannot be read. */ }
    void (async () => {
      const peers = await Promise.all(handoff.references.map(peerReferenceEvidence));
      let imported: { raw: string; evidence: Evidence; name: string; issues: SourceIssue[] } | undefined;
      if (handoff.source && mode === 'amend') {
        const { doc, meta } = handoff.source;
        const text = referenceBody(doc);
        imported = { raw: text, name: doc.title,
          issues: [{ code: 'LAW_PARTIAL', severity: 'warning', message: '공식 API에서 조회한 조문 본문입니다. 현행 여부와 부칙·별표·별지 누락을 원문에서 확인해 주세요.', location: `「${doc.title}」 조회 원문`, excerpt: text.slice(0, 220) }],
          evidence: { id: 'EV-SOURCE', kind: 'rule', label: `「${doc.title}」 원문`, text, url: doc.url, via: meta.via, lawId: doc.id, lawKind: doc.kind, effectiveAt: doc.effectiveAt, fetchedAt: meta.fetchedAt, date: meta.fetchedAt.slice(0, 10), contentHash: await sha256(text), partial: true, note: meta.note },
        };
      }
      if (!active) return;
      peerEvidenceRef.current = peers;
      setPeerEvidence(peers); setInitialReferences(handoff.references); setHistoryNote(handoff.historyNote);
      if (imported) {
        setRaw(imported.raw); setSrc('paste'); setKind(/규칙/.test(imported.name) ? 'rule' : 'ordinance');
        setOrigin({ ...imported, type: 'law' }); setSourceConfirmed(false);
      }
    })().catch(error => { if (active) setErr(error instanceof Error ? error.message : '조례 조사 내용을 가져오지 못했습니다.'); });
    return () => { active = false; };
  }, [sp, mode]);

  const sourceReview = useMemo(() => (mode === 'amend' && raw.trim() ? reviewSource(raw, kind, origin?.issues, origin?.raw === raw ? origin.positions : undefined) : null), [raw, kind, mode, origin]);
  const parsed = sourceReview?.rule;

  function changeRaw(value: string) {
    setRaw(value);
    setSourceConfirmed(false);
    setErr('');
  }

  function changeKind(value: RuleKind) {
    setKind(value);
    setSourceConfirmed(false);
    setErr('');
  }

  async function usePeers(references: SimilarRuleReference[]) {
    const added = await Promise.all(references.map(peerReferenceEvidence));
    const merged = mergePeerEvidence(peerEvidenceRef.current, added);
    peerEvidenceRef.current = merged; setPeerEvidence(merged);
  }

  function removePeer(id: string) {
    const next = peerEvidenceRef.current.filter(item => item.id !== id);
    peerEvidenceRef.current = next; setPeerEvidence(next);
  }

  function saveResearchDraft() {
    try { sessionStorage.setItem('jj:start:research-draft', JSON.stringify({ mode, title, purpose, intent, upper, delegationRaw, kind, amendmentMethod, createdAt: Date.now() })); }
    catch { /* A fresh research page remains available when storage is full. */ }
  }

  async function search() {
    if (!q.trim()) return;
    setSearching(true);
    setSearchNote('');
    try {
      const r = await fetch(`/api/law/search?kind=${lawKind}&q=${encodeURIComponent(q)}`).then((x) => x.json());
      setHits(r.items ?? []);
      if (r.meta?.via === 'snapshot') setSearchNote('법제처에 연결하지 못해 저장본에서 찾았습니다. 저장본에는 일부 법령만 있습니다. 붙여넣기로도 할 수 있어요.');
    } catch {
      setHits([]);
      setSearchNote('법제처 연결이 잠시 원활하지 않습니다. 붙여넣기나 파일로 계속하세요.');
    } finally {
      setSearching(false);
    }
  }

  async function pick(h: { id: string; title: string }) {
    const requestedKind = lawKind;
    setErr('');
    try {
      const r = await fetch(`/api/law/text?kind=${requestedKind}&id=${encodeURIComponent(h.id)}&title=${encodeURIComponent(h.title)}`).then((x) => x.json());
      if (!r.doc?.articles?.length) throw new Error(r.error?.message ?? '조문이 없습니다.');
      const doc = r.doc;
      const text = [doc.title, ...doc.articles.map((a: { label: string; title: string; text: string }) => `${a.label}${a.title ? `(${a.title})` : ''} ${a.text}`)].join('\n');
      const contentHash = await sha256(text);
      changeRaw(text);
      setSrc('paste');
      const issues: SourceIssue[] = r.meta?.partial ? [{ code: 'LAW_PARTIAL', message: r.meta.note ?? '조회한 조문은 발췌본입니다. 부칙·별표·서식과 현행 여부를 공식 원문에서 확인해 주세요.', location: `「${doc.title}」 조회 원문`, severity: 'warning', excerpt: text.slice(0, 220) }] : [];
      setOrigin({ raw: text, type: 'law', name: doc.title, issues, evidence: {
        id: 'EV-SOURCE', kind: 'rule', label: `「${doc.title}」 원문`, text, url: doc.url,
        via: r.meta?.via ?? 'live', date: r.meta?.snapshotDate ?? r.meta?.fetchedAt?.slice(0, 10),
        lawId: doc.id ?? h.id, lawKind: doc.kind ?? requestedKind, effectiveAt: doc.effectiveAt,
        fetchedAt: r.meta?.fetchedAt, contentHash, partial: r.meta?.partial, note: r.meta?.note,
      } });
      if (requestedKind === 'ordin') changeKind(/규칙/.test(doc.title) ? 'rule' : 'ordinance');
      if (requestedKind === 'admrul') changeKind(/예규/.test(doc.title) ? 'established_rule' : /고시/.test(doc.title) ? 'notice' : 'directive');
      if (requestedKind === 'law') changeKind(/시행규칙$/.test(doc.title.trim()) ? 'ministry_rule' : /시행령$|규정$|령$/.test(doc.title.trim()) ? 'decree' : 'act'); // 제명만으로 확정할 수 없으므로 화면의 규정 종류에서 다시 확인
    } catch {
      setErr('원문을 가져오지 못했습니다. 붙여넣기로 계속하세요.');
    }
  }

  async function onFile(f: File) {
    setErr('');
    if (f.size > 10 * 1024 * 1024) { setErr('파일은 10MB 이하로 올려 주세요. 큰 파일은 필요한 규정만 따로 저장해 주세요.'); return; }
    if (/\.hwp$/i.test(f.name)) {
      setErr("HWP는 읽을 수 없습니다. 한글에서 '다른 이름으로 저장 → HWPX'로 바꾸어 올려 주세요.");
      return;
    }
    if (!/\.(?:hwpx|txt)$/i.test(f.name)) { setErr('HWPX 또는 TXT 파일을 올려 주세요.'); return; }
    try {
      const buffer = await f.arrayBuffer();
      const extracted = /\.hwpx$/i.test(f.name) ? extractHwpx(buffer) : extractTxt(buffer);
      changeRaw(extracted.text);
      setSrc('paste');
      setOrigin({ raw: extracted.text, type: 'file', name: f.name, issues: extracted.issues, positions: extracted.positions });
    } catch (error) {
      setErr(error instanceof Error ? error.message : '파일을 읽지 못했습니다. 내용을 복사해 붙여넣어 주세요.');
    }
  }

  async function startWork() {
    setErr('');
    if (mode === 'amend') {
      if (!parsed || !parsed.articles.length) return setErr('조문을 찾지 못했습니다. "제1조(목적) …" 형태의 규정 원문을 넣어 주세요.');
      const gate = sourceReviewGate(sourceReview!.issues, sourceConfirmed);
      if (!gate.allowed) return setErr(gate.message!);
      if (!intent.trim() || intent.trim().length < 6) return setErr('바꾸고 싶은 내용을 한 줄 이상 적어 주세요.');
    } else if (!purpose.trim()) return setErr('이 규정으로 무엇을 하려는지 적어 주세요.');
    setBusy(true);
    const s = loadSettings();
    const selectedProfile = profiles.find(profile => profile.id === profileId) ?? profileById(profileId, s.customProfiles);
    saveSettings({ ...s, profileId: selectedProfile.id });
    const sourceHash = mode === 'amend' ? await sha256(raw) : '';
    const delegation = delegationRaw.trim();
    const providedEvidence: Evidence[] = delegation ? [{ id: 'EV-DELEGATION', kind: 'user', label: `사용자 제공 위임 조항${upper.trim() ? `: ${upper.trim()}` : ''}`, text: delegation, via: 'user', fetchedAt: new Date().toISOString(), contentHash: await sha256(delegation), partial: true, note: '사용자가 입력한 조항입니다. 현행 여부·적용 대상·위임 범위를 공식 원문과 대조해야 합니다.' }] : [];
    const historyEvidence: Evidence[] = historyNote ? [{ id: 'EV-HISTORY', kind: 'user', label: '5개년 자치법규 제·개정 조사 기록', text: historyNote, via: 'user', fetchedAt: new Date().toISOString(), contentHash: await sha256(historyNote), partial: true, note: '공포연도별 조회 기록을 작업에 전달한 참고 메모입니다. 현행 조문이나 위임 근거를 대신하지 않습니다.' }] : [];
    const p: Project = {
      id: newId(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      mode,
      ...(mode === 'amend' && amendmentMethod !== 'partial' ? { amendmentKind: amendmentMethod } : {}),
      sampleId: delegation || peerEvidence.length || amendmentMethod !== 'partial' ? undefined : originalSampleId(sample, { raw, intent, purpose, upper, kind, title, profileId: selectedProfile.id }),
      title: mode === 'amend' ? parsed!.title : title.trim() || `${selectedProfile.name} 새 규정`,
      kind,
      profileId: selectedProfile.id,
      profileSnapshot: snapshotProfile(selectedProfile),
      source: { type: origin?.raw === raw ? origin.type : src === 'sample' ? 'sample' : src, raw: mode === 'amend' ? raw : '', hash: sourceHash, name: origin?.raw === raw ? origin.name : undefined },
      sourceReview: mode === 'amend' && sourceReview ? { hash: sourceHash, issues: sourceReview.issues, confirmedAt: sourceReview.issues.length && sourceConfirmed ? Date.now() : undefined } : undefined,
      evaluation: recordTime ? startPilot(pageOpenedAt.current) : undefined,
      intent: mode === 'amend' ? intent.trim() : purpose.trim(),
      purpose: mode === 'enact' ? purpose.trim() : undefined,
      upperLaw: upper.trim().replace(/[「」]/g, '') || undefined,
      spec: emptySpec(),
      excludedFixes: [],
      evidence: [...(origin?.raw === raw && origin.evidence ? [origin.evidence] : []), ...providedEvidence, ...peerEvidence, ...historyEvidence],
      log: initialLog(mode),
    };
    if (!(await saveProject(p))) { setErr('브라우저 저장소에 작업을 저장하지 못했습니다. 저장소 사용을 허용한 창에서 다시 시도하세요.'); setBusy(false); return; }
    router.push(`/work/${p.id}?run=1`);
  }

  const statuteMismatch = isStatuteKind(kind) && profiles.find(item => item.id === profileId)?.type !== 'central';
  const companion = startBrief({
    mode, sample: !!sample, hasSource: !!raw.trim(), title: parsed?.title, articles: parsed?.articles.length ?? 0, annexes: parsed?.annexes.length ?? 0,
    sourceIssues: sourceReview?.issues.length ?? 0, sourceConfirmed, intentLength: intent.trim().length, purposeLength: purpose.trim().length,
    kindLabel: RULE_KIND_LABEL[kind], statuteMismatch, peers: peerEvidence.length,
  });
  const focusStep = (id: string) => {
    const section = document.getElementById(id)?.closest('section');
    section?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    const field = section?.querySelector<HTMLElement>('textarea, input:not([type=checkbox]):not([type=radio]):not([type=file])');
    window.setTimeout(() => field?.focus({ preventScroll: true }), 350);
  };
  const companionAction = (action: CompanionActionId) => {
    if (action === 'focus-source') focusStep('s1');
    else if (action === 'focus-intent') focusStep('s2');
    else if (action === 'start-work') void startWork();
  };
  const n = (i: number) => <span className="step-n" aria-hidden>{i}</span>;

  return (
    <>
      <Header />
      <main className="start">
        <div className="start-companion"><Jomoki size={82} mood={busy ? 'thinking' : err ? 'care' : 'wave'} /><div><span>한 조씩, 차근차근 함께해요</span><h1>{mode === 'amend' ? '기존 규정 고치기' : '새 규정 만들기'}</h1><p className="sub">{sample ? '예시가 채워져 있어요. 내용을 살펴보고 작업을 시작해 볼까요?' : mode === 'enact' ? '만들려는 목적과 근거를 알려 주세요. 조목이가 초안 준비를 도와드릴게요.' : '현재 규정과 바꾸려는 내용을 알려 주세요. 조목이가 수정할 곳을 함께 살펴볼게요.'}</p></div></div>
        {historyNote && <div className="panel panel-b" role="status" style={{ marginBottom: 20 }}><b>조례 조사 내용을 가져왔어요.</b><p className="help">{mode === 'amend' ? '현행 원문을 불러왔습니다. 무엇을 바꿀지 적고 원문 확인 후 시작하세요.' : `참고 조례 ${peerEvidence.length}개를 연결했습니다. 우리 기관의 제정 목적과 위임 근거를 채워 주세요.`}</p><details><summary>함께 보관할 조사 기록</summary><p className="help" style={{ whiteSpace: 'pre-wrap' }}>{historyNote}</p></details></div>}

        {mode === 'amend' ? (
          <section className="step" aria-labelledby="s1">
            <div className="step-h">{n(1)}<h2 id="s1">어떤 규정을 고치시나요?</h2></div>
            <div className="tabs-s" role="group" aria-label="규정 불러오는 방법">
              {sample && <button aria-pressed={src === 'sample'} onClick={() => { setSrc('sample'); changeRaw(sample.text); setOrigin(null); }}>예시 규정</button>}
              <button aria-pressed={src === 'law'} onClick={() => setSrc('law')}>법제처에서 찾기</button>
              <button aria-pressed={src === 'paste'} onClick={() => setSrc('paste')}>붙여넣기</button>
              <button aria-pressed={src === 'file'} onClick={() => setSrc('file')}>파일 올리기(HWPX·TXT)</button>
            </div>
            {src === 'law' && (
              <div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <select className="field" style={{ width: 160 }} value={lawKind} onChange={(e) => setLawKind(e.target.value as typeof lawKind)} aria-label="종류">
                    <option value="ordin">자치법규</option>
                    <option value="admrul">행정규칙</option>
                    <option value="law">법령</option>
                  </select>
                  <input className="field" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && search()} placeholder="예) 서구 공무원 여비 조례" aria-label="검색어" />
                  <button className="btn" onClick={search} disabled={searching}>{searching ? '찾는 중…' : '찾기'}</button>
                </div>
                {searchNote && <p className="help">{searchNote}</p>}
                {!hits && !raw && <p className="help">규정 이름 일부만 넣어도 찾아요. 고른 규정의 현행 원문을 바로 불러옵니다.</p>}
                {hits && (hits.length ? (
                  <div className="results">
                    {hits.map((h) => (
                      <label key={h.id}><input type="radio" name="hit" onChange={() => pick(h)} /> <span><b>{h.title}</b> <span className="help" style={{ display: 'inline' }}>{h.org} {h.effectiveAt && `· 시행 ${h.effectiveAt}`}</span></span></label>
                    ))}
                  </div>
                ) : <p className="help">찾은 규정이 없습니다. 띄어쓰기를 바꾸거나 붙여넣기로 계속하세요.</p>)}
              </div>
            )}
            {src === 'file' && (
              <div>
                <input type="file" accept=".hwpx,.txt,.hwp" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} aria-label="규정 파일" />
                <p className="help">추출한 텍스트는 원문으로 보관하고, 고친 내용은 따로 만듭니다. HWPX의 표 배치·서식·그림은 원본 파일에서 함께 확인해 주세요.</p>
              </div>
            )}
            {(src === 'paste' || src === 'sample') && (
              <>
                <textarea className="field mono" value={raw} onChange={(e) => { changeRaw(e.target.value); if (src === 'sample') setSrc('paste'); }} placeholder={'규정 제목\n제1조(목적) 이 규칙은 …\n제2조(정의) …'} aria-label="규정 원문" />
                <p className="help">🔒 개인정보·민감자료는 넣지 마세요. 원본은 고치지 않고 따로 보관합니다.</p>
              </>
            )}
            {sourceReview && <SourceReview review={sourceReview} confirmed={sourceConfirmed} onConfirm={(confirmed) => { setSourceConfirmed(confirmed); setErr(''); }} />}
            <div className="grid2" style={{ marginTop: 14 }}>
              <label>
                <span className="help" style={{ display: 'block', margin: '0 0 4px' }}>규정 종류</span>
                <KindSelect value={kind} onChange={changeKind} label="규정 종류" />
              </label>
              <label>
                <span className="help" style={{ display: 'block', margin: '0 0 4px' }}>우리 기관(절차·서식 기준)</span>
                <select className="field" value={profileId} onChange={(e) => setProfileId(e.target.value)}>
                  {profiles.map((p) => <option key={p.id} value={p.id}>{p.name} · {p.typeLabel}</option>)}
                </select>
              </label>
            </div>
            {statuteMismatch && <p className="help" role="note">국가 법령은 중앙행정기관 설정(예: 한빛부)을 고르면 입법예고 40일·법제처 심사 등 정부입법 절차로 안내해요.</p>}
          </section>
        ) : (
          <section className="step" aria-labelledby="s1">
            <div className="step-h">{n(1)}<h2 id="s1">어떤 종류의 규정을 만드시나요?</h2></div>
            <div className="kind-groups" role="group" aria-label="규정 종류">
              {KIND_GROUPS.map(g => <div key={g.label} className="kind-group"><span>{g.label}</span><div className="tabs-s">{g.kinds.map((k) => <button key={k} aria-pressed={kind === k} onClick={() => setKind(k)}>{RULE_KIND_LABEL[k]}</button>)}</div></div>)}
              <button className="kind-unsure" aria-pressed={unsure} onClick={() => setUnsure((v) => !v)}>잘 모르겠어요</button>
            </div>
            {unsure && (
              <div className="panel panel-b" style={{ marginBottom: 12 }}>
                <p style={{ margin: '0 0 8px' }}>의회(지방의회) 의결을 거쳐야 하나요?</p>
                <div className="chips" style={{ marginTop: 0 }}>
                  <button onClick={() => { setKind('ordinance'); setUnsure(false); }}>예 → 조례</button>
                  <button onClick={() => { setKind('rule'); setUnsure(false); }}>법령·조례가 단체장 규칙에 위임 → 규칙 검토</button>
                  <button onClick={() => { setKind('guideline'); setUnsure(false); }}>아니요, 공무원 내부에만 → 훈령·예규·지침</button>
                  <button onClick={() => { setKind('decree'); setUnsure(false); }}>중앙부처 법령 → 법률·시행령·시행규칙</button>
                </div>
                <p className="help">주민에게 적용된다는 사정만으로 규칙을 선택할 수는 없습니다. 자치사무 여부, 위임 조항과 발령권자를 확인하고 법무 담당자와 종류를 확정하세요.</p>
              </div>
            )}
            <input className="field" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="규정 이름(가제, 비워 두면 조목조목이 제안)" aria-label="규정 이름" />
            <label style={{ display: 'block', marginTop: 12 }}>
              <span className="help" style={{ display: 'block', margin: '0 0 4px' }}>우리 기관(절차·서식 기준)</span>
              <select className="field" value={profileId} onChange={(e) => setProfileId(e.target.value)} aria-label="우리 기관">
                {profiles.map((p) => <option key={p.id} value={p.id}>{p.name} · {p.typeLabel}</option>)}
              </select>
            </label>
            {statuteMismatch && <p className="help" role="note">국가 법령은 중앙행정기관 설정(예: 한빛부)을 고르면 입법예고 40일·법제처 심사 등 정부입법 절차로 안내해요.</p>}
          </section>
        )}

        <section className="step" aria-labelledby="s2">
          <div className="step-h">{n(2)}<h2 id="s2">{mode === 'amend' ? '무엇을 바꾸고 싶으세요?' : '이 규정으로 무엇을 하려고 하시나요?'}</h2></div>
          {mode === 'amend' ? (
            <>
              <label>작업 방식<select className="field" aria-label="개정 또는 폐지 방식" value={amendmentMethod} onChange={event => setAmendmentMethod(event.target.value as AmendmentKind)}>{Object.entries(AMENDMENT_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
              <p className="help">{methodSuggestion(intent).reason} 전부개정·폐지는 종전 부칙과 진행 중인 업무를 별도로 검토합니다.</p>
              <textarea className="field" value={intent} onChange={(e) => setIntent(e.target.value)} placeholder="평소 말하듯 적어 주세요. 예) 제5조 위원 수를 10명에서 15명으로 늘리고, 위원 임기 연임 제한 조항을 새로 넣고 싶어요." aria-label="개정 의도" />
              <div className="chips" aria-label="자주 쓰는 이유">
                {REASONS.map((r) => <button key={r} onClick={() => setIntent((v) => (v ? `${v} (${r})` : `${r}: `))}>{r}</button>)}
              </div>
            </>
          ) : (
            <textarea className="field" value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="예) 공공시설의 남는 공간을 시민이 회의 장소로 쓸 수 있게 개방 절차와 사용료 감면 기준을 정하고 싶어요." aria-label="제정 목적" />
          )}
          <input className="field" style={{ marginTop: 12 }} value={upper} onChange={(e) => setUpper(e.target.value)} placeholder="근거가 되는 상위 법령(선택) 예) 공유재산 및 물품 관리법" aria-label="근거 법령" />
          <p className="help">상위 법령은 법제처에서 원문을 찾아 근거로 붙입니다. 비워 두면 규정 안의 「」 법령명을 씁니다.</p>
          <details open={mode === 'enact' || !!delegationRaw || peerEvidence.length > 0} style={{ marginTop: 14 }}>
            <summary>위임 조항 원문 넣기 · 유사 규정 참고 <span className="help" style={{ display: 'inline' }}>(선택{peerEvidence.length ? ` · 연결 ${peerEvidence.length}개` : ''})</span></summary>
            <label style={{ display: 'block', marginTop: 12 }}>위임 조항 원문(선택)
              <textarea className="field" value={delegationRaw} maxLength={6000} onChange={event => setDelegationRaw(event.target.value)} placeholder="법령명·조 번호와 위임 조항 원문을 함께 넣으세요. 예: ○○법 제○조 ..." />
            </label>
            <p className="help">최대 6,000자. 사용자 제공 근거로 보관합니다. 입력 사실만으로 현행 법령이나 위임 범위가 검증되지는 않습니다.</p>
            <p className="help"><a href="/law" onClick={saveResearchDraft}>최근 5개년 제·개정부터 조사하기 →</a> · 공포연도별 변경을 확인하고 선택한 조례를 가져올 수 있어요.</p>
            <SimilarRules initialQuery={title || parsed?.title || ''} initialReferences={initialReferences} initialKind={kind === 'ordinance' || kind === 'rule' ? 'ordin' : 'admrul'} onUseReference={reference => usePeers([reference])} onUseReferences={usePeers} />
            {peerEvidence.length > 0 && <div aria-live="polite"><p className="help">이 작업에 유사 규정 {peerEvidence.length}/4개를 참고자료로 연결했습니다.</p>{peerEvidence.map(item => <p key={item.id}>{item.label} <button className="btn small" onClick={() => removePeer(item.id)}>참고 해제</button></p>)}</div>}
          </details>
        </section>

        <section className="step" aria-labelledby="s3">
          <div className="step-h">{n(3)}<h2 id="s3">이렇게 진행할게요</h2></div>
          <dl className="kv">
            <dt>규정</dt><dd>{mode === 'amend' ? parsed?.title ?? '—' : title || '(이름은 조목조목이 제안)'} ({RULE_KIND_LABEL[kind]})</dd>
            <dt>방식</dt><dd>{mode === 'amend' ? `${AMENDMENT_LABELS[amendmentMethod]} — 작업 화면에서 본문·종전 부칙·적용 관계를 확인합니다. 변경 비율만으로 방식을 확정하지 않습니다.` : '제정 — 조문 체계(목차)를 먼저 확정한 뒤 조문을 씁니다'}</dd>
            <dt>기관</dt><dd>{profiles.find((p) => p.id === profileId)?.name}</dd>
            <dt>할 일</dt><dd>{mode === 'amend' ? '원문 불러오기 → 근거 법령 찾기 → 고칠 곳 정하기 → 연결된 곳 정리 → 형식 점검 → 문서 세트 → 절차·일정' : '근거 법령 찾기 → 조문 체계 제안 → (확정) → 조문 초안 → 형식 점검 → 문서 세트 → 절차·일정'}</dd>
          </dl>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 18 }}>
            <input type="checkbox" checked={recordTime} onChange={(event) => setRecordTime(event.target.checked)} />
            <span>이 작업의 사용시간도 기록하기</span>
          </label>
          <p className="help">이 화면을 연 때부터 측정하며 작업 화면에서 일시정지·종료할 수 있습니다.</p>
          {err && <p className="err" role="alert">{err}</p>}
          <div className="row-end">
            <button className="btn primary big" onClick={startWork} disabled={busy}>{busy ? '준비 중…' : '조목이와 작업 시작 →'}</button>
          </div>
        </section>
        <div style={{ height: 110 }} aria-hidden="true" />
      </main>
      <JomokiCompanion brief={companion} onAction={companionAction} stage="start" mode={mode} kind={kind} kindLabel={RULE_KIND_LABEL[kind]} getDocument={() => (mode === 'amend' ? raw : purpose)} />
    </>
  );
}

export default function Start() {
  return (
    <Suspense>
      <StartInner />
    </Suspense>
  );
}
