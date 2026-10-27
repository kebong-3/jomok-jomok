import { CIRCLED_CLASS, fromCircled, uid } from './labels';
import type { Annex, Article, ParseDiagnostic, Rule, RuleKind } from './types';

const RE_ARTICLE = /^\s*제\s*(\d+)\s*조(?:의\s*(\d+))?\s*(?:\(([^()]*(?:\([^()]*\)[^()]*)*)\))?\s*(.*)$/u;
const RE_ARTICLE_NUMBER = /^\s*제\s*\d+\s*조(?:의\s*\d+)?/u;
const RE_ARTICLE_REFERENCE_TAIL = /^(?:[을를이가은는에의와과로부까]|제\d|\s*(?:및|또는|부터|에서))/u;
const RE_ART_DEL = /^\s*제\s*(\d+)\s*조(?:의\s*(\d+))?\s*삭제\s*(<[^>]*>)?\s*$/u;
const RE_PARA = new RegExp(`^\\s*(${CIRCLED_CLASS})\\s*(.*)$`, 'u');
const RE_ADDENDA = /^\s*부\s*칙(?:\s*<[^>]*>)?\s*$/u;
const RE_ANNEX = /^\s*\[\s*별표\s*(\d+)?(?:의\s*(\d+))?\s*\]\s*(.*)$/u;
const RE_FORM = /^\s*\[\s*별지\s*제?\s*(\d+)(?:의\s*(\d+))?\s*호\s*서식\s*\]\s*(.*)$/u;
const RE_CHAPTER = /^\s*제\s*\d+\s*(장|절|관)(?:의\s*\d+)?\s+\S/u;
const RE_HISTORY_TAIL = /\s*(<(?:개정|신설|삭제|전문개정)[^>]*>|\[(?:본조신설|전문개정|제목개정|종전[^\]]*)[^\]]*\])\s*$/u;

function stripHistory(s: string): string {
  let out = s;
  for (let i = 0; i < 4; i++) {
    const n = out.replace(RE_HISTORY_TAIL, '');
    if (n === out) break;
    out = n;
  }
  return out.trimEnd();
}

function normalizeLine(s: string): string {
  return s
    .replace(/ /g, ' ')
    .replace(/[“”″]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[ \t]+/g, ' ')
    .trimEnd();
}

/**
 * 규정 원문 → 구조. 원문은 바꾸지 않고, 비교용 구조만 만든다.
 * 지원: 제목줄, 장·절·관, 조(제목·가지번호·삭제조), 항(①~㊿), 호·목(항 본문에 줄로 보존), 부칙, 별표·별지 서식
 */
