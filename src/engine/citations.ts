import type { Annex, Article, Citation, Rule, UnitRef } from './types';

// 우선순위: 범위 → 같은 조 → 조(+항) → 항만
const RE =
  /제(\d+)조(?:의(\d+))?부터\s*제(\d+)조(?:의(\d+))?까지|같은\s*조\s*제(\d+)항|제(\d+)조(?:의(\d+))?(?:\s*제(\d+)항)?|(?<![조\d])제(\d+)항/gu;

const EXTERNAL_BEFORE = /(」\s*|(?:^|[\s(])(?:법|영|시행령|시행규칙|같은\s*법|같은\s*영)\s*)$/u;

export interface RawCitation {
  raw: string;
  start: number;
  end: number;
  target: UnitRef;
  form: 'full' | 'para_only';
  external: boolean;
}

/** 텍스트 하나에서 인용을 뽑는다. ctx = 이 텍스트가 들어 있는 조(상대 인용 해석용) */
export function extractCitations(text: string, ctx?: { num: number; br?: number }): RawCitation[] {
  const out: RawCitation[] = [];
  let last: UnitRef | undefined;
  let lastExt = false;
  // 「」 안의 조문 번호는 법령명이므로 가린다
  const masked = text.replace(/「[^」]*」/g, (m) => m.replace(/[^「」]/g, '·'));
  for (const m of masked.matchAll(RE)) {
    const start = m.index!;
    const before = masked.slice(Math.max(0, start - 12), start);
    const external = EXTERNAL_BEFORE.test(before);
    if (m[1]) {
      // 범위: 시작과 끝을 각각 인용으로 등록
      const s = `제${m[1]}조${m[2] ? `의${m[2]}` : ''}`;
      const e = `제${m[3]}조${m[4] ? `의${m[4]}` : ''}`;
      const ePos = start + m[0].lastIndexOf(e);
      out.push({ raw: s, start, end: start + s.length, target: { art: +m[1], artBr: m[2] ? +m[2] : undefined }, form: 'full', external });
      out.push({ raw: e, start: ePos, end: ePos + e.length, target: { art: +m[3], artBr: m[4] ? +m[4] : undefined }, form: 'full', external });
      last = { art: +m[3], artBr: m[4] ? +m[4] : undefined };
      lastExt = external;
    } else if (m[5]) {
      if (!last) continue;
      const p = `제${m[5]}항`;
      const ps = start + m[0].lastIndexOf(p);
      out.push({ raw: p, start: ps, end: ps + p.length, target: { ...last, para: +m[5] }, form: 'para_only', external: lastExt });
    } else if (m[6]) {
      const target: UnitRef = { art: +m[6], artBr: m[7] ? +m[7] : undefined, para: m[8] ? +m[8] : undefined };
      out.push({ raw: m[0], start, end: start + m[0].length, target, form: 'full', external });
      last = { art: target.art, artBr: target.artBr };
      lastExt = external;
    } else if (m[9]) {
      // "제5조제2항 및 제3항"처럼 바로 앞 인용에 이어지면 그 조를 따른다
      const prev = out[out.length - 1];
      const gap = prev ? masked.slice(prev.end, start) : '';
      if (prev && last && /^\s*(,|및|또는|ㆍ|·)\s*$/.test(gap)) {
        out.push({ raw: m[0], start, end: start + m[0].length, target: { ...last, para: +m[9] }, form: 'para_only', external: lastExt });
        continue;
      }
      if (!ctx) continue;
      out.push({ raw: m[0], start, end: start + m[0].length, target: { art: ctx.num, artBr: ctx.br, para: +m[9] }, form: 'para_only', external });
    }
  }
  return out.filter((c) => !c.external);
}

/** 규정 전체의 내부 인용 목록 */
export function collectCitations(rule: Rule, originalPositions?: Map<string, UnitRef>): Citation[] {
  const all: Citation[] = [];
  for (const a of rule.articles) {
    if (a.deleted) continue;
    const old = originalPositions?.get(a.uid);
    const ctx = old ? { num: old.art, br: old.artBr } : a;
    for (const p of a.paragraphs) {
      if (p.deleted) continue;
      for (const c of extractCitations(p.text, ctx)) all.push({ ...c, from: { kind: 'unit', art: a, paraUid: p.uid } });
    }
    if (a.title) {
      // 조 제목 안 인용은 드묾 — 생략
    }
  }
  for (const x of rule.annexes) {
    for (const c of extractCitations(`${x.title}\n${x.text}`)) all.push({ ...c, from: { kind: 'annex', annex: x } });
  }
  return all;
}

/** "이 조를 인용하는 곳" 역인덱스 */
export function citedBy(rule: Rule, art: Article, paraNum?: number): Citation[] {
  return collectCitations(rule).filter(
    (c) => c.target.art === art.num && (c.target.artBr ?? 0) === (art.br ?? 0) && (paraNum === undefined || c.target.para === paraNum),
  );
}

export function citationWhere(c: Citation): string {
  if (c.from.kind === 'annex') {
    const x: Annex = c.from.annex;
    return x.kind === 'table' ? `별표 ${x.num}` : `별지 제${x.num}호서식`;
  }
  const a = c.from.art;
  const p = a.paragraphs.find((q) => q.uid === (c.from as { paraUid?: string }).paraUid);
  return `제${a.num}조${a.br ? `의${a.br}` : ''}${p?.num ? `제${p.num}항` : ''}`;
}
