import { z } from 'zod';
import { buildAddenda, eunNeun, derive, hashText, parseRule, renderArticle, renderRule, type Derived, type Rule, type SpecOp } from '@/engine';
import { citationSchema, knowledgeAnswerSchema, knowledgeRecordSchema, type KnowledgeAnswer } from './knowledge';
import type { Project } from './project';
import { amendmentKind, deriveProject, replacementBody } from './amendment-method';
import { transitionDraftHash } from './transition-review';
import { enactRule as toEnactRule } from './pipeline';

export const REVIEW_DOCUMENT_LIMIT = 12_000;
export type ReviewStage = 'articles' | 'lint' | 'docs';
const compactQuote = (text: string) => text.normalize('NFC').replace(/\s+/g, '');
export const knowledgeAssistResultSchema = z.object({
  answer: knowledgeAnswerSchema.optional(),
  sources: z.array(citationSchema).max(16),
  retrieval: knowledgeRecordSchema,
  trace: z.object({ model: z.string().max(200), modelLabel: z.string().max(300).optional(), actualModel: z.string().max(200).optional(), latencyMs: z.number().finite().nonnegative().optional(), promptVersion: z.string().max(200).optional(), fallbacks: z.array(z.string().max(500)).max(20).optional() }).optional(),
  status: z.enum(['answered', 'insufficient', 'ai_unavailable']),
  message: z.string().max(3000).optional(), warnings: z.array(z.string().max(3000)).max(30).optional(),
}).superRefine((value, ctx) => {
  if (value.status === 'answered' && !value.answer) ctx.addIssue({ code: 'custom', message: '검토 답변이 없습니다.' });
  const ids = new Map(value.sources.map(source => [source.id, source]));
  if (ids.size !== value.sources.length) ctx.addIssue({ code: 'custom', message: '검토 원문의 ID가 중복됩니다.' });
  for (const source of value.sources) {
    const retrieval = value.retrieval.citations.find(citation => citation.id === source.id);
    if (!retrieval || JSON.stringify(retrieval) !== JSON.stringify(source)) ctx.addIssue({ code: 'custom', message: '검토 원문과 검색 기록이 일치하지 않습니다.' });
  }
  for (const item of [...(value.answer?.points ?? []), ...(value.answer?.changes ?? [])]) {
    if (item.citations.some(ref => !ids.has(ref.id) || compactQuote(ref.quote).length < 8 || !compactQuote(ids.get(ref.id)!.text).includes(compactQuote(ref.quote)))) ctx.addIssue({ code: 'custom', message: '검토 답변의 인용문을 검색 원문에서 확인할 수 없습니다.' });
  }
});
export type KnowledgeAssistResult = z.infer<typeof knowledgeAssistResultSchema>;
export interface KnowledgeAssistRequest { question: string; document: string; kind: string; mode: 'explain' | 'review' | 'plain_language' | 'opinion_request' }

const appliedChangeSchema = z.object({ index: z.number().int().min(0).max(7), before: z.string().max(1800), after: z.string().max(1800), where: z.string().max(300) });
const undoParagraphSchema = z.object({ articleId: z.string().max(500), paragraphIndex: z.number().int().min(0).max(1000), before: z.string().max(200000), after: z.string().max(200000), provenance: z.enum(['ai', 'ai_accepted', 'human']) });
/** Only the latest review is kept. This is a draft-edit audit, not a legal approval. */
export const workReviewSessionSchema = z.object({
  version: z.literal(1), id: z.string().min(1).max(100), stage: z.enum(['articles', 'lint', 'docs']), createdAt: z.number().int().nonnegative(),
  scope: z.array(z.string().max(500)).max(1001), snapshotHash: z.string().regex(/^[a-f0-9]{16}$/),
  request: z.object({ question: z.string().min(2).max(2000), document: z.string().max(REVIEW_DOCUMENT_LIMIT), kind: z.string().max(50), mode: z.enum(['explain', 'review', 'plain_language', 'opinion_request']) }),
  result: knowledgeAssistResultSchema, selected: z.array(z.number().int().min(0).max(7)).max(8),
  application: z.object({
    appliedAt: z.number().int().nonnegative(), afterHash: z.string().regex(/^[a-f0-9]{16}$/), changes: z.array(appliedChangeSchema).min(1).max(8),
    undo: z.object({ paragraphs: z.array(undoParagraphSchema).max(8), opIds: z.array(z.string().min(1).max(500)).max(8), replacement: z.object({ beforeRaw: z.string().max(200000), afterRaw: z.string().max(200000) }).optional() }),
    undoneAt: z.number().int().nonnegative().optional(),
  }).optional(),
}).superRefine((session, ctx) => {
  if (session.result.answer?.changes.some(change => !session.request.document.includes(change.before) || change.before === change.after)) ctx.addIssue({ code: 'custom', message: '검토한 본문에서 정비 제안의 기존 문장을 확인할 수 없습니다.' });
  if (session.selected.some(index => !session.result.answer?.changes[index])) ctx.addIssue({ code: 'custom', message: '선택한 정비 제안이 검토 결과에 없습니다.' });
  for (const applied of session.application?.changes ?? []) {
    const change = session.result.answer?.changes[applied.index];
    if (!change || change.before !== applied.before || change.after !== applied.after) ctx.addIssue({ code: 'custom', message: '반영 기록이 검토 제안과 일치하지 않습니다.' });
  }
});
export type WorkReviewSession = z.infer<typeof workReviewSessionSchema>;
export type ReviewChange = KnowledgeAnswer['changes'][number];
export interface ReviewUnit { key: string; label: string; text: string }
export interface ReviewDraft { units: ReviewUnit[]; before?: Rule; derived?: Derived }

