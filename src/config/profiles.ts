// 기관 프로필 — 코드 수정 없이 기관 이식(활용성: 기관별 환경 설정)
import type { ComparisonStyle, RuleKind } from '@/engine';
import { DEFAULT_STYLE } from '@/engine/comparison';
import { z } from 'zod';

export interface ProcedureStep {
  id: string;
  name: string;
  docs?: string[];
  days?: number;
  basis?: string;
  tip?: string;
}

export interface Profile {
  id: string;
  name: string;
  type: 'central' | 'local' | 'public';
  typeLabel: string;
  headTitle: string; // 시장·구청장·이사장
  council?: string;
  legalDept: string;
  noticeNo: string; // 공고번호 형식
  noticeDays: number;
  opinionContact: string;
  style: ComparisonStyle;
  /** law(국가 법령)는 v0.9에 추가 — 이전 기관 설정 파일에는 없을 수 있다(procedureSteps가 기본값 제공). */
  procedures: Record<'ordinance' | 'rule' | 'admin' | 'bylaw', ProcedureStep[]> & { law?: ProcedureStep[] };
  procedureConfirmed?: boolean;
  procedureCheckedAt?: string;
  procedureNote?: string;
}

const LOCAL_PROC: Profile['procedures'] = {
  ordinance: [
    { id: 'draft', name: '입안(개정안·대비표·이유서)', docs: ['개정안', '대비표', '이유서'] },
    { id: 'pre', name: '사전검토·관계부서 협의', tip: '규제·성별영향·부패영향 해당 여부를 법무 담당과 함께 확인합니다.', basis: '성별영향평가법 제5조, 부패방지권익위법 시행령 제30조' },
    { id: 'notice', name: '입법예고', days: 20, basis: '행정절차법 제43조(자치법규 20일 이상)', docs: ['입법예고문'] },
    { id: 'review', name: '의견 검토·반영, 법제심사' },
    { id: 'council', name: '조례·규칙심의회', basis: '지방자치법 시행령 제28조' },
    { id: 'assembly', name: '의회 제출·의결', tip: '예산이 드는 조례안은 비용추계서를 붙입니다(지방자치법 제78조).' },
    { id: 'promulgate', name: '공포·보고', days: 20, basis: '지방자치법 제32조(이송 후 20일 이내 공포), 제35조(이송 후 5일 이내 보고)' },
  ],
  rule: [
    { id: 'draft', name: '입안(개정안·대비표·이유서)', docs: ['개정안', '대비표', '이유서'] },
    { id: 'pre', name: '사전검토·관계부서 협의' },
    { id: 'notice', name: '입법예고', days: 20, basis: '행정절차법 제43조(자치법규 20일 이상)', docs: ['입법예고문'] },
    { id: 'review', name: '의견 검토·반영, 법제심사' },
    { id: 'council', name: '조례·규칙심의회', basis: '지방자치법 시행령 제28조' },
    { id: 'promulgate', name: '공포·보고', basis: '지방자치법 제35조(규칙은 공포 예정일 15일 전 보고)' },
  ],
  admin: [
    { id: 'draft', name: '입안(개정안·대비표·이유서)' },
    { id: 'notice', name: '행정예고(해당 시)·관계기관 협의', days: 20, basis: '행정절차법 제46조' },
    { id: 'review', name: '내부 심사(법령 위반·위임 근거·중복 상충)', basis: '법제업무 운영규정 제25조제2항' },
    { id: 'issue', name: '발령(발령번호 부여)' },
    { id: 'register', name: '법제정보시스템 등재(발령 후 지체 없이)', basis: '법령정보의 관리 및 제공에 관한 법률 시행령 제4조제3항' },
  ],
  bylaw: [
    { id: 'draft', name: '입안(개정안·대비표·이유서)' },
    { id: 'review', name: '규정 심사·관계 부서 협의' },
    { id: 'board', name: '이사회 의결(정관에 정한 경우)' },
    { id: 'issue', name: '공포·시행, 누리집 공개' },
  ],
  law: [],
};

