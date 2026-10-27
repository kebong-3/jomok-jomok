import { buildComparison, DEFAULT_STYLE, derive, hashText, lintRule, parseRule, renderRule, type Derived, type DeriveOptions, type Rule } from '@/engine';
import type { Project } from './project';

export type AmendmentKind = 'partial' | 'full' | 'repeal';
export const AMENDMENT_LABELS: Record<AmendmentKind, string> = { partial: '일부개정', full: '전부개정', repeal: '폐지' };
export function amendmentKind(p: Pick<Project, 'mode' | 'amendmentKind'>): AmendmentKind {
  return p.mode === 'amend' ? p.amendmentKind ?? 'partial' : 'partial';
}
export function workMethodLabel(p: Pick<Project, 'mode' | 'amendmentKind'>): string {
  return p.mode === 'enact' ? '제정' : AMENDMENT_LABELS[amendmentKind(p)];
}
/** A suggestion exposes its reasons; text volume never decides the method. */
export function methodSuggestion(intent: string): { kind: AmendmentKind; reason: string } {
  if (/폐지|제도\s*종료|규정\s*없애/.test(intent)) return { kind: 'repeal', reason: '규정 자체를 없애려는 취지가 있습니다. 계속 처리할 사건과 다른 규정의 인용을 먼저 확인하세요.' };
  if (/전부개정|전면\s*(개편|개정)|체계\s*(전면|재편|변경)|목적.*변경/.test(intent)) return { kind: 'full', reason: '목적이나 조문 체계의 큰 변화가 포함됩니다. 종전 부칙·인용·별표의 처리까지 검토한 뒤 선택하세요.' };
  return { kind: 'partial', reason: '특정 조문 변경은 일부개정부터 검토합니다. 변경량이나 비율만으로 방식을 확정하지 않습니다.' };
}
export function amendmentDecisionHash(p: Project): string {
  return hashText(JSON.stringify({ mode: p.mode, method: amendmentKind(p), source: p.source.raw, kind: p.kind, title: p.title, intent: p.intent,
    replacement: p.replacementDraft?.raw, ops: p.spec.ops.filter(o => o.status === 'accepted').map(o => o.change), addenda: p.spec.addenda, profile: p.profileSnapshot ?? p.profileId }));
}
export function replacementDraftHash(raw: string, p: Pick<Project, 'title' | 'kind'>): string { return hashText(JSON.stringify({ raw, title: p.title, kind: p.kind })); }
export function replacementBody(rule: Rule): string { return renderRule({ ...rule, addenda: '', preamble: [] }); }

/** Full text is explicit user input. Repeal never inherits accepted partial edits. */
export function deriveProject(p: Project, before: Rule, opts: DeriveOptions = {}): Derived {
  const method = amendmentKind(p);
  const base = derive(before, method === 'repeal' ? { ...p.spec, ops: [] } : p.spec, opts);
  if (method !== 'full') return base;
  if (!p.replacementDraft) return { ...base, after: { ...before, articles: [], annexes: [], addenda: '' }, comparison: [], fullText: '[작성 필요] 전부개정 본칙·별표·서식을 작성해 주세요.',
    lint: [{ code: '전부-00', tier: 'must', title: '전부개정 본문 미작성', where: '전부개정 본문', message: '전부개정은 새 본칙 전체가 필요합니다. 원문이나 수락한 일부 변경을 전부개정 본문으로 자동 확정하지 않습니다.', source: 'engine', origin: 'introduced' }], specHash: hashText(`${base.specHash}|full|missing`) };
  const parsed = parseRule(p.replacementDraft.raw, p.kind, p.title);
  const after = { ...parsed, addenda: '' };
  const issues = lintRule(after, opts.lint ?? {});
  if (parsed.addenda.trim()) issues.push({ code: '전부-01', tier: 'must', title: '본칙과 부칙을 나누어 주세요', where: '전부개정 본문', message: '본문 입력에 부칙이 있습니다. 새 부칙은 기존 업무 처리표와 시행일에서 작성하세요. 입력 부칙은 자동으로 출력하지 않습니다.', source: 'engine', origin: 'introduced' });
  if (!after.articles.length || after.diagnostics.length) issues.push({ code: '전부-02', tier: 'must', title: '전부개정 본문 원문 대조 필요', where: '전부개정 본문', message: '조문이 없거나 읽지 못한 줄이 있습니다. 본문·별표·서식의 누락과 구조를 원문과 대조하세요.', source: 'engine', origin: 'introduced' });
  return { ...base, after, rejected: [], fixes: [], inserted: new Set<string>(), comparison: buildComparison(before, after, opts.style ?? DEFAULT_STYLE), fullText: renderRule(after), lint: issues,
    specHash: hashText(`${base.specHash}|full|${p.replacementDraft.raw}`) };
}