export function parseRule(raw: string, kind: RuleKind = 'rule', titleHint?: string): Rule {
  const lines = raw.split(/\r?\n/).map(normalizeLine);
  const diagnostics: ParseDiagnostic[] = [];
  const articles: Article[] = [];
  const annexes: Annex[] = [];
  const preamble: string[] = [];
  let headings: string[] = [];
  let title = titleHint ?? '';
  let mode: 'head' | 'body' | 'addenda' | 'annex' = 'head';
  let addenda: string[] = [];
  let cur: Article | undefined;
  let curAnnex: Annex | undefined;

  const pushParaText = (text: string, newLine: boolean) => {
    if (!cur) return;
    const p = cur.paragraphs[cur.paragraphs.length - 1];
    if (!p) {
      cur.paragraphs.push({ uid: uid('p'), text });
      return;
    }
    p.text = p.text ? p.text + (newLine ? '\n' : ' ') + text : text;
  };

  lines.forEach((line, idx) => {
    const ln = idx + 1;
    if (!line.trim()) return;

    const mAnnex = line.match(RE_ANNEX);
    const mForm = line.match(RE_FORM);
    if (mAnnex || mForm) {
      const m = (mAnnex || mForm)!;
      mode = 'annex';
      curAnnex = {
        uid: uid('x'),
        kind: mAnnex ? 'table' : 'form',
        num: m[1] ? Number(m[1]) : 1,
        br: m[2] ? Number(m[2]) : undefined,
        title: m[3]?.trim() ?? '',
        text: '',
      };
      annexes.push(curAnnex);
      return;
    }
    if (mode === 'annex' && curAnnex) {
      curAnnex.text = curAnnex.text ? curAnnex.text + '\n' + line.trim() : line.trim();
      return;
    }
    if (RE_ADDENDA.test(line)) {
      mode = 'addenda';
      cur = undefined;
      return;
    }
    if (mode === 'addenda') {
      addenda.push(line.trim());
      return;
    }
    if (RE_CHAPTER.test(line)) {
      headings.push(line.trim());
      return;
    }

    const mDel = line.match(RE_ART_DEL);
    if (mDel) {
      mode = 'body';
      cur = { uid: uid('a'), num: Number(mDel[1]), br: mDel[2] ? Number(mDel[2]) : undefined, paragraphs: [], deleted: true };
      if (headings.length) { cur.headings = headings; headings = []; }
      articles.push(cur);
      return;
    }
    const mArt = line.match(RE_ARTICLE);
    // Consume the complete branch number first. A combined optional-branch
    // regex can backtrack and misread "제1조의2" as "제1조" + particle "의".
    if (mArt && !RE_ARTICLE_REFERENCE_TAIL.test(line.slice(line.match(RE_ARTICLE_NUMBER)![0].length))) {
      mode = 'body';
      cur = {
        uid: uid('a'),
        num: Number(mArt[1]),
        br: mArt[2] ? Number(mArt[2]) : undefined,
        title: mArt[3]?.trim() || undefined,
        paragraphs: [],
      };
      if (headings.length) { cur.headings = headings; headings = []; }
      articles.push(cur);
      const rest = stripHistory(mArt[4] ?? '');
      const mP = rest.match(RE_PARA);
      if (mP) {
        const text = stripHistory(mP[2]);
        cur.paragraphs.push({ uid: uid('p'), num: fromCircled(mP[1]), text, deleted: /^삭제\s*(<[^>]*>)?$/.test(text) || undefined });
      } else if (rest) {
        cur.paragraphs.push({ uid: uid('p'), text: rest });
      }
      return;
    }
    if (mode === 'head') {
      if (!title) title = line.trim();
      else if (line.trim() !== title) preamble.push(line.trim());
      return;
    }
    if (!cur) {
      diagnostics.push({ line: ln, text: line, message: '어느 조에도 속하지 않는 줄입니다' });
      return;
    }
    const mP = line.match(RE_PARA);
    if (mP) {
      const text = stripHistory(mP[2]);
      const num = fromCircled(mP[1]);
      // 첫 항이 원문자 없이 시작했다면 그 항을 ①로 본다
      if (cur.paragraphs.length === 1 && cur.paragraphs[0].num === undefined && num === 2) cur.paragraphs[0].num = 1;
      cur.paragraphs.push({ uid: uid('p'), num, text, deleted: /^삭제\s*(<[^>]*>)?$/.test(text) || undefined });
      return;
    }
    // 호·목·세목 또는 이어지는 줄
    const isItem = /^\s*(\d+(?:의\d+)?\.|[가-하](?:의\d+)?\.|\d+\)|\([가-하]\))\s/u.test(line);
    pushParaText(stripHistory(line.trim()), isItem || true);
  });

  // 진단: 항 번호 연속성
  for (const a of articles) {
    const nums = a.paragraphs.map((p) => p.num).filter((n): n is number => n !== undefined);
    nums.forEach((n, i) => {
      if (i > 0 && n !== nums[i - 1] + 1) {
        diagnostics.push({ line: 0, text: `제${a.num}조`, message: `항 번호가 ${nums[i - 1]} 다음에 ${n}입니다` });
      }
    });
  }

  if (headings.length) diagnostics.push({ line: lines.length, text: headings.join('\n'), message: '이 표제 뒤에 조문이 없습니다. 원문 배치를 확인하세요.' });
  return { title: title || '제목 없는 규정', kind, articles, addenda: addenda.join('\n'), annexes, diagnostics, preamble };
}

/** 구조 → 원문 형태 텍스트(개정 후 전문) */
export function renderRule(rule: Rule): string {
  const out: string[] = [rule.title, ...(rule.preamble ?? []), ''];
  for (const a of rule.articles) out.push(...(a.headings ?? []), renderArticle(a));
  if (rule.addenda) out.push('', '부칙', rule.addenda);
  for (const x of rule.annexes) {
    const head = x.kind === 'table' ? `[별표 ${x.num}${x.br ? `의${x.br}` : ''}]` : `[별지 제${x.num}${x.br ? `의${x.br}` : ''}호서식]`;
    out.push('', `${head} ${x.title}`.trim(), x.text);
  }
  return out.join('\n');
}

export function renderArticle(a: Article): string {
  const head = `제${a.num}조${a.br ? `의${a.br}` : ''}`;
  if (a.deleted) return `${head} 삭제`;
  const t = a.title ? `${head}(${a.title})` : head;
  const lines: string[] = [];
  a.paragraphs.forEach((p, i) => {
    const mark = p.num ? `${String.fromCodePoint(p.num <= 20 ? 0x2460 + p.num - 1 : p.num <= 35 ? 0x3251 + p.num - 21 : 0x32b1 + p.num - 36)} ` : '';
    const body = p.deleted ? '삭제' : p.text;
    const [first, ...rest] = body.split('\n');
    lines.push(i === 0 ? `${t} ${mark}${first}` : `${mark}${first}`);
    lines.push(...rest);
  });
  if (!a.paragraphs.length) lines.push(t);
  return lines.join('\n');
}