/** 국가 법령(법률·대통령령·총리령·부령) 정부입법 절차 — 「법제업무 운영규정」·「행정절차법」 기준의 안내용 기본값 */
export const LAW_PROC: ProcedureStep[] = [
  { id: 'draft', name: '입안(개정안·대비표·이유서)', docs: ['개정안', '대비표', '이유서'] },
  { id: 'pre', name: '관계기관 협의·부패영향·성별영향평가', tip: '관계 중앙행정기관과 협의하고 부패영향평가·성별영향평가 대상 여부를 확인합니다.', basis: '법제업무 운영규정 제11조' },
  { id: 'notice', name: '입법예고', days: 40, basis: '행정절차법 제43조(법령 40일 이상)', docs: ['입법예고문'] },
  { id: 'regulation', name: '규제심사(규제 신설·강화 시)', tip: '규제를 신설·강화하면 법제처 심사 요청 전에 규제개혁위원회 심사를 요청합니다.', basis: '행정규제기본법 제10조' },
  { id: 'review', name: '법제처 심사', basis: '법제업무 운영규정 제21조' },
  { id: 'council', name: '차관회의·국무회의 심의(법률안·대통령령안)', tip: '총리령·부령안은 국무회의 심의 대상이 아닙니다. 법률안은 국무회의 후 국회에 제출합니다.' },
  { id: 'promulgate', name: '공포(관보 게재)·법령정보 등재', basis: '법령 등 공포에 관한 법률' },
];
LOCAL_PROC.law = LAW_PROC;

export type ProcedureGroup = keyof Profile['procedures'];
const PROC_GROUP: Record<RuleKind, ProcedureGroup> = { ordinance: 'ordinance', rule: 'rule', directive: 'admin', established_rule: 'admin', notice: 'admin', guideline: 'admin', bylaw: 'bylaw', act: 'law', decree: 'law', ministry_rule: 'law' };
export const procedureGroupOf = (kind: RuleKind): ProcedureGroup => PROC_GROUP[kind];

/** 오래된 기관 설정 파일에 law 절차가 없을 때의 안전한 기본값 */
export function procedureSteps(profile: Profile, group: keyof Profile['procedures']): ProcedureStep[] {
  return profile.procedures[group] ?? (group === 'law' ? LAW_PROC : []);
}

const CENTRAL_PROC: Profile['procedures'] = {
  ordinance: LOCAL_PROC.ordinance,
  rule: LOCAL_PROC.rule,
  admin: [
    { id: 'draft', name: '입안(개정안·대비표·이유서)', docs: ['개정안', '대비표', '이유서'] },
    { id: 'pre', name: '관계 행정기관 의견조회(회신 10일 이상)', basis: '훈령·예규 등의 발령 및 관리에 관한 규정 제6조제3항' },
    { id: 'regulation', name: '규제심사·법제처 사전검토(규제 신설·강화 시)', basis: '행정규제기본법 제10조, 법제업무 운영규정 제25조제1항' },
    { id: 'notice', name: '행정예고(국민 생활 관련 시)', days: 20, basis: '행정절차법 제46조(20일 이상)', docs: ['행정예고문'] },
    { id: 'issue', name: '발령(발령번호 부여)' },
    { id: 'register', name: '법제정보시스템 등재(발령 후 지체 없이)', basis: '법령정보의 관리 및 제공에 관한 법률 시행령 제4조제3항, 법제업무 운영규정 제24조의3' },
  ],
  bylaw: LOCAL_PROC.bylaw,
  law: LAW_PROC,
};

