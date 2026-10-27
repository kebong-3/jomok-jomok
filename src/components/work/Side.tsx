'use client';
import { useState } from 'react';
import type { SpecOp } from '@/engine';
import { SourceBadge, ProvBadge } from '@/components/Badges';
import type { Evidence, Project } from '@/lib/project';
import { opTitle } from '@/lib/opconv';

export function LogPanel({ p, onCompare, canCompare, onEvidence }: { p: Project; onCompare: () => void; canCompare: boolean; onEvidence?: (e: Evidence) => void }) {
  const [open, setOpen] = useState(true);
  const total = p.log.reduce((s, l) => s + (l.ms ?? 0), 0);
  return (
    <aside className="panel log" aria-label="에이전트 작업 기록">
      <div className="panel-h">
        <h3>작업 기록</h3>
        <span className="help" style={{ margin: 0 }}>{total ? `${(total / 1000).toFixed(1)}초` : ''}</span>
        <button className="btn ghost small" style={{ marginLeft: 'auto' }} onClick={() => setOpen((v) => !v)} aria-expanded={open}>{open ? '접기' : '펼치기'}</button>
      </div>
      {open && (
        <>
          <ol>
            {p.log.map((l) => (
              <li key={l.step}>
                <span className={`st ${l.status}`} aria-label={l.status} />
                <div>
                  <div className="l1">
                    {l.label}
                    <span className={`badge ${l.actor === 'AI' ? 'b-ai' : l.actor === '법제처' ? 'b-law' : l.actor === '사람' ? 'b-human' : 'b-rule'}`}>{l.actor}</span>
                    {l.ms != null && l.status !== 'running' && <span className="l2">{l.ms < 1000 ? `${l.ms}ms` : `${(l.ms / 1000).toFixed(1)}s`}</span>}
                  </div>
                  {l.model && <div className="l2">모델: {l.model}</div>}
                  {l.detail && <div className="l2">{l.detail}</div>}
                  {l.tools && <div className="tools">{l.tools.join(' · ')}</div>}
                </div>
              </li>
            ))}
          </ol>
          {p.evidence.length > 0 && (
            <div className="panel-b" style={{ borderTop: '1px solid var(--line-2)' }}>
              <p className="help" style={{ margin: '0 0 6px' }}>찾은 근거</p>
              {p.evidence.map((e) => (
                <div key={e.id} style={{ fontSize: '1.35rem', marginBottom: 8 }}><button className="btn ghost small" style={{ textAlign: 'left', padding: 0, whiteSpace: 'normal' }} onClick={() => onEvidence?.(e)}>{e.label}</button> <SourceBadge via={e.via} date={e.date} /><div className="help" style={{ margin: 0 }}>시행일 {e.effectiveAt ?? '미확인'}</div></div>
              ))}
            </div>
          )}
          {canCompare && (
            <div className="panel-b" style={{ borderTop: '1px solid var(--line-2)' }}>
              <button className="btn small" style={{ width: '100%' }} onClick={onCompare}>다른 AI에게도 물어보기</button>
              <p className="help">같은 입력을 다른 모델에 보내 제안을 나란히 봅니다.</p>
            </div>
          )}
        </>
      )}
    </aside>
  );
}

