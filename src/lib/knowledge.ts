/** Shared, serializable reference contracts. No server code or complete corpus here. */
import { z } from 'zod';
import manifest from '@/data/knowledge/manifest.json';
export const KNOWLEDGE_MANIFEST = manifest;
export const KNOWLEDGE_DOCUMENTS = manifest.documents;
/** Five substantive manuals/forms; the separate source guide remains downloadable. */
export const KNOWLEDGE_CORE_DOCUMENTS = KNOWLEDGE_DOCUMENTS.filter(document => document.id !== 'source-guide');
export type KnowledgeDocument = (typeof manifest.documents)[number];
export type KnowledgeMode = 'explain' | 'review' | 'plain_language' | 'opinion_request';
export const KNOWLEDGE_MODES: Record<KnowledgeMode, { label: string; help: string }> = {
 explain: { label: '기준 물어보기', help: '입안 방식과 절차를 원문 근거로 설명합니다.' },
 review: { label: '초안 검토', help: '위임·권한, 조문 체계, 부칙과 확인할 쟁점을 찾습니다.' },
 plain_language: { label: '알기 쉬운 문장', help: '표현을 다듬고, 의미나 요건이 달라질 수 있는 곳을 구분합니다.' },
 opinion_request: { label: '의견제시 요청 준비', help: '질의 배경·요지·대립 의견과 확인할 요청 요건을 정리합니다.' },
};
export interface KnowledgeChunk { id: string; documentId: string; pdfPage: number | null; printedPage: string | null; section: string; sectionType: 'body' | 'contents' | 'frontmatter'; text: string; contentHash: string }
export interface KnowledgeCitation extends KnowledgeChunk { title: string; edition: string; sourceUrl: string | null; downloadPath: string; coverageDate: string }
export interface KnowledgeHit extends KnowledgeCitation { score: number; matchedTerms: string[] }
export interface KnowledgeSearchResult { query: string; hits: KnowledgeHit[]; total: number; version: string; method: 'hybrid-lexical'; elapsedMs: number; note?: string }
export type KnowledgeIssue = 'authority' | 'addenda' | 'form' | 'plain' | 'opinion' | 'procedure' | 'question';
/** Retrieval/input coverage only. Neither a legal finding nor a claim that the model reviewed every issue. */
export interface KnowledgeCoverage {
 documentCharacters: number;
 scannedCharacters: number;
 inputUnits: { label: string; issues: KnowledgeIssue[] }[];
 issues: { id: KnowledgeIssue; label: string; query: string; status: 'included' | 'not_found' | 'budget_omitted'; citationIds: string[] }[];
 sourceCharacters: number;
 sourceCharacterLimit: number;
 note: string;
}
export interface KnowledgeRecord { role: string; query: string; retrievedAt: string; version: string; method: 'hybrid-lexical'; status: 'retrieved' | 'empty' | 'failed'; citations: KnowledgeCitation[]; note?: string; coverage?: KnowledgeCoverage }
export const citationSchema = z.object({
 id: z.string().min(1).max(150), documentId: z.string().max(100), pdfPage: z.number().int().min(1).max(5000).nullable(), printedPage: z.string().max(60).nullable(),
 section: z.string().max(200), sectionType: z.enum(['body','contents','frontmatter']), text: z.string().min(1).max(5000), contentHash: z.string().regex(/^[a-f0-9]{64}$/),
 title: z.string().max(200), edition: z.string().max(200), sourceUrl: z.string().max(2048).nullable(), downloadPath: z.string().max(300), coverageDate: z.string().max(30),
}).superRefine((v,ctx)=>{
 const doc=KNOWLEDGE_DOCUMENTS.find(d=>d.id===v.documentId);
 if(!doc || v.sourceUrl!==doc.sourceUrl || v.downloadPath!==doc.downloadPath || v.title!==doc.title || v.edition!==doc.edition || v.coverageDate!==doc.coverageDate) ctx.addIssue({code:'custom',message:'등록된 참고자료 출처와 일치하지 않습니다.'});
 if(doc && (doc.format==='pdf' ? !v.pdfPage || v.pdfPage>(doc.pages??0) : v.pdfPage!==null)) ctx.addIssue({code:'custom',message:'참고자료 쪽수 범위를 확인하세요.'});
 if(!v.id.startsWith(`KB-${v.documentId}-p`)) ctx.addIssue({code:'custom',message:'참고자료 ID를 확인하세요.'});
});
const knowledgeIssueSchema=z.enum(['authority','addenda','form','plain','opinion','procedure','question']);
export const knowledgeCoverageSchema=z.object({
 documentCharacters:z.number().int().min(0).max(12000),scannedCharacters:z.number().int().min(0).max(12000),
 inputUnits:z.array(z.object({label:z.string().max(160),issues:z.array(knowledgeIssueSchema).max(7)})).max(400),
 issues:z.array(z.object({id:knowledgeIssueSchema,label:z.string().max(100),query:z.string().max(2000),status:z.enum(['included','not_found','budget_omitted']),citationIds:z.array(z.string().max(150)).max(6)})).max(7),
 sourceCharacters:z.number().int().min(0).max(5500),sourceCharacterLimit:z.literal(5500),note:z.string().max(1500),
}).superRefine((v,ctx)=>{if(v.scannedCharacters!==v.documentCharacters)ctx.addIssue({code:'custom',message:'입력 범위와 쟁점 탐지 범위가 일치하지 않습니다.'});});
export const knowledgeRecordSchema=z.object({role:z.string().max(80),query:z.string().max(2000),retrievedAt:z.string().datetime(),version:z.string().max(100),method:z.literal('hybrid-lexical'),status:z.enum(['retrieved','empty','failed']),citations:z.array(citationSchema).max(16),note:z.string().max(2000).optional(),coverage:knowledgeCoverageSchema.optional()}).superRefine((v,ctx)=>{
 if(!v.coverage)return;
 const ids=new Set(v.citations.map(c=>c.id));
 if(v.coverage.sourceCharacters!==v.citations.reduce((sum,c)=>sum+c.text.length,0))ctx.addIssue({code:'custom',message:'전달 발췌문 분량이 검색 범위 기록과 다릅니다.'});
 for(const issue of v.coverage.issues)if(issue.citationIds.some(id=>!ids.has(id))||(issue.status==='included'&&!issue.citationIds.length)||(issue.status!=='included'&&issue.citationIds.length))ctx.addIssue({code:'custom',message:'쟁점별 검색 기록과 전달 근거가 일치하지 않습니다.'});
});
const reference=z.object({id:z.string().max(150),quote:z.string().min(8).max(500)});
export const knowledgeAnswerSchema=z.object({
 summary:z.string().min(1).max(1600),points:z.array(z.object({heading:z.string().min(1).max(100),explanation:z.string().min(1).max(2200),citations:z.array(reference).min(1).max(4)})).min(1).max(8),
 changes:z.array(z.object({before:z.string().min(1).max(1800),after:z.string().max(1800),reason:z.string().max(700),changeType:z.enum(['wording','substance','verify']),citations:z.array(reference).min(1).max(4)})).max(8).default([]),
 draft:z.string().max(7000).optional(),nextSteps:z.array(z.string().max(500)).max(10),needsCheck:z.array(z.string().max(600)).min(1).max(10),
});
export type KnowledgeAnswer=z.infer<typeof knowledgeAnswerSchema>;
export function knowledgePageLabel(c:Pick<KnowledgeCitation,'pdfPage'|'printedPage'|'section'>):string{return c.pdfPage?`PDF ${c.pdfPage}쪽${c.printedPage?` · 책자 ${c.printedPage}`:''}`:c.section;}
export function knowledgeSourceHref(c:Pick<KnowledgeCitation,'downloadPath'|'pdfPage'>):string{return `${c.downloadPath}${c.pdfPage?`#page=${c.pdfPage}`:''}`;}
export function mergeKnowledge(records:KnowledgeRecord[]|undefined,record?:KnowledgeRecord):KnowledgeRecord[]|undefined{if(!record)return records;return [...(records??[]).filter(r=>r.role!==record.role),record].slice(-12);}
export function knowledgeRecordText(records:KnowledgeRecord[]|undefined):string{
 if(!records?.length)return '이 작업에 기록된 입안 참고자료 검색이 없습니다.\n';
 return '입안 참고자료 검색·AI 입력 기록\n매뉴얼은 입안 참고 기준입니다. 현행 법령·위임 근거와 적법성 확인을 대신하지 않습니다.\n\n'+records.map(r=>[
 `작업: ${r.role} · 검색시각: ${r.retrievedAt} · 자료버전: ${r.version}`,`검색어: ${r.query}`,`검색상태: ${r.status}${r.note?` · ${r.note}`:''}`,
 ...(r.coverage?[knowledgeCoverageText(r.coverage)]:[]),
 ...r.citations.map(c=>`${c.id}\n${c.title} · ${c.edition} · ${knowledgePageLabel(c)}\n수록 기준: ${c.coverageDate}\n공식 출처: ${c.sourceUrl??'사용자 제공 출처 안내'}\n앱 원본: https://jomokjomok.vercel.app${knowledgeSourceHref(c)}\n추출문 지문(SHA-256): ${c.contentHash}\n[AI에 전달한 참고 발췌문]\n${c.text}`),
 ].join('\n\n')).join('\n\n────────────────────\n\n');
}
export function knowledgeCoverageText(coverage:KnowledgeCoverage):string{
 return [`검색·검토 요청 범위: 본문 ${coverage.documentCharacters.toLocaleString('ko-KR')}자 중 ${coverage.scannedCharacters.toLocaleString('ko-KR')}자에서 쟁점 단서를 탐지`,
 `검토 요청 단위: ${coverage.inputUnits.map(u=>u.label).join(', ')||'본문 미입력'}`,
 ...coverage.issues.map(i=>`${i.label}: ${i.status==='included'?'참고 입력에 포함':i.status==='not_found'?'관련 발췌문 미발견':'전달 예산으로 제외'}${i.citationIds.length?` (${i.citationIds.join(', ')})`:''}`),coverage.note].join('\n');
}
