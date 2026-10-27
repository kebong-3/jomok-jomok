import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import {
  KNOWLEDGE_DOCUMENTS, KNOWLEDGE_MANIFEST,
  type KnowledgeChunk, type KnowledgeCitation, type KnowledgeHit,
  type KnowledgeMode, type KnowledgeRecord, type KnowledgeSearchResult,
} from '@/lib/knowledge';

/** Local retrieval: sparse term BM25 + Korean character matching. No embeddings
 * or provider request is silently substituted for this reproducible search. */
export class KnowledgeError extends Error {
  constructor(public code: 'BAD_QUERY' | 'CORPUS_UNAVAILABLE', message: string) { super(message); }
}
export interface KnowledgeSearchOptions {
  documentIds?: string[];
  kind?: string;
  mode?: KnowledgeMode;
  limit?: number;
}

const STOP = new Set([
  '법령', '규정', '조례', '법률', '경우', '내용', '사항', '기준', '조문', '기관', '관련',
  '이것', '그것', '대해', '대한', '어떻게', '무엇', '어떤', '언제', '왜', '모두', '아직',
  '해당', '이상', '같은', '다른', '새로운', '새로', '기존', '그리고', '또한', '따라',
  '있다', '없다', '있는', '없는', '한다', '하는', '하기', '경우에는', '경우', '때문',
  '되나요', '하나요', '인가요', '무엇인가요', '있나요', '알려주세요', '해주세요', '주세요',
  '싶습니다', '합니다', '하려고', '그대로', '무조건', '반드시', '자동으로', '가능한', '가능',
  '검토', '작성', '설명', '확인', '선택', '구분', '사람', '단계', '근거', '때는', '추천',
]);
const GENERIC = new Set(['제정', '개정', '적용', '시행', '상위법', '상위법령', '일부개정', '방법', '대상', '표현', '정비']);
const KINDS = new Set(['all', 'law', 'ordinance', 'rule', 'directive', 'established_rule', 'notice', 'guideline', 'bylaw', 'act', 'decree', 'ministry_rule']);
const MODES = new Set(['explain', 'review', 'plain_language', 'opinion_request']);
const ALIASES: string[][] = [
  ['전부개정', '전문개정', '전체개정'], ['가지번호', '가지조문'],
  ['입법예고', '재입법예고', '다시예고'], ['의견제시', '질의서', '요청서'],
  ['경과조치', '경과규정'], ['미시행', '시행전', '시행하지않은', '시행되지않은'],
  ['내부운영', '내부규정', '내부지침'], ['재검토기한', '재검토', '일몰제'],
  ['연임제한', '연임횟수'], ['공동이용', '행정정보공동이용'],
  ['수권', '위임근거'], ['법령보충적', '대외적구속력'],
  ['알기쉬운', '쉬운말', '쉬운용어', '순화어'], ['신구조문대비표', '신구대비표'],
  ['일괄개정', '일괄정비'], ['준비기간', '시행유예기간'],
];
// Topic words are a tokenizer aid, never mappings to answers or page numbers.
const TOPICS = [
  '입법위임', '위임입법', '법률의위임', '위임범위', '재위임', '위임조례', '자치조례', '법률유보', '포괄위임', '권리제한', '의무부과',
  '신고의무', '첨부서류', '추가서류', '제출서류', '법령보충적', '대외적구속력',
  '입법필요성', '입법형식', '전부개정', '일부개정', '폐지제정', '폐지법률',
  '가지번호', '가지조문', '각호외의부분', '단서', '본문', '전단', '후단',
  '적용례', '경과조치', '특례', '종전규정', '종전부칙', '유효기간', '시행일', '공포일',
  '공포번호', '공포후', '시행전', '입법예고', '재예고', '행정예고', '발령형식',
  '존속기한', '재검토기한', '일몰제', '내부운영', '공동고시', '일괄개정', '동질성',
  '위원회', '자문기관', '의결기관', '연임', '임기', '보조금', '운영비', '지원대상',
  '수수료', '사용료', '부담금', '과징금', '과태료', '처분', '취소', '위탁', '위임',
  '민간위탁', '행정정보공동이용', '공동이용', '개인정보', '법률해석', '법령해석',
  '의견제시', '요청권한', '질의요지', '갑설', '을설', '대립의견', '입법단계',
  '정의', '약칭', '정책명', '용어', '정비제외', '순화어', '전문용어', '과반수',
  '능동문', '피동문', '병기', '호선', '개의', '멸실', '양도', '경감', '소멸시효',
  '별표', '별지', '서식', '법인', '지방자치', '자치입법권', '2/3', '3분의2',
];