export function EvidenceDrawer({ ev, onClose }: { ev: Evidence | string; onClose: () => void }) {
  const bad = typeof ev === 'string';
  return (
    <>
      <div className="drawer-bg" onClick={onClose} />
      <div className="drawer" role="dialog" aria-modal="true" aria-label="근거">
        <div className="drawer-h">
          <h3>{bad ? '확인 안 되는 근거' : ev.label}</h3>
          <button className="btn ghost small" onClick={onClose} autoFocus>닫기</button>
        </div>
        <div className="drawer-b">
          {bad ? (
            <p>AI가 “{ev}”를 근거로 들었지만, 조목조목이 실제로 찾은 법령 목록에 없습니다. 이 제안은 근거를 직접 확인한 뒤에 수락하세요.</p>
          ) : (
            <>
              <p style={{ marginTop: 0 }}><SourceBadge via={ev.via} date={ev.date} /></p>
              <dl className="evidence-meta">
                <dt>시행일</dt><dd>{ev.effectiveAt ?? '미확인'}</dd>
                <dt>조회·등록 시각</dt><dd>{ev.fetchedAt ?? '이전 작업: 미기록'}</dd>
                {ev.date && <><dt>자료 기준일</dt><dd>{ev.date}</dd></>}
                {ev.lawId && <><dt>법령 식별자</dt><dd>{ev.lawId}</dd></>}
                <dt>보존 원문 지문(SHA-256)</dt><dd style={{ overflowWrap: 'anywhere', fontSize: '1.25rem' }}>{ev.contentHash ?? '이전 작업: 미기록'}</dd>
              </dl>
              {(ev.partial || ev.note) && <p className="help">{ev.note ?? '일부 발췌 근거입니다. 전체 법령과 부칙·별표는 별도로 확인하세요.'}</p>}
              <div className="lawtext">{ev.text}</div>
              {ev.via === 'snapshot' && <p className="help">저장본입니다. 그 이후 개정된 내용은 반영되지 않았을 수 있으니 법제처에서 한 번 더 확인하세요.</p>}
              {ev.via === 'user' && <p className="help">사용자가 제공한 원문입니다. 공식 원문 확인을 대신하지 않습니다.</p>}
              {ev.url && <p><a href={ev.url} target="_blank" rel="noreferrer">출처 원문에서 보기</a></p>}
              {ev.url && <p className="help">출처 페이지는 이후 개정본을 보여줄 수 있습니다. 위 시행일과 보존한 원문을 함께 대조하세요.</p>}
            </>
          )}
        </div>
      </div>
    </>
  );
}

export function CompareModal({ p, mine, other, onClose, onAdopt }: { p: Project; mine: SpecOp[]; other: { ops: SpecOp[]; model: string; via: string } | 'loading' | { error: string }; onClose: () => void; onAdopt: (op: SpecOp) => void }) {
  const list = (ops: SpecOp[], adopt?: boolean) => (
    <div className="cards">
      {ops.map((o) => {
        const same = !adopt ? false : mine.some((m) => JSON.stringify(m.change) === JSON.stringify(o.change));
        return (
          <div key={o.id} className="card" style={{ padding: '12px 14px' }}>
            <div className="card-h"><ProvBadge p="ai" /><h4 style={{ fontSize: '1.5rem' }}>{opTitle(o.change)}</h4>{same && <span className="badge b-law">같은 제안</span>}</div>
            {o.why && <p className="why" style={{ margin: 0 }}>{o.why}</p>}
            {adopt && !same && <div className="acts" style={{ marginTop: 8 }}><button className="btn small" onClick={() => onAdopt(o)}>이 제안 가져오기</button></div>}
          </div>
        );
      })}
      {!ops.length && <div className="empty">제안 없음</div>}
    </div>
  );
  return (
    <>
      <div className="drawer-bg" onClick={onClose} />
      <div className="modal" onClick={onClose}>
        <div className="modal-box" role="dialog" aria-modal="true" aria-label="두 AI 비교" onClick={(e) => e.stopPropagation()}>
          <div className="drawer-h"><h3>두 AI 제안 비교</h3><button className="btn ghost small" onClick={onClose} autoFocus>닫기</button></div>
          <div className="drawer-b grid2" style={{ alignItems: 'start' }}>
            <div>
              <p className="help" style={{ margin: '0 0 8px' }}>지금 제안 · {p.planVia === 'cassette' ? '미리 작성한 예시' : p.planModel ?? '직접 작성'}</p>
              {list(mine)}
            </div>
            <div>
              {other === 'loading' ? <p className="help">다른 AI가 생각하는 중…</p> : 'error' in other ? <p className="err">{other.error}</p> : (
                <>
                  <p className="help" style={{ margin: '0 0 8px' }}>다른 AI · {other.model}</p>
                  {list(other.ops, true)}
                </>
              )}
            </div>
          </div>
          <p className="help" style={{ padding: '0 20px 20px', margin: 0 }}>모델의 일치는 법적 타당성을 보장하지 않습니다. 같은 제안과 다른 제안을 확인하고 원문 근거로 판단하세요. 비교 요청은 선택한 모델만 호출하며 실패하면 그대로 표시합니다.</p>
        </div>
      </div>
    </>
  );
}
