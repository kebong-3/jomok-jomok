'use client';
import { useState } from 'react';
import { LINT_CATALOG, uid, type LintIssue, type SpecOp } from '@/engine';
import { suggestDeletedFix } from '@/lib/pipeline';
import { mergeKnowledge } from '@/lib/knowledge';
import { ProvBadge } from '@/components/Badges';
import { opTitle } from '@/lib/opconv';
import { useWork } from './ctx';

const TIER = {
  must: { label: '반드시 고치기', mark: '!', help: '이대로 두면 문서가 틀립니다.' },
  check: { label: '확인해 보기', mark: '?', help: '맞을 수도 있지만 사람이 한 번 봐야 합니다.' },
  note: { label: '참고', mark: 'i', help: '표기 다듬기. 고치지 않아도 결재에는 지장이 없습니다.' },
} as const;

export default function LintTab() {
  const { p, update, before, d, enactRule, enactLint, toast, setTab } = useWork();
  const [showPre, setShowPre] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [showCatalog, setShowCatalog] = useState(false);
  const enact = p.mode === 'enact';
  const all: LintIssue[] = enact ? enactLint : d?.lint ?? [];
  const now = all.filter((i) => i.origin === 'introduced' || enact);
  const pre = all.filter((i) => i.origin === 'preexisting' && !enact);
  const count = (t: LintIssue['tier']) => now.filter((i) => i.tier === t).length;
  const derived = p.spec.ops.filter((o) => o.derivedFrom);

  const applyFix = (i: LintIssue) => {
    if (!i.fix) return;
    if (enact) {
      // 제정: 초안 문장 직접 치환
      update((q) => ({
        ...q,
        enact: q.enact && {
          ...q.enact,
          outline: q.enact.outline.map((a) => ({
            ...a,
            paragraphs: a.paragraphs.map((t) => i.fix!.ops.reduce((s, op) => (op.op === 'replace_text' ? s.replace(op.find, op.replace) : s), t)),
          })),
        },
      }));
    } else {
      const ops: SpecOp[] = i.fix.ops.map((c) => ({ id: uid(), change: c, status: 'accepted', provenance: 'engine', why: `${i.title}: ${i.message}` }));
      update((q) => ({ ...q, spec: { ...q.spec, ops: [...q.spec.ops, ...ops] } }));
    }
    toast(`${i.where} — ${i.fix.label} 반영`);
  };

  const askAi = async (i: LintIssue) => {
    if (!before) return;
    const m = i.message.match(/"(제\d+조(?:의\d+)?(?:제\d+항)?)"/);
    if (!m) return;
    setBusy(i.where);
    const op = await suggestDeletedFix(p, before, i.where, m[1], (record) => update((q) => ({ ...q, knowledge: mergeKnowledge(q.knowledge, record) })));
    setBusy(null);
    if (!op) return toast('AI가 문안을 내지 못했습니다. 조문 탭의 "AI 없이 직접 고치기"로 고쳐 주세요.');
    update((q) => ({ ...q, spec: { ...q.spec, ops: [...q.spec.ops, { ...op, derivedFrom: `${op.derivedFrom}@${i.where}` }] } }));
  };

  const setDerived = (id: string, status: SpecOp['status']) =>
    update((q) => ({ ...q, spec: { ...q.spec, ops: q.spec.ops.map((o) => (o.id === id ? { ...o, status, provenance: status === 'accepted' ? 'ai_accepted' : 'ai' } : o)) } }));

  const Row = ({ i }: { i: LintIssue }) => {
    const deletedRef = !enact && i.code === '인용-02' && /삭제된/.test(i.message);
    const pending = derived.find((o) => o.status !== 'rejected' && o.derivedFrom?.endsWith(`@${i.where}`));
    return (
      <div className={`issue ${i.tier}`}>
        <span className="mark" aria-hidden>{TIER[i.tier].mark}</span>
        <div>
          <h5>{i.title} <span className="where">· {i.where} · {i.code}</span></h5>
          <p>{i.message}</p>
          {i.offline && <p className="help">법제처에 연결되면 자동으로 다시 확인합니다.</p>}
          {deletedRef && !pending && <p className="help">삭제되는 곳을 인용한 문장은 번호만 바꿔서는 안 되고 문장을 고쳐 써야 합니다.</p>}
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          {i.fix && <button className="btn small" onClick={() => applyFix(i)}>{i.fix.label}</button>}
          {deletedRef && !pending && <button className="btn small" disabled={busy === i.where} onClick={() => askAi(i)}>{busy === i.where ? 'AI가 쓰는 중…' : 'AI에게 문안 받기'}</button>}
        </div>
      </div>
    );
  };

  const groups = (['must', 'check', 'note'] as const).map((t) => ({ t, list: now.filter((i) => i.tier === t) })).filter((g) => g.list.length);

  if (!enact && !d) return null;
  if (enact && !enactRule) return null;

  return (
    <div>
      <div className="lint-sum">
        {(['must', 'check', 'note'] as const).map((t) => (
          <div key={t} className={`n ${t}`}>
            <b>{count(t)}</b>
            {TIER[t].label}
          </div>
        ))}
        <div className="n" style={{ flex: 1, minWidth: 240 }}>
          <span className="badge b-rule">규칙</span>
          <p className="help" style={{ marginTop: 6 }}>
            {LINT_CATALOG.length}가지 형식 규칙을 규칙 엔진이 점검합니다. AI가 판단하지 않습니다.{' '}
            <button className="btn ghost small" onClick={() => setShowCatalog((v) => !v)}>{showCatalog ? '목록 닫기' : '무엇을 보나요?'}</button>
          </p>
        </div>
      </div>

      {showCatalog && (
        <div className="panel" style={{ marginBottom: 16 }}>
          <table className="plain">
            <thead><tr><th>번호</th><th>점검 내용</th><th>단계</th></tr></thead>
            <tbody>{LINT_CATALOG.map((c) => <tr key={c.code}><td>{c.code}</td><td>{c.title}</td><td>{TIER[c.tier].label}</td></tr>)}</tbody>
          </table>
        </div>
      )}

      {derived.length > 0 && (
        <div className="panel" style={{ marginBottom: 16 }}>
          <div className="panel-h"><h3>삭제된 곳을 인용하던 문장 — AI 문안</h3><span className="help" style={{ margin: 0 }}>수락해야 반영됩니다</span></div>
          <div className="panel-b cards">
            {derived.map((o) => (
              <article key={o.id} className={`card ${o.status}`}>
                <div className="card-h"><ProvBadge p={o.provenance} /><h4>{opTitle(o.change)}</h4></div>
                {o.change.op === 'replace_text' && (
                  <p className="quote"><span className="ul">“{o.change.find}”</span> → <span className="ul-new">“{o.change.replace || '(삭제)'}”</span></p>
                )}
                {o.why && <p className="why">{o.why}</p>}
                <div className="acts">
                  {o.status !== 'accepted' && <button className="btn primary small" onClick={() => setDerived(o.id, 'accepted')}>수락</button>}
                  {o.status === 'proposed' && <button className="btn small" onClick={() => setDerived(o.id, 'rejected')}>거절</button>}
                  {o.status !== 'proposed' && <button className="btn ghost small" onClick={() => setDerived(o.id, 'proposed')}>되돌리기</button>}
                </div>
              </article>
            ))}
          </div>
        </div>
      )}

      <div className="panel">
        <div className="panel-h">
          <h3>{enact ? '초안 점검 결과' : '이번 개정에서 생긴 문제'}</h3>
          {!now.length && <span className="badge b-law">문제 없음</span>}
        </div>
        {!now.length && <div className="empty">형식상 문제가 없습니다. 내용이 맞는지는 담당자와 법무 담당이 판단합니다.</div>}
        {groups.map((g) => (
          <div key={g.t}>
            <div className="group-h">{TIER[g.t].label} {g.list.length} — <span style={{ fontWeight: 400 }}>{TIER[g.t].help}</span></div>
            {g.list.map((i, k) => <Row key={`${i.code}-${i.where}-${k}`} i={i} />)}
          </div>
        ))}
      </div>

      {pre.length > 0 && (
        <div className="panel" style={{ marginTop: 16 }}>
          <div className="panel-h">
            <h3>원래 있던 문제 {pre.length}건</h3>
            <span className="help" style={{ margin: 0 }}>이번 개정과는 별개입니다. 고칠지 담당자가 정합니다.</span>
            <button className="btn ghost small" style={{ marginLeft: 'auto' }} onClick={() => setShowPre((v) => !v)}>{showPre ? '접기' : '펼치기'}</button>
          </div>
          {showPre && pre.map((i, k) => <Row key={`pre-${k}`} i={i} />)}
        </div>
      )}

      <div className="row-end"><button className="btn primary" onClick={() => setTab('docs')}>다음: 문서 받기</button></div>
    </div>
  );
}
