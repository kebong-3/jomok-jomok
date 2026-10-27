'use client';
import { useMemo, useState } from 'react';
import { applySpec, buildComparison, DEFAULT_STYLE, findArticle, previewInsertPolicy, renderArticle, type ChangeOp, type SpecOp } from '@/engine';
import { ProvBadge } from '@/components/Badges';
import { convertOps, opTitle, type AiOp } from '@/lib/opconv';
import { useWork } from './ctx';

function OpQuote({ c, ruleText }: { c: ChangeOp; ruleText: (ref: { art: number; artBr?: number; para?: number }) => string }) {
  switch (c.op) {
    case 'replace_text':
      return (
        <p className="quote">
          <span className="ul">“{c.find}”</span> → <span className="ul-new">“{c.replace || '(삭제)'}”</span>
        </p>
      );
    case 'insert_paragraph':
      return <p className="quote"><span className="ul-new">{c.text}</span></p>;
    case 'insert_article':
      return <p className="quote"><span className="ul-new">({c.title}) {c.paragraphs.join('\n')}</span></p>;
    case 'delete_paragraph':
    case 'delete_article':
      return <p className="quote" style={{ textDecoration: 'line-through', textDecorationColor: 'var(--seal)' }}>{ruleText(c.target)}</p>;
    case 'set_title':
      return <p className="quote">새 제목: ({c.title})</p>;
  }
}

