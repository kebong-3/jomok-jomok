import { derive, parseRule, renderArticle, RULE_KIND_LABEL, type Rule, type SpecOp } from '@/engine';
import { AiUnavailable, callRole } from './ai';
import { evidenceText, gatherEvidence } from './evidence';
import { convertOps, type AiOp } from './opconv';
import { newId, type AgentLog, type EnactArticle, type Evidence, type Project } from './project';
import { projectProfile } from '@/config/profiles';
import { mergeKnowledge, type KnowledgeRecord } from './knowledge';
import type { AiProgressEvent } from './ai-protocol';
import { amendmentKind, deriveProject, workMethodLabel } from './amendment-method';

/** Workroom updates resolve after durable storage; synchronous adapters remain supported. */
export type Update = (fn: (p: Project) => Project) => void | Promise<boolean>;

export const STEPS: { step: AgentLog['step']; label: string; actor: AgentLog['actor'] }[] = [
  { step: 'load', label: '원문 불러오기', actor: '규칙 엔진' },
  { step: 'upper', label: '근거 법령 찾기', actor: '법제처' },
  { step: 'plan', label: '고칠 곳 정하기', actor: 'AI' },
  { step: 'link', label: '연결된 곳 정리', actor: '규칙 엔진' },
  { step: 'lint', label: '형식 점검', actor: '규칙 엔진' },
  { step: 'docs', label: '문서 세트 만들기', actor: '규칙 엔진' },
];

export const ENACT_STEPS: typeof STEPS = [
  { step: 'upper', label: '근거 법령 찾기', actor: '법제처' },
  { step: 'plan', label: '조문 체계 제안', actor: 'AI' },
  { step: 'link', label: '조문 초안 쓰기', actor: 'AI' },
  { step: 'lint', label: '형식 점검', actor: '규칙 엔진' },
  { step: 'docs', label: '문서 세트 만들기', actor: '규칙 엔진' },
];

function setLog(update: Update, step: AgentLog['step'], patch: Partial<AgentLog>) {
  update((p) => ({ ...p, log: p.log.map((l) => (l.step === step ? { ...l, ...patch } : l)) }));
}

export function initialLog(mode: 'amend' | 'enact'): AgentLog[] {
  return (mode === 'amend' ? STEPS : ENACT_STEPS).map((s) => ({ ...s, status: 'wait' as const }));
}

/** 'LAW:제16조' 같은 녹화 응답 근거 표기를 실제 근거 ID로 */
export function resolveEvidenceRefs(ids: string[] | undefined, ev: Evidence[]): string[] {
  return (ids ?? [])
    .map((id) => {
      if (!id.startsWith('LAW:')) return id;
      const label = id.slice(4);
      return ev.find((e) => e.label.includes(`」 ${label}(`) || e.label.endsWith(`」 ${label}`))?.id ?? id;
    })
    .filter((x): x is string => !!x && ev.some(e => e.id === x));
}

function outline(rule: Rule) {
  return rule.articles.map((a) => `제${a.num}조${a.br ? `의${a.br}` : ''}${a.title ? `(${a.title})` : ''}`).join('\n');
}

/** 의도와 관련된 조문만 골라 보냄(토큰 절약 — Groq 8K TPM 대응) */
function selectArticles(rule: Rule, intent: string): string {
  const complete = rule.articles.map(renderArticle).join('\n');
  if (complete.length <= 4500) return complete;
  const explicit = new Set([...intent.replace(/\s/g, '').matchAll(/제(\d+)조/g)].map((m) => +m[1]));
  const words = intent.split(/[\s,.]+/).filter((w) => w.length >= 2).map((w) => w.replace(/(을|를|이|가|은|는|에|의|로|으로|과|와|도)$/, ''));
  const scored = rule.articles.map((a) => {
    const t = renderArticle(a);
    const s = (explicit.has(a.num) ? 10 : 0) + words.reduce((n, w) => n + (t.includes(w) ? 1 : 0), 0);
    return { a, s, t };
  });
  const pick = scored.filter((x) => x.s > 0).sort((x, y) => y.s - x.s).slice(0, 6).sort((x, y) => x.a.num - y.a.num);
  let out = '';
  for (const x of pick) {
    if ((out + x.t).length > 4500) break;
    out += x.t + '\n';
  }
  return `[관련 조문 발췌: 전체 ${rule.articles.length}개 조 중 일부입니다. 제공되지 않은 조문의 문구를 추측하지 마세요.]\n${out || scored.slice(0, 4).map((x) => x.t).join('\n').slice(0, 4500)}`;
}

