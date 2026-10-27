// 모델 레지스트리 — 모델 교체 = 이 파일 또는 환경변수 MODELS_JSON 한 줄.
// 대회 권장(행안부 AI 공통기반 지원·예정) 계열: Gemma, Llama, GPT-OSS, EXAONE, HyperCLOVA X, Solar

export interface ModelSpec {
  id: string;
  label: string;
  family: 'gpt-oss' | 'gemma' | 'solar' | 'hyperclovax' | 'exaone' | 'llama' | 'other';
  adapter: 'openai' | 'gemini';
  baseURL: string;
  model: string;
  keyEnv?: string;
  keyEnvAliases?: string[];
  modelEnv?: string;
  modelEnvAliases?: string[];
  /** 쉬운 설명(설정 화면) */
  note: string;
  official: boolean;
  quirks?: { maxTokensRequired?: boolean; noSystemRole?: boolean };
  /** 지원 종료일(이후 사용 경고) */
  deprecatedAfter?: string;
  limits?: string;
}

export const MODELS: ModelSpec[] = [
  {
    id: 'gpt54-mini@openai', label: 'GPT-5.4 mini · OpenAI', family: 'other', adapter: 'openai',
    baseURL: 'https://api.openai.com/v1', model: 'gpt-5.4-mini', keyEnv: 'OPENAI_API_KEY', modelEnv: 'OPENAI_MODEL',
    note: '선택 연결 · 같은 입안 자료와 문서 엔진 사용', official: false, limits: '계정별 제공자 요금·한도 적용',
  },
  {
    id: 'gptoss-120b@groq', label: 'GPT-OSS 120B · Groq', family: 'gpt-oss', adapter: 'openai',
    baseURL: 'https://api.groq.com/openai/v1', model: 'openai/gpt-oss-120b', keyEnv: 'GROQ_API_KEY', modelEnv: 'GROQ_GPTOSS_MODEL', modelEnvAliases: ['GROQ_MODEL'],
    note: '연결 시험 후 선택할 수 있는 비교 모델', official: true, limits: '계정별 제공자 한도 적용',
  },
  {
    id: 'gemma4-31b@google', label: 'Gemma 4 31B · Google AI Studio', family: 'gemma', adapter: 'gemini',
    baseURL: 'https://generativelanguage.googleapis.com/v1beta', model: 'gemma-4-31b-it', keyEnv: 'GOOGLE_API_KEY', keyEnvAliases: ['GEMINI_API_KEY', 'GOOGLE_GENERATIVE_AI_API_KEY'], modelEnv: 'GEMMA_MODEL', modelEnvAliases: ['GOOGLE_MODEL'],
    note: '기본 우선 모델 · 공개 모델', official: true, quirks: { noSystemRole: true },
  },
  {
    id: 'gptoss-120b@cerebras', label: 'GPT-OSS 120B · Cerebras', family: 'gpt-oss', adapter: 'openai',
    baseURL: 'https://api.cerebras.ai/v1', model: 'gpt-oss-120b', keyEnv: 'CEREBRAS_API_KEY',
    note: '예비 · 긴 입력(무료 30K TPM)', official: true, limits: '계정별 제공자 한도 적용',
  },
  {
    id: 'gptoss-120b@openrouter', label: 'GPT-OSS 120B · OpenRouter', family: 'gpt-oss', adapter: 'openai',
    baseURL: 'https://openrouter.ai/api/v1', model: 'openai/gpt-oss-120b:free', keyEnv: 'OPENROUTER_API_KEY',
    note: '예비 · 무료 경로', official: true,
  },
  {
    id: 'gemma4-31b@openrouter', label: 'Gemma 4 31B · OpenRouter', family: 'gemma', adapter: 'openai',
    baseURL: 'https://openrouter.ai/api/v1', model: 'google/gemma-4-31b-it:free', keyEnv: 'OPENROUTER_API_KEY',
    note: '예비 · 무료 경로', official: true,
  },
  {
    id: 'solar-pro4@upstage', label: 'Solar Pro 4 · 업스테이지', family: 'solar', adapter: 'openai',
    baseURL: 'https://api.upstage.ai/v1', model: 'solar-pro4', keyEnv: 'UPSTAGE_API_KEY',
    note: '국산 · 한국어 문장', official: true,
  },
  {
    id: 'hcx-007@clova', label: 'HyperCLOVA X HCX-007 · 네이버', family: 'hyperclovax', adapter: 'openai',
    baseURL: 'https://clovastudio.stream.ntruss.com/v1/openai', model: 'HCX-007', keyEnv: 'CLOVA_API_KEY',
    note: '국산 · 한국어 문장', official: true, quirks: { maxTokensRequired: true },
  },
  {
    id: 'llama33-70b@groq', label: 'Llama 3.3 70B · Groq', family: 'llama', adapter: 'openai',
    baseURL: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b-versatile', keyEnv: 'GROQ_API_KEY',
    note: '공개 모델', official: true,
  },
  {
    id: 'custom', label: '우리 기관 AI 서버(OpenAI 호환)', family: 'other', adapter: 'openai',
    baseURL: '', model: '', keyEnv: 'CUSTOM_LLM_KEY',
    note: '운영자가 등록한 OpenAI 호환 기관 서버(EXAONE 등)', official: false,
  },
];

