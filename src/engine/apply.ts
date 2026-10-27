import { collectCitations, citationWhere } from './citations';
import { artSortKey, findAnnex, sameArt, uid, unitLabel } from './labels';
import type { Article, ChangeOp, CitationFix, Rule, SpecOp, UnitRef } from './types';

export interface ApplyResult {
  after: Rule;
  /** 원문 uid → 옛 위치(조·항) */
  oldPos: Map<string, UnitRef>;
  /** 새로 생긴 노드 uid */
  inserted: Set<string>;
  fixes: CitationFix[];
  rejected: { opId: string; reason: string }[];
}

export function cloneRule(r: Rule): Rule {
  return {
    ...r,
    articles: r.articles.map((a) => ({ ...a, paragraphs: a.paragraphs.map((p) => ({ ...p })) })),
    annexes: r.annexes.map((x) => ({ ...x })),
    diagnostics: [...r.diagnostics],
  };
}

function positions(r: Rule): Map<string, UnitRef> {
  const m = new Map<string, UnitRef>();
  for (const a of r.articles) {
    m.set(a.uid, { art: a.num, artBr: a.br });
    for (const p of a.paragraphs) m.set(p.uid, { art: a.num, artBr: a.br, para: p.num });
  }
  return m;
}

/** 원문 기준 주소 → 노드(uid) */
function resolveArticle(before: Rule, after: Rule, ref: UnitRef): Article | undefined {
  const orig = before.articles.find((a) => sameArt(a, ref));
  if (!orig) return undefined;
  return after.articles.find((a) => a.uid === orig.uid);
}

function countOnce(hay: string, needle: string): number {
  if (!needle) return 0;
  let n = 0;
  let i = hay.indexOf(needle);
  while (i >= 0) {
    n++;
    i = hay.indexOf(needle, i + needle.length);
  }
  return n;
}

