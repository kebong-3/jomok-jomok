import { searchKnowledge } from './knowledge';
import { KNOWLEDGE_MANIFEST, type KnowledgeCitation, type KnowledgeCoverage, type KnowledgeIssue, type KnowledgeMode, type KnowledgeRecord } from '@/lib/knowledge';

export const REVIEW_SOURCE_CHARACTER_LIMIT = 5500;
export const REVIEW_SOURCE_LIMIT = 6;
interface IssueDefinition { id: KnowledgeIssue; label: string; terms: string[]; query: string }
// These are search concepts, never legal answers, page numbers or mandatory obligations.
const ISSUES: IssueDefinition[] = [
  { id: 'authority', label: '권한·위임·권리와 의무', terms: ['위임', '권한', '권리', '의무', '신고', '허가', '등록', '과태료', '제재', '제출하여야', '제출해야', '법률유보'], query: '자치사무 법률유보 권리 제한 의무 부과 위임 범위 재위임' },
  { id: 'addenda', label: '부칙·기존 업무의 적용', terms: ['부칙', '적용례', '경과조치', '특례', '종전', '시행일', '시행 전', '시행전', '기존 위원', '임기', '접수한', '진행 중', '진행중'], query: '부칙 적용례 경과조치 특례 종전 규정 기존 위원 임기 시행일' },
  { id: 'form', label: '제·개정 형식·조문 구조', terms: ['전부개정', '일부개정', '폐지', '가지번호', '가지조문', '별표', '별지', '서식', '신구조문대비표', '조문 체계'], query: '입법형식 일부개정 전부개정 폐지 종전 부칙 별표 별지 서식' },
  { id: 'plain', label: '문장 정비·의미의 변화', terms: ['알기 쉬', '알기쉬', '문장', '용어', '당해', '내지', '과반수', '반수', '및', '또는', '이상', '이하', '초과', '미만'], query: '알기 쉬운 법령 용어 문장 및 또는 이상 초과 과반수 의미' },
  { id: 'opinion', label: '의견제시 요청의 요건·서식', terms: ['의견제시', '질의서', '요청서', '질의요지', '질의 요지', '갑설', '을설', '대립 의견'], query: '의견제시 요청서 질의 배경 질의 요지 갑설 을설 요청기관 의견' },
  { id: 'procedure', label: '예고·협의·기한과 절차', terms: ['입법예고', '재예고', '재입법예고', '행정예고', '제출 의견', '제출의견', '비용추계', '협의', '재검토기한', '존속기한', '일몰'], query: '입법예고 제출 의견 처리 재예고 협의 재검토기한 존속기한' },
];
const normalize = (text: string) => text.normalize('NFC').replace(/\s+/g, '');
function issueIds(text: string): KnowledgeIssue[] {
  const value = normalize(text);
  return ISSUES.filter(issue => issue.terms.some(term => value.includes(normalize(term)))).map(issue => issue.id);
}

/** Full input is scanned for retrieval clues; this does not purport to semantically review it. */
export function knowledgeInputUnits(document: string): KnowledgeCoverage['inputUnits'] {
  if (!document.trim()) return [];
  const headings = [...document.matchAll(/^[ \t]*(제\s*\d+\s*조(?:\s*의\s*\d+)?(?:\s*\([^\n)]{0,100}\))?|부\s*칙[^\n]{0,80}|\[?별(?:표|지)[^\n]{0,100})/gm)];
  if (!headings.length) return [{ label: '입력 본문', issues: issueIds(document) }];
  const units: KnowledgeCoverage['inputUnits'] = [];
  if (document.slice(0, headings[0].index).trim()) units.push({ label: '제목·도입부', issues: issueIds(document.slice(0, headings[0].index)) });
  headings.forEach((heading, index) => {
    const text = document.slice(heading.index, headings[index + 1]?.index ?? document.length);
    units.push({ label: heading[1].replace(/\s+/g, ' ').slice(0, 160), issues: issueIds(text) });
  });
  // 12,000 chars normally permit fewer units. Preserve an explicit combined tail
  // rather than silently dropping pathological one-character-per-line inputs.
  return units.length > 400 ? [...units.slice(0, 399), { label: `이후 입력 단위 ${units.length - 399}개`, issues: [...new Set(units.slice(399).flatMap(unit => unit.issues))] }] : units;
}