export default function ArticlesTab() {
  const { p, update, before, d, openEvidence, toast, setTab } = useWork();
  const [view, setView] = useState<'changed' | 'all'>('changed');
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [manual, setManual] = useState(false);
  const [mf, setMf] = useState<AiOp>({ type: 'replace_text', target: '', find: '', replace: '' });
  const [mErr, setMErr] = useState('');

  const ops = p.spec.ops.filter((o) => !o.derivedFrom);
  const proposed = ops.filter((o) => o.status === 'proposed').length;
  const accepted = ops.filter((o) => o.status === 'accepted').length;

  const ruleText = (ref: { art: number; artBr?: number; para?: number }) => {
    if (!before) return '';
    const a = findArticle(before.articles, ref);
    if (!a) return '';
    if (ref.para) return a.paragraphs.find((x) => x.num === ref.para)?.text ?? '';
    return renderArticle(a);
  };

  // 연산별 "함께 고칠 곳"
  const fixesByOp = useMemo(() => {
    const m = new Map<string, ReturnType<typeof applySpec>['fixes']>();
    if (!before) return m;
    for (const o of ops) {
      if (o.status !== 'accepted') continue;
      const r = applySpec(before, [o]);
      m.set(o.id, r.fixes);
    }
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [before, p.spec.ops]);

  const previews = useMemo(() => {
    const m = new Map<string, { branch: number; renumber: number }>();
    if (!before) return m;
    for (const o of ops) if (o.change.op === 'insert_article') m.set(o.id, previewInsertPolicy(before, [{ ...o, status: 'accepted' }], o.id));
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [before, p.spec.ops]);

  const setStatus = (id: string, status: SpecOp['status']) => {
    update((q) => ({
      ...q,
      spec: { ...q.spec, ops: q.spec.ops.map((o) => (o.id === id ? { ...o, status, provenance: status === 'accepted' && o.provenance === 'ai' ? 'ai_accepted' : o.provenance === 'ai_accepted' && status !== 'accepted' ? 'ai' : o.provenance } : o)) },
    }));
    if (status === 'rejected') toast('제안을 거절했습니다', () => setStatus(id, 'proposed'));
  };

  const acceptAll = () => {
    const unopened = ops.filter((o) => o.status === 'proposed').length;
    if (!unopened) return;
    if (!confirm(`아직 수락하지 않은 제안 ${unopened}건을 모두 수락할까요? 근거를 확인하지 않은 수락은 입안 점검표에 그대로 기록됩니다.`)) return;
    update((q) => ({ ...q, spec: { ...q.spec, ops: q.spec.ops.map((o) => (o.status === 'proposed' ? { ...o, status: 'accepted', provenance: o.provenance === 'ai' ? 'ai_accepted' : o.provenance } : o)) } }));
  };

  const setPolicy = (id: string, policy: 'branch' | 'renumber') =>
    update((q) => ({ ...q, spec: { ...q.spec, ops: q.spec.ops.map((o) => (o.id === id && o.change.op === 'insert_article' ? { ...o, change: { ...o.change, policy } } : o)) } }));

  const toggleFix = (fid: string) =>
    update((q) => ({ ...q, excludedFixes: q.excludedFixes.includes(fid) ? q.excludedFixes.filter((x) => x !== fid) : [...q.excludedFixes, fid] }));

  const saveEdit = (o: SpecOp) => {
    const c = o.change;
    let change: ChangeOp = c;
    if (c.op === 'insert_paragraph') change = { ...c, text: draft };
    else if (c.op === 'replace_text') change = { ...c, replace: draft };
    else if (c.op === 'insert_article') change = { ...c, paragraphs: draft.split(/\n(?=[①-⑳]|\S)/).map((s) => s.replace(/^[①-⑳]\s*/, '')).filter(Boolean) };
    update((q) => ({ ...q, spec: { ...q.spec, ops: q.spec.ops.map((x) => (x.id === o.id ? { ...x, change, status: 'accepted', provenance: 'human' } : x)) } }));
    setEditing(null);
  };

  const addManual = () => {
    if (!before) return;
    setMErr('');
    const conv = convertOps(before, [mf], 'human');
    if (!conv.ok.length) return setMErr(conv.dropped[0]?.reason ?? '입력을 확인하세요');
    update((q) => ({ ...q, spec: { ...q.spec, ops: [...q.spec.ops, { ...conv.ok[0], status: 'accepted' }] } }));
    setMf({ type: 'replace_text', target: '', find: '', replace: '' });
    setManual(false);
    toast('직접 고친 내용을 반영했습니다. 대비표·개정문이 다시 만들어졌어요.');
  };

  const rows = useMemo(() => {
    if (!before || !d) return [];
    return buildComparison(before, d.after, { ...DEFAULT_STYLE, unchangedMark: 'full', titleAlways: true });
  }, [before, d]);

  if (!before || !d) return null;

  return (
    <div>
      <div className="panel-h panel" style={{ marginBottom: 14, borderRadius: 10 }}>
        <h3>변경 제안 {ops.length}건</h3>
        <span className="help" style={{ margin: 0 }}>수락 {accepted} · 검토 대기 {proposed}</span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {proposed > 0 && <button className="btn small" onClick={acceptAll}>남은 제안 모두 수락…</button>}
          <button className="btn small" onClick={() => setManual((v) => !v)}>{manual ? '닫기' : 'AI 없이 직접 고치기'}</button>
        </div>
      </div>

      {manual && (
        <div className="panel panel-b" style={{ marginBottom: 14 }}>
          <p style={{ margin: '0 0 10px', fontWeight: 700 }}>직접 고치기 <span className="badge b-human">직접</span></p>
          <div className="grid2">
            <select className="field" value={mf.type} onChange={(e) => setMf({ ...mf, type: e.target.value as AiOp['type'] })} aria-label="작업 종류">
              <option value="replace_text">문구 바꾸기</option>
              <option value="insert_paragraph">항 새로 넣기</option>
              <option value="delete_paragraph">항 삭제</option>
              <option value="insert_article">조 새로 넣기</option>
              <option value="delete_article">조 삭제</option>
              <option value="set_title">조 제목 바꾸기</option>
            </select>
            <input className="field" value={mf.type === 'insert_article' ? mf.after ?? '' : mf.target ?? ''} onChange={(e) => setMf(mf.type === 'insert_article' ? { ...mf, after: e.target.value } : { ...mf, target: e.target.value })} placeholder={mf.type === 'insert_article' ? '어느 조 다음에? 예) 제7조' : '대상 예) 제5조제2항'} aria-label="대상" />
          </div>
          {mf.type === 'replace_text' && (
            <div className="grid2" style={{ marginTop: 8 }}>
              <input className="field" value={mf.find} onChange={(e) => setMf({ ...mf, find: e.target.value })} placeholder="찾을 말(원문 그대로)" aria-label="찾을 말" />
              <input className="field" value={mf.replace} onChange={(e) => setMf({ ...mf, replace: e.target.value })} placeholder="바꿀 말" aria-label="바꿀 말" />
            </div>
          )}
          {mf.type === 'insert_paragraph' && (
            <div className="grid2" style={{ marginTop: 8 }}>
              <input className="field" type="number" min={1} value={mf.position ?? ''} onChange={(e) => setMf({ ...mf, position: Number(e.target.value) })} placeholder="몇 항으로? 예) 2" aria-label="항 번호" />
              <input className="field" value={mf.text ?? ''} onChange={(e) => setMf({ ...mf, text: e.target.value })} placeholder="새 항 문장" aria-label="새 항 문장" />
            </div>
          )}
          {mf.type === 'insert_article' && (
            <div className="grid2" style={{ marginTop: 8 }}>
              <input className="field" value={mf.title ?? ''} onChange={(e) => setMf({ ...mf, title: e.target.value })} placeholder="조 제목" aria-label="조 제목" />
              <input className="field" value={(mf.paragraphs ?? []).join('\n')} onChange={(e) => setMf({ ...mf, paragraphs: [e.target.value] })} placeholder="조문 내용" aria-label="조문 내용" />
            </div>
          )}
          {mf.type === 'set_title' && <input className="field" style={{ marginTop: 8 }} value={mf.title ?? ''} onChange={(e) => setMf({ ...mf, title: e.target.value })} placeholder="새 제목" aria-label="새 제목" />}
          {mErr && <p className="err">{mErr}</p>}
          <div className="row-end"><button className="btn primary small" onClick={addManual}>반영하기</button></div>
          <p className="help">AI가 꺼져 있어도 이렇게 고치면 대비표·개정문·인용 정정은 그대로 만들어집니다.</p>
        </div>
      )}

      {p.planVia === 'manual' && !ops.length && (
        <div className="panel panel-b" style={{ marginBottom: 14 }}>
          AI에 연결하지 못했어요. 위의 <b>AI 없이 직접 고치기</b>로 바꿀 곳을 넣으면 나머지는 조목조목이 정리합니다.
        </div>
      )}

      <div className="cards">
        {ops.map((o, idx) => {
          const fixes = fixesByOp.get(o.id) ?? [];
          const moved = fixes.filter((f) => f.reason === 'moved');
          const deleted = fixes.filter((f) => f.reason === 'deleted');
          const pv = previews.get(o.id);
          return (
            <article key={o.id} className={`card ${o.status} ${o.provenance === 'human' ? 'human' : ''}`} aria-label={`변경 ${idx + 1}`}>
              <div className="card-h">
                <ProvBadge p={o.provenance} model={p.planModel} />
                <h4>{idx + 1}. {opTitle(o.change)}</h4>
                {o.status === 'accepted' && <span className="badge b-law">수락함</span>}
                {o.status === 'rejected' && <span className="badge b-unk">거절함</span>}
              </div>
              {o.why && <p className="why">{o.why}</p>}
              {editing === o.id ? (
                <div style={{ marginBottom: 10 }}>
                  <textarea className="field" value={draft} onChange={(e) => setDraft(e.target.value)} aria-label="문안 고치기" />
                  <div className="row-end" style={{ marginTop: 8 }}>
                    <button className="btn small" onClick={() => setEditing(null)}>취소</button>
                    <button className="btn primary small" onClick={() => saveEdit(o)}>고친 대로 수락</button>
                  </div>
                </div>
              ) : (
                <OpQuote c={o.change} ruleText={ruleText} />
              )}
              {o.change.op === 'insert_article' && pv && (
                <div>
                  <p className="help" style={{ margin: '0 0 6px' }}>조를 어떤 번호로 넣을까요? <span className="badge b-rule">규칙</span></p>
                  <div className="policy">
                    <label><input type="radio" name={`pol-${o.id}`} checked={o.change.policy === 'branch'} onChange={() => setPolicy(o.id, 'branch')} /> <b>가지번호(권장)</b>{`제${o.change.after.art}조의2`}로 넣기 · 고칠 인용 {pv.branch}곳</label>
                    <label><input type="radio" name={`pol-${o.id}`} checked={o.change.policy === 'renumber'} onChange={() => setPolicy(o.id, 'renumber')} /> <b>번호 밀기</b>뒤 조 번호를 하나씩 밀기 · 고칠 인용 {pv.renumber}곳(자동 처리)</label>
                  </div>
                </div>
              )}
              <div className="acts">
                {(o.evidence ?? []).map((id) => {
                  const ev = p.evidence.find((e) => e.id === id);
                  return (
                    <button key={id} className={`evchip ${ev ? '' : 'bad'}`} onClick={() => openEvidence(ev ?? id)}>
                      근거 {ev ? ev.label : `${id} — 확인 안 되는 근거`}
                    </button>
                  );
                })}
                <span style={{ flex: 1 }} />
                {o.status !== 'accepted' && <button className="btn primary small" onClick={() => setStatus(o.id, 'accepted')}>수락</button>}
                {o.status === 'proposed' && <button className="btn small" onClick={() => setStatus(o.id, 'rejected')}>거절</button>}
                {o.status !== 'proposed' && <button className="btn ghost small" onClick={() => setStatus(o.id, 'proposed')}>되돌리기</button>}
                {(o.change.op === 'insert_paragraph' || o.change.op === 'replace_text' || o.change.op === 'insert_article') && editing !== o.id && (
                  <button className="btn ghost small" onClick={() => { setEditing(o.id); setDraft(o.change.op === 'insert_paragraph' ? o.change.text : o.change.op === 'replace_text' ? o.change.replace : (o.change as Extract<ChangeOp, { op: 'insert_article' }>).paragraphs.join('\n')); }}>직접 고치기</button>
                )}
              </div>
              {o.status === 'accepted' && (moved.length > 0 || deleted.length > 0) && (
                <div className="linked">
                  {moved.length > 0 && (
                    <>
                      <b>번호가 바뀌어 함께 고친 인용 {moved.filter((f) => !p.excludedFixes.includes(f.id)).length}곳</b> <span className="badge b-rule">규칙</span>
                      <ul>
                        {moved.map((f) => (
                          <li key={f.id}>
                            <label style={{ display: 'flex', gap: 8, alignItems: 'baseline', cursor: 'pointer' }}>
                              <input type="checkbox" checked={!p.excludedFixes.includes(f.id)} onChange={() => toggleFix(f.id)} />
                              <span><b>{f.where}</b> “{f.before}” <span className="arrow">→</span> “{f.after}”</span>
                            </label>
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                  {deleted.length > 0 && (
                    <p style={{ margin: '8px 0 0', color: 'var(--seal)' }}>
                      삭제되는 곳을 인용하는 조문 {deleted.length}곳: {deleted.map((f) => f.where).join(', ')} — <button className="btn ghost small" onClick={() => setTab('lint')}>점검에서 고치기</button>
                    </p>
                  )}
                </div>
              )}
            </article>
          );
        })}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '28px 0 10px' }}>
        <h3 className="sec-title" style={{ margin: 0 }}>현행과 개정안 나란히 보기</h3>
        <div className="view-toggle" role="group" aria-label="보기">
          <button aria-pressed={view === 'changed'} onClick={() => setView('changed')}>바뀐 조만</button>
          <button aria-pressed={view === 'all'} onClick={() => setView('all')}>전체</button>
        </div>
        <span className="help" style={{ margin: 0 }}>밑줄 = 바뀐 글자 · 수락한 변경만 반영됩니다</span>
      </div>
      {view === 'changed' ? (
        <div className="cmp-rows">
          <div className="cmp-h"><div>현행 <span aria-hidden>🔒</span><span className="help" style={{ margin: 0 }}>원본은 고치지 않습니다</span></div><div>개정안</div></div>
          {rows.map((r) => (
            <div key={r.key} className="cmp-row">
              <div className="art">{r.left.map((l, i) => <div key={i}>{l.map((s, j) => <span key={j} className={s.underline ? 'ul' : undefined}>{s.text}</span>)}</div>)}</div>
              <div className="art">{r.right.map((l, i) => <div key={i}>{l.map((s, j) => <span key={j} className={s.underline ? 'ul-new' : undefined}>{s.text}</span>)}</div>)}</div>
            </div>
          ))}
          {!rows.length && <div className="art dim">아직 수락한 변경이 없습니다. 위 제안을 수락하면 여기에 나란히 보입니다.</div>}
        </div>
      ) : (
        <div className="split">
          <div className="col">
            <div className="col-h">현행 <span aria-hidden>🔒</span></div>
            {before.articles.map((a) => <div key={a.uid} className="art">{renderArticle(a)}</div>)}
          </div>
          <div className="col">
            <div className="col-h">개정안</div>
            {d.after.articles.map((a) => <div key={a.uid} className={`art ${a.deleted ? 'dim' : ''}`}>{renderArticle(a)}</div>)}
          </div>
        </div>
      )}
      <div className="row-end"><button className="btn primary" onClick={() => setTab('lint')}>다음: 점검하기</button></div>
    </div>
  );
}

