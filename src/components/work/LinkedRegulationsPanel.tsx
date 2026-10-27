'use client';
import { useMemo, useState } from 'react';
import { RULE_KIND_LABEL, type RuleKind } from '@/engine';
import Jomoki from '@/components/Jomoki';
import { analyzeLinkedRegulations, LINKED_IMPACT_LABELS, linkedRegulationsSchema, newLinkedRegulation, type LinkedRegulation, type LinkedRegulationImpact } from '@/lib/linked-regulations';
import { useWork } from './ctx';
import styles from './LinkedRegulationsPanel.module.css';

export default function LinkedRegulationsPanel() {
  const { p, update, before, d, toast } = useWork();
  const [editing, setEditing] = useState<LinkedRegulation | null>(null);
  const [error, setError] = useState('');
  const analysis = useMemo(() => before && d ? analyzeLinkedRegulations(p, before, d.after) : null, [p, before, d]);
  if (p.mode !== 'amend' || !before || !d || !analysis) return null;
  const regulations = p.linkedRegulations ?? [];
  const affected = analysis.exact.filter(item => item.impact !== 'unchanged');
  const unchanged = analysis.exact.filter(item => item.impact === 'unchanged');
  const modify = (patch: Partial<LinkedRegulation>) => { setEditing(current => current && { ...current, ...patch }); setError(''); };
  const save = () => {
    if (!editing) return;
    const cleaned = { ...editing, sourceUrl: editing.sourceUrl?.trim() || undefined, effectiveAt: editing.effectiveAt || undefined };
    const entries = [...regulations.filter(item => item.id !== editing.id), cleaned];
    const checked = linkedRegulationsSchema.safeParse(entries);
    if (!checked.success) { setError('규정명·원문을 입력하고 날짜·공개 원문 주소를 확인해 주세요. 최대 8개, 각 원문 10만 자까지 저장할 수 있어요.'); return; }
    update(q => {
      const next = [...(q.linkedRegulations ?? []).filter(item => item.id !== editing.id), cleaned];
      const result = linkedRegulationsSchema.safeParse(next);
      return result.success ? { ...q, linkedRegulations: result.data } : q;
    });
    setEditing(null); toast('연결할 규정 원문을 이 작업에 보관했습니다. 현재 초안 기준으로 인용 후보를 다시 살폈어요.');
  };
  const card = (item: LinkedRegulationImpact) => <article className={styles.result} key={item.id}>
    <span className={styles.badge}>{LINKED_IMPACT_LABELS[item.impact]}</span>
    <h4>{item.regulationTitle} · {item.location}</h4>
    <p><strong>찾은 인용:</strong> {item.citation}{item.movedTo ? ` → 이동 후보 ${item.movedTo}` : ''}</p>
    <ul>{item.checks.map(check => <li key={check}>{check}</li>)}</ul>
    <details><summary>주변 원문과 변경 대상 대조</summary><p>연결한 규정의 인용 문맥</p><pre>{item.excerpt}</pre>{item.beforeText && <><p>현재 작업의 변경 전 인용 대상</p><pre>{item.beforeText}</pre></>}{item.afterText && <><p>{item.impact === 'full' ? '전부개정 초안에서 같은 번호인 조문 · 동일성 미확정' : '변경 후 대상'}</p><pre>{item.afterText}</pre></>}</details>
    <small>후보를 표시한 단계입니다. 다른 규정의 문장은 자동 수정하지 않으며 정비 완료로 처리하지 않습니다.</small>
  </article>;
  return <section className={styles.panel} aria-labelledby="linked-regulations-title">
    <div className={styles.intro}><Jomoki size={70} mood="thinking" motion="none" /><div><h3 id="linked-regulations-title">이 규정을 인용하는 다른 규정도 살펴봐요</h3><p>기관 규정 원문을 최대 8개 연결하면, 정확히 이름을 적어 인용한 조문·별표·서식의 변화 후보를 찾아요.</p></div></div>
    <div className={styles.body}>
      <p>현재 기준: <strong>「{before.title}」</strong> · 변경 전 원문과 현재 수락·작성한 초안</p>
      <small>규정명 없는 ‘제5조’, 다른 규정명, 약칭·간접 인용과 연속 인용 범위는 자동 추정하지 않습니다. 기관 전체 규정이나 별표·서식을 모두 검토했다는 뜻은 아닙니다.</small>
      {regulations.map(item => <details key={item.id} className={styles.result}><summary><strong>{item.title}</strong> · {RULE_KIND_LABEL[item.kind]} · 시행일 {item.effectiveAt || '미확인'} · {item.raw.length.toLocaleString()}자</summary>
        <small>식별자 {item.id} · {item.partial !== false ? '부분 원문·완전성 미확인' : '사용자 전체 원문 대조 기록'}</small>
        {item.sourceUrl && <p><a href={item.sourceUrl} target="_blank" rel="noreferrer">등록한 공식 원문 주소 열기</a></p>}
        <div className={styles.actions}><button type="button" className="btn small" onClick={() => { setEditing({ ...item }); setError(''); }}>원문·기준 정보 수정</button><button type="button" className="btn ghost small" onClick={() => { update(q => ({ ...q, linkedRegulations: (q.linkedRegulations ?? []).filter(value => value.id !== item.id) })); toast('이 작업에서 규정 연결을 해제했습니다.'); }}>이 작업에서 연결 해제</button></div>
        <pre>{item.raw}</pre>
      </details>)}
      {!editing && <div className={styles.actions}><button type="button" className="btn" disabled={regulations.length >= 8} onClick={() => { setEditing(newLinkedRegulation(p.kind)); setError(''); }}>인용하는 기관 규정 추가</button><span>{regulations.length}/8개 연결</span></div>}
      {editing && <div className={styles.result}>
        <h4>{regulations.some(item => item.id === editing.id) ? '연결 규정 수정' : '인용하는 규정의 원문 넣기'}</h4>
        <label>정확한 규정명<input maxLength={500} value={editing.title} onChange={event => modify({ title: event.target.value })} /></label>
        <div className={styles.grid}><label>규정 종류<select value={editing.kind} onChange={event => modify({ kind: event.target.value as RuleKind })}>{Object.entries(RULE_KIND_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>이 원문의 시행일<input type="date" value={editing.effectiveAt?.replace(/^(\d{4})(\d{2})(\d{2})$/, '$1-$2-$3') || ''} onChange={event => modify({ effectiveAt: event.target.value })} /></label></div>
        <label>공식 원문 주소 · 선택<input type="url" maxLength={4096} value={editing.sourceUrl || ''} onChange={event => modify({ sourceUrl: event.target.value })} placeholder="https://" /></label>
        <label>본문·부칙·별표·서식 원문<textarea rows={10} maxLength={100000} value={editing.raw} onChange={event => modify({ raw: event.target.value, partial: true })} /></label><small>{editing.raw.length.toLocaleString()}/100,000자 · 표 구조와 서식 배치는 원본에서 별도로 확인해 주세요.</small>
        <label className={styles.check}><input type="checkbox" checked={editing.partial === false} onChange={event => modify({ partial: !event.target.checked })} /><span>기관의 전체 원문과 대조하고 부칙·별표·서식 누락 여부를 확인했습니다.</span></label>
        <label>기준본·누락·확인 범위 메모<textarea maxLength={5000} value={editing.note || ''} onChange={event => modify({ note: event.target.value })} /></label>
        {error && <p className={styles.alert} role="alert">{error}</p>}
        <div className={styles.actions}><button type="button" className="btn primary" onClick={save}>이 작업에 원문 연결</button><button type="button" className="btn ghost" onClick={() => { setEditing(null); setError(''); }}>입력 닫기</button></div>
      </div>}
      {!!regulations.length && <><h4>정확한 규정명 인용 {analysis.exact.length}곳 · 변화·재확인 후보 {affected.length}곳</h4>
        {affected.slice(0, 100).map(card)}{affected.length > 100 && <p className={styles.alert}>화면에는 앞 100개를 표시했습니다. 나머지 {affected.length - 100}곳은 연결 원문에서 직접 확인해 주세요.</p>}
        {!affected.length && <p>직접 인용 대상에서 변화 후보를 찾지 못했어요. 이름 없는 인용·정의·부칙·미입력 규정의 영향까지 없다는 뜻은 아니에요.</p>}
        {!!unchanged.length && <details><summary>직접 대상의 문자열이 같은 인용 {unchanged.length}곳</summary>{unchanged.slice(0, 30).map(card)}{unchanged.length > 30 && <p>앞 30개를 표시했습니다. 전체 {unchanged.length}곳입니다.</p>}</details>}
        {!!analysis.uncertain.length && <details><summary>규정명 표기가 불충분해 연결하지 않은 후보 {analysis.uncertain.length}곳</summary>{analysis.uncertain.slice(0, 30).map(card)}{analysis.uncertain.length > 30 && <p>앞 30개를 표시했습니다. 전체 {analysis.uncertain.length}곳입니다.</p>}</details>}
        <details><summary>입력 자료별 확인 범위</summary>{analysis.coverage.map(item => <div key={item.regulationId}><strong>{item.title} · {item.regulationId}</strong><ul>{item.issues.map(issue => <li key={issue}>{issue}</li>)}</ul></div>)}</details>
      </>}
    </div>
  </section>;
}