/** 변경 연산 하나 적용. 대상은 원문(before) 번호로 해석한다. */
function applyOne(before: Rule, after: Rule, op: ChangeOp, inserted: Set<string>): string | null {
  switch (op.op) {
    case 'replace_text': {
      if (op.target.kind === 'annex') {
        const t = op.target;
        const x = findAnnex(after.annexes, t.annexKind, t.num, t.br);
        if (!x) return '별표·서식을 찾지 못했습니다';
        const whole = `${x.title}\n${x.text}`;
        if (countOnce(whole, op.find) !== 1) return `"${op.find}"가 한 번만 나오지 않습니다`;
        if (x.title.includes(op.find)) x.title = x.title.replace(op.find, () => op.replace);
        else x.text = x.text.replace(op.find, () => op.replace);
        return null;
      }
      const ref = op.target.ref;
      const a = resolveArticle(before, after, ref);
      if (!a) return `${unitLabel(ref)}를 찾지 못했습니다`;
      if (a.deleted) return `${unitLabel(ref)}는 삭제된 조입니다`;
      const origArt = before.articles.find((q) => sameArt(q, ref))!;
      const paras = ref.para
        ? origArt.paragraphs.filter((p) => p.num === ref.para).map((p) => a.paragraphs.find((q) => q.uid === p.uid)!)
        : a.paragraphs;
      const hits = paras.filter((p) => p && !p.deleted && countOnce(p.text, op.find) > 0);
      const total = hits.reduce((s, p) => s + countOnce(p.text, op.find), 0);
      if (total !== 1) return total === 0 ? `${unitLabel(ref)}에 "${op.find}"가 없습니다` : `${unitLabel(ref)}에 "${op.find}"가 여러 번 나옵니다`;
      hits[0].text = hits[0].text.replace(op.find, () => op.replace);
      return null;
    }
    case 'insert_paragraph': {
      const a = resolveArticle(before, after, op.art);
      if (!a) return `${unitLabel(op.art)}를 찾지 못했습니다`;
      if (a.deleted) return `${unitLabel(op.art)}는 삭제된 조입니다`;
      if (!Number.isInteger(op.position) || op.position < 1 || op.position > a.paragraphs.length + 1) return '새 항의 위치가 조문 범위를 벗어났습니다';
      if (!op.text.trim()) return '새 항의 본문이 비어 있습니다';
      if (a.paragraphs.length === 1 && a.paragraphs[0].num === undefined) a.paragraphs[0].num = 1;
      const pos = op.position;
      const p = { uid: uid('p'), num: pos, text: op.text.trim() };
      inserted.add(p.uid);
      // 항은 가지번호를 쓰지 않는다 → 뒤 항 번호를 민다
      for (const q of a.paragraphs) if (q.num !== undefined && q.num >= pos) q.num += 1;
      const idx = a.paragraphs.findIndex((q) => (q.num ?? 0) > pos);
      if (idx < 0) a.paragraphs.push(p);
      else a.paragraphs.splice(idx, 0, p);
      return null;
    }
    case 'delete_paragraph': {
      const a = resolveArticle(before, after, op.target);
      if (!a) return `${unitLabel(op.target)}를 찾지 못했습니다`;
      const origArt = before.articles.find((q) => sameArt(q, op.target))!;
      const orig = origArt.paragraphs.find((p) => p.num === op.target.para);
      const p = orig && a.paragraphs.find((q) => q.uid === orig.uid);
      if (!p) return `${unitLabel(op.target)}를 찾지 못했습니다`;
      p.deleted = true; // 일부개정에서 항 삭제는 번호를 남기고 "삭제"로 둔다
      return null;
    }
    case 'insert_article': {
      const anchor = resolveArticle(before, after, op.after);
      if (!anchor) return `${unitLabel(op.after)}를 찾지 못했습니다`;
      const paras = op.paragraphs.map((t, i) => ({ uid: uid('p'), num: op.paragraphs.length > 1 ? i + 1 : undefined, text: t.trim() }));
      paras.forEach((p) => inserted.add(p.uid));
      let art: Article;
      if (op.policy === 'branch') {
        const maxBr = Math.max(1, ...after.articles.filter((x) => x.num === anchor.num).map((x) => x.br ?? 0));
        art = { uid: uid('a'), num: anchor.num, br: maxBr + 1, title: op.title, paragraphs: paras };
      } else {
        const newNum = anchor.num + 1;
        for (const x of after.articles) if (x.num >= newNum) x.num += 1;
        art = { uid: uid('a'), num: newNum, title: op.title, paragraphs: paras };
      }
      inserted.add(art.uid);
      after.articles.push(art);
      after.articles.sort((p, q) => artSortKey(p) - artSortKey(q));
      return null;
    }
    case 'delete_article': {
      const a = resolveArticle(before, after, op.target);
      if (!a) return `${unitLabel(op.target)}를 찾지 못했습니다`;
      a.deleted = true;
      return null;
    }
    case 'set_title': {
      const a = resolveArticle(before, after, op.target);
      if (!a) return `${unitLabel(op.target)}를 찾지 못했습니다`;
      a.title = op.title;
      return null;
    }
  }
}

function rebuild(target: UnitRef, form: 'full' | 'para_only', raw: string): string {
  if (form === 'para_only') return `제${target.para}항`;
  const space = /조\s+제/.test(raw) ? ' ' : '';
  return `제${target.art}조${target.artBr ? `의${target.artBr}` : ''}${target.para ? `${space}제${target.para}항` : ''}`;
}

/**
 * 변경명세 적용 → 개정안 + 인용 정정.
 * excludedFixes: 사용자가 되돌린 정정 id
 */
