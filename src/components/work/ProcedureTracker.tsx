'use client';
import { useMemo } from 'react';
import Jomoki from '@/components/Jomoki';
import { RULE_KIND_LABEL } from '@/engine';
import { emptyProcedureTrack, formatKoreanDate, holidayCoverage, keyDeadlines, STEP_STATUS_LABEL, stepDocHints, trackSummary, type ProcedureTrackState, type StepStatus } from '@/lib/procedure-track';
import { useWork } from './ctx';
import styles from './ProcedureTracker.module.css';

const STATUSES: StepStatus[] = ['todo', 'doing', 'done', 'skip'];
const DATE_INPUTS = {
  noticeStart: { label: '예고(공고) 시작일', help: '공보·누리집에 게재한 날' },
  resolved: { label: '의회 의결일', help: '본회의 의결일' },
  transferred: { label: '조례안 이송받은 날', help: '의장으로부터 이송된 날' },
  promulgation: { label: '공포 예정일', help: '규칙의 공포 예정일' },
} as const;
type DateKey = keyof typeof DATE_INPUTS;

/** 기관 절차를 이 작업의 진행판으로 바꾸고, 담당자가 넣은 기준일로 기한을 계산한다. */
export default function ProcedureTracker() {
  const { p, update, prof, setTab, toast } = useWork();
  const state = p.procedureTrack ?? emptyProcedureTrack();
  const summary = useMemo(() => trackSummary(p.kind, prof, p.procedureTrack, p.mode), [p.kind, prof, p.procedureTrack, p.mode]);
  const deadlines = useMemo(() => keyDeadlines(p.kind, prof, p.procedureTrack?.dates), [p.kind, prof, p.procedureTrack?.dates]);
  const percent = summary.total ? Math.round((summary.done / summary.total) * 100) : 0;
  const dateKeys: DateKey[] = summary.group === 'ordinance' ? ['noticeStart', 'resolved', 'transferred'] : summary.group === 'rule' ? ['noticeStart', 'promulgation'] : ['noticeStart'];
  const outside = Object.values(state.dates ?? {}).some(v => !holidayCoverage(v));

  const save = (fn: (s: ProcedureTrackState) => ProcedureTrackState) => update(q => ({ ...q, procedureTrack: fn(q.procedureTrack ?? emptyProcedureTrack()) }));
  const setStep = (id: string, patch: Partial<ProcedureTrackState['steps'][string]>) => save(s => {
    const prev = s.steps[id] ?? { status: 'todo' as StepStatus };
    const next = { ...prev, ...patch };
    if (patch.date === '') delete next.date;
    return { ...s, steps: { ...s.steps, [id]: next } };
  });
  const setDate = (key: DateKey, value: string) => save(s => {
    const dates = { ...(s.dates ?? {}) };
    if (value) dates[key] = value; else delete dates[key];
    return { ...s, dates };
  });
  const useForNotice = () => {
    const start = state.dates?.noticeStart;
    const end = deadlines.find(d => d.id === 'notice-end');
    if (!start || !end) return;
    update(q => ({ ...q, documentSettings: { ...q.documentSettings, notice: { ...q.documentSettings?.notice, date: start, deadline: end.date } } }));
    toast('예고문의 공고일과 의견 제출 기한을 채웠어요. 문서 받기에서 확인해 주세요.');
  };

  const current = summary.current;
  return <section className={styles.wrap} aria-labelledby="procedure-track-title">
    <div className={styles.head}>
      <Jomoki size={84} mood={current ? 'guide' : 'celebrate'} motion="once" />
      <div className={styles.headText}>
        <span className={styles.eyebrow}>{prof.name} · {RULE_KIND_LABEL[p.kind]} 절차 {summary.rows.length}단계</span>
        <h2 id="procedure-track-title">{current ? <>지금은 <em>{current.step.name}</em> 단계예요</> : '모든 절차를 완료로 기록했어요'}</h2>
        <p>{current ? '단계를 마칠 때마다 완료로 바꿔 주세요. 조목이가 다음 할 일과 필요한 문서를 이어서 안내해요.' : '추진 일정표는 문서 받기에서 함께 내려받을 수 있어요.'}</p>
        <div className={styles.progress} role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} aria-label="절차 진행률"><span style={{ width: `${percent}%` }} /></div>
        <small>{summary.done}/{summary.total}단계 완료{summary.rows.length !== summary.total ? ` · 해당 없음 ${summary.rows.length - summary.total}단계` : ''}</small>
      </div>
    </div>

    <div className={styles.grid}>
      <ol className={styles.steps}>
        {summary.rows.map(row => {
          const docs = stepDocHints(row.step, p.mode);
          const isCurrent = current?.step.id === row.step.id;
          return <li key={row.step.id} className={`${styles.step} ${styles[row.status]} ${isCurrent ? styles.current : ''}`} aria-current={isCurrent ? 'step' : undefined}>
            <span className={styles.no} aria-hidden="true">{row.status === 'done' ? '✓' : row.index + 1}</span>
            <div className={styles.body}>
              <div className={styles.titleRow}>
                <h3>{row.step.name}</h3>
                {isCurrent && <span className={styles.nowBadge}>지금 할 일</span>}
              </div>
              {row.step.tip && <p className={styles.tip}>{row.step.tip}</p>}
              {!!docs.length && <p className={styles.docs}><b>준비 문서</b>{docs.map(name => <button key={name} type="button" onClick={() => setTab('docs')}>{name}</button>)}</p>}
              {(row.step.basis || row.step.days) && <p className={styles.basis}>{row.step.basis}{row.step.days ? ` · 설정 기간 ${row.step.days}일` : ''}</p>}
              <div className={styles.controls}>
                <div className={styles.status} role="group" aria-label={`${row.step.name} 상태`}>
                  {STATUSES.map(s => <button key={s} type="button" aria-pressed={row.status === s} onClick={() => setStep(row.step.id, { status: s })}>{STEP_STATUS_LABEL[s]}</button>)}
                </div>
                <label className={styles.date}><span>예정·완료일</span><input type="date" value={row.date ?? ''} onChange={e => setStep(row.step.id, { date: e.target.value })} /></label>
              </div>
              <input className={styles.note} maxLength={2000} placeholder="메모(선택) 예) 법무팀 협의 회신 대기" value={row.note ?? ''} onChange={e => setStep(row.step.id, { note: e.target.value })} aria-label={`${row.step.name} 메모`} />
            </div>
          </li>;
        })}
      </ol>

      <aside className={styles.calc} aria-labelledby="deadline-calc-title">
        <h3 id="deadline-calc-title">기한 계산기</h3>
        <p className={styles.calcLead}>기준일을 넣으면 법정 기한을 바로 계산해요. 첫날은 빼고, 마지막 날이 토·일·공휴일이면 다음 날로 넘깁니다.</p>
        {dateKeys.map(key => <label key={key} className={styles.calcField}><span>{DATE_INPUTS[key].label}<small>{DATE_INPUTS[key].help}</small></span><input type="date" value={state.dates?.[key] ?? ''} onChange={e => setDate(key, e.target.value)} /></label>)}
        {deadlines.length ? <ul className={styles.deadlines}>
          {deadlines.map(d => <li key={d.id}><span>{d.label}</span><strong>{formatKoreanDate(d.date)}</strong><small>{d.basis}{d.rolled ? ' · 휴일이라 다음 날로 넘김' : ''}</small></li>)}
        </ul> : <p className={styles.empty}>아직 기준일이 없어요. 예고 시작일부터 넣어 보세요.</p>}
        {deadlines.some(d => d.id === 'notice-end') && <button type="button" className={styles.apply} onClick={useForNotice}>예고문에 공고일·제출기한 넣기</button>}
        <p className={styles.caution}>단순 계산입니다. 기관이 더 긴 기간을 정했거나 예외·임시공휴일이 있으면 담당자가 조정하세요.{outside ? ' 2026~2027년 밖의 날짜는 음력 공휴일을 반영하지 못해요.' : ''}</p>
      </aside>
    </div>
  </section>;
}