/** Excludes output settings and review status so an unrelated notice edit does not break undo. */
export function reviewDraftHash(p: Project): string {
  return hashText(JSON.stringify({ mode: p.mode, kind: p.kind, title: p.title, source: p.source.raw,
    ...(p.mode === 'amend' && amendmentKind(p) !== 'partial' ? { amendmentKind: amendmentKind(p), replacement: p.replacementDraft?.raw } : {}),
    content: p.mode === 'enact' ? { title: p.enact?.title, outline: p.enact?.outline.map(a => ({ id: a.id, title: a.title, paragraphs: a.paragraphs })) } : p.spec.ops.map(o => ({ id: o.id, status: o.status, change: o.change })),
    addenda: p.spec.addenda, excludedFixes: p.excludedFixes, intent: p.intent, purpose: p.purpose, upperLaw: p.upperLaw, profileId: p.profileId, profileSnapshot: p.profileSnapshot, evidence: p.evidence.map(e => ({ id: e.id, text: e.text })),
  }));
}

export function reviewDraft(p: Project): ReviewDraft {
  if (p.mode === 'enact') {
    const units = (p.enact?.outline ?? []).map((a, i) => {
      const label = `제${i + 1}조(${a.title})`;
      return { key: `enact:${a.id}`, label, text: `${label} ${a.paragraphs.map((t, j) => `${a.paragraphs.length > 1 ? String.fromCodePoint(0x2460 + j) + ' ' : ''}${t}`).join('\n')}` };
    });
    const rule = toEnactRule(p);
    const addenda = buildAddenda(p.kind, p.spec.addenda, transitionDraftHash(rule, p.spec.addenda), rule).join('\n');
    if (addenda) units.push({ key: 'addenda', label: '부칙', text: `부칙\n${addenda}` });
    return { units };
  }
  const before = parseRule(p.source.raw, p.kind);
  const derived = deriveProject(p, before, { excludedFixes: new Set(p.excludedFixes) });
  if (amendmentKind(p) === 'repeal') {
    const addenda = buildAddenda(p.kind, p.spec.addenda, transitionDraftHash(before, p.spec.addenda), before).join('\n');
    return { before, derived, units: [{ key: 'repeal', label: '규정 폐지문', text: `${p.title} 폐지안\n${p.title}${eunNeun(p.title)} 폐지한다.` }, { key: 'addenda', label: '부칙', text: `부칙\n${addenda}` }, ...(before.addenda ? [{ key: 'previous-addenda', label: '종전 부칙(참고)', text: before.addenda }] : [])] };
  }
  const units = derived.after.articles.filter(a => !a.deleted).map(a => ({ key: `amend:${a.num}:${a.br ?? 0}`, label: `제${a.num}조${a.br ? `의${a.br}` : ''}${a.title ? `(${a.title})` : ''}`, text: renderArticle(a) }));
  const addenda = buildAddenda(p.kind, p.spec.addenda, transitionDraftHash(derived.after, p.spec.addenda), derived.after).join('\n');
  if (addenda) units.push({ key: 'addenda', label: '부칙', text: `부칙\n${addenda}` });
  return { units, before, derived };
}

export function reviewDocument(p: Project, scope: string[]): string {
  const keys = new Set(scope);
  return [p.enact?.title ?? p.title, ...reviewDraft(p).units.filter(unit => keys.has(unit.key)).map(unit => unit.text)].join('\n\n');
}