export function applySpec(before: Rule, ops: SpecOp[], excludedFixes: Set<string> = new Set()): ApplyResult {
  const after = cloneRule(before);
  const oldPos = positions(before);
  const inserted = new Set<string>();
  const rejected: ApplyResult['rejected'] = [];
  for (const s of ops) {
    if (s.status !== 'accepted') continue;
    const err = applyOne(before, after, s.change, inserted);
    if (err) rejected.push({ opId: s.id, reason: err });
  }

  // 새 위치 색인
  const newPos = positions(after);
  const deletedUids = new Set<string>();
  for (const a of after.articles) {
    if (a.deleted && !before.articles.find((b) => b.uid === a.uid)?.deleted) {
      deletedUids.add(a.uid);
      a.paragraphs.forEach((p) => deletedUids.add(p.uid));
    }
    for (const p of a.paragraphs) if (p.deleted && !before.articles.flatMap((b) => b.paragraphs).find((b) => b.uid === p.uid)?.deleted) deletedUids.add(p.uid);
  }

  // 원문 번호 → uid
  const uidOfOld = (ref: UnitRef): string | undefined => {
    const a = before.articles.find((x) => sameArt(x, ref));
    if (!a) return undefined;
    if (ref.para === undefined) return a.uid;
    return a.paragraphs.find((p) => p.num === ref.para)?.uid;
  };

  const fixes: CitationFix[] = [];
  // 기존 문장의 상대 인용은 원문 조 번호로 해석한 뒤 새 위치로 옮긴다.
  const cites = collectCitations(after, oldPos);
  // 텍스트별 치환 목록(뒤에서부터 적용)
  const edits = new Map<object, { start: number; end: number; text: string }[]>();
  for (const c of cites) {
    // 새로 넣은 문장 속 인용은 새 번호 기준으로 쓴 것으로 본다
    if (c.from.kind === 'unit' && c.from.paraUid && inserted.has(c.from.paraUid)) continue;
    if (c.from.kind === 'unit' && inserted.has(c.from.art.uid)) continue;
    const u = uidOfOld(c.target);
    if (!u) continue;
    const where = citationWhere(c);
    const fixTarget = c.from.kind === 'annex'
      ? ({ kind: 'annex', annexKind: c.from.annex.kind, num: c.from.annex.num, br: c.from.annex.br } as const)
      : ({ kind: 'unit', ref: oldPos.get(c.from.paraUid ?? '') ?? oldPos.get(c.from.art.uid) ?? { art: c.from.art.num } } as const);
    const id = `fix:${where}:${c.raw}:${c.start}`;
    if (deletedUids.has(u)) {
      fixes.push({ id, where, before: c.raw, reason: 'deleted', target: fixTarget });
      continue;
    }
    const np = newPos.get(u)!;
    const op = oldPos.get(u)!;
    const moved = c.form === 'para_only' ? np.para !== op.para : np.art !== op.art || (np.artBr ?? 0) !== (op.artBr ?? 0) || np.para !== op.para;
    if (!moved) continue;
    const afterText = rebuild({ art: np.art, artBr: np.artBr, para: c.target.para !== undefined ? np.para : undefined }, c.form, c.raw);
    fixes.push({ id, where, before: c.raw, after: afterText, reason: 'moved', target: fixTarget });
    if (excludedFixes.has(id)) continue;
    const holder: object = c.from.kind === 'annex' ? c.from.annex : c.from.art.paragraphs.find((p) => p.uid === (c.from as { paraUid?: string }).paraUid)!;
    if (!edits.has(holder)) edits.set(holder, []);
    edits.get(holder)!.push({ start: c.start, end: c.end, text: afterText });
  }
  for (const [holder, list] of edits) {
    list.sort((x, y) => y.start - x.start);
    if ('kind' in holder && 'title' in holder) {
      const x = holder as unknown as { title: string; text: string };
      let whole = `${x.title}\n${x.text}`;
      for (const e of list) whole = whole.slice(0, e.start) + e.text + whole.slice(e.end);
      const nl = whole.indexOf('\n');
      x.title = whole.slice(0, nl);
      x.text = whole.slice(nl + 1);
    } else {
      const p = holder as { text: string };
      for (const e of list) p.text = p.text.slice(0, e.start) + e.text + p.text.slice(e.end);
    }
  }
  return { after, oldPos, inserted, fixes, rejected };
}