const compact = (v: string) => v.normalize('NFC').toLowerCase().replace(/[^가-힣a-z0-9]/g, '');
function stem(word: string): string {
  // Only remove a suffix when a useful Korean stem remains.
  const v = word.replace(/(?:으로부터|에서부터|이어야|여야|이라고|이라고는|이라도|이라면|이라는|이라고|한다면|해야|해도|하면|하려|하나요|인가요|되나요|있나요|되면|되는|하는|하지|합니다|합니까|하여야|하려면|하려고|한가요|인가|처럼|에서|으로|에게|까지|부터|보다|마다|이나|라도|에는|에도|이고|이며|하고|한다|하여|이란|란|을|를|은|는|이|가|의|에|로|과|와|도|만)$/, '');
  return v.length >= 2 ? v : word;
}
function words(text: string): string[] {
  return (text.normalize('NFC').toLowerCase().match(/[가-힣a-z][가-힣a-z0-9]{1,}/g) ?? [])
    .map(stem).filter(x => x.length >= 2 && !STOP.has(x));
}
function grams(text: string, n: number): string[] {
  const result: string[] = [];
  for (const word of text.match(/[가-힣]{2,}/g) ?? []) {
    for (let i = 0; i <= word.length - n; i++) result.push(word.slice(i, i + n));
  }
  return result;
}
function frequencies(values: string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const value of values) m.set(value, Math.min((m.get(value) ?? 0) + 1, 12));
  return m;
}

interface Indexed {
  citation: KnowledgeCitation; compact: string; section: string;
  terms: Map<string, number>; grams: Map<string, number>; length: number;
}
interface Corpus {
  rows: Indexed[]; byId: Map<string, Indexed>; df: Map<string, number>;
  gramDf: Map<string, number>; averageLength: number;
}
let cached: Corpus | undefined;

function corpus(): Corpus {
  if (cached) return cached;
  try {
    const bytes = readFileSync(path.join(process.cwd(), 'data', 'knowledge', 'corpus.json.gz'));
    if (createHash('sha256').update(bytes).digest('hex') !== KNOWLEDGE_MANIFEST.corpusSha256) throw new Error('hash');
    const parsed = JSON.parse(gunzipSync(bytes, { maxOutputLength: 20 * 1024 * 1024 }).toString('utf8')) as { version: string; chunks: KnowledgeChunk[] };
    if (parsed.version !== KNOWLEDGE_MANIFEST.version || !Array.isArray(parsed.chunks) || parsed.chunks.length !== KNOWLEDGE_MANIFEST.chunkCount) throw new Error('version');
    const documents = new Map(KNOWLEDGE_DOCUMENTS.map(d => [d.id, d]));
    const rows: Indexed[] = [], byId = new Map<string, Indexed>(), df = new Map<string, number>(), gramDf = new Map<string, number>();
    for (const chunk of parsed.chunks) {
      const doc = documents.get(chunk.documentId);
      if (!doc || typeof chunk.text !== 'string' || chunk.text.length > 5000 || byId.has(chunk.id) || createHash('sha256').update(chunk.text).digest('hex') !== chunk.contentHash) throw new Error('chunk');
      const citation: KnowledgeCitation = { ...chunk, title: doc.title, edition: doc.edition,
        sourceUrl: doc.sourceUrl, downloadPath: doc.downloadPath, coverageDate: doc.coverageDate };
      const all = words(chunk.text), ct = compact(chunk.text);
      const terms = frequencies(all);
      for (const topic of TOPICS) if (ct.includes(compact(topic))) terms.set(compact(topic), Math.max(terms.get(compact(topic)) ?? 0, 2));
      const chargrams = frequencies([...grams(chunk.text, 2), ...grams(chunk.text, 3)]);
      const headings = chunk.text.split('\n').filter(line => line.length < 90 && /^(?:[가-하][.)]|\d+[.)]|[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ]+[. ]|제\d+[장절편])/.test(line));
      const row = { citation, compact: ct, section: compact([chunk.section, ...headings].join(' ')), terms, grams: chargrams, length: all.length };
      rows.push(row); byId.set(chunk.id, row);
      for (const term of terms.keys()) df.set(term, (df.get(term) ?? 0) + 1);
      for (const term of chargrams.keys()) gramDf.set(term, (gramDf.get(term) ?? 0) + 1);
    }
    cached = { rows, byId, df, gramDf, averageLength: rows.reduce((a, r) => a + r.length, 0) / rows.length };
    return cached;
  } catch {
    throw new KnowledgeError('CORPUS_UNAVAILABLE', '참고자료 검색 색인을 읽지 못했습니다. 원본 내려받기는 이용할 수 있습니다. 잠시 후 다시 검색해 주세요.');
  }
}