interface Match { articleId: string; paragraphIndex: number; text: string; start: number; end: number; where: string; originalArt?: { art: number; artBr?: number }; provenance?: 'ai' | 'ai_accepted' | 'human' }
export interface ReviewChangeState { eligible: boolean; reason?: string; where?: string; match?: Match; find?: string; replace?: string }
const occurrences = (text: string, find: string) => { const starts: number[] = []; for (let at = text.indexOf(find); find && at !== -1; at = text.indexOf(find, at + 1)) starts.push(at); return starts; };
/** Compare parser structure on the entire paragraph, including insertion boundaries. */
function paragraphStructure(text: string): string {
  const parsed = parseRule(`검토용 규정\n제100000조(검토 본문) ${text}`);
  return JSON.stringify({
    articles: parsed.articles.map(a => ({ num: a.num, br: a.br, title: a.title, headings: a.headings, deleted: a.deleted, paragraphs: a.paragraphs.map(p => ({ num: p.num, deleted: p.deleted })) })),
    annexes: parsed.annexes.map(a => ({ kind: a.kind, num: a.num, br: a.br, title: a.title })),
    addenda: text.match(/^\s*부\s*칙(?:\s*<[^>]*>)?\s*$/gm)?.map(t => t.replace(/\s/g, '')) ?? [],
    diagnostics: parsed.diagnostics.map(d => d.message),
  });
}

function findChange(p: Project, scope: string[], change: ReviewChange): ReviewChangeState {
  if (p.mode === 'amend' && amendmentKind(p) === 'repeal') return { eligible: false, reason: '폐지문과 부칙은 작업 방식에 맞춰 조문 화면에서 직접 반영해 주세요. 검토 의견은 보관됩니다.' };
  if (!change.before.trim()) return { eligible: false, reason: '원문 문장이 비어 있어 반영할 수 없습니다.' };
  if (change.before === change.after) return { eligible: false, reason: '기존 문장과 제안이 같습니다.' };
  // The server checks source quotes. Local application remains stricter: exact,
  // case/whitespace-sensitive text with one unique paragraph location.
  const matches: Match[] = [];
  const keys = new Set(scope);
  if (p.mode === 'enact') {
    (p.enact?.outline ?? []).forEach((a, ai) => {
      if (!keys.has(`enact:${a.id}`)) return;
      a.paragraphs.forEach((text, paragraphIndex) => {
        for (const start of occurrences(text, change.before)) matches.push({ articleId: a.id, paragraphIndex, text, start, end: start + change.before.length, where: `제${ai + 1}조${a.paragraphs.length > 1 ? ` 제${paragraphIndex + 1}항` : ''}`, provenance: a.provenance });
      });
    });
  } else {
    const draft = reviewDraft(p);
    if (draft.derived?.rejected.length) return { eligible: false, reason: '기존 변경 중 적용하지 못한 항목을 먼저 정리해 주세요.' };
    if (amendmentKind(p) === 'full') {
      const articles = draft.derived?.after.articles ?? [];
      const addresses = articles.map(a => `${a.num}:${a.br ?? 0}`);
      if (!p.replacementDraft || draft.derived?.after.diagnostics.length || new Set(addresses).size !== addresses.length) return { eligible: false, reason: '전부개정 본문의 조문 주소나 구조가 명확하지 않습니다. 조문 화면에서 원문을 먼저 대조해 주세요.' };
    }
    for (const a of draft.derived?.after.articles ?? []) {
      if (a.deleted || !keys.has(`amend:${a.num}:${a.br ?? 0}`)) continue;
      const original = draft.before!.articles.find(x => x.uid === a.uid);
      a.paragraphs.forEach((paragraph, paragraphIndex) => {
        if (paragraph.deleted) return;
        for (const start of occurrences(paragraph.text, change.before)) matches.push({ articleId: `amend:${a.num}:${a.br ?? 0}`, paragraphIndex, text: paragraph.text, start, end: start + change.before.length, where: `제${a.num}조${a.br ? `의${a.br}` : ''}${paragraph.num ? ` 제${paragraph.num}항` : ''}`, originalArt: original ? { art: original.num, ...(original.br ? { artBr: original.br } : {}) } : undefined });
      });
    }
  }
  if (!matches.length) return { eligible: false, reason: '같은 문장을 본문에서 찾지 못했습니다. 제목·조 번호·부칙 변경은 조문 화면에서 직접 확인해 주세요.' };
  if (matches.length > 1) return { eligible: false, reason: '같은 문장이 여러 곳에 있습니다. 검토할 조문 범위를 좁혀 다시 검토해 주세요.' };
  const match = matches[0];
  if (p.mode === 'amend' && amendmentKind(p) === 'partial' && !match.originalArt) return { eligible: false, reason: '새로 신설하는 조의 구조 변경은 조문 화면에서 직접 수정해 주세요.', where: match.where };
  const nextText = match.text.slice(0, match.start) + change.after + match.text.slice(match.end);
  if (!nextText.trim()) return { eligible: false, reason: '항 전체를 지우는 변경입니다. 조문 화면에서 삭제 구조를 검토해 주세요.', where: match.where };
  if (paragraphStructure(match.text) !== paragraphStructure(nextText)) return { eligible: false, reason: '조·항·부칙·별표의 구조가 바뀌는 제안입니다. 조문 화면에서 구조를 직접 검토해 주세요.', where: match.where };
  return { eligible: true, match, where: match.where, find: change.before, replace: change.after };
}

