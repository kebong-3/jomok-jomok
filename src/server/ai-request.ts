import { LlmError, type RunInput } from './llm';
import { ROLES, type RoleName } from './prompts';
import { impactInputIssues } from '@/lib/impact';
import { RULE_KIND_LABEL, type RuleKind } from '@/engine';

export function userConnection(req: Request): RunInput['byok'] {
  const connection = req.headers.get('x-user-connection');
  if (connection && !['default', 'byok', 'org'].includes(connection)) throw new LlmError('BAD_REQUEST', 'AI 연결 방식이 올바르지 않습니다.');
  const explicit = connection === 'byok' || connection === 'org' || req.headers.has('x-user-key') || req.headers.has('x-user-model') || req.headers.has('x-user-baseurl');
  if (!explicit) return undefined;
  const key = req.headers.get('x-user-key')?.trim();
  if (!key) throw new LlmError('NO_KEY', '선택한 연결의 API 키가 없습니다. 설정에서 키를 입력해 주세요.');
  if (key.length > 4096) throw new LlmError('BAD_REQUEST', 'API 키 형식을 확인해 주세요.');
  return { key, modelId: req.headers.get('x-user-model') || (connection === 'org' ? 'custom' : 'gptoss-120b@groq'), baseURL: req.headers.get('x-user-baseurl') || undefined, model: req.headers.get('x-user-modelname') || undefined };
}

const required: Record<RoleName, string[]> = {
  knowledge_assist: ['question', 'references', 'mode', 'kind'],
  impact_review: ['upperTitle', 'before', 'after', 'institutionRaw', 'kind'],
  amend_plan: ['title', 'kind', 'outline', 'articles', 'intent'],
  fix_suggest: ['where', 'text', 'deleted'],
  reason: ['title', 'mode', 'intent', 'changes'],
  enact_outline: ['kind', 'purpose'],
  enact_draft: ['kind', 'title', 'outline', 'institution'],
};
export function roleRequest(body: unknown): Pick<RunInput, 'role' | 'vars' | 'modelId' | 'strictModel'> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new LlmError('BAD_REQUEST', '요청 형식이 올바르지 않습니다.');
  const b = body as Record<string, unknown>;
  if (typeof b.role !== 'string' || !Object.hasOwn(ROLES, b.role)) throw new LlmError('BAD_REQUEST', '지원하지 않는 AI 역할입니다.');
  if (!b.vars || typeof b.vars !== 'object' || Array.isArray(b.vars) || Object.values(b.vars).some((v) => typeof v !== 'string')) throw new LlmError('BAD_REQUEST', 'AI 입력 항목은 문자열이어야 합니다.');
  const vars = b.vars as Record<string, string>, role = b.role as RoleName;
  if (role === 'knowledge_assist') throw new LlmError('BAD_REQUEST', '입안 자료실의 전용 검토 경로를 이용하세요.');
  if (JSON.stringify(vars).length > 60_000) throw new LlmError('LLM_INPUT', '입력이 너무 깁니다. 검토할 조문 범위를 줄여 주세요.');
  if (required[role].some((k) => !vars[k]?.trim())) throw new LlmError('BAD_REQUEST', 'AI 작업에 필요한 제목·원문·요청 내용을 입력해 주세요.');
  if (role === 'impact_review') {
    if (!Object.hasOwn(RULE_KIND_LABEL, vars.kind)) throw new LlmError('BAD_REQUEST', '기관 규정 종류를 확인해 주세요.');
    const issues = impactInputIssues({ upperTitle: vars.upperTitle, before: vars.before, after: vars.after, beforeDate: vars.beforeDate || '', afterDate: vars.afterDate || '', institutionRaw: vars.institutionRaw, kind: vars.kind as RuleKind });
    if (issues.length) throw new LlmError('BAD_REQUEST', issues[0]);
  }
  if (b.modelId !== undefined && (typeof b.modelId !== 'string' || b.modelId.length > 100)) throw new LlmError('BAD_REQUEST', '모델 선택 값이 올바르지 않습니다.');
  if (b.strictModel !== undefined && typeof b.strictModel !== 'boolean') throw new LlmError('BAD_REQUEST', '모델 확인 방식이 올바르지 않습니다.');
  return { role, vars, modelId: b.modelId as string | undefined, strictModel: b.strictModel as boolean | undefined };
}
export function errorResponse(e: unknown) {
  const error = e instanceof LlmError ? e : new LlmError('LLM_HTTP', 'AI 요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.');
  const status = error.code === 'BAD_REQUEST' ? 400 : error.code === 'LLM_INPUT' ? 413 : error.code === 'NO_KEY' ? 503 : error.code === 'LLM_QUOTA' ? 429 : error.code === 'LLM_TIMEOUT' ? 504 : 502;
  return { error: { code: error.code, message: error.message }, status };
}