interface QueryTerm { value: string; weight: number; original: boolean }
function isLegislativeDelegation(query: string): boolean {
  return /(?:법률|법령|상위법).{0,35}조례/.test(query) && /고시|규칙|재위임/.test(query) && !/사무|업무를|권한을/.test(query);
}
function queryTerms(query: string): QueryTerm[] {
  const result = new Map<string, QueryTerm>(), ct = compact(query);
  const add = (value: string, weight: number, original: boolean) => {
    const v = compact(value);
    if (v.length < 2 || STOP.has(v)) return;
    const old = result.get(v);
    if (!old || old.weight < weight) result.set(v, { value: v, weight, original: original || !!old?.original });
  };
  const withoutArticleNumbers = query.replace(/제\s*\d+\s*(?:조|항|호)(?:의\s*\d+)?/g, ' ');
  for (const w of words(withoutArticleNumbers)) add(w, GENERIC.has(w) ? 0.25 : 1, true);
  // A question about 제N조의N names a branch provision even when the user
  // does not know its technical term. Example article numbers are not topics.
  if (/제\s*\d+\s*조\s*의\s*\d+/.test(query)) { add('가지조문', 1.6, true); add('가지번호', 1.6, true); }
  if (isLegislativeDelegation(query)) {
    // Delegating the form/content of a norm and delegating administrative
    // tasks use the same word 재위임. Preserve the question's legal-form intent.
    add('위임입법', 1.6, true); add('입법위임', 1.4, false); add('입법형식', 1.2, false);
    add('법률의위임', 1.4, false); add('위임범위', 1.4, false); add('재위임', 1.4, true);
    add('조례로위임', 1.4, true); add('조례로정하도록', 1.2, false);
  }
  for (const topic of TOPICS) if (ct.includes(compact(topic))) add(topic, GENERIC.has(topic) ? 0.45 : 1.6, true);
  if (/제정/.test(query) && /개정/.test(query) && /선택|기존|새로|필요/.test(query)) { add('입법형식', 1.2, false); add('입법필요성', 1.2, false); add('형식의선택', 1.2, false); }
  for (const group of ALIASES) if (group.some(t => ct.includes(compact(t)))) for (const term of group) add(term, 0.55, ct.includes(compact(term)));
  // Curly quotes and quoted literal clauses are important for drafting questions.
  for (const match of query.matchAll(/["“‘「]([^"”’」]{2,50})["”’」]/g)) add(match[1], 1.8, true);
  return [...result.values()].slice(0, 65);
}
function scopeMultiplier(row: Indexed, opts: KnowledgeSearchOptions, query: string): number {
  const doc = row.citation.documentId;
  let m = row.citation.sectionType === 'body' ? 1 : row.citation.sectionType === 'contents' ? 0.25 : 0.16;
  if (opts.kind && opts.kind !== 'all') {
    const primary = ['ordinance', 'rule'].includes(opts.kind) ? 'local-ordinance-2026'
      : ['law', 'act', 'decree', 'ministry_rule'].includes(opts.kind) ? 'legislation-2026' : 'administrative-rules-2025';
    if (doc === primary) m *= 1.28;
    else if (doc === 'administrative-rules-2025' && ['ordinance', 'rule', 'law', 'act', 'decree', 'ministry_rule'].includes(opts.kind)) m *= 0.65;
  }
  if (opts.mode === 'plain_language') m *= doc === 'plain-language-2026' ? 1.5 : 0.65;
  if (opts.mode === 'opinion_request') m *= doc === 'opinion-request' ? 2 : 0.85;
  if (doc === 'opinion-request' && opts.mode !== 'opinion_request' && !/의견제시|질의서|요청서|갑설|을설/.test(query)) m *= 0.25;
  if (doc === 'source-guide') m *= 0.2;
  if (isLegislativeDelegation(query) && /기관위임사무|행정권한의위임및위탁|재위임받은사무/.test(row.compact)) m *= 0.45;
  return m;
}

export function getKnowledgeChunk(id: string): KnowledgeCitation | undefined {
  const found = corpus().byId.get(id)?.citation;
  return found ? { ...found } : undefined;
}

export function searchKnowledge(query: string, opts: KnowledgeSearchOptions = {}): KnowledgeSearchResult {
  const started = performance.now();
  const q = query.normalize('NFC').trim().replace(/\s+/g, ' ');
  if (q.length < 2 || q.length > 2000) throw new KnowledgeError('BAD_QUERY', '검색어는 2~2,000자로 입력해 주세요.');
  if (opts.kind && !KINDS.has(opts.kind)) throw new KnowledgeError('BAD_QUERY', '규정 종류를 확인해 주세요.');
  if (opts.mode && !MODES.has(opts.mode)) throw new KnowledgeError('BAD_QUERY', '자료 검토 방식을 확인해 주세요.');
  const ids = opts.documentIds ? new Set(opts.documentIds) : undefined;
  if (ids && [...ids].some(id => !KNOWLEDGE_DOCUMENTS.some(d => d.id === id))) throw new KnowledgeError('BAD_QUERY', '등록되지 않은 참고자료입니다.');
  const limit = opts.limit ?? 6;
  if (!Number.isInteger(limit) || limit < 1 || limit > 12) throw new KnowledgeError('BAD_QUERY', '검색 결과 수는 1~12개입니다.');
  const c = corpus(), terms = queryTerms(q);
  // A comparison/choice question asks for the section explaining the two
  // concepts together, not every example that happens to mention either one.
  const choiceIntent = /선택|판단|할지|어느|차이|구분|구별|다른가요/.test(q);
  const compactQuery = compact(q);
  const queriedTopics = TOPICS.map(compact).filter(topic => compactQuery.includes(topic));
  const choiceTopics = queriedTopics.filter(topic => !queriedTopics.some(other => other !== topic && other.includes(topic)));
  const choiceSection = (row: Indexed) => choiceIntent && choiceTopics.length >= 2 &&
    /선택|구분|구별|차이/.test(row.section) && choiceTopics.filter(topic => row.section.includes(topic)).length >= 2;
  const synonymConcepts = ALIASES.filter(group => group.some(t => compact(q).includes(compact(t)))).flat().map(compact);
  const finish = (hits: KnowledgeHit[], total: number, note?: string): KnowledgeSearchResult => ({
    query: q, hits, total, version: KNOWLEDGE_MANIFEST.version, method: 'hybrid-lexical',
    elapsedMs: Math.round(performance.now() - started), ...(note ? { note } : {}),
  });
  const primary = terms.filter(t => t.original && t.weight >= 1);
  if (!primary.length) return finish([], 0, '조문 주제나 궁금한 내용을 조금 더 구체적으로 입력해 주세요.');
  const qGrams = [...new Set(primary.flatMap(t => grams(t.value, 3)))].filter(g => (c.gramDf.get(g) ?? 0) < c.rows.length * 0.25).slice(0, 90);
  const idf = (df: number) => Math.log(1 + (c.rows.length - df + 0.5) / (df + 0.5));
  const scored: { row: Indexed; score: number; matched: string[]; coverage: number }[] = [];
  for (const row of c.rows) {
    if (ids?.size && !ids.has(row.citation.documentId)) continue;
    if (!ids?.has('source-guide') && row.citation.documentId === 'source-guide' && !/출처|파일|다운로드|수집일|해시|sha/i.test(q)) continue;
    let score = 0, direct = 0, meaningful = 0, weightMatched = 0, weightTotal = 0;
    const matched: string[] = [];
    for (const term of terms) {
      if (term.original) weightTotal += term.weight;
      const f = row.terms.get(term.value) ?? (row.compact.includes(term.value) ? 1 : 0);
      if (!f) continue;
      const d = c.df.get(term.value) ?? c.gramDf.get(term.value) ?? Math.min(c.rows.length / 5, 100);
      const tf = f * 2.2 / (f + 1.2 * (0.25 + 0.75 * row.length / c.averageLength));
      score += term.weight * idf(d) * tf;
      if (row.section.includes(term.value)) score += term.weight * idf(d) * 0.3;
      if (term.original) {
        direct++; weightMatched += term.weight;
        if (term.weight >= 1 && !GENERIC.has(term.value)) meaningful++;
        if (matched.length < 12) matched.push(term.value);
      }
    }
    // Character matches improve particle/spacing tolerance, but cannot alone
    // turn an unrelated query into a plausible-looking legal reference.
    if (!direct || !meaningful) continue;
    const coverage = weightMatched / Math.max(weightTotal, 1);
    if (primary.length >= 4 && meaningful < 2 && coverage < 0.18) continue;
    // A single incidental word in a long everyday question is not evidence.
    // One explicitly requested legal topic can still be a focused query.
    if (primary.length >= 3 && meaningful < 2 && coverage < 0.5 && !matched.some(t => TOPICS.includes(t)) && !synonymConcepts.some(t => row.compact.includes(t))) continue;
    let gramScore = 0;
    for (const gram of qGrams) if (row.grams.has(gram)) gramScore += Math.min(4, idf(c.gramDf.get(gram) ?? 1));
    score += Math.min(score * 0.25, gramScore * 0.08);
    score *= 0.65 + 0.7 * coverage;
    if (choiceSection(row)) score *= 2.4;
    else if (/차이|구분|구별|다른가요/.test(q) && /구별|구분|차이/.test(row.section) && primary.filter(t => row.section.includes(t.value)).length >= 2) score *= 1.6;
    score *= scopeMultiplier(row, opts, q);
    if (score > 1.5) scored.push({ row, score, matched, coverage });
  }
  scored.sort((a, b) => b.score - a.score || a.row.citation.id.localeCompare(b.row.citation.id));
  if (!scored.length) return finish([], 0, '이 자료 묶음에서 질문과 직접 관련된 본문을 찾지 못했습니다. 법령명이나 쟁점 용어로 다시 찾아보세요.');
  // Selection criteria may continue as a numbered list on the next physical
  // page. Keep that tightly related exception next to its introductory section.
  // Preserve the original chunk, page and hash; never synthesize a joined quote.
  const anchor = scored.find(candidate => choiceSection(candidate.row));
  if (anchor && anchor.row.citation.pdfPage !== null) {
    const nextPage = anchor.row.citation.pdfPage + 1;
    const continuations = c.rows.filter(row => row.citation.documentId === anchor.row.citation.documentId &&
      row.citation.pdfPage === nextPage && row.citation.sectionType === 'body' &&
      /(?:^|\n)\s*(?:\d+[.)]|[①②③④⑤⑥⑦⑧⑨⑩])/.test(row.citation.text) &&
      /다만|예외|제외|주의|종전/.test(row.citation.text) &&
      choiceTopics.filter(topic => row.compact.includes(topic)).length >= 2);
    const continuation = continuations.sort((a, b) =>
      (scored.find(candidate => candidate.row === b)?.score ?? 0) - (scored.find(candidate => candidate.row === a)?.score ?? 0))[0];
    if (continuation) {
      const found = scored.find(candidate => candidate.row === continuation);
      const score = anchor.score * 0.98;
      if (found) found.score = Math.max(found.score, score);
      else scored.push({ row: continuation, score, matched: choiceTopics.filter(topic => continuation.compact.includes(topic)), coverage: 0 });
      scored.sort((a, b) => b.score - a.score || a.row.citation.id.localeCompare(b.row.citation.id));
    }
  }
  // Prefer distinct pages; overlapping chunks do not masquerade as corroboration.
  const seen = new Set<string>(), picked: typeof scored = [];
  for (const candidate of scored) {
    const { documentId, pdfPage, id } = candidate.row.citation;
    const key = `${documentId}:${pdfPage ?? id}`;
    if (seen.has(key)) continue;
    if (candidate.score < scored[0].score * 0.27) continue;
    picked.push(candidate); seen.add(key);
    if (picked.length >= limit) break;
  }
  const hits = picked.map(({ row, score, matched }) => ({ ...row.citation, score: Math.round(score * 100) / 100, matchedTerms: matched }));
  return finish(hits, scored.length, '자료의 수록 기준일에 따른 참고 내용입니다. 현행 법령과 위임 근거 확인은 별도로 필요합니다.');
}

const KIND_LABELS: Record<string, string> = { '조례': 'ordinance', '규칙': 'rule', '훈령': 'directive', '예규': 'established_rule', '고시': 'notice', '지침': 'guideline', '내부규정': 'bylaw', '내규': 'bylaw', '법률': 'act', '대통령령': 'decree', '총리령·부령': 'ministry_rule' };
const ROLE_QUERY: Record<string, string> = {
  amend_plan: '일부개정 개정문 인용 조항 부칙',
  enact_outline: '입법 필요성 입법 형식 목적 정의 적용 범위 위임',
  enact_draft: '조문 체계 법률유보 위임 범위 부칙',
  reason: '제정 개정 이유 주요내용 작성',
  fix_suggest: '삭제 조문 인용 가지번호',
  impact_review: '상위법 개정 위임 범위 시행일 경과조치',
};
function sameSection(a: KnowledgeCitation, b: KnowledgeCitation): boolean {
  if (a.documentId !== b.documentId || a.pdfPage === null || b.pdfPage === null || Math.abs(a.pdfPage - b.pdfPage) > 1) return false;
  if (b.sectionType !== 'body') return false;
  const x = compact(a.section), y = compact(b.section);
  if (a.pdfPage === b.pdfPage) return true;
  const specific = (s: string) => !/^제\d+[편장]/.test(s) && !/^(?:법령입안|행정규칙입안|자치법규입안|본문)/.test(s);
  return (specific(x) && specific(y) && (x === y || (x.length >= 6 && y.length >= 6 && (x.includes(y) || y.includes(x))))) ||
    // Continuation paragraphs often have no repeated section header. Only
    // select an adjacent page if it shares several substantive topic words.
    TOPICS.filter(t => !GENERIC.has(t) && compact(a.text).includes(compact(t)) && compact(b.text).includes(compact(t))).length >= 3;
}

export function retrieveForRole(role: string, vars: Record<string, string>): KnowledgeRecord {
  const specific = [vars.intent, vars.purpose, vars.query, vars.question].filter(Boolean).join(' ').slice(0, 1100);
  const base = ROLE_QUERY[role];
  const query = (specific || base || vars.title || '입안 기준').slice(0, 1600);
  const record: KnowledgeRecord = { role, query, retrievedAt: new Date().toISOString(), version: KNOWLEDGE_MANIFEST.version,
    method: 'hybrid-lexical', status: 'empty', citations: [] };
  if (!base) return { ...record, note: '이 AI 역할에는 자동 참고자료 검색을 적용하지 않았습니다.' };
  try {
    const kind = KINDS.has(vars.kind) ? vars.kind : KIND_LABELS[vars.kind];
    const relevant = searchKnowledge(query, { kind, limit: 6 }).hits;
    const general = specific ? searchKnowledge(base, { kind, limit: 2 }).hits : [];
    const chosen: KnowledgeCitation[] = relevant.slice(0, 4).map(({ score: _s, matchedTerms: _m, ...hit }) => hit);
    // A short neighboring exception is more valuable than a fifth duplicate
    // checklist. Never attach a faraway exception or invent a page relationship.
    for (const first of chosen.slice(0, 2)) {
      const neighbors = corpus().rows.filter(r => !chosen.some(v => v.id === r.citation.id) && sameSection(first, r.citation) && /다만|제외|예외|유의|종전|아니|주의/.test(r.citation.text));
      neighbors.sort((a, b) => Math.abs((a.citation.pdfPage ?? 0) - (first.pdfPage ?? 0)) - Math.abs((b.citation.pdfPage ?? 0) - (first.pdfPage ?? 0)));
      if (neighbors[0]) chosen.push({ ...neighbors[0].citation });
    }
    for (const { score: _s, matchedTerms: _m, ...hit } of general) if (chosen.length < 6 && !chosen.some(c => c.id === hit.id)) chosen.push(hit);
    let characters = 0;
    record.citations = chosen.filter(c => {
      const size = c.text.length + c.title.length + c.edition.length + c.id.length + 150;
      if (characters + size > 7000) return false;
      characters += size; return true;
    });
    record.status = record.citations.length ? 'retrieved' : 'empty';
    record.note = record.citations.length
      ? '입안 참고자료의 관련 발췌문을 AI에 전달했습니다. 현재 법령·위임 근거를 확인했다는 뜻은 아닙니다.'
      : '이 요청과 관련된 참고 본문을 찾지 못했습니다. 매뉴얼을 확인한 것으로 처리하지 않습니다.';
    return record;
  } catch (error) {
    return { ...record, status: 'failed', note: error instanceof KnowledgeError ? error.message : '참고자료 검색을 완료하지 못했습니다.' };
  }
}
