import type { Annex, Article, UnitRef } from './types';

const CIRCLED_START = [
  [1, 20, 0x2460],
  [21, 35, 0x3251],
  [36, 50, 0x32b1],
] as const;

export function circled(n: number): string {
  for (const [lo, hi, base] of CIRCLED_START) {
    if (n >= lo && n <= hi) return String.fromCodePoint(base + (n - lo));
  }
  return `(${n})`;
}

export function fromCircled(ch: string): number | undefined {
  const cp = ch.codePointAt(0)!;
  for (const [lo, hi, base] of CIRCLED_START) {
    if (cp >= base && cp <= base + (hi - lo)) return lo + (cp - base);
  }
  return undefined;
}

export const CIRCLED_CLASS = '[①-⑳㉑-㉟㊱-㊿]';

export function artLabel(a: { num: number; br?: number } | UnitRef): string {
  const num = 'art' in a ? a.art : a.num;
  const br = 'art' in a ? a.artBr : a.br;
  return `제${num}조${br ? `의${br}` : ''}`;
}

export function unitLabel(ref: UnitRef): string {
  return artLabel(ref) + (ref.para ? `제${ref.para}항` : '');
}

export function annexLabel(a: { kind: 'table' | 'form'; num: number; br?: number }): string {
  const n = `${a.num}${a.br ? `의${a.br}` : ''}`;
  return a.kind === 'table' ? `별표 ${n}` : `별지 제${n}호서식`;
}

export function sameArt(a: { num: number; br?: number }, ref: UnitRef): boolean {
  return a.num === ref.art && (a.br ?? 0) === (ref.artBr ?? 0);
}

export function refOf(a: Article, paraNum?: number): UnitRef {
  return { art: a.num, artBr: a.br, para: paraNum };
}

export function artSortKey(a: { num: number; br?: number }): number {
  return a.num * 100 + (a.br ?? 0);
}

export function findArticle(articles: Article[], ref: UnitRef): Article | undefined {
  return articles.find((a) => sameArt(a, ref));
}

export function findAnnex(annexes: Annex[], kind: 'table' | 'form', num: number, br?: number) {
  return annexes.find((x) => x.kind === kind && x.num === num && (x.br ?? 0) === (br ?? 0));
}

/** 항 번호 범위 표기: [2,3] → "제2항 및 제3항", [2,3,4] → "제2항부터 제4항까지" */
export function rangeText(nums: number[], unit: '항' | '조', art?: string): string {
  const f = (n: number) => (unit === '항' ? `제${n}항` : `제${n}조`);
  if (nums.length === 1) return f(nums[0]);
  if (nums.length === 2) return `${f(nums[0])} 및 ${f(nums[1])}`;
  return `${f(nums[0])}부터 ${f(nums[nums.length - 1])}까지`;
  void art;
}

let counter = 0;
export function uid(prefix = 'u'): string {
  counter += 1;
  return `${prefix}${counter.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}
