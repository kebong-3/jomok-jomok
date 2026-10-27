import { wordHunks } from './diff';
import { euro, eulReul, eunNeun } from './josa';
import { annexLabel, circled } from './labels';
import { renderArticle } from './parser';
import type { AddendaSpec, Article, Paragraph, Rule, RuleKind } from './types';
import { confirmedTransitionClauses, transitionDraftHash } from './transition';

const NOUN: Record<RuleKind, string> = {
  ordinance: '조례', rule: '규칙', directive: '훈령', established_rule: '예규', notice: '고시', guideline: '지침', bylaw: '내규',
  // 법령 부칙의 주어: 「법령 입안·심사 기준」 — 이 법 / 이 영 / 이 규칙
  act: '법', decree: '영', ministry_rule: '규칙',
};

const q = (s: string) => `“${s}”`;
const head = (a: { num: number; br?: number }) => `제${a.num}조${a.br ? `의${a.br}` : ''}`;

export interface AmendSentence {
  text: string;
  /** 문장 뒤에 붙는 신설 조문(들여쓰기) */
  body?: string[];
}

/** 같은 조 안 자구 수정 → "제○조제○항 중 “A”를 “B”로" 조각 */
function textEdits(o: Paragraph, n: Paragraph): string[] | 'whole' {
  const hunks = wordHunks(o.text, n.text);
  if (!hunks.length) return [];
  const changed = hunks.reduce((s, h) => s + (h.oE - h.oS), 0);
  if (changed / Math.max(1, o.text.length) > 0.5 || hunks.length > 4) return 'whole';
  return hunks.map((h) => {
    const A = o.text.slice(h.oS, h.oE).trim();
    const B = n.text.slice(h.nS, h.nE).trim();
    return `${q(A)}${eulReul(A)} ${q(B)}${euro(B)}`;
  });
}

function paraRef(a: Article, p: Paragraph): string {
  return `${head(a)}${p.num ? `제${p.num}항` : ''}`;
}

/** 개정 전후 비교 → 일부개정 개정문 */
export function buildAmendText(before: Rule, after: Rule, addenda: AddendaSpec, insertedUids: Set<string>): { header: string; sentences: AmendSentence[]; addendaText: string[] } {
  const title = before.title;
  const sentences: AmendSentence[] = [];
  const oldByUid = new Map(before.articles.map((a) => [a.uid, a] as const));

  // 조 번호 밀기(번호 이동) 묶음
  const movedArts = after.articles.filter((a) => {
    const o = oldByUid.get(a.uid);
    return o && (o.num !== a.num || (o.br ?? 0) !== (a.br ?? 0));
  });

  for (const na of after.articles) {
    const oa = oldByUid.get(na.uid);
    if (!oa) {
      // 조 신설
      if (na.br) {
        sentences.push({ text: `${head(na)}${eulReul(head(na))} 다음과 같이 신설한다.`, body: renderArticle(na).split('\n') });
      } else {
        const shifted = movedArts.filter((m) => m.num > na.num);
        if (shifted.length) {
          const olds = shifted.map((m) => oldByUid.get(m.uid)!);
          const o1 = head(olds[0]);
          const o2 = head(olds[olds.length - 1]);
          const n1 = head(shifted[0]);
          const n2 = head(shifted[shifted.length - 1]);
          const span = olds.length === 1 ? `${o1}${eulReul(o1)} ${n1}${euro(n1)}` : olds.length === 2 ? `${o1} 및 ${o2}${eulReul(o2)} 각각 ${n1} 및 ${n2}${euro(n2)}` : `${o1}부터 ${o2}까지${eulReul('까지')} 각각 ${n1}부터 ${n2}까지${euro('까지')}`;
          sentences.push({ text: `${span} 하고, ${head(na)}${eulReul(head(na))} 다음과 같이 신설한다.`, body: renderArticle(na).split('\n') });
        } else {
          sentences.push({ text: `${head(na)}${eulReul(head(na))} 다음과 같이 신설한다.`, body: renderArticle(na).split('\n') });
        }
      }
      continue;
    }
    if (na.deleted && !oa.deleted) {
      sentences.push({ text: `${head(oa)}${eulReul(head(oa))} 삭제한다.` });
      continue;
    }
    const parts: string[] = [];
    const bodies: string[] = [];
    // 제목
    if ((oa.title ?? '') !== (na.title ?? '')) {
      const A = `(${oa.title ?? ''})`;
      const B = `(${na.title ?? ''})`;
      parts.push(`${head(na)}의 제목 ${q(A)}${eulReul(A)} ${q(B)}${euro(B)}`);
    }
    const oldParas = new Map(oa.paragraphs.map((p) => [p.uid, p] as const));
    // 항 신설·번호 이동
    const insertedParas = na.paragraphs.filter((p) => !oldParas.has(p.uid) && insertedUids.has(p.uid));
    const renumbered = na.paragraphs.filter((p) => oldParas.has(p.uid) && oldParas.get(p.uid)!.num !== p.num);
    if (renumbered.length) {
      const formerlyUnnumbered = renumbered.find((p) => oldParas.get(p.uid)!.num === undefined);
      if (formerlyUnnumbered) {
        // 무번호 단일 본문을 항으로 전환할 때 존재하지 않는 '제undefined항'을 쓰지 않는다.
        parts.push(`${head(oa)} 제목 외의 부분을 제${formerlyUnnumbered.num}항으로 하고`);
      } else {
      const o = renumbered.map((p) => oldParas.get(p.uid)!.num!);
      const n = renumbered.map((p) => p.num!);
      const lastN = `제${n[n.length - 1]}항`;
      const span =
        o.length === 1
          ? `${head(oa)}제${o[0]}항${eulReul('항')} 제${n[0]}항${euro('항')}`
          : o.length === 2
            ? `${head(oa)}제${o[0]}항 및 제${o[1]}항${eulReul('항')} 각각 제${n[0]}항 및 ${lastN}${euro('항')}`
            : `${head(oa)}제${o[0]}항부터 제${o[o.length - 1]}항까지${eulReul('까지')} 각각 제${n[0]}항부터 ${lastN}까지${euro('까지')}`;
      parts.push(`${span} 하고`);
      }
    }
    for (const p of insertedParas) {
      parts.push(`${renumbered.length ? '같은 조에' : `${head(na)}에`} 제${p.num}항을 다음과 같이 신설`);
      bodies.push(`${p.num ? circled(p.num) + ' ' : ''}${p.text}`);
    }
    // 항 삭제·자구 수정
    for (const n of na.paragraphs) {
      const o = oldParas.get(n.uid);
      if (!o) continue;
      const movedPara = o.num !== n.num;
      const ref = movedPara
        ? `${head(na)}제${n.num}항(종전의 ${o.num === undefined ? '제목 외의 부분' : `제${o.num}항`})`
        : paraRef(na, n);
      if (n.deleted && !o.deleted) {
        parts.push(`${ref}${eulReul(ref)} 삭제`);
        continue;
      }
      if (o.text === n.text) continue;
      const ed = textEdits(o, n);
      if (ed === 'whole') {
        parts.push(`${ref}${eulReul(ref)} 다음과 같이`);
        bodies.push(`${n.num ? circled(n.num) + ' ' : ''}${n.text}`);
      } else if (ed.length) {
        parts.push(`${ref} 중 ${ed.join(', ')}`);
      }
    }
    if (!parts.length) continue;
    sentences.push({ text: joinParts(parts, head(oa)), body: bodies.length ? bodies.join('\n').split('\n') : undefined });
  }

  // 별표·서식
  for (const nx of after.annexes) {
    const ox = before.annexes.find((x) => x.uid === nx.uid);
    if (!ox || ox.text !== nx.text || ox.title !== nx.title) {
      const L = annexLabel(nx);
      sentences.push({ text: `${L}${eulReul(L)} 별지와 같이 한다.` });
    }
  }

  return { header: `${title} 일부를 다음과 같이 개정한다.`, sentences, addendaText: buildAddenda(before.kind, addenda, transitionDraftHash(after, addenda), after) };
}

