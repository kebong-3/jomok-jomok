import { knowledgeAnswerSchema, type KnowledgeAnswer, type KnowledgeCitation } from '@/lib/knowledge';
const compact = (text: string) => text.normalize('NFC').replace(/\s+/g, '');
const logicalWords = (text: string) => text.match(/또는|그리고|및|하여야\s*한다|해야\s*한다|할\s*수\s*있다|할\s*수\s*없다|하여서는\s*아니\s*된다|해서는\s*아니\s*된다|해서는\s*안\s*된다|하지\s*아니한다|하지\s*않는다|하지\s*못한다|아니할\s*수\s*있다|정당한\s*사유\s*없이|제외|이상|이하|초과|미만|모든|일부/g)?.map(compact).join('|') ?? '';
const numbers = (text: string) => text.match(/\d+(?:[.,]\d+)*/g)?.join('|') ?? '';
/** Mechanical source/quotation checks, not validation of a legal interpretation. */
export function validateKnowledgeAnswer(raw: unknown, sources: KnowledgeCitation[], document = ''): { answer?: KnowledgeAnswer; warnings: string[] } {
 const parsed = knowledgeAnswerSchema.safeParse(raw);
 if (!parsed.success) return { warnings: ['AI 응답 구조를 확인하지 못했습니다. 검색한 원문을 먼저 확인하세요.'] };
 const lookup = new Map(sources.map(c => [c.id, c])); let removed = 0, substantive = 0;
 const validRefs = (refs: KnowledgeAnswer['points'][number]['citations']) => refs.filter(ref => {
  const source = lookup.get(ref.id); const valid = !!source && compact(ref.quote).length >= 8 && compact(source.text).includes(compact(ref.quote));
  if (!valid) removed++; return valid;
 });
 const points = parsed.data.points.flatMap(point => { const citations = validRefs(point.citations); return citations.length ? [{ ...point, citations }] : []; });
 const changes = parsed.data.changes.flatMap(change => {
  const citations = validRefs(change.citations);
  if (!citations.length || !document.includes(change.before) || change.before === change.after) { removed++; return []; }
  const conditions = numbers(change.before) !== numbers(change.after) || logicalWords(change.before) !== logicalWords(change.after);
  if (conditions && change.changeType !== 'substance') substantive++;
  return [{ ...change, citations, changeType: conditions ? 'substance' as const : change.changeType }];
 });
 const warnings: string[] = [];
 if (removed) warnings.push(`검색 원문과 일치하지 않는 인용·변경 제안 ${removed}건을 제외했습니다.`);
 if (substantive) warnings.push(`수치·의무·조건 표현이 바뀐 제안 ${substantive}건을 내용 변경 검토 대상으로 표시했습니다.`);
 if (!points.length) return { warnings: [...warnings, '원문 인용으로 뒷받침할 수 있는 설명이 없어 AI 답변을 표시하지 않았습니다.'] };
 return { answer: { ...parsed.data, summary: removed ? '검색 원문과 대조할 수 있는 검토 사항을 아래에 정리했습니다. 제외된 항목은 원문과 질문을 구체화하여 다시 확인하세요.' : parsed.data.summary, points, changes, draft: removed ? undefined : parsed.data.draft }, warnings };
}
