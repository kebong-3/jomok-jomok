import { buildAmendText, amendTextPlain } from './amendtext';
import { applySpec } from './apply';
import { buildComparison, DEFAULT_STYLE, type ComparisonStyle } from './comparison';
import { lintRule, markOrigin, type LintContext } from './lint';
import { renderRule } from './parser';
import type { ChangeSpec, LintIssue, Rule, SpecOp } from './types';

export * from './types';
export * from './labels';
export { parseRule, renderRule, renderArticle } from './parser';
export { buildComparison, DEFAULT_STYLE } from './comparison';
export type { ComparisonStyle } from './comparison';
export { buildAmendText, amendTextPlain, buildAddenda } from './amendtext';
export { buildDeadlineArticle, transitionDraftHash, transitionDecisionIssues, transitionDecisionState, confirmedTransitionClauses, deadlineReviewIssues, TRANSITION_FORMS } from './transition';
export { applySpec } from './apply';
export { lintRule, LINT_CATALOG } from './lint';
export { collectCitations, extractCitations, citationWhere } from './citations';
export { wordHunks } from './diff';
export * from './josa';

export interface Derived {
  after: Rule;
  fixes: ReturnType<typeof applySpec>['fixes'];
  rejected: ReturnType<typeof applySpec>['rejected'];
  inserted: Set<string>;
  comparison: ReturnType<typeof buildComparison>;
  amend: ReturnType<typeof buildAmendText>;
  amendPlain: string;
  fullText: string;
  lint: LintIssue[];
  /** 변경명세 지문(같은 명세면 같은 값) */
  specHash: string;
}

export interface DeriveOptions {
  style?: ComparisonStyle;
  excludedFixes?: Set<string>;
  lint?: Omit<LintContext, 'oldPos' | 'inserted' | 'fixes' | 'excludedFixes' | 'amendText'>;
}

/** 변경명세 → 모든 산출물(결정론). 같은 입력이면 같은 출력. */
export function derive(before: Rule, spec: ChangeSpec, opts: DeriveOptions = {}): Derived {
  const excluded = opts.excludedFixes ?? new Set<string>();
  const res = applySpec(before, spec.ops, excluded);
  const comparison = buildComparison(before, res.after, opts.style ?? DEFAULT_STYLE);
  const amend = buildAmendText(before, res.after, spec.addenda, res.inserted);
  const docTitle = `${before.title} 일부개정${kindSuffix(before)}안`;
  const amendPlain = amendTextPlain(amend, docTitle);
  const ctx: LintContext = { ...opts.lint, oldPos: res.oldPos, inserted: res.inserted, fixes: res.fixes, excludedFixes: excluded, amendText: amendPlain };
  const pre = lintRule(before, { ...opts.lint });
  let lint = markOrigin(lintRule(res.after, ctx), pre);
  // 수락했지만 적용에 실패한 변경을 성공한 변경처럼 문서에 누락시키지 않는다.
  for (const failed of res.rejected) {
    const index = spec.ops.findIndex((op) => op.id === failed.opId);
    lint.push({
      code: '정합-02', tier: 'must', title: '수락한 변경을 적용하지 못함',
      where: `변경 제안 ${index + 1}`,
      message: `이 변경은 문서에 반영되지 않았습니다. ${failed.reason}. 대상을 고치거나 해당 제안을 취소하세요.`,
      origin: 'introduced', source: 'engine',
    });
  }
  if (spec.addenda.reviewDeadline && ['directive', 'established_rule', 'notice', 'guideline'].includes(before.kind)) {
    // An imported v0.7 checkbox is a request to review, not a drafting decision.
    const present = res.after.articles.some(a => !a.deleted && /재검토기한|유효기간|존속기한/.test(a.title ?? ''));
    if (!present) lint.push({ code: '부칙-04', tier: 'check', title: '일몰 적용 대상과 본칙 배치 확인', where: '본칙 마지막', message: '이전 재검토기한 선택을 보관했습니다. 발령 기관·내부운영 제외 여부와 적용 기준을 먼저 확인하세요. 담당자가 작성한 재검토기한 또는 유효기간 조문은 원칙적으로 본칙 마지막에 두며, 선택만으로 부칙이나 임의의 기한을 넣지 않습니다.', origin: 'introduced', source: 'engine' });
  }
  // 정합-01: 대비표에 나온 조는 모두 개정문에도 있어야 한다
  const amendJoined = amend.sentences.map((s) => s.text).join('\n');
  for (const row of comparison) {
    const a = res.after.articles.find((x) => x.uid === row.key);
    const o = before.articles.find((x) => x.uid === row.key);
    const label = (o ?? a) && `제${(o ?? a)!.num}조${(o ?? a)!.br ? `의${(o ?? a)!.br}` : ''}`;
    if (label && !amendJoined.includes(label)) {
      lint.push({ code: '정합-01', tier: 'must', title: '대비표와 개정문이 서로 다름', where: label, message: `${label}가 대비표에는 있는데 개정문에는 없습니다.`, origin: 'introduced', source: 'engine' });
    }
  }
  if (!amend.addendaText.length) lint.push({ code: '부칙-01', tier: 'must', title: '시행일 조항 없음', where: '부칙', message: '부칙에 시행일을 정하세요.', origin: 'introduced', source: 'engine' });
  lint = dedupe(lint);
  return {
    after: res.after,
    fixes: res.fixes,
    rejected: res.rejected,
    inserted: res.inserted,
    comparison,
    amend,
    amendPlain,
    fullText: renderRule(res.after),
    lint,
    specHash: hashSpec(spec, excluded),
  };
}

function dedupe(list: LintIssue[]): LintIssue[] {
  const seen = new Set<string>();
  return list.filter((i) => {
    const k = `${i.code}|${i.where}|${i.message}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export function kindSuffix(r: Rule): string {
  // 법령: ○○법 일부개정법률안, ○○법 시행령 일부개정령안, ○○법 시행규칙 일부개정령안
  return { ordinance: '조례', rule: '규칙', directive: '훈령', established_rule: '예규', notice: '고시', guideline: '지침', bylaw: '내규', act: '법률', decree: '령', ministry_rule: '령' }[r.kind];
}

/** 간단한 결정론 해시(FNV-1a 32bit ×2) — 화면 표시용 지문 */
export function hashText(s: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ (c + i), 0x811c9dc5) >>> 0;
  }
  return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
}

function hashSpec(spec: ChangeSpec, excluded: Set<string>): string {
  const ops = spec.ops.filter((o) => o.status === 'accepted').map((o) => o.change);
  return hashText(JSON.stringify({ ops, addenda: spec.addenda, excluded: [...excluded].sort() }));
}

/** 조 신설 시 가지번호/번호 밀기 두 안의 정정 건수 미리 계산 */
export function previewInsertPolicy(before: Rule, ops: SpecOp[], targetOpId: string): { branch: number; renumber: number } {
  const count = (policy: 'branch' | 'renumber') => {
    const changed = ops.map((o) => {
      if (o.id !== targetOpId || o.change.op !== 'insert_article') return o;
      return { ...o, status: 'accepted' as const, change: { ...o.change, policy } };
    });
    const others = changed.filter((o) => o.id === targetOpId);
    return applySpec(before, others).fixes.filter((f) => f.reason === 'moved').length;
  };
  return { branch: count('branch'), renumber: count('renumber') };
}
