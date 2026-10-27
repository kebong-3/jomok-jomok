'use client';
import { useWork } from './ctx';

export default function ReviewSummary() {
  const { p, openEvidence } = useWork();
  if (!p.impact && !p.sourceReview?.issues.length) return null;
  const impact = p.impact;
  const selected = impact?.candidates.filter(c => impact.selectedIds.includes(c.id)) ?? [];
  return <details className="panel no-print review-summary">
    <summary><b>{impact ? '상위법 영향 검토 기록' : '원문 확인 기록'}</b><span>{impact ? `${selected.length}개 후보 선택 · ${impact.method === 'ai' ? 'AI 검토' : '문자일치 후보'}` : `${p.sourceReview?.issues.length}개 확인사항`}</span></summary>
    <div className="panel-b">
      {impact && <>
        <p><b>{impact.upperTitle}</b> · 사용자 제공 개정 전·후 원문을 비교했습니다. 공식 원문 대조와 적용 시점 판단은 담당자가 확인해야 합니다.</p>
        <div className="pilot-actions">{p.evidence.filter(e => e.id.startsWith('EV-IMPACT-')).map(e => <button key={e.id} className="btn small" onClick={() => openEvidence(e)}>{e.label} 보기</button>)}</div>
        {selected.map(c => <div key={c.id} className="review-candidate"><b>{c.target} ← {c.upperTarget}</b><p>{c.reason}</p><p className="help">확인할 사항: {c.checks.join(' · ') || '적용 대상·시행일·경과조치 확인'}</p></div>)}
        <p className="help">선택한 조문에 대한 제안만 가져옵니다. 수락한 변경으로 생기는 내부 인용 정정은 점검 탭에서 별도로 확인하세요. {impact.note}</p>
      </>}
      {!!p.sourceReview?.issues.length && <>
        <h3>원문을 읽을 때 확인한 사항</h3>
        <p className="help">{p.sourceReview.confirmedAt ? `원문 대조 확인: ${new Date(p.sourceReview.confirmedAt).toLocaleString('ko-KR')}` : '원문 대조 확인이 기록되지 않았습니다.'}</p>
        <ul>{p.sourceReview.issues.map((i, n) => <li key={`${i.code}-${n}`}>{i.location && `${i.location}: `}{i.message}</li>)}</ul>
      </>}
    </div>
  </details>;
}
