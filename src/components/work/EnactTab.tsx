'use client';
import { useEffect, useRef, useState } from 'react';
import { renderArticle } from '@/engine';
import { ProvBadge } from '@/components/Badges';
import { newId, type EnactArticle } from '@/lib/project';
import { runEnactDraft, type DraftProgress } from '@/lib/pipeline';
import AiProgress from '@/components/AiProgress';
import { useWork } from './ctx';

/** 한 줄 = 한 항. "1." "가." 로 시작하는 줄은 앞 항의 호·목으로 붙임 */
function toParas(v: string): string[] {
  const out: string[] = [];
  for (const raw of v.split('\n')) {
    const line = raw.replace(/^[\u2460-\u2473]\s*/, '');
    if (out.length && /^(\d+|[가-하])\.\s/.test(line)) out[out.length - 1] += `\n${line}`;
    else out.push(line);
  }
  return out;
}

export default function EnactTab() {
  const { p, update, enactRule, openEvidence, setTab } = useWork();
  const [drafting, setDrafting] = useState(false);
  const [startedAt, setStartedAt] = useState<number>();
  const [progress, setProgress] = useState<DraftProgress>();
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  const out = p.enact;
  if (!out) return <div className="panel empty">아직 조문 체계가 없습니다. 위의 ‘새 작업으로 AI 다시 실행’을 누르거나 처음 화면에서 제정 목적을 확인해 주세요.</div>;
  const missing = out.outline.filter(article => !article.paragraphs.some(text => text.trim())).length;

  const setArts = (fn: (a: EnactArticle[]) => EnactArticle[]) => update((q) => ({ ...q, sampleId: undefined, enact: q.enact && { ...q.enact, outline: fn(q.enact.outline) } }));
  const move = (i: number, dir: -1 | 1) => setArts((a) => {
    const b = [...a];
    const j = i + dir;
    if (j < 0 || j >= b.length) return a;
    [b[i], b[j]] = [b[j], b[i]];
    return b;
  });

  const confirmOutline = async () => {
    if (drafting) return;
    const ctrl = new AbortController(); controller.current = ctrl;
    update((q) => ({ ...q, enact: q.enact && { ...q.enact, outlineConfirmed: true } }));
    setStartedAt(Date.now()); setProgress({ completed: out.outline.length - missing, total: out.outline.length, current: '확정한 조문 체계를 확인하고 있어요.', phase: 'preparing' }); setDrafting(true);
    try { await runEnactDraft({ ...p, enact: { ...out, outlineConfirmed: true } }, update, { signal: ctrl.signal, onProgress: setProgress }); }
    finally { if (controller.current === ctrl) { controller.current = null; setDrafting(false); } }
  };

  if (!out.outlineConfirmed) {
    return (
      <div>
        <div className="panel" style={{ marginBottom: 14 }}>
          <div className="panel-h">
            <h3>조문 체계 확인</h3>
            <span className="help" style={{ margin: 0 }}>순서를 바꾸거나 빼고 더한 뒤 확정하세요. 확정하면 AI가 조문을 씁니다.</span>
          </div>
          <div className="panel-b">
            <label className="help" style={{ display: 'block', margin: '0 0 6px' }}>제목</label>
            <input className="field" value={out.title} onChange={(e) => update((q) => ({ ...q, sampleId: undefined, enact: q.enact && { ...q.enact, title: e.target.value } }))} aria-label="제정안 제목" />
          </div>
        </div>
        <div className="cards">
          {out.outline.map((a, i) => (
            <article key={a.id} className={`card ${a.provenance === 'human' ? 'human' : ''}`}>
              <div className="card-h">
                <ProvBadge p={a.provenance} />
                <h4 style={{ fontFamily: 'var(--doc)' }}>제{i + 1}조</h4>
                <input className="field" style={{ flex: 1, minWidth: 160, padding: '6px 10px' }} value={a.title} onChange={(e) => setArts((x) => x.map((y) => (y.id === a.id ? { ...y, title: e.target.value, provenance: 'human' } : y)))} aria-label={`제${i + 1}조 제목`} />
                <button className="btn ghost small" onClick={() => move(i, -1)} disabled={i === 0} aria-label="위로">▲</button>
                <button className="btn ghost small" onClick={() => move(i, 1)} disabled={i === out.outline.length - 1} aria-label="아래로">▼</button>
                <button className="btn ghost small danger" onClick={() => setArts((x) => x.filter((y) => y.id !== a.id))}>빼기</button>
              </div>
              <input className="field" value={a.summary ?? ''} onChange={(e) => setArts((x) => x.map((y) => (y.id === a.id ? { ...y, summary: e.target.value } : y)))} placeholder="이 조에 담을 내용" aria-label="담을 내용" />
              {(a.evidence ?? []).length > 0 && (
                <div className="acts" style={{ marginTop: 8 }}>
                  {a.evidence!.map((id) => {
                    const ev = p.evidence.find((e) => e.id === id);
                    return <button key={id} className="evchip" onClick={() => openEvidence(ev ?? id)}>근거 {ev?.label ?? id}</button>;
                  })}
                </div>
              )}
            </article>
          ))}
        </div>
        <div className="row-end">
          <button className="btn" onClick={() => setArts((x) => [...x, { id: newId(), title: '새 조', paragraphs: [], provenance: 'human' }])}>조 더하기</button>
          <button className="btn primary" onClick={confirmOutline} disabled={!out.outline.length}>이 체계로 확정하고 조문 쓰기</button>
        </div>
      </div>
    );
  }

  return (
    <div>
      {drafting && <AiProgress title="조문을 한 묶음씩 차근차근 쓰고 있어요" detail={progress?.current} completed={progress?.completed ?? 0} total={out.outline.length} startedAt={startedAt} modelLabel={progress?.modelLabel} phase={progress?.phase} onCancel={() => controller.current?.abort()} />}
      {!drafting && missing > 0 && <div className="panel panel-b" style={{ marginBottom: 14 }}><p>전체 {out.outline.length}개 중 {out.outline.length - missing}개 조문이 작성되어 있습니다. 작성한 내용은 유지하고 남은 {missing}개를 이어서 쓰거나 직접 입력할 수 있어요.</p><button className="btn primary" onClick={confirmOutline}>{missing === out.outline.length ? '조문 초안 작성하기' : `남은 ${missing}개 조문 이어쓰기`}</button></div>}
      <div className="cards">
        {out.outline.map((a, i) => (
          <article key={a.id} className={`card ${a.provenance === 'human' ? 'human' : a.provenance === 'ai_accepted' ? 'accepted' : ''}`}>
            <div className="card-h">
              <ProvBadge p={a.provenance} />
              <h4 style={{ fontFamily: 'var(--doc)' }}>제{i + 1}조({a.title})</h4>
              {a.provenance === 'ai' && a.paragraphs.length > 0 && (
                <button className="btn small" style={{ marginLeft: 'auto' }} disabled={drafting} onClick={() => setArts((x) => x.map((y) => (y.id === a.id ? { ...y, provenance: 'ai_accepted' } : y)))}>확인함</button>
              )}
            </div>
            <textarea
              className="field mono"
              rows={Math.max(3, a.paragraphs.join('\n').split('\n').length + 1)}
              style={{ minHeight: 0 }}
              value={a.paragraphs.join('\n')}
              disabled={drafting}
              placeholder="항마다 한 줄씩 쓰세요. 번호(①②)는 자동으로 붙습니다."
              onChange={(e) => setArts((x) => x.map((y) => (y.id === a.id ? { ...y, paragraphs: toParas(e.target.value), provenance: 'human' } : y)))}
              aria-label={`제${i + 1}조 내용`}
            />
            {(a.evidence ?? []).length > 0 && (
              <div className="acts" style={{ marginTop: 8 }}>
                {a.evidence!.map((id) => {
                  const ev = p.evidence.find((e) => e.id === id);
                  return <button key={id} className={`evchip ${ev ? '' : 'bad'}`} onClick={() => openEvidence(ev ?? id)}>근거 {ev?.label ?? `${id} — 확인 안 되는 근거`}</button>;
                })}
              </div>
            )}
          </article>
        ))}
      </div>
      <h3 className="sec-title" style={{ marginTop: 28 }}>조문으로 보기</h3>
      <div className="split" style={{ gridTemplateColumns: '1fr' }}>
        <div className="col">
          <div className="col-h">{out.title}안</div>
          {enactRule?.articles.map((a) => <div key={a.uid} className="art">{renderArticle(a)}</div>)}
        </div>
      </div>
      <div className="row-end">
        <button className="btn" disabled={drafting} onClick={() => update((q) => ({ ...q, enact: q.enact && { ...q.enact, outlineConfirmed: false } }))}>체계로 돌아가기</button>
        <button className="btn primary" disabled={drafting || missing > 0} onClick={() => setTab('lint')}>다음: 점검하기</button>
      </div>
    </div>
  );
}
