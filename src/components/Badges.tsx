import type { Provenance } from '@/engine';

export function ProvBadge({ p, model }: { p: Provenance | 'law'; model?: string }) {
  if (p === 'ai') return <span className="badge b-ai" title={model ? `AI 작성(${model}) · 아직 확인 전` : 'AI 작성 · 아직 확인 전'}>AI</span>;
  if (p === 'ai_accepted') return <span className="badge b-ai-ok" title="AI가 쓰고 담당자가 수락함">AI✓</span>;
  if (p === 'engine') return <span className="badge b-rule" title="규칙 엔진이 계산함(AI 아님)">규칙</span>;
  if (p === 'law') return <span className="badge b-law" title="법제처 원문">법제처</span>;
  return <span className="badge b-human" title="담당자가 직접 씀">직접</span>;
}

export function SourceBadge({ via, date }: { via: string; date?: string }) {
  if (via === 'live' || via === 'relay') return <span className="badge b-law" title="법제처에서 방금 받은 원문">● 법제처 원문{date ? ` ${date.replace(/-/g, '. ')}.` : ''}</span>;
  if (via === 'snapshot') return <span className="badge b-snap" title="저장해 둔 원문입니다. 그 이후 바뀐 내용은 반영되지 않았을 수 있습니다">◐ 저장본{date ? ` ${date.replace(/-/g, '. ')}. 기준` : ''}</span>;
  if (via === 'cassette') return <span className="badge b-tape" title="미리 만들어 둔 예시 응답입니다. 대비표·개정문·점검은 실제로 계산합니다">▷ 예시 응답</span>;
  return <span className="badge b-unk">○ 확인 못 함</span>;
}
