import DiffMatchPatch from 'diff-match-patch';
import type { Segment } from './types';

export interface Hunk {
  oS: number;
  oE: number;
  nS: number;
  nE: number;
}

const dmp = new DiffMatchPatch();
dmp.Diff_Timeout = 0.5;

const JOSA_START = /[에의을를은는이가과와로도만및]/;
const isBoundary = (ch: string | undefined) => ch === undefined || /[\s\n]/.test(ch);

/** 문자 diff → 어절 단위로 넓힌 변경 구간(옛 글·새 글 위치 쌍) */
export function wordHunks(a: string, b: string): Hunk[] {
  if (a === b) return [];
  const diffs = dmp.diff_main(a, b);
  dmp.diff_cleanupSemantic(diffs);
  const raw: Hunk[] = [];
  let oi = 0;
  let ni = 0;
  let cur: Hunk | null = null;
  for (const [op, text] of diffs) {
    if (op === 0) {
      if (cur) {
        raw.push(cur);
        cur = null;
      }
      oi += text.length;
      ni += text.length;
    } else {
      if (!cur) cur = { oS: oi, oE: oi, nS: ni, nE: ni };
      if (op === -1) {
        oi += text.length;
        cur.oE = oi;
      } else {
        ni += text.length;
        cur.nE = ni;
      }
    }
  }
  if (cur) raw.push(cur);

  // 어절 경계로 넓힘: 앞쪽 공통 문자열은 두 글에서 같으므로 같은 만큼 넓힌다
  const ex = raw.map((h) => {
    const r = { ...h };
    while (r.oS > 0 && r.nS > 0 && !isBoundary(a[r.oS - 1]) && a[r.oS - 1] === b[r.nS - 1]) {
      r.oS--;
      r.nS--;
    }
    while (r.oE < a.length && r.nE < b.length && !isBoundary(a[r.oE]) && a[r.oE] === b[r.nE]) {
      // 조·항·호·목·숫자 뒤에 붙은 조사는 밑줄에서 뺀다
      if (/[조항호목\d]/.test(a[r.oE - 1] ?? '') && JOSA_START.test(a[r.oE])) break;
      r.oE++;
      r.nE++;
    }
    // 순수 삽입·삭제는 앞 어절을 붙여 "A"를 "B"로 형태가 되게 한다
    if (r.oS === r.oE || r.nS === r.nE) {
      let s = r.oS;
      // 앞 공백 건너뛰고 앞 어절 시작까지
      while (s > 0 && isBoundary(a[s - 1])) s--;
      while (s > 0 && !isBoundary(a[s - 1])) s--;
      const d = r.oS - s;
      if (d > 0) {
        r.oS -= d;
        r.nS -= d;
      } else {
        // 맨 앞이면 뒤 어절을 붙인다
        let e = r.oE;
        while (e < a.length && isBoundary(a[e])) e++;
        while (e < a.length && !isBoundary(a[e])) e++;
        const dd = e - r.oE;
        r.oE += dd;
        r.nE += dd;
      }
    }
    return r;
  });
  // 겹치거나 맞닿은 구간 합치기(사이가 공백뿐이면 합침)
  const merged: Hunk[] = [];
  for (const h of ex) {
    const last = merged[merged.length - 1];
    if (last && h.oS <= last.oE + 1 && /^\s*$/.test(a.slice(last.oE, h.oS))) {
      last.oE = Math.max(last.oE, h.oE);
      last.nE = Math.max(last.nE, h.nE);
    } else merged.push({ ...h });
  }
  return merged;
}

/** 옛 글 밑줄 구간 */
export function underlineOld(a: string, hunks: Hunk[]): Segment[] {
  return splitByRanges(a, hunks.map((h) => [h.oS, h.oE]));
}

/** 새 글 밑줄 구간 */
export function underlineNew(b: string, hunks: Hunk[]): Segment[] {
  return splitByRanges(b, hunks.map((h) => [h.nS, h.nE]));
}

function splitByRanges(s: string, ranges: [number, number][]): Segment[] {
  const out: Segment[] = [];
  let i = 0;
  for (const [st, en] of ranges) {
    if (st > i) out.push({ text: s.slice(i, st) });
    if (en > st) out.push({ text: s.slice(st, en), underline: true });
    i = Math.max(i, en);
  }
  if (i < s.length) out.push({ text: s.slice(i) });
  return out;
}

export function dash(len: number, mark: 'dash' | 'ellipsis' = 'dash'): string {
  if (mark === 'ellipsis') return '…'.repeat(Math.max(2, Math.min(12, Math.round(len * 0.6))));
  return '-'.repeat(Math.max(3, Math.min(56, Math.round(len * 1.6))));
}

/** 개정안 칸: 바뀌지 않은 글자는 줄표, 바뀐 글자는 밑줄 */
export function dashedNew(b: string, hunks: Hunk[], mark: 'dash' | 'ellipsis' | 'full' = 'dash'): Segment[] {
  if (mark === 'full') return underlineNew(b, hunks);
  const segs = underlineNew(b, hunks);
  return segs.map((s) => {
    if (s.underline) return s;
    // 끝 문장부호는 남긴다
    const m = s.text.match(/^(\s*)(.*?)(\s*[.。]?\s*)$/su)!;
    const body = m[2];
    if (!body.trim()) return s;
    return { text: m[1] + dash(body.length, mark) + m[3] };
  });
}
