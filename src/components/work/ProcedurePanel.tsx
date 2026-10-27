'use client';
import { useState } from 'react';
import { deriveProject } from '@/lib/amendment-method';
import { enactRule } from '@/lib/pipeline';
import { parseRule, type Rule } from '@/engine';
import type { Project } from '@/lib/project';
import { confirmOpinionRequest, emptyOpinionRequest, OPINION_KIND_LABELS, OPINION_STAGE_LABELS, OPINION_TYPE_LABELS, opinionRequestIssues, opinionRequestStatus, RELATION_LABELS, REQUESTER_LABELS, reuseOpinionWork, type OpinionRequestState } from '@/lib/opinion-request';
import { captureConsultationBaseline, confirmConsultationEntry, consultationEntryIssues, consultationEntryStatus, consultationReviewIssues, CONSULTATION_DECISIONS, CONSULTATION_PROCEDURES, emptyConsultationEntry, emptyConsultationReview, NOTIFICATION_LABELS, reNoticeReviewHash, reNoticeSignals, RENOTICE_LABELS, type ConsultationEntry, type ConsultationReviewState } from '@/lib/consultation-review';
import { useWork } from './ctx';
import styles from './ProcedurePanel.module.css';

const id = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
const STATUS = { unreviewed: '아직 작성 전', incomplete: '작성·확인 중', stale: '본문·입력 변경 · 다시 확인', reviewed: '담당자 확인 기록' };
function currentRule(p: Project): Rule { return p.mode === 'enact' ? enactRule(p) : deriveProject(p, parseRule(p.source.raw, p.kind, p.title)).after; }
function Text({ label, value, change, max = 30000, rows = 3 }: { label: string; value: string; change: (value: string) => void; max?: number; rows?: number }) {
  return <label className={styles.field}>{label}<textarea className="field" rows={rows} maxLength={max} value={value} onChange={e => change(e.target.value)} /></label>;
}