export function reviewChangeStates(p: Project, session: WorkReviewSession): ReviewChangeState[] {
  const changes = session.result.answer?.changes ?? [];
  if (session.application && !session.application.undoneAt) return changes.map((_, index) => ({ eligible: false, reason: session.application!.changes.some(c => c.index === index) ? '선택하여 초안에 반영했습니다.' : '이번 반영에서는 선택하지 않았습니다. 추가 수정은 새 검토에서 선택해 주세요.' }));
  if (reviewDraftHash(p) !== session.snapshotHash) return changes.map(() => ({ eligible: false, reason: '검토 이후 초안이 바뀌었습니다. 현재 초안으로 다시 검토해 주세요.' }));
  if (p.mode === 'amend' && amendmentKind(p) === 'full' && session.request.document.trim() !== reviewDocument(p, session.scope).trim()) return changes.map(() => ({ eligible: false, reason: '전부개정의 현재 검토 범위가 저장한 본문과 다릅니다. 현재 초안으로 다시 검토해 주세요.' }));
  return changes.map(change => findChange(p, session.scope, change));
}

export interface ReviewApplyResult { project: Project; error?: string; count: number }

export function applyReviewSelection(p: Project, session: WorkReviewSession, selected: number[], now = Date.now()): ReviewApplyResult {
  const fail = (error: string): ReviewApplyResult => ({ project: p, error, count: 0 });
  if (session.application && !session.application.undoneAt) return fail('이미 반영한 검토입니다. 되돌리거나 현재 초안으로 새로 검토해 주세요.');
  if (reviewDraftHash(p) !== session.snapshotHash) return fail('검토 이후 초안이 바뀌었습니다. 현재 초안으로 다시 검토해 주세요.');
  if (p.mode === 'amend' && amendmentKind(p) === 'full' && session.request.document.trim() !== reviewDocument(p, session.scope).trim()) return fail('전부개정의 현재 검토 범위가 저장한 본문과 다릅니다. 현재 초안으로 다시 검토해 주세요.');
  const indexes = [...new Set(selected)].sort((a, b) => a - b);
  if (!indexes.length) return fail('반영할 수정안을 먼저 선택해 주세요.');
  const changes = session.result.answer?.changes ?? [];
  const states = indexes.map(index => changes[index] ? findChange(p, session.scope, changes[index]) : { eligible: false, reason: '존재하지 않는 수정안입니다.' });
  const invalid = states.find(state => !state.eligible);
  if (invalid) return fail(invalid.reason ?? '반영할 문장을 확인하지 못했습니다.');
  for (let i = 0; i < states.length; i++) for (let j = i + 1; j < states.length; j++) {
    const a = states[i].match!, b = states[j].match!;
    if (a.articleId === b.articleId && a.paragraphIndex === b.paragraphIndex && a.start < b.end && b.start < a.end) return fail('선택한 수정안이 같은 문장 범위에서 겹칩니다. 하나씩 선택해 반영해 주세요.');
  }
  let next: Project = p;
  const undo: NonNullable<WorkReviewSession['application']>['undo'] = { paragraphs: [], opIds: [] };
  if (p.mode === 'enact') {
    const groups = new Map<string, { match: Match; changes: { start: number; end: number; after: string }[] }>();
    indexes.forEach((index, i) => {
      const match = states[i].match!, key = `${match.articleId}/${match.paragraphIndex}`;
      const group = groups.get(key) ?? { match, changes: [] };
      group.changes.push({ start: match.start, end: match.end, after: changes[index].after }); groups.set(key, group);
    });
    const outline = p.enact!.outline.map(article => ({ ...article, paragraphs: [...article.paragraphs] }));
    for (const { match, changes: edits } of groups.values()) {
      let text = match.text;
      for (const edit of edits.sort((a, b) => b.start - a.start)) text = text.slice(0, edit.start) + edit.after + text.slice(edit.end);
      if (paragraphStructure(match.text) !== paragraphStructure(text)) return fail('선택한 수정을 함께 반영하면 조·항·부칙·별표 구조가 바뀝니다. 조문 화면에서 직접 검토해 주세요.');
      const article = outline.find(a => a.id === match.articleId)!;
      article.paragraphs[match.paragraphIndex] = text;
      // Applying selected sentences does not approve other AI-written sentences.
      undo.paragraphs.push({ articleId: article.id, paragraphIndex: match.paragraphIndex, before: match.text, after: text, provenance: article.provenance });
    }
    next = { ...p, enact: { ...p.enact!, outline } };
  } else if (amendmentKind(p) === 'full') {
    const raw = p.replacementDraft!.raw;
    const rule = reviewDraft(p).derived!.after;
    const expected = structuredClone(rule);
    const patches: { start: number; end: number; after: string }[] = [];
    // Resolve literal raw positions against the parsed article/paragraph result.
    // Re-rendering the whole raw input would also normalize unrelated spacing,
    // quotes and annexes, so preserve every non-selected character instead.
    for (const [i, index] of indexes.entries()) {
      const match = states[i].match!, item = changes[index];
      const single = structuredClone(rule);
      const paragraph = single.articles.find(a => `amend:${a.num}:${a.br ?? 0}` === match.articleId)!.paragraphs[match.paragraphIndex];
      paragraph.text = paragraph.text.slice(0, match.start) + item.after + paragraph.text.slice(match.end);
      const target = replacementBody(single);
      const locations = occurrences(raw, item.before);
      if (locations.length > 100) return fail('원문에서 같은 문구가 너무 많이 반복됩니다. 조문 화면에서 수정할 문장을 직접 확인해 주세요.');
      const candidates = locations.filter(start => {
        const candidate = raw.slice(0, start) + item.after + raw.slice(start + item.before.length);
        return replacementBody(parseRule(candidate, p.kind, p.title)) === target;
      });
      if (candidates.length !== 1) return fail('선택한 문장의 정확한 원문 위치를 확인하지 못했습니다. 공백·따옴표 등을 원문과 대조하거나 조문 화면에서 직접 수정해 주세요.');
      patches.push({ start: candidates[0], end: candidates[0] + item.before.length, after: item.after });
    }
    // Apply all changes to the original parsed text, in descending positions.
    // Several individually safe edits may combine into a structural change.
    const groups = new Map<string, { match: Match; edits: { start: number; end: number; after: string }[] }>();
    indexes.forEach((index, i) => {
      const match = states[i].match!, key = `${match.articleId}/${match.paragraphIndex}`;
      const group = groups.get(key) ?? { match, edits: [] };
      group.edits.push({ start: match.start, end: match.end, after: changes[index].after }); groups.set(key, group);
    });
    for (const { match, edits } of groups.values()) {
      const paragraph = expected.articles.find(a => `amend:${a.num}:${a.br ?? 0}` === match.articleId)!.paragraphs[match.paragraphIndex];
      for (const edit of edits.sort((a, b) => b.start - a.start)) paragraph.text = paragraph.text.slice(0, edit.start) + edit.after + paragraph.text.slice(edit.end);
      if (paragraphStructure(match.text) !== paragraphStructure(paragraph.text)) return fail('선택한 수정을 함께 반영하면 조·항·부칙·별표 구조가 바뀝니다. 조문 화면에서 직접 검토해 주세요.');
    }
    patches.sort((a, b) => b.start - a.start);
    for (let i = 1; i < patches.length; i++) if (patches[i].end > patches[i - 1].start) return fail('선택한 수정안의 원문 위치가 겹칩니다. 하나씩 선택해 반영해 주세요.');
    let nextRaw = raw;
    for (const patch of patches) nextRaw = nextRaw.slice(0, patch.start) + patch.after + nextRaw.slice(patch.end);
    if (replacementBody(parseRule(nextRaw, p.kind, p.title)) !== replacementBody(expected)) return fail('전부개정 문장 반영 결과가 미리보기와 다릅니다. 조문 화면에서 직접 확인해 주세요.');
    next = { ...p, replacementDraft: { raw: nextRaw } };
    undo.replacement = { beforeRaw: raw, afterRaw: nextRaw };
  } else {
    for (const [i, index] of indexes.entries()) {
      const item = changes[index];
      const state = findChange(next, session.scope, item);
      if (!state.eligible) return fail(`선택한 수정안을 함께 적용할 수 없습니다. ${state.reason ?? ''}`);
      const draft = reviewDraft(next), match = state.match!;
      const opId = `review:${session.id}:${index}:${now}`;
      const op: SpecOp = { id: opId, status: 'accepted', provenance: 'ai_accepted', why: `자료 근거 검토에서 담당자가 선택: ${item.reason}`, change: { op: 'replace_text', target: { kind: 'unit', ref: match.originalArt! }, find: item.before, replace: item.after } };
      const candidate = { ...next, spec: { ...next.spec, ops: [...next.spec.ops, op] } };
      const result = reviewDraft(candidate).derived!;
      const expected = structuredClone(draft.derived!.after);
      const paragraph = expected.articles.find(a => `amend:${a.num}:${a.br ?? 0}` === match.articleId)!.paragraphs[match.paragraphIndex];
      paragraph.text = paragraph.text.slice(0, match.start) + item.after + paragraph.text.slice(match.end);
      if (result.rejected.some(reject => reject.opId === opId) || renderRule(result.after) !== renderRule(expected)) return fail(`수정안 ${indexes[i] + 1}의 적용 결과가 미리보기와 다릅니다. 조문 화면에서 직접 확인해 주세요.`);
      next = candidate; undo.opIds.push(opId);
    }
  }
  if (next.prose) next = { ...next, prose: { ...next.prose, reviewed: false } };
  const application: NonNullable<WorkReviewSession['application']> = {
    appliedAt: now, afterHash: reviewDraftHash(next), changes: indexes.map((index, i) => ({ index, before: changes[index].before, after: changes[index].after, where: states[i].where! })), undo,
  };
  next = { ...next, workReview: { ...session, selected: indexes, application } };
  return { project: next, count: indexes.length };
}

