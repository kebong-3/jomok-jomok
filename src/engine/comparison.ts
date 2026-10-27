import { dashedNew, underlineOld, wordHunks } from './diff';
import { annexLabel, circled } from './labels';
import type { Article, ComparisonRow, Paragraph, Rule, Segment } from './types';

export interface ComparisonStyle {
  unchangedMark: 'dash' | 'ellipsis' | 'full';
  omitText: string; // (생 략)
  sameText: string; // (현행과 같음)
  insertMark: string; // <신 설>
  deleteMark: string; // <삭 제>
  titleAlways: boolean; // 조 제목 항상 기재(법제처식) / 바뀔 때만(서울시식)
}

export const DEFAULT_STYLE: ComparisonStyle = {
  unchangedMark: 'dash',
  omitText: '(생 략)',
  sameText: '(현행과 같음)',
  insertMark: '<신 설>',
  deleteMark: '<삭 제>',
  titleAlways: false,
};

const T = (text: string, underline = false): Segment => ({ text, underline: underline || undefined });

function head(a: Article): string {
  return `제${a.num}조${a.br ? `의${a.br}` : ''}`;
}

function paraMark(p: Paragraph): string {
  return p.num ? `${circled(p.num)} ` : '';
}

function lines(text: string): string[] {
  return text.split('\n');
}