function planVars(rule: Rule, p: Project) {
  return {
    title: rule.title,
    kind: RULE_KIND_LABEL[p.kind],
    outline: outline(rule),
    articles: selectArticles(rule, p.intent),
    intent: p.intent,
    evidence: evidenceText(p.evidence),
  };
}

/** Impact review authorizes only the article candidates explicitly selected by the user. */
export function scopedImpactOps(p: Project, ops: AiOp[]): { allowed: AiOp[]; rejected: number } {
  if (!p.impact) return { allowed: ops, rejected: 0 };
  const selected = new Set(p.impact.candidates.filter(c => p.impact!.selectedIds.includes(c.id)).map(c => c.target.replace(/\s/g, '')));
  const allowed = ops.filter(o => {
    if (o.type === 'insert_article') return false;
    const match = (o.target ?? '').replace(/\s/g, '').match(/^(제\d+조(?:의\d+)?)(?=제\d+항|\(|$)/);
    return !!match && selected.has(match[1]);
  });
  return { allowed, rejected: ops.length - allowed.length };
}

/** 두 AI 비교: 같은 입력을 다른 모델에 보내 제안을 나란히 본다 */
export async function runCompare(p: Project, rule: Rule, modelId: string): Promise<{ ops: SpecOp[]; via: 'live' | 'cassette'; model: string; ms: number; knowledge?: KnowledgeRecord }> {
  const r = await callRole<{ ops: AiOp[]; model?: string }>('amend_plan', planVars(rule, p), { modelId, strictModel: true, allowCassette: false });
  if (r.model !== modelId) throw new AiUnavailable('선택한 비교 모델이 아닌 응답을 받았습니다. 설정에서 연결을 확인하세요.');
  const scoped = scopedImpactOps(p, r.data.ops);
  if (scoped.rejected) throw new AiUnavailable(`다른 AI가 선택한 영향 검토 범위 밖의 변경 ${scoped.rejected}건을 제안하여 비교 결과를 반영하지 않았습니다.`);
  const ops = scoped.allowed.map((o) => ({ ...o, evidence: resolveEvidenceRefs(o.evidence, p.evidence) }));
  const conv = convertOps(rule, ops, 'ai', new Set(p.evidence.map((e) => e.id)));
  return { ops: conv.ok, via: r.via, model: r.via === 'live' ? r.modelLabel ?? modelId : `${r.data.model ?? modelId} (예시 응답)`, ms: r.ms, knowledge: r.knowledge ? { ...r.knowledge, role: 'compare' } : undefined };
}

export async function runAmendPipeline(p0: Project, update: Update): Promise<void> {
  const t = () => performance.now();
  // 1 원문
  let t0 = t();
  setLog(update, 'load', { status: 'running' });
  const rule = parseRule(p0.source.raw, p0.kind);
  setLog(update, 'load', { status: 'ok', ms: Math.round(t() - t0), detail: `${rule.articles.length}개 조${rule.annexes.length ? `, 별표·서식 ${rule.annexes.length}개` : ''}를 읽었습니다${rule.diagnostics.length ? ` · 정확히 읽지 못한 곳 ${rule.diagnostics.length}곳` : ''}`, tools: ['parse_rule'] });

  // 2 근거
  t0 = t();
  setLog(update, 'upper', { status: 'running' });
  const g = await gatherEvidence(p0.source.raw, p0.intent, p0.upperLaw ? [p0.upperLaw] : []);
  const allEvidence = [...g.evidence, ...p0.evidence.filter((e) => e.kind !== 'law')];
  update((p) => ({ ...p, evidence: allEvidence }));
  const via = g.vias.includes('live') ? '법제처 원문' : g.vias.includes('relay') ? '법제처 원문(중계)' : g.vias.length ? '저장본' : '';
  setLog(update, 'upper', { status: g.evidence.length ? 'ok' : 'skipped', ms: Math.round(t() - t0), detail: [g.evidence.length ? `${g.evidence.map((e) => e.label).join(', ')} · ${via}` : '공식 API에서 연결할 상위 법령을 찾지 못했습니다', p0.impact ? '사용자가 제공한 개정 전·후 원문을 별도 근거로 유지했습니다(공식 대조 필요).' : '', ...g.notes].filter(Boolean).join(' · '), tools: ['search_law', 'get_law_text'] });

  // 3 계획(AI)
  t0 = t();
  setLog(update, 'plan', { status: 'running' });
  if (amendmentKind(p0) === 'repeal') {
    setLog(update, 'plan', { status: 'ok', detail: '규정 전체 폐지안을 준비합니다. 폐지 이유와 기존 업무 처리 판단은 담당자가 작성합니다.', tools: ['build_repeal_bill'] });
    for (const step of ['link', 'lint', 'docs'] as const) setLog(update, step, { status: 'ok', detail: '문서 단계에서 종전 부칙과 진행 중인 업무를 확인하세요.' });
    return;
  }
  try {
    const r = await callRole<{ ops: AiOp[] }>('amend_plan', {
      title: rule.title,
      kind: RULE_KIND_LABEL[p0.kind],
      outline: outline(rule),
      articles: selectArticles(rule, p0.intent),
      intent: p0.intent,
      evidence: evidenceText(allEvidence.filter(e => e.kind !== 'rule')),
    }, { sampleId: p0.sampleId });
    const scoped = scopedImpactOps(p0, r.data.ops);
    if (!scoped.allowed.length && scoped.rejected) throw new AiUnavailable(`선택한 영향 검토 범위 밖의 AI 제안 ${scoped.rejected}건을 제외했습니다. 선택한 조문에 적용할 제안이 없습니다.`);
    const ops = scoped.allowed.map((o) => ({ ...o, evidence: resolveEvidenceRefs(o.evidence, allEvidence) }));
    const conv = convertOps(rule, ops, 'ai', new Set(allEvidence.map((e) => e.id)));
    if (!conv.ok.length && conv.dropped.length) throw new AiUnavailable(`AI 제안 ${conv.dropped.length}건을 원문에 적용할 수 없어 반영하지 않았습니다. ${conv.dropped[0].reason}`);
    update((p) => ({ ...p, spec: { ...p.spec, ops: conv.ok }, knowledge: mergeKnowledge(p.knowledge, r.knowledge), planVia: r.via, planModel: r.modelLabel, planModelId: r.model, planFamily: r.family, planError: undefined, planTrace: r.trace }));
    setLog(update, 'plan', {
      status: 'ok', ms: r.ms, model: r.via === 'live' ? r.modelLabel : '예시 응답',
      detail: `변경 제안 ${conv.ok.length}건${scoped.rejected ? ` · 선택 범위 밖 ${scoped.rejected}건 제외` : ''}${selectArticles(rule, p0.intent).startsWith('[관련 조문 발췌:') ? ' · 긴 규정의 관련 조문만 AI가 검토했습니다. 전체 정비 요청은 구간별로 나누어 확인하세요.' : ''}${conv.dropped.length ? ` · 형식이 맞지 않아 뺀 제안 ${conv.dropped.length}건` : ''}${r.note ? ` · ${r.note}` : ''}`,
      tools: ['search_drafting_references', 'amend_plan'],
    });
  } catch (e) {
    update((p) => ({ ...p, planVia: 'manual', planError: (e as Error).message }));
    setLog(update, 'plan', { status: 'failed', ms: Math.round(t() - t0), detail: (e as Error).message });
  }

  // 4~6 엔진(결정론) — 화면에서 즉시 다시 계산되므로 여기서는 시간만 기록
  for (const step of ['link', 'lint', 'docs'] as const) {
    t0 = t();
    setLog(update, step, { status: 'running' });
    setLog(update, step, { status: 'ok', ms: Math.max(1, Math.round(t() - t0)), tools: step === 'link' ? ['apply_ops', 'find_citations', 'analyze_impact', 'diff'] : step === 'lint' ? ['lint_rule'] : ['build_amend_text', 'build_addenda', 'build_document'] });
  }
}

/** 삭제되는 항을 인용하는 곳 → AI 문안 제안(파생 연산) */
export async function suggestDeletedFix(p: Project, rule: Rule, where: string, deleted: string, onKnowledge?: (record: KnowledgeRecord) => void): Promise<SpecOp | undefined> {
  const art = rule.articles.find((a) => where.startsWith(`제${a.num}조${a.br ? `의${a.br}` : ''}`));
  if (!art) return undefined;
  const target = rule.articles.find((a) => deleted.startsWith(`제${a.num}조`));
  const dp = target?.paragraphs.find((x) => deleted.endsWith(`제${x.num}항`));
  try {
    const r = await callRole<{ find: string; replace: string; why?: string }>('fix_suggest', { where, text: renderArticle(art), deleted, deletedText: dp?.text ?? '' }, { sampleId: p.sampleId, cassetteKey: where.replace(/제\d+항$/, '') });
    if (r.knowledge) onKnowledge?.(r.knowledge);
    const conv = convertOps(rule, [{ type: 'replace_text', target: where, find: r.data.find, replace: r.data.replace, why: r.data.why }], 'ai');
    const op = conv.ok[0];
    if (!op) return undefined;
    return { ...op, derivedFrom: `deleted:${deleted}`, why: `${r.data.why ?? ''}${r.via === 'cassette' ? ' (예시 응답)' : ''}` };
  } catch {
    return undefined;
  }
}

export function enactReasonReady(p: Project): boolean {
  return !!p.enact?.outlineConfirmed && p.enact.outline.length > 0 &&
    p.enact.outline.every((a) => a.paragraphs.some((text) => text.trim()));
}

export async function runReason(p: Project, rule: Rule, opts: { signal?: AbortSignal; onProgress?: (progress: AiProgressEvent) => void } = {}): Promise<{ reason: string; mainPoints: string[]; via: 'live' | 'cassette' | 'template'; model?: string; note?: string; knowledge?: KnowledgeRecord }> {
  const enact = p.mode === 'enact';
  if (enact && !enactReasonReady(p)) return {
    reason: '', mainPoints: [], via: 'template',
    note: '조문 체계를 확정하고 각 조의 내용을 작성한 뒤 제정이유를 작성해 주세요.',
  };
  const d = enact ? undefined : deriveProject(p, rule, { style: projectProfile(p).style, excludedFixes: new Set(p.excludedFixes) });
  const changes = enact ? rule.articles.map(renderArticle).join('\n') : amendmentKind(p) === 'repeal' ? `${rule.title} 폐지. 폐지 사유(담당자 입력): ${p.amendmentDecision?.note ?? '[미확인]'}` : amendmentKind(p) === 'full' ? d!.fullText : d!.amendPlain;
  try {
    const r = await callRole<{ reason: string; mainPoints: string[] }>('reason', {
      title: rule.title, kind: RULE_KIND_LABEL[p.kind], mode: workMethodLabel(p),
      intent: enact ? '확정된 제정 조문 본문만을 근거로 목적과 주요내용을 정리하세요.' : p.intent,
      changes, evidence: evidenceText(p.evidence),
    }, { allowCassette: false, ...opts });
    return { ...r.data, via: r.via, model: r.modelLabel, knowledge: r.knowledge };
  } catch (error) {
    if (opts.signal?.aborted || (error instanceof AiUnavailable && error.code === 'AI_CANCELLED')) throw error;
    // 명령형 사용자 입력이나 오래된 체계 요약을 이유서 문장으로 위장하지 않는다.
    const mainPoints = enact
      ? rule.articles.map((a) => `${a.paragraphs.map((para) => para.text.trim()).filter(Boolean).join(' ').replace(/[.。]$/, '')}(안 제${a.num}조${a.br ? `의${a.br}` : ''}).`)
      : amendmentKind(p) === 'repeal' ? [`「${rule.title}」를 폐지함.`] : amendmentKind(p) === 'full' ? d!.after.articles.filter(a => !a.deleted).map(a => `${a.title ?? '조문'}(안 제${a.num}조${a.br ? `의${a.br}` : ''}).`) : d!.amend.sentences.map((s) => `${s.text.replace(/한다\.$/, '함')}.`);
    return {
      reason: '', mainPoints, via: 'template',
      note: `AI 이유서 작성 실패: ${(error as Error).message} 주요내용은 ${enact ? '확정된 현재 조문 본문' : '수락한 변경'}으로 정리했습니다. ${enact ? '제정' : '개정'}이유를 직접 작성한 뒤 확인해 주세요.`,
    };
  }
}

// ───────── 제정 ─────────

export async function runEnactOutline(p0: Project, updateProject: Update, opts: { signal?: AbortSignal; onProgress?: (progress: AiProgressEvent) => void } = {}): Promise<void> {
  const update: Update = fn => updateProject(p => p.id === p0.id ? fn(p) : p);
  let t0 = performance.now();
  setLogE(update, 'upper', { status: 'running' });
  const g = await gatherEvidence('', p0.purpose ?? '', p0.upperLaw ? [p0.upperLaw] : []);
  const allEvidence = [...g.evidence, ...p0.evidence.filter(e => e.kind !== 'law')];
  update((p) => ({ ...p, evidence: allEvidence }));
  setLogE(update, 'upper', { status: g.evidence.length ? 'ok' : 'skipped', ms: Math.round(performance.now() - t0), detail: g.evidence.length ? g.evidence.map((e) => e.label).join(', ') : '연결한 상위 법령이 없습니다', tools: ['search_law', 'get_law_text'] });
  t0 = performance.now();
  setLogE(update, 'plan', { status: 'running' });
  try {
    if (opts.signal?.aborted) throw new AiUnavailable('AI 작성을 중단했습니다.', 'AI_CANCELLED');
    const r = await callRole<{ title: string; articles: { title: string; summary: string; evidence?: string[] }[] }>('enact_outline', {
      kind: RULE_KIND_LABEL[p0.kind], purpose: p0.purpose ?? '', upper: p0.upperLaw ?? '', evidence: evidenceText(allEvidence), institution: projectProfile(p0).name, title: p0.title,
    }, { sampleId: p0.sampleId, ...opts });
    const outlineArts: EnactArticle[] = r.data.articles.map((a) => ({ id: newId(), title: a.title, summary: a.summary, paragraphs: [], evidence: resolveEvidenceRefs(a.evidence, allEvidence), provenance: 'ai' }));
    update((p) => ({ ...p, knowledge: mergeKnowledge(p.knowledge, r.knowledge), title: r.data.title || p.title, planVia: r.via, planModel: r.modelLabel, planModelId: r.model, planFamily: r.family, planTrace: r.trace, planError: undefined, enact: { title: r.data.title || p.title, outline: outlineArts, outlineConfirmed: false, via: r.via } }));
    setLogE(update, 'plan', { status: 'ok', ms: r.ms, model: r.via === 'live' ? r.modelLabel : '예시 응답', detail: `${outlineArts.length}개 조로 체계를 제안했습니다${r.note ? ` · ${r.note}` : ''}`, tools: ['enact_outline'] });
  } catch (error) {
    const base = ['목적', '정의', '적용 범위', '시행규칙'];
    update((p) => ({ ...p, planVia: 'manual', planError: opts.signal?.aborted ? undefined : (error as Error).message, enact: p.enact ?? { title: p.title, outline: base.map((t) => ({ id: newId(), title: t, paragraphs: [], provenance: 'human' })), outlineConfirmed: false } }));
    setLogE(update, 'plan', { status: opts.signal?.aborted ? 'skipped' : 'failed', ms: Math.round(performance.now() - t0), detail: `${(error as Error).message} 기본 체계로 직접 작성할 수 있습니다.` });
  }
}

export interface DraftProgress {
  completed: number;
  total: number;
  current: string;
  modelLabel?: string;
  phase?: AiProgressEvent['phase'];
}
interface DraftArticle { articleNo?: number; title: string; paragraphs: string[]; evidence?: string[] }
const hasContent = (article: EnactArticle) => article.paragraphs.some(text => text.trim());
const titleKey = (value: string) => value.normalize('NFC').replace(/\s/g, '');

/** Match the response to the requested articles; never position-shift a mismatched draft. */
export function validateDraftBatch(articles: DraftArticle[], requested: { article: EnactArticle; index: number }[]): DraftArticle[] {
  if (!Array.isArray(articles) || articles.length !== requested.length) throw new AiUnavailable('요청한 조문 수와 AI 응답이 달라 이번 묶음을 반영하지 않았습니다. 남은 조문을 다시 작성해 주세요.', 'LLM_SCHEMA');
  const used = new Set<DraftArticle>();
  return requested.map(({ article, index }) => {
    const matches = articles.filter(d => !used.has(d) && titleKey(d.title) === titleKey(article.title) && (d.articleNo === undefined || d.articleNo === index + 1));
    if (matches.length !== 1 || !Array.isArray(matches[0].paragraphs) || !matches[0].paragraphs.length || matches[0].paragraphs.some(text => typeof text !== 'string' || !text.trim())) throw new AiUnavailable(`제${index + 1}조(${article.title})의 완성된 본문을 확인하지 못했습니다. 이번 묶음은 반영하지 않았습니다.`, 'LLM_SCHEMA');
    used.add(matches[0]);
    return matches[0];
  });
}

export async function runEnactDraft(p0: Project, updateProject: Update, opts: { signal?: AbortSignal; onProgress?: (progress: DraftProgress) => void } = {}): Promise<void> {
  const update: Update = fn => updateProject(p => p.id === p0.id ? fn(p) : p);
  const t0 = performance.now();
  const out = p0.enact!;
  if (!out?.outlineConfirmed || !out.outline.length) return;
  const total = out.outline.length;
  let working = out.outline.map(article => ({ ...article, paragraphs: [...article.paragraphs] }));
  const remaining = working.map((article, index) => ({ article, index })).filter(({ article }) => !hasContent(article));
  let completed = working.filter(hasContent).length;
  const completedAtStart = completed;
  const sameOutline = (p: Project) => p.id === p0.id && p.enact?.outlineConfirmed && p.enact.outline.length === total && p.enact.outline.every((a, i) => a.id === out.outline[i].id && a.title === out.outline[i].title);
  const fullOutline = out.outline.map((a, i) => `제${i + 1}조(${a.title}) ${a.summary ?? ''}`).join('\n');
  const evidence = evidenceText(p0.evidence);
  setLogE(update, 'link', { status: 'running', detail: `${completed}/${total}개 조문 작성 · 남은 조문을 3개씩 이어서 작성합니다.`, ms: undefined });
  setLogE(update, 'lint', { status: 'wait', detail: '모든 조문 본문을 작성한 뒤 점검합니다.', ms: undefined });
  setLogE(update, 'docs', { status: 'wait', detail: '조문 작성과 담당자 확인 후 문서를 준비합니다.', ms: undefined });
  update(p => p.id === p0.id ? { ...p, planError: undefined } : p);
  try {
    for (let start = 0; start < remaining.length; start += 3) {
      if (opts.signal?.aborted) throw new AiUnavailable('AI 작성을 중단했습니다.', 'AI_CANCELLED');
      const batch = remaining.slice(start, start + 3);
      const current = batch.map(({ article, index }) => `제${index + 1}조(${article.title})`).join(' · ');
      opts.onProgress?.({ completed, total, current, phase: 'preparing' });
      setLogE(update, 'link', { status: 'running', detail: `${completed}/${total}개 조문 작성 · ${current} 작성 중` });
      const r = await callRole<{ articles: DraftArticle[] }>('enact_draft', {
        kind: RULE_KIND_LABEL[p0.kind], title: out.title, institution: projectProfile(p0).name, purpose: p0.purpose ?? '',
        outline: fullOutline,
        targets: JSON.stringify(batch.map(({ article, index }) => ({ articleNo: index + 1, title: article.title, summary: article.summary ?? '' }))),
        previous: working.flatMap((article, index) => hasContent(article) ? [`제${index + 1}조(${article.title}) ${article.paragraphs.join('\n')}`] : []).join('\n\n'),
        evidence,
      }, { sampleId: p0.sampleId, signal: opts.signal, onProgress: progress => opts.onProgress?.({ completed, total, current, ...progress }) });
      if (opts.signal?.aborted) throw new AiUnavailable('AI 작성을 중단했습니다.', 'AI_CANCELLED');
      const supplied = r.via === 'cassette' ? r.data.articles.filter(article => batch.some(target => titleKey(target.article.title) === titleKey(article.title))) : r.data.articles;
      const checked = validateDraftBatch(supplied, batch);
      const written = new Map(batch.map(({ article }, i) => [article.id, checked[i]]));
      const batchKnowledge = r.knowledge ? { ...r.knowledge, role: `enact_draft:${batch.map(({ index }) => index + 1).join(',')}`, note: [r.knowledge.note, `${current} 작성에 전달한 참고자료${r.actualModel ? ` · 실제 모델 ${r.actualModel}` : ''}`].filter(Boolean).join(' · ').slice(0, 2000) } : undefined;
      working = working.map(article => {
        const draft = written.get(article.id);
        return draft ? { ...article, paragraphs: draft.paragraphs, evidence: resolveEvidenceRefs(draft.evidence, p0.evidence), provenance: 'ai' as const } : article;
      });
      completed = working.filter(hasContent).length;
      // Wait for this group's storage acknowledgement before spending another
      // provider request. The visible result remains available if storage fails.
      const saved = await update(p => !sameOutline(p) ? p : ({ ...p,
        planError: undefined, planVia: r.via, planModel: r.modelLabel, planModelId: r.model, planFamily: r.family, planTrace: r.trace,
        knowledge: mergeKnowledge(p.knowledge, batchKnowledge),
        enact: { ...p.enact!, via: r.via, outline: p.enact!.outline.map(article => {
          const draft = written.get(article.id);
          return draft && !hasContent(article) ? { ...article, paragraphs: draft.paragraphs, evidence: resolveEvidenceRefs(draft.evidence, p.evidence), provenance: 'ai' as const } : article;
        }) },
      }));
      if (saved === false) throw new AiUnavailable('작성한 조문의 기기 저장을 확인하지 못해 다음 AI 요청을 멈췄습니다.', 'SAVE_FAILED');
      opts.onProgress?.({ completed, total, current: `${current} 작성 완료`, modelLabel: r.modelLabel, phase: 'validating' });
      setLogE(update, 'link', { status: 'running', ms: Math.round(performance.now() - t0), model: r.via === 'live' ? r.modelLabel : '예시 응답', detail: `${completed}/${total}개 조문 작성${r.note ? ` · ${r.note}` : ''}`, tools: ['enact_draft_batch', 'checkpoint_draft'] });
    }
    setLogE(update, 'link', { status: 'ok', ms: Math.round(performance.now() - t0), detail: `${total}개 조문 작성 완료${completedAtStart ? ` · 기존 ${completedAtStart}개 조문 유지` : ''} · 담당자 내용 확인 필요`, tools: ['enact_draft_batch', 'checkpoint_draft'] });
    setLogE(update, 'lint', { status: 'ok', ms: 1, detail: '작성된 초안의 형식 점검 결과를 확인하세요.', tools: ['lint_rule'] });
    setLogE(update, 'docs', { status: 'wait', detail: '조문 내용과 제정이유를 확인한 뒤 문서를 받을 수 있습니다.', ms: undefined });
  } catch (error) {
    const cancelled = opts.signal?.aborted || (error instanceof AiUnavailable && error.code === 'AI_CANCELLED');
    const storageFailed = error instanceof AiUnavailable && error.code === 'SAVE_FAILED';
    const detail = storageFailed
      ? `화면에 ${completed}/${total}개 조문이 있지만 기기 저장을 확인하지 못해 다음 AI 요청을 멈췄습니다. 새로고침하거나 창을 닫기 전에 ‘작업 보관’으로 파일을 받고 ‘저장 다시 시도’를 눌러 주세요.`
      : `${cancelled ? '작성을 중단했습니다.' : (error as Error).message} ${completed}/${total}개 조문을 유지합니다. 남은 ${total - completed}개 조문을 이어서 작성할 수 있습니다.`;
    update(p => p.id === p0.id ? { ...p, planError: cancelled ? undefined : detail } : p);
    setLogE(update, 'link', { status: cancelled ? 'skipped' : 'failed', ms: Math.round(performance.now() - t0), detail });
    setLogE(update, 'lint', { status: 'wait', detail: storageFailed ? '기기 저장을 확인한 뒤 전체 점검을 진행하세요.' : '미작성 조문이 있어 전체 점검을 기다립니다.', ms: undefined });
    setLogE(update, 'docs', { status: 'wait', detail: storageFailed ? '화면의 내용을 작업 보관 파일로 먼저 받아 주세요.' : '미작성 조문이 있어 문서 준비를 기다립니다.', ms: undefined });
  }
}

function setLogE(update: Update, step: AgentLog['step'], patch: Partial<AgentLog>) {
  setLog(update, step, patch);
}

/** 제정 초안 → 규정 구조 */
export function enactRule(p: Project): Rule {
  const lines = [p.enact?.title ?? p.title];
  (p.enact?.outline ?? []).forEach((a, i) => {
    const paras = a.paragraphs.length ? a.paragraphs : ['(내용을 써 주세요)'];
    const circ = (n: number) => String.fromCodePoint(0x2460 + n - 1);
    paras.forEach((t, j) => lines.push(j === 0 ? `제${i + 1}조(${a.title}) ${paras.length > 1 ? circ(1) + ' ' : ''}${t}` : `${circ(j + 1)} ${t}`));
  });
  return parseRule(lines.join('\n'), p.kind);
}