export const PROFILES: Profile[] = [
  {
    id: 'hanbit-city', name: '한빛시', type: 'local', typeLabel: '기초자치단체(가상)', headTitle: '시장', council: '한빛시의회', legalDept: '법무담당관',
    noticeNo: '한빛시 공고 제{yyyy}-{n}호', noticeDays: 20, opinionContact: '한빛시 ○○과(주소, 전화, 팩스, 전자우편)', style: DEFAULT_STYLE, procedures: LOCAL_PROC,
  },
  {
    id: 'hanbit-corp', name: '한빛공단', type: 'public', typeLabel: '공공기관(가상)', headTitle: '이사장', legalDept: '법무팀',
    noticeNo: '한빛공단 공고 제{yyyy}-{n}호', noticeDays: 10, opinionContact: '한빛공단 기획조정실', style: { ...DEFAULT_STYLE, titleAlways: true }, procedures: LOCAL_PROC,
  },
  {
    id: 'hanbit-ministry', name: '한빛부', type: 'central', typeLabel: '중앙행정기관(가상)', headTitle: '장관', legalDept: '규제법무담당관',
    noticeNo: '한빛부 공고 제{yyyy}-{n}호', noticeDays: 40, opinionContact: '한빛부 ○○정책과(주소, 전화, 전자우편)', style: DEFAULT_STYLE, procedures: CENTRAL_PROC,
  },
  {
    id: 'seogu', name: '전남광주통합특별시 서구', type: 'local', typeLabel: '기초자치단체(자치구)', headTitle: '구청장', council: '서구의회', legalDept: '법무팀',
    noticeNo: '서구 공고 제{yyyy}-{n}호', noticeDays: 20, opinionContact: '서구청 ○○과(주소, 전화, 팩스, 전자우편)', style: DEFAULT_STYLE, procedures: LOCAL_PROC,
  },
];

export const PROFILE_TYPES = { local: '지방자치단체', central: '중앙행정기관', public: '공공기관' } as const;
export const PROCEDURE_GROUPS = { ordinance: '조례', rule: '자치규칙', admin: '훈령·예규·고시·지침', bylaw: '기관 내부규정', law: '법령(법률·대통령령·총리령·부령)' } as const;
export const PROFILE_FILE_MAX_BYTES = 256 * 1024;
export const CUSTOM_PROFILE_LIMIT = 20;
const shortText = (max: number) => z.string().trim().min(1).max(max);
const procedureStepSchema = z.object({
  id: shortText(80), name: shortText(200), docs: z.array(shortText(100)).max(20).optional(),
  days: z.number().int().min(1).max(3650).optional(), basis: z.string().max(1000).optional(), tip: z.string().max(2000).optional(),
});
const procedureStepsSchema = z.array(procedureStepSchema).max(25).refine(steps => new Set(steps.map(s => s.id)).size === steps.length, '절차 ID가 중복되었습니다.');

/** Allowlist shared by the editor, portable profile files and project backups. */
export const profileSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/), name: shortText(120), type: z.enum(['central', 'local', 'public']),
  typeLabel: shortText(120), headTitle: shortText(80), council: z.string().trim().max(120).optional(), legalDept: shortText(120),
  noticeNo: shortText(200), noticeDays: z.number().int().min(1).max(365), opinionContact: shortText(1000),
  style: z.object({ unchangedMark: z.enum(['dash', 'ellipsis', 'full']), omitText: shortText(80), sameText: shortText(80), insertMark: shortText(80), deleteMark: shortText(80), titleAlways: z.boolean() }),
  procedures: z.object({ ordinance: procedureStepsSchema, rule: procedureStepsSchema, admin: procedureStepsSchema, bylaw: procedureStepsSchema, law: procedureStepsSchema.optional() }),
  procedureConfirmed: z.boolean().optional(), procedureCheckedAt: z.string().datetime().optional(), procedureNote: z.string().max(2000).optional(),
});

export function normalizeCustomProfiles(value: unknown): Profile[] {
  if (!Array.isArray(value)) return [];
  const profiles: Profile[] = [];
  for (const candidate of value.slice(0, CUSTOM_PROFILE_LIMIT)) {
    const parsed = profileSchema.safeParse(candidate);
    if (parsed.success && parsed.data.id.startsWith('custom-') && !profiles.some(p => p.id === parsed.data.id)) profiles.push(parsed.data);
  }
  return profiles;
}

export function availableProfiles(customProfiles?: unknown): Profile[] {
  return [...PROFILES, ...normalizeCustomProfiles(customProfiles)];
}

export function profileById(id?: string, customProfiles?: unknown): Profile {
  return availableProfiles(customProfiles).find((p) => p.id === id) ?? PROFILES[0];
}

export function snapshotProfile(profile: Profile): Profile {
  return profileSchema.parse(profile); // Zod makes a deep, allowlisted copy.
}