/** 같은 조 안 여러 조각을 "…로 하고, 같은 조 제2항 중 …로 한다." 형태로 */
function joinParts(parts: string[], artHead: string): string {
  const fixed = parts.map((p, i) => {
    let s = p;
    if (i > 0) s = s.replace(new RegExp(`^${artHead}제`), '같은 조 제').replace(new RegExp(`^${artHead}(?=의|에| 중)`), '같은 조');
    return s;
  });
  const endVerb = (s: string) => {
    if (s.endsWith('하고')) return s;
    if (s.endsWith('신설')) return s + '하고';
    if (s.endsWith('삭제')) return s + '하고';
    if (s.endsWith('다음과 같이')) return s + ' 하고';
    return s + ' 하고';
  };
  const last = (s: string) => {
    if (s.endsWith('하고')) return s.replace(/하고$/, '한다.');
    if (s.endsWith('신설') || s.endsWith('삭제')) return s + '한다.';
    if (s.endsWith('다음과 같이')) return s + ' 한다.';
    return s + ' 한다.';
  };
  return fixed.map((s, i) => (i === fixed.length - 1 ? last(s) : endVerb(s))).join(', ');
}

export function buildAddenda(kind: RuleKind, a: AddendaSpec, draftHash?: string, rule?: Rule): string[] {
  const noun = `이 ${NOUN[kind]}`;
  const subj = `${noun}${eunNeun(noun)}`;
  const isAdm = ['directive', 'established_rule', 'notice', 'guideline'].includes(kind);
  let effective: string;
  if (a.effective === 'months') effective = `${subj} ${isAdm ? '발령' : '공포'} 후 ${a.months ?? 3}개월이 경과한 날부터 시행한다.`;
  else if (a.effective === 'date' && a.date) {
    const [y, m, d] = a.date.split('-').map(Number);
    effective = `${subj} ${y}년 ${m}월 ${d}일부터 시행한다.`;
  } else effective = isAdm ? `${subj} 발령한 날부터 시행한다.` : `${subj} 공포한 날부터 시행한다.`;
  const items: string[] = [];
  items.push(...confirmedTransitionClauses(a, draftHash, rule));
  // Keep a manually entered legacy clause, without treating an old checkbox as
  // a legal decision. A deadline belongs at the end of the substantive articles.
  if (a.transitional?.trim()) items.push(`(경과조치) ${a.transitional.trim()}`);
  if (!items.length) return [effective];
  return [`제1조(시행일) ${effective}`, ...items.map((t, i) => `제${i + 2}조${t}`)];
}

export function amendTextPlain(r: ReturnType<typeof buildAmendText>, docTitle: string): string {
  const out = [docTitle, '', r.header];
  for (const s of r.sentences) {
    out.push(s.text);
    if (s.body) out.push(...s.body.map((b) => '  ' + b));
  }
  out.push('', '부      칙', ...r.addendaText);
  return out.join('\n');
}
