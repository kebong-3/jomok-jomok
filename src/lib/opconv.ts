import type { ChangeOp, Rule, SpecOp, UnitRef } from '@/engine';
import { findArticle } from '@/engine';
import { newId } from './project';

export interface AiOp {
  type: 'replace_text' | 'insert_paragraph' | 'delete_paragraph' | 'insert_article' | 'delete_article' | 'set_title';
  target?: string;
  after?: string;
  find?: string;
  replace?: string;
  position?: number;
  text?: string;
  title?: string;
  paragraphs?: string[];
  why?: string;
  evidence?: string[];
}

export function parseLabel(s?: string): UnitRef | undefined {
  if (!s) return undefined;
  const m = s.replace(/\s/g, '').match(/제(\d+)조(?:의(\d+))?(?:제(\d+)항)?/);
  if (!m) return undefined;
  return { art: +m[1], artBr: m[2] ? +m[2] : undefined, para: m[3] ? +m[3] : undefined };
}

function parseAnnexLabel(s?: string) {
  if (!s) return undefined;
  const t = s.replace(/\s/g, '');
  const a = t.match(/별표(\d+)/);
  if (a) return { kind: 'annex' as const, annexKind: 'table' as const, num: +a[1] };
  const f = t.match(/별지제(\d+)호서식/);
  if (f) return { kind: 'annex' as const, annexKind: 'form' as const, num: +f[1] };
  return undefined;
}

/** AI가 낸 연산 → 변경 연산(대상 실존·찾을 글자 1회 존재 검사). 통과 못 하면 이유와 함께 버림 */
export function convertOps(rule: Rule, ops: AiOp[], provenance: 'ai' | 'human' = 'ai', evidenceIds: Set<string> = new Set()): { ok: SpecOp[]; dropped: { op: AiOp; reason: string }[] } {
  const ok: SpecOp[] = [];
  const dropped: { op: AiOp; reason: string }[] = [];
  for (const o of ops) {
    const ref = parseLabel(o.target);
    const art = ref && findArticle(rule.articles, ref);
    let change: ChangeOp | undefined;
    let reason = '';
    switch (o.type) {
      case 'replace_text': {
        const annex = parseAnnexLabel(o.target);
        if (annex && !ref) {
          change = { op: 'replace_text', target: annex, find: o.find ?? '', replace: o.replace ?? '' };
          break;
        }
        if (!art || !ref) { reason = `${o.target ?? '대상'}을(를) 찾지 못했습니다`; break; }
        const texts = ref.para ? art.paragraphs.filter((p) => p.num === ref.para).map((p) => p.text) : art.paragraphs.map((p) => p.text);
        const n = texts.join('\n').split(o.find ?? '\u0000').length - 1;
        if (!o.find || n !== 1) { reason = n === 0 ? `"${o.find}"가 원문에 없습니다` : `"${o.find}"가 여러 번 나옵니다`; break; }
        change = { op: 'replace_text', target: { kind: 'unit', ref }, find: o.find, replace: o.replace ?? '' };
        break;
      }
      case 'insert_paragraph':
        if (!art || !ref || !o.text) { reason = '항을 넣을 조 또는 문장이 없습니다'; break; }
        change = { op: 'insert_paragraph', art: { art: ref.art, artBr: ref.artBr }, position: o.position ?? art.paragraphs.length + 1, text: o.text.replace(/^[①-⑳]\s*/, '') };
        break;
      case 'delete_paragraph':
        if (!art || !ref?.para || !art.paragraphs.find((p) => p.num === ref.para)) { reason = `${o.target}을(를) 찾지 못했습니다`; break; }
        change = { op: 'delete_paragraph', target: ref };
        break;
      case 'insert_article': {
        const after = parseLabel(o.after);
        if (!after || !findArticle(rule.articles, after) || !o.paragraphs?.length) { reason = '조를 넣을 위치 또는 문장이 없습니다'; break; }
        change = { op: 'insert_article', after: { art: after.art, artBr: after.artBr }, title: o.title ?? '', paragraphs: o.paragraphs.map((p) => p.replace(/^[①-⑳]\s*/, '')), policy: 'branch' };
        break;
      }
      case 'delete_article':
        if (!art || !ref) { reason = `${o.target}을(를) 찾지 못했습니다`; break; }
        change = { op: 'delete_article', target: { art: ref.art, artBr: ref.artBr } };
        break;
      case 'set_title':
        if (!art || !ref || !o.title) { reason = '제목을 바꿀 조가 없습니다'; break; }
        change = { op: 'set_title', target: { art: ref.art, artBr: ref.artBr }, title: o.title.replace(/^\(|\)$/g, '') };
        break;
    }
    if (!change) {
      dropped.push({ op: o, reason });
      continue;
    }
    const ev = (o.evidence ?? []).filter((e) => evidenceIds.has(e));
    ok.push({ id: newId(), change, status: 'proposed', provenance, why: o.why, evidence: ev });
  }
  return { ok, dropped };
}

/** 카드 제목(사람 말) */
export function opTitle(c: ChangeOp, ruleTitleOf: (r: UnitRef) => string = () => ''): string {
  const L = (r: UnitRef) => `제${r.art}조${r.artBr ? `의${r.artBr}` : ''}${r.para ? `제${r.para}항` : ''}`;
  switch (c.op) {
    case 'replace_text':
      return c.target.kind === 'unit' ? `${L(c.target.ref)} 문구 고치기` : `${c.target.annexKind === 'table' ? `별표 ${c.target.num}` : `별지 제${c.target.num}호서식`} 고치기`;
    case 'insert_paragraph':
      return `${L(c.art)}에 제${c.position}항 새로 넣기`;
    case 'delete_paragraph':
      return `${L(c.target)} 삭제`;
    case 'insert_article':
      return `${L(c.after)} 다음에 조 새로 넣기${c.title ? ` — (${c.title})` : ''}`;
    case 'delete_article':
      return `${L(c.target)} 삭제`;
    case 'set_title':
      return `${L(c.target)} 제목 바꾸기${ruleTitleOf(c.target) ? '' : ''}`;
  }
}
