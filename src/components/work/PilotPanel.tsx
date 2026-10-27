'use client';
import { useEffect, useState } from 'react';
import { finishPilot, pausePilot, pilotCsv, pilotElapsed, resumePilot, startPilot, type PilotRecord } from '@/lib/evaluation';
import { download } from '@/lib/export';
import { useWork } from './ctx';

export default function PilotPanel() {
  const { p, update } = useWork();
  const r = p.evaluation;
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (r?.status !== 'running') return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [r?.status]);
  const set = (patch: Partial<PilotRecord>) => update(q => ({ ...q, evaluation: q.evaluation ? { ...q.evaluation, ...patch } : undefined }));
  const elapsed = r ? Math.floor(pilotElapsed(r, now) / 1000) : 0;
  const time = `${Math.floor(elapsed / 3600).toString().padStart(2, '0')}:${Math.floor(elapsed % 3600 / 60).toString().padStart(2, '0')}:${(elapsed % 60).toString().padStart(2, '0')}`;
  return (
    <details className="panel pilot-panel no-print">
      <summary><b>사용 기록</b><span>{r ? `${r.status === 'running' ? '측정 중' : r.status === 'finished' ? '종료' : '일시정지'} · ${time}` : '선택 사항 · 검토와 문서 수정에 든 시간 기록'}</span></summary>
      <div className="panel-b">
        <p className="help">기록 시작부터 종료까지의 경과 시간을 측정합니다. 원문 확인·AI 대기·검토·다운로드 후 문서 수정 시간도 포함하고, 쉬는 동안은 일시정지하세요. 브라우저를 닫아도 일시정지 전까지 시간은 계속됩니다. 기록 시작 이전에 쓴 시간은 포함되지 않습니다.</p>
        {!r ? <button className="btn small" onClick={() => { setNow(Date.now()); update(q => ({ ...q, evaluation: startPilot() })); }}>기록 시작</button> : <>
          <div className="pilot-actions">
            <strong aria-live="off" className="pilot-clock">{time}</strong>
            {r.status === 'running' ? <button className="btn small" onClick={() => update(q => ({ ...q, evaluation: pausePilot(q.evaluation!) }))}>일시정지</button> : <button className="btn small" onClick={() => { setNow(Date.now()); update(q => ({ ...q, evaluation: resumePilot(q.evaluation!) })); }}>측정 이어가기</button>}
            <button className="btn small" disabled={r.status === 'finished'} onClick={() => update(q => ({ ...q, evaluation: finishPilot(q.evaluation!) }))}>기록 종료</button>
            <button className="btn small" onClick={() => download(`조목조목_사용기록_${p.id}.csv`, pilotCsv(p), 'text/csv;charset=utf-8')}>기록 CSV 받기</button>
          </div>
          <div className="grid2 pilot-fields">
            <label>참여자 코드<input className="field" maxLength={40} value={r.participantCode} placeholder="예: P01 (이름 대신 코드)" onChange={e => set({ participantCode: e.target.value })} /></label>
            <label>과제 코드<input className="field" maxLength={80} value={r.caseCode} placeholder="예: A03" onChange={e => set({ caseCode: e.target.value })} /></label>
            <label>기존 방식 소요 시간(분)<input className="field" type="number" min={0.1} max={100000} step="0.1" value={r.baselineMinutes ?? ''} placeholder="같은 난이도로 실제 측정한 시간" onChange={e => set({ baselineMinutes: +e.target.value > 0 ? Math.min(100000, +e.target.value) : undefined })} /></label>
            <label>진행 결과<select className="field" value={r.outcome} onChange={e => set({ outcome: e.target.value as PilotRecord['outcome'] })}><option value="in_progress">진행 중</option><option value="completed">과제 완료</option><option value="incomplete">완료하지 못함</option></select></label>
            <label>수동 수정 건수<input className="field" type="number" min={0} max={100000} value={r.manualCorrections} onChange={e => set({ manualCorrections: Math.max(0, Math.min(100000, Math.floor(+e.target.value))) })} /></label>
            <label>검토 후 남은 오류<input className="field" type="number" min={0} max={100000} value={r.remainingErrors} onChange={e => set({ remainingErrors: Math.max(0, Math.min(100000, Math.floor(+e.target.value))) })} /></label>
            <label>만족도<select className="field" value={r.rating ?? ''} onChange={e => set({ rating: e.target.value ? +e.target.value : undefined })}><option value="">기록하지 않음</option>{[1, 2, 3, 4, 5].map(v => <option key={v} value={v}>{v} / 5</option>)}</select></label>
            <p className="help">문서 세트 받기 {r.exportCount}회<br />이 기록의 수치와 메모는 사용자가 입력한 평가값입니다.</p>
            <label style={{ gridColumn: '1 / -1' }}>수정·오류 메모<textarea className="field" maxLength={2000} value={r.notes} onChange={e => set({ notes: e.target.value })} placeholder="어느 단계에서 어떤 수정이 필요했는지 기록하세요." /></label>
          </div>
          <p className="help">기록은 이 브라우저의 작업에 저장됩니다. CSV에는 원문·API 키가 포함되지 않습니다. 메모와 참여자 코드에는 공개해도 되는 내용만 적으세요. 시간 변화율은 기존 방식 시간이 있고 과제 완료 후 종료한 기록에만 계산합니다.</p>
        </>}
      </div>
    </details>
  );
}
