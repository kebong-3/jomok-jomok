import { NextResponse } from 'next/server';
import { z } from 'zod';
import { RULE_KINDS } from '@/engine/types';
import { retrieveKnowledgeReview } from '@/server/knowledge-review';
import { runRole, LlmError } from '@/server/llm';
import { errorResponse, userConnection } from '@/server/ai-request';
import { validateKnowledgeAnswer } from '@/server/knowledge-answer';
export const runtime = 'nodejs'; export const maxDuration = 300;
const inputSchema = z.object({question:z.string().trim().min(2).max(2000),document:z.string().max(12000).default(''),mode:z.enum(['explain','review','plain_language','opinion_request']).default('explain'),kind:z.enum([...RULE_KINDS,'law']).default('ordinance'),modelId:z.string().max(100).optional(),strictModel:z.boolean().optional()});
const reply=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'no-store'}});
export async function POST(req:Request){
 try{
  const raw=await req.text(); if(new TextEncoder().encode(raw).length>65000)throw new LlmError('LLM_INPUT','질문은 2,000자, 검토할 본문은 12,000자 이내로 입력하세요.');
  let json:unknown;try{json=JSON.parse(raw);}catch{throw new LlmError('BAD_REQUEST','요청 형식을 확인해 주세요.');}
  const parsed=inputSchema.safeParse(json);if(!parsed.success)throw new LlmError('BAD_REQUEST','질문·규정 종류·검토할 본문의 길이를 확인해 주세요.');
  const input=parsed.data;if(['review','plain_language'].includes(input.mode)&&!input.document.trim())throw new LlmError('BAD_REQUEST','검토할 초안이나 문장을 입력해 주세요.');
  const {sources,retrieval}=retrieveKnowledgeReview(input);
  if(!sources.length)return reply({status:'insufficient',sources,retrieval,message:'첨부 자료에서 질문을 뒷받침할 근거를 찾지 못했습니다. 주제·조문·쟁점을 구체적으로 입력하거나 자료 검색에서 범위를 확인하세요.'});
  try{
   const result=await runRole({role:'knowledge_assist',vars:{question:input.question,document:input.document,mode:input.mode,kind:input.kind,reviewScope:JSON.stringify({documentCharacters:input.document.length,issues:retrieval.coverage?.issues.map(i=>({issue:i.label,status:i.status,citationIds:i.citationIds}))}),references:JSON.stringify(sources.map(c=>({id:c.id,title:c.title,edition:c.edition,pdfPage:c.pdfPage,printedPage:c.printedPage,section:c.section,text:c.text})))},modelId:input.modelId,strictModel:input.strictModel??!!input.modelId,byok:userConnection(req),signal:req.signal});
   const checked=validateKnowledgeAnswer(result.data,sources,input.document);
   return reply({status:checked.answer?'answered':'insufficient',answer:checked.answer,warnings:checked.warnings,message:checked.answer?undefined:'원문과 일치하는 인용을 확인하지 못해 설명을 보류했습니다. 아래 검색 자료를 확인해 주세요.',sources,retrieval,trace:result.trace});
  }catch(error){const result=errorResponse(error);return reply({status:'ai_unavailable',sources,retrieval,error:result.error,message:`자료 검색은 완료했지만 AI 설명을 만들지 못했습니다. ${result.error.message}`});}
 }catch(error){const result=errorResponse(error);return reply({error:result.error},result.status);}
}