/** 개정 전후 규정 → 신·구조문대비표 행(바뀐 조와 별표·서식 본문) */
export function buildComparison(before: Rule, after: Rule, style: ComparisonStyle = DEFAULT_STYLE): ComparisonRow[] {
  const rows: ComparisonRow[] = [];
  const oldByUid = new Map(before.articles.map((a) => [a.uid, a] as const));

  for (const na of after.articles) {
    const oa = oldByUid.get(na.uid);
    if (!oa) {
      // 조 신설
      const right: Segment[][] = [];
      const t = `${head(na)}${na.title ? `(${na.title})` : ''}`;
      na.paragraphs.forEach((p, i) => {
        right.push([T(`${i === 0 ? t + ' ' : ''}${paraMark(p)}${lines(p.text)[0]}`, true)]);
        lines(p.text).slice(1).forEach((l) => right.push([T(l, true)]));
      });
      if (!na.paragraphs.length) right.push([T(t, true)]);
      rows.push({ key: na.uid, left: [[T(style.insertMark)]], right });
      continue;
    }
    if (na.deleted && !oa.deleted) {
      const left: Segment[][] = [];
      const t = `${head(oa)}${oa.title ? `(${oa.title})` : ''}`;
      oa.paragraphs.forEach((p, i) => {
        left.push([T(`${i === 0 ? t + ' ' : ''}${paraMark(p)}${lines(p.text)[0]}`, true)]);
        lines(p.text).slice(1).forEach((l) => left.push([T(l, true)]));
      });
      rows.push({ key: na.uid, left, right: [[T(`${head(na)} ${style.deleteMark}`)]] });
      continue;
    }
    const moved = oa.num !== na.num || (oa.br ?? 0) !== (na.br ?? 0);
    const titleChanged = (oa.title ?? '') !== (na.title ?? '');
    const oldParas = new Map(oa.paragraphs.map((p) => [p.uid, p] as const));
    const anyParaChange =
      na.paragraphs.some((p) => {
        const op = oldParas.get(p.uid);
        return !op || op.text !== p.text || op.num !== p.num || !!op.deleted !== !!p.deleted;
      }) || oa.paragraphs.some((p) => !na.paragraphs.find((q) => q.uid === p.uid));
    if (!moved && !titleChanged && !anyParaChange) continue; // 변경 없는 조는 행을 넣지 않음

    const left: Segment[][] = [];
    const right: Segment[][] = [];
    // 조 머리
    const oHead: Segment[] = [T(head(oa)), ...(oa.title ? [T('('), T(oa.title, titleChanged), T(')')] : [])];
    const nHead: Segment[] = [T(head(na), moved)];
    if (titleChanged) nHead.push(T('('), T(na.title ?? '', true), T(')'));
    else if (style.titleAlways && na.title) nHead.push(T(`(${na.title})`));

    if (moved && !titleChanged && !anyParaChange) {
      left.push([...oHead, T(` ${style.omitText}`)]);
      right.push([...nHead, T(` (현행 ${head(oa)}와 같음)`)]);
      rows.push({ key: na.uid, left, right });
      continue;
    }

    // 항 정렬: 새 순서 기준 + 삭제된(빠진) 옛 항
    type Pair = { o?: Paragraph; n?: Paragraph };
    const pairs: Pair[] = na.paragraphs.map((p) => ({ o: oldParas.get(p.uid), n: p }));
    let first = true;
    const pushLine = (target: Segment[][], hd: Segment[], body: Segment[]) => {
      target.push(first ? [...hd, T(' '), ...body] : body);
    };
    for (const pr of pairs) {
      const { o, n } = pr;
      const lf: Segment[] = [];
      const rt: Segment[] = [];
      if (!o && n) {
        lf.push(T(style.insertMark));
        rt.push(T(`${paraMark(n)}${n.text}`, true));
      } else if (o && n) {
        const renum = o.num !== n.num;
        if (n.deleted && !o.deleted) {
          lf.push(T(paraMark(o)), T(o.text, true));
          rt.push(T(paraMark(n)), T(style.deleteMark));
        } else if (o.text === n.text) {
          lf.push(T(`${paraMark(o)}${style.omitText}`));
          if (renum) rt.push(T(paraMark(n).trim(), true), T(` (현행 ${o.num === undefined ? '제목 외의 부분' : `제${o.num}항`}과 같음)`));
          else rt.push(T(`${paraMark(n)}${style.sameText}`));
        } else {
          const hunks = wordHunks(o.text, n.text);
          lf.push(T(paraMark(o)), ...underlineOld(o.text, hunks));
          if (renum) rt.push(T(paraMark(n).trim(), true), T(' '));
          else rt.push(T(paraMark(n)));
          rt.push(...dashedNew(n.text, hunks, style.unchangedMark));
        }
      }
      pushLine(left, oHead, lf);
      pushLine(right, nHead, rt);
      first = false;
    }
    if (!pairs.length) {
      left.push(oHead);
      right.push(nHead);
    }
    rows.push({ key: na.uid, left: splitNewlines(left), right: splitNewlines(right) });
  }

  // Annexes are stored as plain text. Compare that text explicitly; this is not
  // a reconstruction or a cell-by-cell comparison of the original document.
  const oldAnnexes = new Map(before.annexes.map((annex) => [annex.uid, annex] as const));
  for (const annex of after.annexes) {
    const old = oldAnnexes.get(annex.uid);
    if (old && old.title === annex.title && old.text === annex.text && annexLabel(old) === annexLabel(annex)) continue;
    const label = `[${annexLabel(annex)}]`;
    if (!old) {
      rows.push({ key: annex.uid, left: [[T(style.insertMark)]], right: splitNewlines([
        [T(`${label} ${annex.title}`, true)], [T('(별표·서식 본문 텍스트 비교)')], [T(annex.text, true)],
      ]) });
      continue;
    }
    const headingOld = `[${annexLabel(old)}] ${old.title}`.trimEnd();
    const headingNew = `${label} ${annex.title}`.trimEnd();
    const titleHunks = wordHunks(headingOld, headingNew);
    const bodyHunks = wordHunks(old.text, annex.text);
    rows.push({
      key: annex.uid,
      left: splitNewlines([underlineOld(headingOld, titleHunks), [T('(별표·서식 본문 텍스트 비교)')], underlineOld(old.text, bodyHunks)]),
      right: splitNewlines([
        // Keep the annex identity readable even when unchanged text uses dashes.
        titleHunks.length ? dashedNew(headingNew, titleHunks, 'full') : [T(headingNew)],
        [T('(별표·서식 본문 텍스트 비교)')],
        bodyHunks.length ? dashedNew(annex.text, bodyHunks, style.unchangedMark) : [T(style.sameText)],
      ]),
    });
  }
  const remainingAnnexes = new Set(after.annexes.map((annex) => annex.uid));
  for (const old of before.annexes) {
    if (remainingAnnexes.has(old.uid)) continue;
    rows.push({ key: old.uid, left: splitNewlines([[T(`[${annexLabel(old)}] ${old.title}`, true)], [T(old.text, true)]]), right: [[T(style.deleteMark)]] });
  }
  return rows;
}

/** 세그먼트 안 줄바꿈을 실제 줄로 나눔 */
function splitNewlines(ls: Segment[][]): Segment[][] {
  const out: Segment[][] = [];
  for (const l of ls) {
    let cur: Segment[] = [];
    for (const s of l) {
      const parts = s.text.split('\n');
      parts.forEach((part, i) => {
        if (i > 0) {
          out.push(cur);
          cur = [];
        }
        if (part) cur.push({ ...s, text: part });
      });
    }
    out.push(cur);
  }
  return out;
}

export function rowsToPlain(rows: ComparisonRow[]): string {
  const seg = (l: Segment[]) => l.map((s) => (s.underline ? `_${s.text}_` : s.text)).join('');
  return rows.map((r) => `${r.left.map(seg).join('\n')}\n||\n${r.right.map(seg).join('\n')}`).join('\n=====\n');
}
