'use client';

import { useMemo, useRef, useState } from 'react';
import KnowledgeWorkbench from '@/components/KnowledgeWorkbench';
import Jomoki from '@/components/Jomoki';
import { mergeKnowledge } from '@/lib/knowledge';
import { newId } from '@/lib/project';
import { applyReviewSelection, REVIEW_DOCUMENT_LIMIT, reviewChangeStates, reviewDocument, reviewDraft, reviewDraftHash, undoReviewApplication, workReviewSessionSchema, type KnowledgeAssistRequest, type KnowledgeAssistResult, type ReviewApplyResult, type ReviewStage, type WorkReviewSession } from '@/lib/work-review';
import { useWork } from './ctx';
import styles from './WorkReview.module.css';

const STAGES: Record<ReviewStage, { label: string; question: string }> = {
  articles: { label: '조문 작성', question: '현재 조문 초안의 권한·위임 범위, 권리·의무와 조문 체계를 검토해 주세요. 수정할 문장이 있으면 현재 본문을 그대로 인용하고 바꿀 문장을 함께 제시해 주세요.' },
  lint: { label: '오류·영향 점검', question: '현재 조문의 인용, 용어, 요건과 예외, 경과조치 사이에 충돌이나 누락이 있는지 검토해 주세요. 근거를 확인할 수 있는 문장만 정비안으로 제시해 주세요.' },
  docs: { label: '문서 준비', question: '문서를 준비하기 전에 조문과 부칙에서 마지막으로 확인할 사항을 검토해 주세요. 필요한 경우 현재 문장과 수정 제안을 나란히 제시하고, 별도 협의·확인 사항을 구분해 주세요.' },
};

