'use client';
import { useState } from 'react';
import { parseRule, renderArticle, type DeadlineReview, type Rule, type TransitionCategory, type TransitionDecision } from '@/engine';
import type { Project } from '@/lib/project';
import type { Update } from '@/lib/pipeline';
import { applyDeadlineArticle, buildDeadlineArticle, deadlineReviewIssues, newTransitionDecision, priorAddendaHash, TRANSITION_CATEGORIES, TRANSITION_FORMS, transitionCandidates, transitionDecisionIssues, transitionDecisionState, transitionDraftHash, transitionReviewWarnings } from '@/lib/transition-review';
import styles from './TransitionPanel.module.css';

const STATE = { unreviewed: '담당자 확인 전', stale: '본문 변경 · 다시 확인', incomplete: '입력 보완 필요', confirmed: '부칙 반영', not_needed: '불필요 판단 기록' };

export default function TransitionPanel({ project: p, update, rule }: { project: Project; update: Update; rule: Rule }) {
  const [category, setCategory] = useState<TransitionCategory>('other');
  const [applyMessage, setApplyMessage] = useState('');
  const addenda = p.spec.addenda;
  const entries = addenda.transitions ?? [];
  const hash = transitionDraftHash(rule, addenda);
  const warnings = transitionReviewWarnings(rule, addenda);
  const candidates = transitionCandidates(rule);
  const setEntry = (id: string, patch: Partial<TransitionDecision>) => update(q => ({ ...q, spec: { ...q.spec, addenda: { ...q.spec.addenda, transitions: (q.spec.addenda.transitions ?? []).map(entry => entry.id === id ? { ...entry, ...patch, status: patch.status ?? 'unreviewed', sourceHash: patch.sourceHash } : entry) } } }));
  const add = (chosen: TransitionCategory, refs: string[] = []) => update(q => ({ ...q, spec: { ...q.spec, addenda: { ...q.spec.addenda, transitions: [...(q.spec.addenda.transitions ?? []), newTransitionDecision(chosen, refs)] } } }));
  const deadline: DeadlineReview = addenda.deadlineReview ?? { institutionType: p.profileSnapshot?.type ?? 'unknown', applicability: 'unreviewed', kind: 'review', basis: '', clause: '', confirmed: false };
  const setDeadline = (patch: Partial<DeadlineReview>) => update(q => ({ ...q, spec: { ...q.spec, addenda: { ...q.spec.addenda, deadlineReview: { ...deadline, ...patch, confirmed: patch.confirmed ?? false, sourceHash: patch.sourceHash } } } }));
  const deadlineIssues = deadlineReviewIssues(deadline, p.kind);
  const deadlineArticle = buildDeadlineArticle(rule, addenda);
  const original = p.source.raw.trim() ? parseRule(p.source.raw, p.kind, p.title) : rule;
  const prior = addenda.priorAddendaReview;
  const priorHash = priorAddendaHash(original, p.mode === 'enact' ? 'enact' : p.amendmentKind ?? 'partial');
  const whole = p.mode === 'amend' && (p.amendmentKind === 'full' || p.amendmentKind === 'repeal');
  const admin = ['directive', 'established_rule', 'notice', 'guideline'].includes(p.kind);

  return <section className={`panel ${styles.panel}`} id="transition-review">
    <div className="panel-h"><h3>이미 진행 중인 업무, 어떻게 이어갈까요?</h3><span className="badge b-rule">부칙 준비</span></div>
    <div className="panel-b">
      <p className={styles.lead}>시행일을 정한 다음, 기존 신청·계약·위원 임기를 함께 챙겨요. <b>직접 판단하고 확인한 문장만 부칙에 들어갑니다.</b></p>
      <p className="help">관련 본칙이나 시행일이 바뀌면 다시 확인합니다. 시행일과 적용례·경과조치는 역할이 다르며, 새 규정 또는 종전 규정의 적용을 일괄 결정하지 않습니다. <a href="/references/local-ordinance-2026.pdf#page=362" target="_blank" rel="noreferrer">길라잡이 PDF 362–363쪽</a></p>
      <div className={styles.questions} aria-label="본문에서 찾은 검토 후보">
        {candidates.filter(candidate => !entries.some(entry => entry.category === candidate.category)).map(candidate => <button className="btn" key={candidate.category} onClick={() => add(candidate.category, candidate.articleRefs)}>{TRANSITION_CATEGORIES[candidate.category].question} <span>검토 추가</span></button>)}
      </div>
      <div className={styles.add}>
        <label>다른 업무도 추가 <select className="field" value={category} onChange={e => setCategory(e.target.value as TransitionCategory)}>{Object.entries(TRANSITION_CATEGORIES).map(([key, value]) => <option key={key} value={key}>{value.label}</option>)}</select></label>
        <button className="btn small" disabled={entries.length >= 50} onClick={() => add(category)}>업무 추가</button>
      </div>
      {entries.length === 0 && <p className={styles.empty}>아직 추가한 기존 업무가 없어요. 본문에서 찾은 후보를 누르거나 필요한 업무를 직접 추가해 주세요.</p>}
      {entries.map(entry => {
        const current = transitionDecisionState(entry, hash, rule);
        const issues = transitionDecisionIssues(entry, rule);
        const notNeeded = { ...entry, status: 'not_needed' as const };
        const notNeededIssues = transitionDecisionIssues(notNeeded, rule);
        return <details className={styles.entry} key={entry.id} open={current !== 'confirmed' && current !== 'not_needed'}>
          <summary><span>{entry.title || TRANSITION_CATEGORIES[entry.category].label}</span><strong className={current === 'confirmed' || current === 'not_needed' ? styles.done : styles.pending}>{STATE[current]}</strong></summary>
          <div className={styles.editor}>
            <p className={styles.hint}>{TRANSITION_CATEGORIES[entry.category].hint}</p>
            <div className={styles.grid}>
              <label>관련 조문 <input className="field" value={entry.articleRefs.join(', ')} placeholder="제5조, 종전의 제7조" onChange={e => setEntry(entry.id, { articleRefs: e.target.value.split(/[,，、\n]/).map(s => s.trim()).filter(Boolean) })} /></label>
              <label>기존 대상·진행 중인 업무 <input className="field" value={entry.target} onChange={e => setEntry(entry.id, { target: e.target.value })} placeholder="현재 임기 중인 위원" /></label>
              <label>적용을 나누는 기준 사건 <input className="field" value={entry.event} onChange={e => setEntry(entry.id, { event: e.target.value })} placeholder="시행 당시 재직 중인지 여부" /></label>
              <label>기준 날짜(정한 경우) <input className="field" type="date" value={entry.eventDate ?? ''} onChange={e => setEntry(entry.id, { eventDate: e.target.value })} /></label>
              <label>어느 규정을 적용하나요? <select className="field" value={entry.application} onChange={e => setEntry(entry.id, { application: e.target.value as TransitionDecision['application'] })}><option value="unresolved">아직 판단하지 않음</option><option value="old">종전 규정</option><option value="new">개정 규정</option><option value="separate">별도 기준·예외</option></select></label>
              <label>부칙에서 다룰 방식 <select className="field" value={entry.form} onChange={e => setEntry(entry.id, { form: e.target.value as TransitionDecision['form'] })}>{Object.entries(TRANSITION_FORMS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
            </div>
            <label>확인한 근거·적용 범위 <textarea className="field" value={entry.basis} onChange={e => setEntry(entry.id, { basis: e.target.value })} placeholder="관련 법령 조문·종전 부칙과 확인한 적용 범위를 적어 주세요." /></label>
            <label>검토 메모·필요하지 않은 이유 <textarea className="field" value={entry.note} onChange={e => setEntry(entry.id, { note: e.target.value })} placeholder="특례라면 대상·기간·예외 범위도 적어 주세요." /></label>
            <div className={styles.clause}>
              <label>부칙 조문 제목 <input className="field" value={entry.title} onChange={e => setEntry(entry.id, { title: e.target.value })} placeholder="위원의 임기에 관한 경과조치" /></label>
              <label>담당자가 검토한 조문 본문 <textarea className="field" value={entry.clause} onChange={e => setEntry(entry.id, { clause: e.target.value })} placeholder="조 번호와 제목을 제외한 문장을 적어 주세요. 적용 결론은 자동으로 채우지 않습니다." /></label>
            </div>
            {current === 'stale' && <p role="status" className={styles.alert}>본문이나 시행일이 달라졌어요. 아래 문장을 다시 검토해 확인해야 부칙에 반영됩니다.</p>}
            {issues.length > 0 && <p className="help">다음 확인: {issues[0]}</p>}
            <div className={styles.actions}>
              <button className="btn primary small" disabled={issues.length > 0 || current === 'confirmed'} onClick={() => setEntry(entry.id, { status: 'confirmed', sourceHash: hash })}>검토한 문장 부칙에 반영</button>
              <button className="btn small" disabled={notNeededIssues.length > 0 || current === 'not_needed'} title={notNeededIssues[0]} onClick={() => setEntry(entry.id, { status: 'not_needed', sourceHash: hash })}>이유를 기록하고 해당 없음</button>
              <button className="btn ghost small" onClick={() => update(q => ({ ...q, spec: { ...q.spec, addenda: { ...q.spec.addenda, transitions: q.spec.addenda.transitions?.filter(item => item.id !== entry.id) } } }))}>이 업무 삭제</button>
            </div>
          </div>
        </details>;
      })}
      {warnings.length > 0 && <p className={styles.alert} role="status">부칙 반영 전에 확인할 기록 {warnings.length}건이 있어요. 미확인·본문 변경 항목은 출력에서 제외하고 작업 기록에 보관합니다.</p>}

      {whole && <details className={styles.entry} open={!prior || prior.decision === 'unreviewed' || prior.sourceHash !== priorHash}>
        <summary><span>종전 부칙에서 계속 필요한 내용</span><strong className={!prior || prior.decision === 'unreviewed' || prior.sourceHash !== priorHash ? styles.pending : styles.done}>별도 검토</strong></summary>
        <div className={styles.editor}>
          <p className={styles.hint}>전부개정·폐지 때에는 종전 부칙의 적용례·특례·경과조치를 따로 살펴봐요. 남길 필요가 있으면 위의 기존 업무에 추가해 구체적인 문장을 작성해 주세요. 선택만으로 종전 부칙을 승계하거나 삭제하지 않습니다. <a href="/references/local-ordinance-2026.pdf#page=391" target="_blank" rel="noreferrer">PDF 391쪽</a></p>
          <pre className={styles.source}>{original.addenda.trim() || '입력한 원문에서 종전 부칙을 찾지 못했습니다. 원본 문서를 확인해 주세요.'}</pre>
          <label>검토 결과 <select className="field" value={prior?.decision ?? 'unreviewed'} onChange={e => update(q => ({ ...q, spec: { ...q.spec, addenda: { ...q.spec.addenda, priorAddendaReview: { decision: e.target.value as NonNullable<typeof prior>['decision'], note: prior?.note ?? '' } } } }))}><option value="unreviewed">아직 검토하지 않음</option><option value="retain">계속 필요한 내용 있음</option><option value="replace">새 적용 관계로 정비 필요</option><option value="not_needed">계속 필요한 내용 없음</option></select></label>
          <label>검토한 부칙·판단 이유 <textarea className="field" value={prior?.note ?? ''} onChange={e => update(q => ({ ...q, spec: { ...q.spec, addenda: { ...q.spec.addenda, priorAddendaReview: { decision: prior?.decision ?? 'unreviewed', note: e.target.value } } } }))} /></label>
          <button className="btn small" disabled={!prior?.note.trim() || prior.decision === 'unreviewed'} onClick={() => update(q => ({ ...q, spec: { ...q.spec, addenda: { ...q.spec.addenda, priorAddendaReview: { decision: prior!.decision, note: prior!.note, sourceHash: priorHash } } } }))}>현재 종전 부칙 검토 기록</button>
        </div>
      </details>}

      {admin && <details className={styles.entry} open={!!addenda.reviewDeadline && !addenda.deadlineReview}>
        <summary><span>재검토기한·유효기간은 본칙 마지막에서</span><strong className={deadline.confirmed && deadline.sourceHash === hash ? styles.done : styles.pending}>적용 대상부터 확인</strong></summary>
        <div className={styles.editor}>
          <p className={styles.hint}>중앙행정기관의 일몰 기준을 지방자치단체나 내부 지침에 자동 적용하지 않아요. <b>유효기간은 효력 상실, 재검토기한은 타당성 검토</b>로 효과가 다릅니다. 날짜와 주기는 임의로 채우지 않습니다. <a href="/references/administrative-rules-2025.pdf#page=40" target="_blank" rel="noreferrer">행정규칙 기준 PDF 40–42쪽</a></p>
          {addenda.reviewDeadline && !addenda.deadlineReview && <p className={styles.alert}>이전 버전의 ‘재검토기한 작성란’ 선택은 검토 요청으로 보관했어요. 부칙에는 자동으로 넣지 않습니다.</p>}
          <div className={styles.grid}>
            <label>발령 기관 <select className="field" value={deadline.institutionType} onChange={e => setDeadline({ institutionType: e.target.value as DeadlineReview['institutionType'] })}><option value="unknown">미확인</option><option value="central">중앙행정기관</option><option value="local">지방자치단체</option><option value="public">공공기관</option></select></label>
            <label>일몰 기준 적용 <select className="field" value={deadline.applicability} onChange={e => setDeadline({ applicability: e.target.value as DeadlineReview['applicability'] })}><option value="unreviewed">대상·제외 여부 미확인</option><option value="applies">적용 근거를 확인함</option><option value="excluded">내부운영 등 제외 근거를 확인함</option><option value="not_needed">해당 없음·기관 기준상 불필요</option></select></label>
            <label>조문 유형 <select className="field" value={deadline.kind} onChange={e => setDeadline({ kind: e.target.value as DeadlineReview['kind'] })}><option value="review">재검토기한(검토 의무)</option><option value="sunset">유효기간(효력 상실)</option></select></label>
          </div>
          <label>적용·제외 근거와 판단 이유 <textarea className="field" value={deadline.basis} onChange={e => setDeadline({ basis: e.target.value })} /></label>
          {deadline.applicability === 'applies' && <label>본칙 마지막에 둘 조문 본문 <textarea className="field" value={deadline.clause} onChange={e => setDeadline({ clause: e.target.value })} placeholder="기관·법령 기준에 맞게 확인한 검토 주체·기준일·주기 또는 유효기간을 직접 적어 주세요." /></label>}
          {deadlineIssues.length > 0 && <p className="help">다음 확인: {deadlineIssues[0]}</p>}
          <button className="btn small" disabled={deadlineIssues.length > 0} onClick={() => setDeadline({ confirmed: true, sourceHash: hash })}>적용 검토 기록</button>
          {deadlineArticle && <div className={styles.clause}><strong>본칙에 추가할 문장 제안</strong><pre className={styles.source}>{renderArticle(deadlineArticle)}</pre><button className="btn primary small" disabled={p.mode === 'amend' && p.amendmentKind === 'repeal'} onClick={() => { update(q => { const applied = applyDeadlineArticle(q, hash); setApplyMessage(applied.error ?? '검토한 문장을 본칙 마지막에 추가했어요. 다른 부칙 검토 기록은 바뀐 본문에서 다시 확인해 주세요.'); return applied.project ?? q; }); }}>검토한 조문을 본칙 마지막에 추가</button><p className="help">담당자 작성 조문으로 반영됩니다. 같은 조항이 이미 있거나 적용 전 본문이 달라지면 추가하지 않습니다.</p></div>}
          {applyMessage && <p role="status" className={styles.hint}>{applyMessage}</p>}
          {rule.articles.some(article => /재검토기한|유효기간|존속기한/.test(article.title ?? '')) && <p className="help">본문에 일몰 관련 조문이 있습니다. 중복으로 추가하지 않고 기존 조문의 내용과 위치를 확인해 주세요.</p>}
        </div>
      </details>}
    </div>
  </section>;
}
