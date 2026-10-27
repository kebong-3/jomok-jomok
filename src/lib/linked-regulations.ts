import { RULE_KINDS } from '@/engine/types';
import { z } from 'zod';
import { hashText, renderArticle, type Article, type Rule, type RuleKind } from '@/engine';
import type { Project } from './project';
import { amendmentKind } from './amendment-method';

const date = z.string().max(10).refine(value => {
  if (!value) return true;
  const normalized = /^\d{8}$/.test(value) ? `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6)}` : value;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return false;
  const parsed = new Date(`${normalized}T00:00:00Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === normalized;
});
const sourceUrl = z.string().max(4096).refine(value => {
  try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password && ![...url.searchParams.keys()].some(key => /^(?:key|api[-_]?key|token|access[-_]?token|secret|password|authorization|signature)$/i.test(key)); } catch { return false; }
});
export const linkedRegulationSchema = z.object({
  id: z.string().min(1).max(128), title: z.string().trim().min(1).max(500),
  kind: z.enum(RULE_KINDS),
  effectiveAt: date.optional(), raw: z.string().min(1).max(100_000).refine(value => !!value.trim()),
  sourceUrl: sourceUrl.optional(), partial: z.boolean().optional(), note: z.string().max(5000).optional(),
});
export const linkedRegulationsSchema = z.array(linkedRegulationSchema).max(8).superRefine((items, ctx) => {
  if (new Set(items.map(item => item.id)).size !== items.length) ctx.addIssue({ code: 'custom', message: '규정 식별자가 중복되어 있습니다.' });
});
export type LinkedRegulation = z.infer<typeof linkedRegulationSchema>;
export type LinkedTarget = { kind: 'article'; art: number; br?: number; para?: number } | { kind: 'table' | 'form'; num: number; br?: number };
export type LinkedImpactKind = 'moved' | 'deleted' | 'text_changed' | 'full' | 'repeal' | 'unchanged' | 'missing_before' | 'unlinked';
export const LINKED_IMPACT_LABELS: Record<LinkedImpactKind, string> = { moved: '인용 대상 이동 후보', deleted: '인용 대상 삭제 후보', text_changed: '인용 대상 본문 변경', full: '전부개정에 따른 재대조', repeal: '폐지에 따른 근거·업무 재검토', unchanged: '직접 대상의 문자열 변화 없음', missing_before: '기준 원문에서 대상 미확인', unlinked: '규정명 표기 불충분 · 연결 미확정' };
export interface LinkedRegulationImpact {
  id: string; regulationId: string; regulationTitle: string; target: LinkedTarget; citation: string;
  confidence: 'exact_title' | 'unverified_title'; impact: LinkedImpactKind; location: string; line: number; excerpt: string;
  beforeText?: string; afterText?: string; movedTo?: string; checks: string[];
}
export interface LinkedRegulationAnalysis { exact: LinkedRegulationImpact[]; uncertain: LinkedRegulationImpact[]; coverage: { regulationId: string; title: string; issues: string[] }[] }

const normalizeTitle = (title: string) => title.normalize('NFC').replace(/\s+/g, '');
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const targetPattern = '(?:제\\s*\\d+\\s*조(?:\\s*의\\s*\\d+)?(?:\\s*제\\s*\\d+\\s*항)?|별표\\s*\\d+(?:\\s*의\\s*\\d+)?|별지\\s*제?\\s*\\d+(?:\\s*의\\s*\\d+)?\\s*호\\s*서식)';
function parseTarget(text: string): LinkedTarget | undefined {
  const compact = text.replace(/\s/g, '');
  const article = compact.match(/^제(\d+)조(?:의(\d+))?(?:제(\d+)항)?$/);
  if (article) return { kind: 'article', art: +article[1], ...(article[2] ? { br: +article[2] } : {}), ...(article[3] ? { para: +article[3] } : {}) };
  const annex = compact.match(/^(별표|별지제?)(\d+)(?:의(\d+))?(?:호서식)?$/);
  return annex ? { kind: annex[1] === '별표' ? 'table' : 'form', num: +annex[2], ...(annex[3] ? { br: +annex[3] } : {}) } : undefined;
}
function articleLabel(article: Article): string { return `제${article.num}조${article.br ? `의${article.br}` : ''}`; }
function targetText(rule: Rule, target: LinkedTarget): { uid: string; text: string; label: string; parentUid?: string } | undefined {
  if (target.kind !== 'article') {
    const annex = rule.annexes.find(item => item.kind === target.kind && item.num === target.num && (item.br ?? 0) === (target.br ?? 0));
    return annex ? { uid: annex.uid, text: `${annex.title}\n${annex.text}`, label: target.kind === 'table' ? `별표 ${annex.num}${annex.br ? `의${annex.br}` : ''}` : `별지 제${annex.num}${annex.br ? `의${annex.br}` : ''}호서식` } : undefined;
  }
  const article = rule.articles.find(item => item.num === target.art && (item.br ?? 0) === (target.br ?? 0) && !item.deleted);
  if (!article) return undefined;
  if (!target.para) return { uid: article.uid, text: renderArticle(article), label: articleLabel(article) };
  const paragraph = article.paragraphs.find(item => item.num === target.para && !item.deleted);
  return paragraph ? { uid: paragraph.uid, parentUid: article.uid, text: paragraph.text, label: `${articleLabel(article)}제${paragraph.num}항` } : undefined;
}
function afterTarget(rule: Rule, before: NonNullable<ReturnType<typeof targetText>>, target: LinkedTarget): ReturnType<typeof targetText> {
  if (target.kind !== 'article') {
    const annex = rule.annexes.find(item => item.uid === before.uid);
    return annex ? targetText(rule, { kind: annex.kind, num: annex.num, br: annex.br }) : undefined;
  }
  const article = rule.articles.find(item => item.uid === (before.parentUid ?? before.uid) && !item.deleted);
  if (!article) return undefined;
  if (!target.para) return targetText(rule, { kind: 'article', art: article.num, br: article.br });
  const paragraph = article.paragraphs.find(item => item.uid === before.uid && !item.deleted);
  return paragraph?.num ? targetText(rule, { kind: 'article', art: article.num, br: article.br, para: paragraph.num }) : undefined;
}
function location(raw: string, index: number): { line: number; location: string; excerpt: string } {
  const lines = raw.slice(0, index).split(/\r?\n/);
  let heading = '전문·머리말'; let section = '';
  for (const line of lines) {
    if (/^\s*부\s*칙(?:\s|$|<)/.test(line)) { section = '부칙'; heading = ''; }
    const annex = line.match(/^\s*\[\s*((?:별표|별지)[^\]]*)\]/);
    if (annex) { section = annex[1]; heading = ''; continue; }
    const article = line.match(/^\s*(제\s*\d+\s*조(?:의\s*\d+)?)(?:\s*\([^)]*\))?/);
    if (article) heading = article[0].trim();
  }
  const line = lines.length;
  return { line, location: `${[section, heading].filter(Boolean).join(' · ')} · 원문 ${line}행`, excerpt: raw.slice(Math.max(0, index - 55), Math.min(raw.length, index + 180)).trim() };
}
function classify(p: Project, before: Rule, after: Rule, target: LinkedTarget): Pick<LinkedRegulationImpact, 'impact' | 'beforeText' | 'afterText' | 'movedTo' | 'checks'> {
  const old = targetText(before, target);
  if (!old) return { impact: 'missing_before', checks: ['입력한 기준 원문에 인용 대상이 없습니다. 부칙·별표·서식 누락, 잘못된 번호, 시행일과 개정 연혁을 원문에서 확인해 주세요.'] };
  const method = amendmentKind(p);
  if (method === 'repeal') return { impact: 'repeal', beforeText: old.text, checks: ['규정 폐지 후에도 해당 근거·업무가 필요한지와 대체 규정·경과조치를 검토해 주세요. 인용 번호만 지우거나 다른 조문으로 자동 치환하지 않습니다.'] };
  if (method === 'full') return { impact: 'full', beforeText: old.text, afterText: targetText(after, target)?.text, checks: ['전부개정은 조문 체계가 달라질 수 있습니다. 같은 번호의 새 조문도 종전 조문과 동일한 대상으로 인정하지 않습니다.', '새 적용 대상·업무·별표·서식과 종전 인용의 의미를 직접 대조해 주세요.'] };
  const next = afterTarget(after, old, target);
  if (!next) return { impact: 'deleted', beforeText: old.text, checks: ['인용 대상이 없어졌습니다. 실제 업무의 근거·적용 범위를 검토해 문장을 다시 작성해야 합니다. 번호만 바꾸어 정비 완료로 처리하지 않습니다.'] };
  const moved = next.label !== old.label;
  // Compare semantic bodies separately from the displayed article number.
  const withoutHeading = (text: string) => text.replace(/^제\d+조(?:의\d+)?(?:제\d+항)?/, '');
  const changed = withoutHeading(next.text) !== withoutHeading(old.text);
  return { impact: moved ? 'moved' : changed ? 'text_changed' : 'unchanged', beforeText: old.text, afterText: next.text, ...(moved ? { movedTo: next.label } : {}), checks: moved ? [`이동 후보: ${old.label} → ${next.label}. 실제로 같은 대상을 가리키는지 원문에서 확인해 주세요.`, ...(changed ? ['번호 외의 본문도 바뀌었습니다. 적용 대상과 업무 의미를 함께 검토해 주세요.'] : [])] : changed ? ['대상 본문이 바뀌었습니다. 이 규정이 인용하는 요건·금액·대상·처리절차의 의미가 달라지는지 검토해 주세요.'] : ['직접 인용 대상의 문자열은 같습니다. 정의·상위법·부칙 또는 다른 조문에 따른 의미 변화까지 확인된 것은 아닙니다.'] };
}

/** Explicit names only; unnamed 제5조, aliases, ranges and indirect citations are not inferred. */
export function analyzeLinkedRegulations(p: Project, before: Rule, after: Rule): LinkedRegulationAnalysis {
  const exact: LinkedRegulationImpact[] = []; const uncertain: LinkedRegulationImpact[] = [];
  const coverage: LinkedRegulationAnalysis['coverage'] = [];
  const wanted = normalizeTitle(before.title);
  for (const regulation of p.linkedRegulations ?? []) {
    const issues = [regulation.partial !== false ? '부분 원문 또는 완전성 미확인: 누락된 부칙·별표·서식에 추가 인용이 있을 수 있습니다.' : '사용자가 전체 원문 대조를 기록했습니다. 자동으로 완전성을 보증하지 않습니다.'];
    if (!regulation.effectiveAt) issues.push('시행일이 입력되지 않았습니다. 다른 시점의 규정을 혼용하지 않도록 확인해 주세요.');
    else if (regulation.effectiveAt.replace(/-/g, '') > new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 10).replace(/-/g, '')) issues.push('시행예정 원문입니다. 현재 시행 중인 규정에 대한 영향과 구분하여 확인해 주세요.');
    if (!regulation.sourceUrl) issues.push('공식 원문 주소가 입력되지 않았습니다. 기관의 원본과 대조해 주세요.');
    if (regulation.note) issues.push(regulation.note);
    coverage.push({ regulationId: regulation.id, title: regulation.title, issues });
    const occupied: [number, number][] = [];
    const named = new RegExp(`「([^」\\r\\n]+)」\\s*(?:의\\s*)?(${targetPattern})`, 'g');
    for (const match of regulation.raw.matchAll(named)) {
      if (normalizeTitle(match[1]) !== wanted) continue;
      const target = parseTarget(match[2]); if (!target) continue;
      const index = match.index!; occupied.push([index, index + match[0].length]);
      exact.push({ id: `linked-${hashText(`${regulation.id}|${index}|${match[0]}`)}`, regulationId: regulation.id, regulationTitle: regulation.title, citation: match[0], target, confidence: 'exact_title', ...location(regulation.raw, index), ...classify(p, before, after, target) });
    }
    const spacedName = [...before.title.trim()].map(character => /\s/.test(character) ? '\\s*' : escape(character)).join('');
    const bare = new RegExp(`${spacedName}\\s*(${targetPattern})`, 'g');
    for (const match of regulation.raw.matchAll(bare)) {
      const index = match.index!;
      if (occupied.some(([start, end]) => index >= start && index < end)) continue;
      const prefix = regulation.raw.slice(0, index);
      if (prefix.lastIndexOf('「') > prefix.lastIndexOf('」')) continue;
      const target = parseTarget(match[1]); if (!target) continue;
      uncertain.push({ id: `unlinked-${hashText(`${regulation.id}|${index}|${match[0]}`)}`, regulationId: regulation.id, regulationTitle: regulation.title, citation: match[0], target, confidence: 'unverified_title', impact: 'unlinked', ...location(regulation.raw, index), checks: ['규정명 인용부호가 없어 정확한 대상 법규인지 먼저 확인해야 합니다. 이 결과는 변경·삭제된 조문과 자동으로 연결하지 않았습니다.'] });
    }
  }
  return { exact, uncertain, coverage };
}

export function newLinkedRegulation(kind: RuleKind = 'rule'): LinkedRegulation {
  return { id: `linked-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`, title: '', kind, raw: '', partial: true };
}