/** Balanced lexical retrieval within the existing 6-source / 5,500-char budget.
 * A topic found at the end receives its own query; it no longer competes only
 * through the first 700 characters of an unrelated introduction. */
export function retrieveKnowledgeReview(input: { question: string; document: string; kind: string; mode: KnowledgeMode }): { sources: KnowledgeCitation[]; retrieval: KnowledgeRecord } {
  const query = input.question.normalize('NFC').trim().slice(0, 2000);
  // Run the explicit question first, preserving query errors and index failures.
  const main = searchKnowledge(query, { kind: input.kind, mode: input.mode, limit: 6 });
  const questionIssues = issueIds(query);
  const documentIssues = issueIds(input.document);
  const orderedIds = [...new Set([...questionIssues, ...(input.mode === 'plain_language' ? ['plain' as const] : input.mode === 'opinion_request' ? ['opinion' as const] : []), ...documentIssues])];
  const searches = orderedIds.map(id => {
    const definition = ISSUES.find(issue => issue.id === id)!;
    const terms = definition.terms.filter(term => normalize(query + input.document).includes(normalize(term)));
    const issueQuery = [terms.join(' '), definition.query].filter(Boolean).join(' ').slice(0, 2000);
    const mode = id === 'plain' ? 'plain_language' : id === 'opinion' ? 'opinion_request' : input.mode === 'plain_language' || input.mode === 'opinion_request' ? 'review' : input.mode;
    return { id, label: definition.label, query: issueQuery, hits: searchKnowledge(issueQuery, { kind: input.kind, mode, limit: 4 }).hits };
  });
  // The explicit question is always a separate retrieval lane. It cannot be
  // marked covered merely because a generic manual page happened to be found.
  const lanes = [{ id: 'question' as const, label: '입력한 질문', query, hits: main.hits }, ...searches];
  const sources: KnowledgeCitation[] = [];
  const pages = new Set<string>();
  let sourceCharacters = 0;
  const add = (hit: typeof main.hits[number]): boolean => {
    if (sources.some(source => source.id === hit.id)) return true;
    const page = `${hit.documentId}:${hit.pdfPage ?? hit.id}`;
    if (pages.has(page) || sources.length >= REVIEW_SOURCE_LIMIT || sourceCharacters + hit.text.length > REVIEW_SOURCE_CHARACTER_LIMIT) return false;
    const { score: _score, matchedTerms: _terms, ...citation } = hit;
    sources.push(citation); pages.add(page); sourceCharacters += hit.text.length; return true;
  };
  // First round reserves an opportunity for each issue. Subsequent rounds add
  // supporting context without filling the budget with one repeated topic.
  for (let round = 0; round < 4; round++) for (const lane of lanes) {
    if (round === 0) {
      for (const hit of lane.hits) if (add(hit)) break;
    } else if (lane.hits[round]) add(lane.hits[round]);
  }
  const selected = new Set(sources.map(source => source.id));
  const coverage: KnowledgeCoverage = {
    documentCharacters: input.document.length, scannedCharacters: input.document.length, inputUnits: knowledgeInputUnits(input.document),
    issues: lanes.map(lane => {
      const citationIds = lane.hits.filter(hit => selected.has(hit.id)).map(hit => hit.id);
      return { id: lane.id, label: lane.label, query: lane.query, status: citationIds.length ? 'included' : lane.hits.length ? 'budget_omitted' : 'not_found', citationIds };
    }),
    sourceCharacters, sourceCharacterLimit: REVIEW_SOURCE_CHARACTER_LIMIT,
    note: '입력 본문 전체를 검토 요청에 사용하며, 실제 AI 응답 상태는 별도로 표시합니다. 쟁점 단서는 자동 탐지한 검색 후보이며, 발췌문 선택이나 원문 인용 일치가 모든 조문의 검토 완료·적법성·현행성을 뜻하지 않습니다. 자료가 없거나 전달되지 않은 쟁점은 별도 검토하세요.',
  };
  return { sources, retrieval: { role: `knowledge_${input.mode}`, query, retrievedAt: new Date().toISOString(), version: KNOWLEDGE_MANIFEST.version,
    method: 'hybrid-lexical', status: sources.length ? 'retrieved' : 'empty', citations: sources, note: main.note, coverage } };
}