/** 역할별 기본 순서(앞에서부터 키가 있는 모델 사용) */
export const DEFAULT_ORDER = ['gemma4-31b@google', 'gptoss-120b@groq', 'gptoss-120b@cerebras', 'gptoss-120b@openrouter', 'gemma4-31b@openrouter', 'solar-pro4@upstage', 'hcx-007@clova', 'custom'];

/** 서버 환경은 요청 때 읽어 설정 변경과 MODELS_JSON이 목록·호출에 동일하게 반영되게 한다. */
export function allModels(): ModelSpec[] {
  let extra: ModelSpec[] = [];
  try {
    const value: unknown = JSON.parse(process.env.MODELS_JSON || '[]');
    if (Array.isArray(value)) extra = value.filter((m): m is ModelSpec => !!m && typeof m === 'object' &&
      typeof m.id === 'string' && typeof m.label === 'string' && typeof m.model === 'string' && typeof m.baseURL === 'string' &&
      ['openai', 'gemini'].includes(m.adapter) && ['gpt-oss', 'gemma', 'solar', 'hyperclovax', 'exaone', 'llama', 'other'].includes(m.family) &&
      (!m.keyEnv || typeof m.keyEnv === 'string') && (!m.modelEnv || typeof m.modelEnv === 'string') &&
      (!m.modelEnvAliases || (Array.isArray(m.modelEnvAliases) && m.modelEnvAliases.every((k: unknown) => typeof k === 'string'))) &&
      (!m.keyEnvAliases || (Array.isArray(m.keyEnvAliases) && m.keyEnvAliases.every((k: unknown) => typeof k === 'string'))));
  } catch { /* 잘못된 추가 목록은 기본 모델을 막지 않는다. */ }
  const merged = new Map<string, ModelSpec>();
  for (const m of [...MODELS, ...extra]) merged.set(m.id, m);
  return [...merged.values()].map((m) => {
    if (m.id === 'custom') return { ...m, baseURL: process.env.CUSTOM_LLM_BASEURL?.trim() || m.baseURL, model: process.env.CUSTOM_LLM_MODEL?.trim() || m.model };
    const override = [m.modelEnv, ...(m.modelEnvAliases ?? [])].filter(Boolean).map(name => process.env[name!]?.trim()).find(Boolean);
    return override ? { ...m, model: override } : m;
  });
}
export function modelById(id: string): ModelSpec | undefined { return allModels().find((m) => m.id === id); }