export function undoReviewApplication(p: Project, now = Date.now()): ReviewApplyResult {
  const session = p.workReview, application = session?.application;
  const fail = (error: string): ReviewApplyResult => ({ project: p, error, count: 0 });
  if (!session || !application || application.undoneAt) return fail('되돌릴 검토 반영 기록이 없습니다.');
  if (reviewDraftHash(p) !== application.afterHash) return fail('반영 이후 조문이 다시 바뀌었습니다. 다른 수정 내용을 보호하기 위해 자동 되돌리기를 멈췄습니다.');
  let next: Project;
  if (p.mode === 'enact') {
    const outline = p.enact!.outline.map(article => ({ ...article, paragraphs: [...article.paragraphs] }));
    for (const patch of application.undo.paragraphs) {
      const article = outline.find(a => a.id === patch.articleId);
      if (!article || article.paragraphs[patch.paragraphIndex] !== patch.after) return fail('되돌릴 본문이 반영 당시 내용과 다릅니다.');
      article.paragraphs[patch.paragraphIndex] = patch.before;
    }
    next = { ...p, enact: { ...p.enact!, outline } };
  } else if (amendmentKind(p) === 'full') {
    const patch = application.undo.replacement;
    if (!patch || p.replacementDraft?.raw !== patch.afterRaw || application.undo.opIds.length || application.undo.paragraphs.length) return fail('되돌릴 전부개정 본문이 반영 당시 내용과 다릅니다.');
    next = { ...p, replacementDraft: { raw: patch.beforeRaw } };
  } else {
    const ids = new Set(application.undo.opIds);
    if (ids.size !== application.undo.opIds.length || [...ids].some(id => !p.spec.ops.some(op => op.id === id))) return fail('되돌릴 변경 기록을 찾지 못했습니다.');
    next = { ...p, spec: { ...p.spec, ops: p.spec.ops.filter(op => !ids.has(op.id)) } };
  }
  if (reviewDraftHash(next) !== session.snapshotHash) return fail('반영 전 초안과 일치하지 않아 자동 되돌리기를 멈췄습니다.');
  if (next.prose) next = { ...next, prose: { ...next.prose, reviewed: false } };
  return { project: { ...next, workReview: { ...session, selected: [], application: { ...application, undoneAt: now } } }, count: application.changes.length };
}
