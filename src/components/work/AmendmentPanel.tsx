'use client';
import { useMemo } from 'react';
import { AMENDMENT_LABELS, amendmentDecisionHash, amendmentKind, methodSuggestion, replacementBody, replacementDraftHash, type AmendmentKind } from '@/lib/amendment-method';
import { parseRule, renderArticle } from '@/engine';
import { useWork } from './ctx';

export default function AmendmentPanel() {
  const { p, update, d, before } = useWork();
  const method = amendmentKind(p);
  const suggestion = methodSuggestion(p.intent);
  const parsed = useMemo(() => p.replacementDraft ? parseRule(p.replacementDraft.raw, p.kind, p.title) : null, [p.replacementDraft?.raw, p.kind, p.title]);
  if (p.mode !== 'amend') return null;
  const confirmed = !!p.amendmentDecision?.confirmedHash && p.amendmentDecision.confirmedHash === amendmentDecisionHash(p);
  return <section className="panel" id="amendment-method" tabIndex={-1} style={{ marginBottom: 16 }}>
    <div className="panel-h"><h3>어떤 방식으로 고칠까요?</h3><span className="badge b-rule">{AMENDMENT_LABELS[method]}</span></div>
    <div className="panel-b">
      <p>조목이의 검토 후보: <b>{AMENDMENT_LABELS[suggestion.kind]}</b> · {suggestion.reason}</p>
      <label>작업 방식<select className="field" value={method} onChange={e => update(q => ({ ...q, sampleId: undefined, amendmentKind: e.target.value as AmendmentKind, amendmentDecision: { note: q.amendmentDecision?.note ?? '' }, prose: q.prose && { ...q.prose, reviewed: false } }))}>{Object.entries(AMENDMENT_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      {method === 'full' && <>
        <p>전부개정안에는 새 본칙 전체와 새 부칙을 출력합니다. 종전 부칙의 승계 여부는 기존 업무 처리표에서 별도로 확인해 주세요.</p>
        {!p.replacementDraft && <button className="btn" onClick={() => update(q => ({ ...q, replacementDraft: { raw: replacementBody(d?.after.articles.length ? d.after : before!) } }))}>원문을 바탕으로 전체 편집 시작</button>}
        {p.replacementDraft && <>
          <label>전부개정 본칙·별표·서식 전체<textarea className="field mono" rows={16} maxLength={200000} value={p.replacementDraft.raw} onChange={e => update(q => ({ ...q, replacementDraft: { raw: e.target.value } }))} /></label>
          <p className="help">제목, 제1조부터 마지막 조문, 필요한 별표·서식을 모두 작성하세요. 새 부칙은 문서 단계에서 따로 작성합니다. 표·서식의 배치는 원본과 대조해 주세요.</p>
          <details><summary>읽어 낸 조문 {parsed?.articles.length ?? 0}개 · 별표·서식 {parsed?.annexes.length ?? 0}개</summary>{parsed?.articles.map(a => <pre key={a.uid} style={{ whiteSpace: 'pre-wrap' }}>{renderArticle(a)}</pre>)}</details>
          {!!parsed?.diagnostics.length && <p role="alert">읽지 못한 줄 {parsed.diagnostics.length}곳이 있습니다. 점검 화면에서 본문을 확인해 주세요.</p>}
          <label><input type="checkbox" disabled={!parsed?.articles.length || !!parsed.diagnostics.length || !!parsed.addenda.trim()} checked={p.replacementDraft.confirmedHash === replacementDraftHash(p.replacementDraft.raw, p)} onChange={e => update(q => ({ ...q, replacementDraft: q.replacementDraft && { ...q.replacementDraft, confirmedHash: e.target.checked ? replacementDraftHash(q.replacementDraft.raw, q) : undefined } }))} /> 새 본칙·별표·서식이 빠짐없이 읽혔는지 대조했습니다</label>
        </>}
      </>}
      {method === 'repeal' && <p>규정 전체를 폐지하는 문서를 만듭니다. 개별 조문 삭제와 다릅니다. 기존 신청·계약·제재, 종전 부칙, 다른 규정에서 인용하는 부분을 확인한 뒤 폐지 이유를 기록하세요.</p>}
      {method !== 'partial' && <>
        <label>이 방식을 선택한 이유<textarea className="field" value={p.amendmentDecision?.note ?? ''} maxLength={5000} onChange={e => update(q => ({ ...q, amendmentDecision: { note: e.target.value } }))} /></label>
        <label><input type="checkbox" checked={confirmed} disabled={!p.amendmentDecision?.note.trim()} onChange={e => update(q => ({ ...q, amendmentDecision: { note: q.amendmentDecision?.note ?? '', confirmedHash: e.target.checked ? amendmentDecisionHash(q) : undefined } }))} /> 현재 본문과 적용 관계를 기준으로 작업 방식을 확인했습니다</label>
        {!confirmed && <p className="help" role="status">방식 선택의 확인이 남아 있습니다. 초안은 내려받을 수 있으며, 내용이 바뀌면 다시 확인합니다.</p>}
      </>}
      <p className="help"><a href="/references/local-ordinance-2026.pdf#page=421" target="_blank" rel="noreferrer">입안 길라잡이 · 개정 방식 선택 근거 보기</a></p>
    </div>
  </section>;
}