/** Stays in the active project and applies only explicitly selected exact edits. */
export default function WorkReview({ stage, onClose }: { stage: ReviewStage; onClose?: () => void }) {
  const { p, update, toast } = useWork();
  const draft = useMemo(() => reviewDraft(p), [p]);
  const saved = p.workReview?.stage === stage ? p.workReview : undefined;
  const initialScope = () => {
    if (saved) return saved.scope;
    const all = draft.units.map(unit => unit.key);
    return reviewDocument(p, all).length <= REVIEW_DOCUMENT_LIMIT ? all : all.slice(0, 1);
  };
  const [scope, setScope] = useState<string[]>(initialScope);
  const [loadedHash, setLoadedHash] = useState(saved?.snapshotHash ?? reviewDraftHash(p));
  const [loadedDocument, setLoadedDocument] = useState(() => saved?.request.document ?? reviewDocument(p, initialScope()));
  const [question, setQuestion] = useState(() => saved?.request.question ?? `${(p.purpose || p.intent || '').slice(0, 900)}\n\n${STAGES[stage].question}`.trim());
  const [activeId, setActiveId] = useState<string | null>(saved?.id ?? null);
  const [workbenchKey, setWorkbenchKey] = useState(0);
  const [status, setStatus] = useState('');
  const [applying, setApplying] = useState(false);
  const pending = useRef<{ id: string; hash: string; scope: string[]; createdAt: number } | null>(null);
  const session = p.workReview?.id === activeId ? p.workReview : undefined;
  const states = session ? reviewChangeStates(p, session) : [];
  const selected = session?.selected ?? [];
  const currentHash = reviewDraftHash(p);
  const changed = currentHash !== loadedHash;
  const hasApplication = !!session?.application && !session.application.undoneAt;
  const applicationCurrent = hasApplication && session?.application?.afterHash === currentHash;
  const changedAfterApplication = hasApplication && !applicationCurrent;
  const tooLong = loadedDocument.length > REVIEW_DOCUMENT_LIMIT;
  const hasBody = draft.units.some(unit => unit.key !== 'addenda');
  const running = p.log.some(log => log.status === 'running');
  const disabledReason = running ? '초안 작성을 마친 뒤 현재 본문으로 검토해 주세요.' : changed ? '검토할 본문이 바뀌었습니다. 위의 ‘현재 초안 새로 불러오기’를 눌러 주세요.' : !scope.length || !hasBody ? '검토할 조문을 먼저 작성하거나 선택해 주세요.' : tooLong ? `선택한 본문이 ${REVIEW_DOCUMENT_LIMIT.toLocaleString('ko-KR')}자를 넘습니다. 아래 조문 범위를 줄여 주세요.` : undefined;

  const loadCurrent = (nextScope = scope) => {
    const valid = nextScope.filter(key => draft.units.some(unit => unit.key === key));
    setScope(valid); setLoadedHash(reviewDraftHash(p)); setLoadedDocument(reviewDocument(p, valid));
    setQuestion(session?.request.question ?? question); setActiveId(null); setWorkbenchKey(key => key + 1);
    setStatus('선택한 범위의 현재 초안을 불러왔습니다. 질문을 확인한 뒤 검토를 요청하세요.');
  };

  const rememberStart = (request: KnowledgeAssistRequest) => {
    setQuestion(request.question); setStatus('');
    pending.current = { id: newId(), hash: loadedHash, scope: [...scope], createdAt: Date.now() };
  };
  const rememberResult = (result: KnowledgeAssistResult, request: KnowledgeAssistRequest) => {
    const started = pending.current;
    if (!started) return;
    const parsed = workReviewSessionSchema.safeParse({ version: 1, id: started.id, stage, createdAt: started.createdAt, scope: started.scope, snapshotHash: started.hash, request, result, selected: [] });
    if (!parsed.success) { setStatus('검토 결과를 작업 기록으로 보관하지 못했습니다. 출처와 수정 제안을 다시 확인해 주세요.'); return; }
    setActiveId(started.id);
    void Promise.resolve(update(current => ({ ...current, workReview: parsed.data, knowledge: mergeKnowledge(current.knowledge, { ...result.retrieval, role: 'knowledge_work_review' }) }))).then(saved => {
      if (saved === false) setStatus('검토 결과는 화면에 있지만 기기에 저장하지 못했습니다. 작업 보관파일을 받아 주세요.');
    });
  };
  const toggle = (index: number, checked: boolean) => {
    if (!session || !states[index]?.eligible || applying) return;
    void update(current => current.workReview?.id !== session.id ? current : ({ ...current, workReview: { ...current.workReview, selected: checked ? [...new Set([...current.workReview.selected, index])] : current.workReview.selected.filter(value => value !== index) } }));
  };
  const apply = async () => {
    if (!session || applying) return;
    setApplying(true); setStatus('');
    let outcome: ReviewApplyResult | undefined;
    const persisted = await update(current => {
      if (current.workReview?.id !== session.id) { outcome = { project: current, error: '검토 기록이 바뀌었습니다. 현재 결과를 다시 확인해 주세요.', count: 0 }; return current; }
      outcome = applyReviewSelection(current, current.workReview, current.workReview.selected);
      return outcome.project;
    });
    setApplying(false);
    if (!outcome || outcome.error) { setStatus(outcome?.error ?? '수정 반영 결과를 확인하지 못했습니다.'); return; }
    const message = persisted === false ? `선택한 수정 ${outcome.count}건을 화면에 반영했지만 저장하지 못했습니다. 작업 보관파일을 받아 주세요.` : `선택한 수정 ${outcome.count}건을 초안에 반영하고 저장했습니다. 조문·점검·문서에 함께 적용됩니다.`;
    setStatus(message); toast(message);
  };
  const undo = async () => {
    if (applying) return;
    setApplying(true);
    let outcome: ReviewApplyResult | undefined;
    const persisted = await update(current => { outcome = undoReviewApplication(current); return outcome.project; });
    setApplying(false);
    const message = outcome?.error ?? (persisted === false ? '화면의 반영은 되돌렸지만 저장하지 못했습니다. 작업을 보관해 주세요.' : '이번 검토에서 반영한 수정만 되돌렸습니다.');
    setStatus(message); toast(message);
  };

  const changeAction = (index: number) => {
    const state = states[index];
    const applied = session?.application && !session.application.undoneAt && session.application.changes.some(change => change.index === index);
    const change = session?.result.answer?.changes[index];
    return <div className={styles.choice}>
      <label><input type="checkbox" checked={selected.includes(index)} disabled={!state?.eligible || applying} onChange={event => toggle(index, event.target.checked)} /><span>{applied ? '초안에 반영함' : `이 수정 반영하기${state?.where ? ` · ${state.where}` : ''}`}</span></label>
      {!state?.eligible && state?.reason && <p>{state.reason}</p>}
      {state?.eligible && change?.changeType !== 'wording' && <p className={styles.meaning}>권리·의무나 요건의 의미를 확인한 뒤 선택하세요.</p>}
    </div>;
  };
  const resultActions = (result: KnowledgeAssistResult) => {
    const application = session?.application;
    return <section className={styles.applyBar} aria-label="검토 수정 반영">
      {!result.answer?.changes.length ? <><strong>이번 결과는 검토 의견입니다</strong><p>현재 본문과 대조 가능한 수정 문장이 없어 자동 반영할 항목은 없습니다. 위 의견을 확인하고, 필요한 조문을 구체적으로 질문해 주세요.</p></> : <>
        <div><strong>{application && !application.undoneAt ? `${application.changes.length}건을 반영했습니다` : `반영할 수정 ${selected.length}건 선택`}</strong><p>선택한 문장만 바꿉니다. 원본 규정과 선택하지 않은 문장은 보존합니다.</p></div>
        {application && !application.undoneAt ? <button type="button" className="btn" disabled={applying} onClick={undo}>이번 반영 되돌리기</button> : <button type="button" className="btn primary" disabled={applying || !selected.length || selected.some(index => !states[index]?.eligible)} onClick={apply}>{applying ? '반영 중…' : '선택한 수정 반영'}</button>}
      </>}
      {application && <details className={styles.audit}><summary>반영 기록 {application.changes.length}건{application.undoneAt ? ' · 되돌림' : ''}</summary>{application.changes.map(change => <div key={change.index}><b>{change.where}</b><p><span>반영 전</span>{change.before}</p><p><span>반영 후</span>{change.after || '(문구 삭제)'}</p></div>)}</details>}
    </section>;
  };

  return <section className={styles.panel} aria-label="조목이와 현재 작업 검토">
    <header className={styles.header}><Jomoki size={76} mood={applying ? 'thinking' : applicationCurrent ? 'celebrate' : changed || changedAfterApplication ? 'care' : 'guide'} decorative /><div><span>{STAGES[stage].label} 중 · 조목이와 함께</span><h2>지금 초안, 같이 살펴볼까요?</h2><p>검토 의견을 먼저 보고, 필요한 수정만 골라 현재 작업에 반영하세요.</p></div>{onClose && <button type="button" className="btn small" onClick={onClose}>검토 접기</button>}</header>
    <div className={styles.scope}>
      <div className={styles.scopeTop}><div><strong>검토할 조문 {scope.filter(key => key !== 'addenda').length}개{scope.includes('addenda') ? '와 부칙' : ''}</strong><span>{loadedDocument.length.toLocaleString('ko-KR')} / {REVIEW_DOCUMENT_LIMIT.toLocaleString('ko-KR')}자</span></div><button type="button" className="btn small" onClick={() => loadCurrent()}>현재 초안 새로 불러오기</button></div>
      <details><summary>검토 범위 고르기</summary><p>긴 초안은 몇 개 조문씩 골라 검토합니다. 선택한 본문을 임의로 잘라 보내지 않습니다.</p><div className={styles.scopeActions}><button type="button" className="btn small" onClick={() => loadCurrent(draft.units.map(unit => unit.key))}>모두 선택</button><button type="button" className="btn ghost small" onClick={() => loadCurrent([])}>선택 비우기</button></div><div className={styles.units}>{draft.units.map(unit => <label key={unit.key}><input type="checkbox" checked={scope.includes(unit.key)} onChange={event => loadCurrent(event.target.checked ? [...scope, unit.key] : scope.filter(key => key !== unit.key))} /><span>{unit.label}</span></label>)}</div></details>
      {(changed || changedAfterApplication) && <p className={styles.stale} role="status">{changedAfterApplication ? '수정 반영 이후 초안이 다시 바뀌었습니다. 현재 초안을 새로 불러와 추가로 검토해 주세요.' : applicationCurrent ? '수정을 반영했습니다. 추가 검토는 현재 초안을 새로 불러와 시작하세요.' : '검토 화면을 연 뒤 초안이 바뀌었습니다. 새로 불러오면 현재 내용으로 검토할 수 있어요.'}</p>}
    </div>
    <KnowledgeWorkbench key={`${stage}-${workbenchKey}`} embedded lockDocument initialKind={p.kind} initialMode={session?.request.mode ?? 'review'} initialQuestion={question} initialDocument={loadedDocument} initialResult={workbenchKey === 0 ? saved?.result : null} assistDisabledReason={disabledReason} onAssistStart={rememberStart} onAssistResult={rememberResult} renderChangeAction={changeAction} renderResultActions={resultActions} />
    <p className={styles.status} role="status" aria-live="polite">{status}</p>
  </section>;
}