/** A saved work must not change when the browser's organization settings change. */
export function projectProfile(project?: { profileId: string; profileSnapshot?: Profile } | null): Profile {
  if (project && project.profileSnapshot?.id === project.profileId) {
    const parsed = profileSchema.safeParse(project.profileSnapshot);
    if (parsed.success) return parsed.data;
  }
  return profileById(project?.profileId);
}

function customId(): string {
  return `custom-${typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`}`;
}

/** Editable starting points; numbers and legal deadlines are deliberately not inferred. */
export function procedureTemplate(type: Profile['type']): Profile['procedures'] {
  const draft: ProcedureStep = { id: 'draft', name: '입안·근거 확인·문서 작성' };
  const review: ProcedureStep = { id: 'review', name: '관계부서 협의·법제 검토', tip: '적용 법령과 기관의 내부 절차에 따라 필요한 심사·협의·영향평가를 확인합니다.' };
  const notice: ProcedureStep = { id: 'notice', name: '예고 대상·기간·의견제출 방법 확인', tip: '문서 유형과 적용 법령에 따라 입법예고 또는 행정예고 여부와 기간을 담당자가 확인합니다.' };
  const issue: ProcedureStep = { id: 'issue', name: '공포·발령·공개·등재 대상 확인', tip: '발령기관과 규범의 법적 성격에 따라 필요한 절차와 기한을 확인합니다.' };
  return {
    ordinance: [draft, review, notice, { id: 'council', name: '조례·규칙심의회 및 의회 심의·의결 대상 확인' }, issue],
    rule: [draft, review, notice, { id: 'council', name: '조례·규칙심의회 대상 확인' }, issue],
    admin: [draft, review, notice, ...(type === 'central' ? [{ id: 'sunset', name: '존속·재검토기한 및 규제심사 대상 확인', tip: '중앙행정기관의 적용 대상과 내부운영 등 제외 사유를 먼저 확인합니다.' }] : []), issue],
    bylaw: [draft, review, { id: 'board', name: '정관·내규에 따른 결재·이사회 의결 대상 확인' }, issue],
    // 새 기관 템플릿에는 법정기간을 미리 넣지 않는다(담당자가 확인 후 입력).
    law: LAW_PROC.map(({ days: _days, ...step }) => step),
  };
}

export function createCustomProfile(base: Profile = PROFILES[0]): Profile {
  return { ...snapshotProfile(base), id: customId(), name: '', typeLabel: PROFILE_TYPES[base.type], council: '', noticeNo: '공고 제{yyyy}-{n}호', opinionContact: '', procedures: procedureTemplate(base.type), procedureConfirmed: false, procedureCheckedAt: undefined, procedureNote: '' };
}

const transferSchema = z.object({ format: z.literal('jomokjomok.profile'), version: z.literal(1), profile: profileSchema });

function assertProfileFileSize(serialized: string) {
  if (serialized.length > PROFILE_FILE_MAX_BYTES || new TextEncoder().encode(serialized).byteLength > PROFILE_FILE_MAX_BYTES) throw new Error('기관 설정 파일은 256KB까지 불러올 수 있습니다.');
}

export function serializeProfile(profile: Profile): string {
  const serialized = JSON.stringify({ format: 'jomokjomok.profile', version: 1, profile: snapshotProfile(profile) }, null, 2);
  assertProfileFileSize(serialized);
  return serialized;
}

export function parseProfile(serialized: string): Profile {
  assertProfileFileSize(serialized);
  let input: unknown;
  try { input = JSON.parse(serialized.replace(/^\uFEFF/, '')); } catch { throw new Error('기관 설정 JSON을 읽지 못했습니다. 조목조목에서 내보낸 파일을 선택해 주세요.'); }
  const checked = transferSchema.safeParse(input);
  if (!checked.success) throw new Error(`기관 설정의 형식이나 허용 범위가 맞지 않습니다 (${checked.error.issues[0]?.path.join('.') || '파일'}).`);
  // An import never overwrites another institution and must be reviewed by its recipient.
  return { ...checked.data.profile, id: customId(), procedureConfirmed: false, procedureCheckedAt: undefined };
}