export default function ProcedurePanel() {
  const { p, update, enactRule: enact, d, toast } = useWork();
  const [view, setView] = useState<'opinion' | 'consultation'>('opinion');
  const rule = enact ?? d?.after;
  if (!rule) return null;
  const opinion = p.opinionRequest ?? emptyOpinionRequest();
  const consultation = p.consultationReview ?? emptyConsultationReview();
  const setOpinion = (patch: Partial<OpinionRequestState>) => update(q => ({ ...q, opinionRequest: { ...(q.opinionRequest ?? emptyOpinionRequest()), ...patch, checkedHash: undefined, checkedAt: undefined } }));
  const editOpinion = (fn: (state: OpinionRequestState) => OpinionRequestState) => update(q => ({ ...q, opinionRequest: { ...fn(q.opinionRequest ?? emptyOpinionRequest()), checkedHash: undefined, checkedAt: undefined } }));
  const setConsultation = (patch: Partial<ConsultationReviewState>) => update(q => ({ ...q, consultationReview: { ...(q.consultationReview ?? emptyConsultationReview()), ...patch } }));
  const editEntry = (entryId: string, patch: Partial<ConsultationEntry>) => update(q => {
    const state = q.consultationReview ?? emptyConsultationReview();
    return { ...q, consultationReview: { ...state, entries: state.entries.map(entry => entry.id === entryId ? { ...entry, ...patch, checkedHash: undefined, checkedAt: undefined } : entry) } };
  });
  const opinionIssues = opinionRequestIssues(opinion);
  const consultationIssues = consultationReviewIssues(p, rule, consultation);
  const signals = reNoticeSignals(p, rule, consultation);

  return <section className={`panel ${styles.panel}`} id="procedure-records" tabIndex={-1}>
    <div className="panel-h"><h3>검토한 내용을 실제 행정 문서로 이어가요</h3></div>
    <div className="panel-b">
      <div className={styles.tabs} role="group" aria-label="행정 문서 준비">
        <button className="btn" aria-pressed={view === 'opinion'} onClick={() => setView('opinion')}>의견제시 요청서 준비</button>
        <button className="btn" aria-pressed={view === 'consultation'} onClick={() => setView('consultation')}>제출의견 처리·재예고 검토</button>
      </div>
      {view === 'opinion' && <>
        <p className={styles.lead}>질의 배경부터 기관 의견까지, <b>확인한 사실만 채워요.</b> 입력한 내용은 문서 목록의 ‘의견제시 요청서 작성자료’에 반영됩니다.</p>
        <p className="help">공식 원본의 항목을 재구성한 작성자료입니다. 원본 배치의 체크란을 채운 파일은 아니므로 제출 전 대조해 주세요. <a href="/references/opinion-request.hwpx" download>공식 원본 HWPX 받기</a></p>
        {!p.opinionRequest ? <button className="btn primary" onClick={() => setOpinion(emptyOpinionRequest())}>요청서 작성 시작</button> : <>
          <div className={styles.status} role="status"><b>{STATUS[opinionRequestStatus(p)]}</b><span>남은 확인 {opinionIssues.length}개 · 요청요건 충족이나 접수 완료를 뜻하지 않습니다.</span></div>
          <button className="btn" onClick={() => update(q => ({ ...q, opinionRequest: reuseOpinionWork(q, currentRule(q)) }))}>비어 있는 기관·제목·조문·근거 칸에 현재 작업 가져오기</button>
          <p className="help">요청 명의, 입법단계, 날짜, 갑설·을설, 기관 의견과 체크 결과는 직접 확인합니다. 이미 적은 내용은 덮어쓰지 않습니다.</p>
          <details className={styles.section} open>
            <summary>1. 요청요건부터 확인해요</summary>
            <div className={styles.grid}>
              <label className={styles.field}>요청기관<input className="field" maxLength={1000} value={opinion.organization} onChange={e => setOpinion({ organization: e.target.value })} /></label>
              <label className={styles.field}>실제 요청 명의(직위)<input className="field" maxLength={1000} value={opinion.requesterOffice} onChange={e => setOpinion({ requesterOffice: e.target.value })} /></label>
              <label className={styles.field}>요청권한자<select className="field" value={opinion.requester} onChange={e => setOpinion({ requester: e.target.value as OpinionRequestState['requester'] })}>{Object.entries(REQUESTER_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
              <label className={styles.field}>자치법규 형식<select className="field" value={opinion.targetKind} onChange={e => setOpinion({ targetKind: e.target.value as OpinionRequestState['targetKind'] })}>{Object.entries(OPINION_KIND_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
              <label className={styles.field}>대상 자치법규 제목<input className="field" maxLength={1000} value={opinion.targetTitle} onChange={e => setOpinion({ targetTitle: e.target.value })} /></label>
              <label className={styles.field}>어느 지자체 소관인가요?<select className="field" value={opinion.jurisdiction} onChange={e => setOpinion({ jurisdiction: e.target.value as OpinionRequestState['jurisdiction'] })}><option value="unreviewed">미확인</option><option value="own">요청 지자체 소관</option><option value="related">관련 지자체 소관</option></select></label>
              <label className={styles.field}>현재 입법단계<select className="field" value={opinion.stage} onChange={e => setOpinion({ stage: e.target.value as OpinionRequestState['stage'] })}>{Object.entries(OPINION_STAGE_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
              <label className={styles.field}>요청 성격<select className="field" value={opinion.requestType} onChange={e => setOpinion({ requestType: e.target.value as OpinionRequestState['requestType'] })}>{Object.entries(OPINION_TYPE_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
              {opinion.stage === 'resolved' && <label className={styles.field}>실제 의결일<input className="field" type="date" value={opinion.resolutionDate ?? ''} onChange={e => setOpinion({ resolutionDate: e.target.value })} /></label>}
              {opinion.stage === 'promulgated' && <label className={styles.field}>실제 공포일<input className="field" type="date" value={opinion.promulgationDate ?? ''} onChange={e => setOpinion({ promulgationDate: e.target.value })} /></label>}
            </div>
            {opinion.jurisdiction === 'related' && <Text label="요청기관과 대상 자치법규의 업무관련성" value={opinion.relationship} change={relationship => setOpinion({ relationship })} />}
            <label className={styles.field}>질의가 조문·쟁점별로 특정되어 있나요?<select className="field" value={opinion.specificity} onChange={e => setOpinion({ specificity: e.target.value as OpinionRequestState['specificity'] })}><option value="unreviewed">아직 확인하지 않음</option><option value="specific">구체적인 조문과 쟁점을 특정함</option><option value="whole_legality">조례안 전체의 적법성을 묻고 있음</option></select></label>
            <p className="help">소속·산하기관이나 의원 개인 명의, 의결·공포 후 위법 여부, 전체 적법성, 사실인정·처분 판단 등은 원본 서식상 반려 가능 사유를 확인해 주세요.</p>
            {(['nationalTask', 'localPlan'] as const).map(key => <div key={key} className={styles.subsection}>
              <label className={styles.field}>{key === 'nationalTask' ? '국정과제 관련성' : '지방시대 시행계획 관련성'}<select className="field" value={opinion[key].status} onChange={e => setOpinion({ [key]: { ...opinion[key], status: e.target.value as OpinionRequestState[typeof key]['status'] } })}>{Object.entries(RELATION_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
              {opinion[key].status === 'related' && <Text label={key === 'nationalTask' ? '실제 국정과제 번호·내용' : '실제 계획·사업과의 관련 내용'} value={opinion[key].detail} change={detail => setOpinion({ [key]: { ...opinion[key], detail } })} />}
            </div>)}
          </details>
          <details className={styles.section} open>
            <summary>2. 질의 배경과 질문을 한 쟁점씩 적어요</summary>
            <Text label="1. 질의배경" value={opinion.background} change={background => setOpinion({ background })} />
            {opinion.questions.map((question, i) => <div key={question.id} className={styles.subsection}>
              <b>질의 {i + 1}</b><label className={styles.field}>대상 조문<input className="field" maxLength={1000} value={question.articleRef} onChange={e => editOpinion(s => ({ ...s, questions: s.questions.map(q => q.id === question.id ? { ...q, articleRef: e.target.value } : q) }))} /></label>
              <Text label="명확하고 간결한 질의요지" value={question.text} change={text => editOpinion(s => ({ ...s, questions: s.questions.map(q => q.id === question.id ? { ...q, text } : q) }))} />
              <button className="btn ghost small" disabled={opinion.questions.length <= 1} onClick={() => editOpinion(s => ({ ...s, questions: s.questions.filter(q => q.id !== question.id) }))}>이 질의 삭제</button>
            </div>)}
            <button className="btn small" disabled={opinion.questions.length >= 20} onClick={() => editOpinion(s => ({ ...s, questions: [...s.questions, { id: id('question'), text: '', articleRef: '' }] }))}>별도 쟁점 추가</button>
            <Text label="3. 대상 자치법규 조문" max={200000} rows={6} value={opinion.targetText} change={targetText => setOpinion({ targetText })} />
            <Text label="관련 법령 원문·출처·기준일" max={200000} rows={6} value={opinion.relatedLaws} change={relatedLaws => setOpinion({ relatedLaws })} />
          </details>
          <details className={styles.section}>
            <summary>3. 실제 검토한 견해·기관 의견·붙임을 정리해요</summary>
            <label className={styles.field}>4. 대립되는 의견이 있나요?<select className="field" value={opinion.viewsStatus} onChange={e => setOpinion({ viewsStatus: e.target.value as OpinionRequestState['viewsStatus'] })}><option value="unreviewed">미확인</option><option value="present">실제로 검토한 견해 있음</option><option value="none">없음 · 원본 안내에 따라 생략</option></select></label>
            {opinion.viewsStatus === 'present' && <>
              <Text label="가. 갑설과 논거" value={opinion.viewA} change={viewA => setOpinion({ viewA })} /><Text label="갑설 논거의 실제 출처" max={1000} value={opinion.viewASource} change={viewASource => setOpinion({ viewASource })} />
              <Text label="나. 을설과 논거" value={opinion.viewB} change={viewB => setOpinion({ viewB })} /><Text label="을설 논거의 실제 출처" max={1000} value={opinion.viewBSource} change={viewBSource => setOpinion({ viewBSource })} />
            </>}
            <Text label="5. 요청기관이 실제로 검토한 의견" value={opinion.requestingOpinion} change={requestingOpinion => setOpinion({ requestingOpinion })} />
            <label className={styles.field}>관계기관 의견을 확보했나요?<select className="field" value={opinion.relatedOpinionStatus} onChange={e => setOpinion({ relatedOpinionStatus: e.target.value as OpinionRequestState['relatedOpinionStatus'] })}><option value="unreviewed">미확인</option><option value="present">실제 회신·의견 있음</option><option value="none">확보한 관계기관 의견 없음</option></select></label>
            {opinion.relatedOpinionStatus === 'present' && <><Text label="관계기관 의견 내용" value={opinion.relatedOpinion} change={relatedOpinion => setOpinion({ relatedOpinion })} /><Text label="회신일·문서번호 등 실제 출처" max={1000} value={opinion.relatedOpinionSource} change={relatedOpinionSource => setOpinion({ relatedOpinionSource })} /></>}
            <label className={styles.field}>6. 참고자료·붙임이 있나요?<select className="field" value={opinion.referencesStatus} onChange={e => setOpinion({ referencesStatus: e.target.value as OpinionRequestState['referencesStatus'] })}><option value="unreviewed">미확인</option><option value="present">있음 · 목록과 첨부 확인</option><option value="none">별도 참고자료 없음</option></select></label>
            {opinion.referencesStatus === 'present' && <>
              {opinion.references.map((ref, i) => <div className={styles.subsection} key={ref.id}><b>자료 {i + 1}</b>
                <label className={styles.field}>제목<input className="field" maxLength={1000} value={ref.label} onChange={e => editOpinion(s => ({ ...s, references: s.references.map(r => r.id === ref.id ? { ...r, label: e.target.value } : r) }))} /></label>
                <label className={styles.field}>공개 주소(있는 경우)<input className="field" type="url" maxLength={4096} value={ref.url ?? ''} onChange={e => editOpinion(s => ({ ...s, references: s.references.map(r => r.id === ref.id ? { ...r, url: e.target.value } : r) }))} /></label>
                <Text label="관련 내용·별도 첨부할 파일 확인" value={ref.note} change={note => editOpinion(s => ({ ...s, references: s.references.map(r => r.id === ref.id ? { ...r, note } : r) }))} />
                <button className="btn ghost small" onClick={() => editOpinion(s => ({ ...s, references: s.references.filter(r => r.id !== ref.id) }))}>목록에서 빼기</button>
              </div>)}
              <button className="btn small" disabled={opinion.references.length >= 50} onClick={() => editOpinion(s => ({ ...s, references: [...s.references, { id: id('reference'), label: '', note: '' }] }))}>참고자료 추가</button>
              <p className="help">붙임 목록을 적었다고 파일이 첨부되는 것은 아닙니다. 실제 제출 때 별도 첨부해 주세요.</p>
            </>}
          </details>
          {!!opinionIssues.length && <div className={styles.next} role="status"><b>먼저 확인할 것</b><p>{opinionIssues[0]}</p><details><summary>남은 확인 {opinionIssues.length}개 모두 보기</summary><ul>{opinionIssues.map(issue => <li key={issue}>{issue}</li>)}</ul></details></div>}
          <button className="btn primary" disabled={opinionIssues.length > 0} onClick={() => update(q => ({ ...q, opinionRequest: confirmOpinionRequest(q, q.opinionRequest ?? emptyOpinionRequest()) }))}>현재 작업 기준으로 작성내용 확인</button>
          <p className="help">확인이 남아 있어도 작성자료를 초안으로 내려받을 수 있어요. 작업·기관·근거·입력 내용이 바뀌면 재확인이 표시됩니다.</p>
        </>}
      </>}
      {view === 'consultation' && <>
        <p className={styles.lead}>제출된 의견을 처리한 이유와 조문을 연결하고, <b>예고 후 바뀐 내용</b>을 챙겨요.</p>
        <p className="help">지방기관의 입법예고, 중앙행정기관의 행정예고, 기관 내부 의견수렴은 절차가 다릅니다. 기관에 적용되는 법령·자체 기준을 확인하세요. <a href="/references/local-ordinance-2026.pdf#page=539" target="_blank" rel="noreferrer">매뉴얼 근거 보기</a></p>
        {!p.consultationReview ? <button className="btn primary" onClick={() => setConsultation(emptyConsultationReview())}>의견 처리 기록 시작</button> : <>
          <div className={styles.grid}>
            <label className={styles.field}>적용 절차<select className="field" value={consultation.procedure} onChange={e => setConsultation({ procedure: e.target.value as ConsultationReviewState['procedure'] })}>{Object.entries(CONSULTATION_PROCEDURES).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
            <label className={styles.field}>진행 상태<select className="field" value={consultation.stage} onChange={e => setConsultation({ stage: e.target.value as ConsultationReviewState['stage'] })}><option value="not_started">아직 실시 전</option><option value="in_progress">진행 중</option><option value="closed">종료한 절차</option></select></label>
          </div>
          <Text label="적용 법령·기관 기준 또는 해당 없음의 판단 근거" value={consultation.basis} change={basis => setConsultation({ basis })} />
          {consultation.procedure !== 'not_required' && <>
            <div className={styles.grid}><label className={styles.field}>실제 시작일<input className="field" type="date" value={consultation.startDate ?? ''} onChange={e => setConsultation({ startDate: e.target.value })} /></label><label className={styles.field}>실제 종료일<input className="field" type="date" value={consultation.endDate ?? ''} onChange={e => setConsultation({ endDate: e.target.value })} /></label></div>
            {consultation.startDate && consultation.endDate && consultation.startDate > consultation.endDate && <p role="alert">종료일이 시작일보다 앞섭니다. 날짜를 확인해 주세요.</p>}
            <div className={styles.subsection}>
              <b>실제로 예고·의견수렴한 본문을 비교 기준으로 보관해요</b><p className="help">버튼을 눌러 보관한 초안과 이후 본문을 비교합니다. 이 버튼이 예고나 공고를 실시하지는 않습니다. 재예고 후 기준을 바꾸면 이전 본문도 백업에 남습니다.</p>
              <button className="btn" disabled={(consultation.baselineHistory?.length ?? 0) >= 20} onClick={() => { try { void update(q => ({ ...q, consultationReview: captureConsultationBaseline(q, currentRule(q)) })); } catch (error) { toast((error as Error).message); } }}>{consultation.baseline ? '현재 본문으로 비교 기준 새로 보관' : '현재 본문을 비교 기준으로 보관'}</button>
              {consultation.baseline && <details><summary>보관한 기준안 보기 · 이전 기준안 {consultation.baselineHistory?.length ?? 0}개</summary><pre className={styles.source}>{consultation.baseline.text}</pre></details>}
            </div>
            <label className={styles.field}>실제 접수 의견이 있나요?<select className="field" value={consultation.intake} onChange={e => setConsultation({ intake: e.target.value as ConsultationReviewState['intake'] })}><option value="unreviewed">유무 미확인</option><option value="received">있음</option><option value="none">없음을 직접 확인함</option></select></label>
            {consultation.intake === 'none' && <Text label="어떤 접수 내역을 확인했나요?" value={consultation.noOpinionsNote} change={noOpinionsNote => setConsultation({ noOpinionsNote })} />}
            <div className={styles.entries}>
              {consultation.entries.map((entry, i) => {
                const issues = consultationEntryIssues(entry, rule), status = consultationEntryStatus(p, rule, consultation, entry);
                return <details className={styles.section} key={entry.id} open={status !== 'reviewed'}>
                  <summary>{entry.label || `제출의견 ${i + 1}`} <span className={styles.tag}>{STATUS[status]}</span></summary>
                  <div className={styles.grid}><label className={styles.field}>식별 제목(개인정보 없이)<input className="field" maxLength={1000} value={entry.label} onChange={e => editEntry(entry.id, { label: e.target.value })} /></label><label className={styles.field}>실제 접수일<input className="field" type="date" value={entry.receivedOn ?? ''} onChange={e => editEntry(entry.id, { receivedOn: e.target.value })} /></label></div>
                  <Text label="의견 요지" value={entry.summary} change={summary => editEntry(entry.id, { summary })} />
                  <label className={styles.field}>처리 결과<select className="field" value={entry.decision} onChange={e => editEntry(entry.id, { decision: e.target.value as ConsultationEntry['decision'] })}>{Object.entries(CONSULTATION_DECISIONS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
                  <Text label="반영·일부 반영·미반영 등 처리 이유" value={entry.reason} change={reason => editEntry(entry.id, { reason })} />
                  <label className={styles.field}>실제 반영·관련 조문(쉼표로 구분)<input className="field" value={entry.articleRefs.join(', ')} onChange={e => editEntry(entry.id, { articleRefs: e.target.value.split(/[,，、\n]/).map(s => s.trim()).filter(Boolean) })} placeholder="제3조, 제5조" /></label>
                  <label className={styles.field}>처리결과·이유의 통지<select className="field" value={entry.notification} onChange={e => editEntry(entry.id, { notification: e.target.value as ConsultationEntry['notification'] })}>{Object.entries(NOTIFICATION_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
                  {entry.notification === 'notified' && <label className={styles.field}>실제 통지일<input className="field" type="date" value={entry.notificationDate ?? ''} onChange={e => editEntry(entry.id, { notificationDate: e.target.value })} /></label>}
                  <Text label="통지 방법·기록 또는 통지 대상 아님의 근거" value={entry.notificationNote} change={notificationNote => editEntry(entry.id, { notificationNote })} />
                  {!!issues.length && <p className="help">다음 확인: {issues[0]}</p>}
                  <button className="btn small" disabled={issues.length > 0} onClick={() => update(q => { const state = q.consultationReview ?? emptyConsultationReview(); return { ...q, consultationReview: { ...state, entries: state.entries.map(item => item.id === entry.id ? confirmConsultationEntry(q, currentRule(q), state, item) : item) } }; })}>현재 본문 기준으로 이 의견 처리 확인</button>
                  <p className="help">입력한 반영·통지 기록입니다. 본문 수정과 실제 통지는 별도로 진행하세요.</p>
                </details>;
              })}
              <button className="btn" disabled={consultation.entries.length >= 200} onClick={() => update(q => { const state = q.consultationReview ?? emptyConsultationReview(); return { ...q, consultationReview: { ...state, intake: 'received', entries: [...state.entries, emptyConsultationEntry()] } }; })}>접수 의견 추가</button>
            </div>
            <details className={styles.section} open={signals.length > 0}>
              <summary>예고 후 변경과 재예고 검토 <span className={styles.tag}>{signals.length}개 확인 후보</span></summary>
              {signals.length ? signals.map(signal => <div className={styles.signal} key={signal.id}><b>{signal.label}</b><p>{signal.detail}</p></div>) : <p className="help">{consultation.baseline ? '보관한 본문과 문자 변경을 찾지 못했습니다. 장기간 지연·환경 변화 등은 별도로 확인하세요.' : '예고안을 보관하면 이후 변경 후보를 확인할 수 있습니다.'}</p>}
              <p className="help">추가·강화뿐 아니라 혜택 축소, 제3자 이익·공익, 시행일·경과조치의 불리한 변경도 살펴봐요. 자동 탐지만으로 재예고 의무·예외를 결정하지 않습니다.</p>
              <label className={styles.field}>담당자 판단<select className="field" value={consultation.reNotice.decision} onChange={e => setConsultation({ reNotice: { ...consultation.reNotice, decision: e.target.value as ConsultationReviewState['reNotice']['decision'], checkedHash: undefined, checkedAt: undefined } })}>{Object.entries(RENOTICE_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
              <Text label="검토한 변경내용·적용 근거·판단 이유" value={consultation.reNotice.reason} change={reason => setConsultation({ reNotice: { ...consultation.reNotice, reason, checkedHash: undefined, checkedAt: undefined } })} />
              <button className="btn small" disabled={!consultation.baseline || consultation.reNotice.decision === 'unreviewed' || !consultation.reNotice.reason.trim()} onClick={() => update(q => { const state = q.consultationReview ?? emptyConsultationReview(); return { ...q, consultationReview: { ...state, reNotice: { ...state.reNotice, checkedHash: reNoticeReviewHash(q, currentRule(q), state), checkedAt: Date.now() } } }; })}>현재 본문 기준으로 재예고 판단 기록</button>
              {consultation.reNotice.checkedHash && <p className="help" role="status">{consultation.reNotice.checkedHash === reNoticeReviewHash(p, rule, consultation) ? '현재 본문에 대한 판단 기록입니다.' : '본문·의견 처리 기록이 바뀌었습니다. 재예고 판단을 다시 확인해 주세요.'}</p>}
            </details>
          </>}
          {!!consultationIssues.length && <div className={styles.next} role="status"><b>먼저 확인할 것</b><p>{consultationIssues[0]}</p><details><summary>남은 확인 {consultationIssues.length}개 모두 보기</summary><ul>{consultationIssues.map(issue => <li key={issue}>{issue}</li>)}</ul></details></div>}
          <p className="help">문서 목록에서 ‘제출의견 처리 및 재예고 검토 기록’을 내려받을 수 있습니다. 확인 전·재확인 상태도 문서와 작업 백업에 보관됩니다.</p>
        </>}
      </>}
    </div>
  </section>;
}
