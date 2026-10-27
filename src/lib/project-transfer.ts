import { RULE_KINDS } from '@/engine/types';
import { procedureTrackSchema } from './procedure-track';
import { z } from 'zod';
import { knowledgeRecordSchema } from './knowledge';
import citationIndex from '@/data/knowledge/citation-index.json';
import { PROFILES, profileSchema, snapshotProfile, type Profile } from '@/config/profiles';
import { newId, saveProject, sha256, type Project } from './project';
import { storedImpactIssues, upperLawReviewSchema } from './impact';
import { PilotRecordSchema, pausePilot } from './evaluation';
import { documentSettingsSchema } from './document-settings';
import { workReviewSessionSchema } from './work-review';
import { authorityReviewStateSchema } from './authority-review';
import { transitionDecisionSchema, deadlineReviewSchema, priorAddendaReviewSchema } from './transition-review';
import { opinionRequestStateSchema } from './opinion-request';
import { consultationReviewStateSchema } from './consultation-review';
import { linkedRegulationsSchema } from './linked-regulations';

/** Work files contain project content only; connection settings are never read. */
export const PROJECT_BACKUP_MAX_BYTES = 10 * 1024 * 1024;
export const PROJECT_BACKUP_VERSION = 1;
const FORMAT = 'jomokjomok.project';
const MAX_SOURCE_CHARS = 1_000_000;
const MAX_TEXT_CHARS = 200_000;
const short = z.string().max(500);
const label = z.string().max(2_000);
const text = z.string().max(MAX_TEXT_CHARS);
const id = z.string().min(1).max(500);
const count = z.number().int().min(0).max(1_000_000);
const timestamp = z.number().int().min(0).max(8_640_000_000_000_000);
const sha = z.string().regex(/^[a-f0-9]{64}$/i);
const legacySourceHash = z.union([sha, z.literal('')]);

const publicUrl = z.string().max(4_096).refine((value) => {
  try {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return false;
    // A source link must not transport a provider key or an authenticated URL.
    return ![...url.searchParams.keys()].some((key) => /^(?:api[-_]?key|access[-_]?token|token|authorization|password|secret|signature|orgkey|byokkey|key)$/i.test(key));
  } catch {
    return false;
  }
}, '공개 HTTP(S) 근거 주소만 보관할 수 있습니다.');

const unit = z.object({
  art: z.number().int().min(1).max(100_000),
  artBr: z.number().int().min(1).max(100_000).optional(),
  para: z.number().int().min(1).max(100_000).optional(),
});
const target = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('unit'), ref: unit }),
  z.object({ kind: z.literal('annex'), annexKind: z.enum(['table', 'form']), num: z.number().int().min(1).max(100_000), br: z.number().int().min(1).max(100_000).optional() }),
]);
const change = z.discriminatedUnion('op', [
  z.object({ op: z.literal('replace_text'), target, find: text.min(1), replace: text }),
  z.object({ op: z.literal('insert_paragraph'), art: unit, position: z.number().int().min(1).max(100_000), text }),
  z.object({ op: z.literal('delete_paragraph'), target: unit }),
  z.object({ op: z.literal('insert_article'), after: unit, title: label, paragraphs: z.array(text).max(1_000), policy: z.enum(['branch', 'renumber']) }),
  z.object({ op: z.literal('delete_article'), target: unit }),
  z.object({ op: z.literal('set_title'), target: unit, title: label }),
]);
const specOp = z.object({
  id,
  change,
  status: z.enum(['proposed', 'accepted', 'rejected']),
  provenance: z.enum(['ai', 'ai_accepted', 'engine', 'human']),
  why: text.optional(),
  evidence: z.array(id).max(500).optional(),
  derivedFrom: id.optional(),
});
const dateOrEmpty = z.string().max(10).refine((value) => {
  if (value === '') return true; // Unfinished drafts may not yet have an effective date.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
});
const addenda = z.object({
  effective: z.enum(['promulgation', 'months', 'date']),
  months: z.number().int().min(0).max(1_200).optional(),
  date: dateOrEmpty.optional(),
  transitional: text.optional(),
  reviewDeadline: z.boolean().optional(),
  transitions: z.array(transitionDecisionSchema).max(50).optional(),
  deadlineReview: deadlineReviewSchema.optional(),
  priorAddendaReview: priorAddendaReviewSchema.optional(),
});
const evidence = z.object({
  id,
  kind: z.enum(['law', 'rule', 'user']),
  label,
  text,
  url: publicUrl.optional(),
  via: z.enum(['live', 'relay', 'snapshot', 'user']),
  date: short.optional(),
  lawId: short.optional(),
  lawKind: z.enum(['law', 'admrul', 'ordin']).optional(),
  effectiveAt: short.optional(),
  fetchedAt: short.optional(),
  contentHash: sha.optional(),
  partial: z.boolean().optional(),
  note: text.optional(),
});
const agentLog = z.object({
  step: z.enum(['load', 'upper', 'plan', 'link', 'lint', 'docs']),
  label,
  actor: z.enum(['법제처', 'AI', '규칙 엔진', '사람']),
  status: z.enum(['wait', 'running', 'ok', 'failed', 'skipped']),
  ms: z.number().finite().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
  model: short.optional(),
  detail: text.optional(),
  tools: z.array(short).max(100).optional(),
});
const sourceReview = z.object({
  hash: sha,
  confirmedAt: timestamp.optional(),
  issues: z.array(z.object({
    code: short,
    message: label,
    location: short.optional(),
    severity: z.enum(['warning', 'blocking']),
    excerpt: text.optional(),
  })).max(2_000),
});

// Each object deliberately uses a field allowlist. Zod strips unknown properties
// at every level, including settings, orgKey, __proto__ and constructor.
const projectSchema = z.object({
  id,
  createdAt: timestamp,
  updatedAt: timestamp,
  mode: z.enum(['amend', 'enact']),
  amendmentKind: z.enum(['partial', 'full', 'repeal']).optional(),
  amendmentDecision: z.object({ note: z.string().max(5000), confirmedHash: z.string().regex(/^[a-f0-9]{16}$/).optional() }).optional(),
  replacementDraft: z.object({ raw: text, confirmedHash: z.string().regex(/^[a-f0-9]{16}$/).optional() }).optional(),
  sampleId: short.optional(),
  title: label,
  kind: z.enum(RULE_KINDS),
  profileId: id,
  profileSnapshot: profileSchema.optional(),
  source: z.object({ type: z.enum(['sample', 'paste', 'law', 'file', 'none']), raw: z.string().max(MAX_SOURCE_CHARS), hash: legacySourceHash, name: label.optional() }),
  sourceReview: sourceReview.optional(),
  impact: upperLawReviewSchema.optional(),
  evaluation: PilotRecordSchema.strip().optional(),
  intent: text,
  purpose: text.optional(),
  upperLaw: label.optional(),
  spec: z.object({ ops: z.array(specOp).max(1_000), addenda }),
  excludedFixes: z.array(id).max(5_000),
  evidence: z.array(evidence).max(500),
  knowledge: z.array(knowledgeRecordSchema).max(12).optional(),
  log: z.array(agentLog).max(2_000),
  prose: z.object({ reason: text, mainPoints: z.array(text).max(1_000), model: short.optional(), via: z.enum(['live', 'cassette', 'template']), specHash: short, reviewed: z.boolean(), note: text.optional() }).optional(),
  documentSettings: documentSettingsSchema.optional(),
  workReview: workReviewSessionSchema.optional(),
  authorityReview: authorityReviewStateSchema.optional(),
  opinionRequest: opinionRequestStateSchema.optional(),
  consultationReview: consultationReviewStateSchema.optional(),
  linkedRegulations: linkedRegulationsSchema.optional(),
  procedureTrack: procedureTrackSchema.optional(),
  enact: z.object({
    title: label,
    outline: z.array(z.object({ id, title: label, summary: text.optional(), paragraphs: z.array(text).max(1_000), evidence: z.array(id).max(500).optional(), provenance: z.enum(['ai', 'ai_accepted', 'human']) })).max(1_000),
    outlineConfirmed: z.boolean(),
    via: z.enum(['live', 'cassette']).optional(),
  }).optional(),
  planVia: z.enum(['live', 'cassette', 'manual']).optional(),
  planModel: short.optional(),
  planModelId: short.optional(),
  planFamily: short.optional(),
  planError: text.optional(),
  planTrace: z.object({ actualModel: short.optional(), promptVersion: short.optional(), tokens: count.optional(), repairs: count.optional(), fallbacks: z.array(short).max(100).optional(), family: short.optional() }).optional(),
  compare: z.object({ otherModel: short, ops: z.array(specOp).max(1_000), via: z.enum(['live', 'cassette']) }).optional(),
}).superRefine((project, ctx) => {
  const unique = (values: string[], path: string[]) => {
    if (new Set(values).size !== values.length) ctx.addIssue({ code: 'custom', path, message: '중복된 항목 ID가 있습니다.' });
  };
  unique(project.spec.ops.map((op) => op.id), ['spec', 'ops']);
  unique(project.evidence.map((item) => item.id), ['evidence']);
  if (project.enact) unique(project.enact.outline.map((article) => article.id), ['enact', 'outline']);
  if (project.compare) unique(project.compare.ops.map((op) => op.id), ['compare', 'ops']);
  if (project.profileSnapshot && project.profileSnapshot.id !== project.profileId) {
    ctx.addIssue({ code: 'custom', path: ['profileSnapshot', 'id'], message: '작업과 기관 설정의 ID가 일치하지 않습니다.' });
  }
});

const envelopeSchema = z.object({
  format: z.literal(FORMAT),
  version: z.literal(PROJECT_BACKUP_VERSION),
  exportedAt: timestamp,
  integrity: z.object({ algorithm: z.literal('SHA-256'), projectHash: sha }),
  project: projectSchema,
});

export class ProjectTransferError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProjectTransferError';
  }
}

export interface PreparedProjectImport {
  project: Project;
  exportedAt: number;
  projectHash: string;
  profileKnown: boolean;
  warnings: string[];
}

/** Keep key order used by old review fingerprints while retaining only validated keys. */
function keepKeyOrder(original: unknown, checked: unknown): unknown {
  if (Array.isArray(checked)) return checked.map((value, index) => keepKeyOrder(Array.isArray(original) ? original[index] : undefined, value));
  if (checked !== null && typeof checked === 'object') {
    const allowed = checked as Record<string, unknown>;
    const input = original !== null && typeof original === 'object' && !Array.isArray(original) ? original as Record<string, unknown> : {};
    const result: Record<string, unknown> = {};
    for (const key of [...Object.keys(input), ...Object.keys(allowed)]) {
      if (!Object.hasOwn(allowed, key) || Object.hasOwn(result, key) || allowed[key] === undefined) continue;
      Object.defineProperty(result, key, { value: keepKeyOrder(input[key], allowed[key]), enumerable: true, writable: true, configurable: true });
    }
    return result;
  }
  return checked;
}

/** Stable keys make the integrity check independent of JSON whitespace/key ordering. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).filter((key) => record[key] !== undefined).sort().map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function schemaError(error: z.ZodError): ProjectTransferError {
  const path = error.issues[0]?.path.join('.') || '파일';
  return new ProjectTransferError(`작업 보관파일의 형식이나 허용 범위가 맞지 않습니다 (${path}). 원본 파일을 다시 선택해 주세요.`);
}

function validateProject(value: unknown): Project {
  const parsed = projectSchema.safeParse(value);
  if (!parsed.success) throw schemaError(parsed.error);
  return keepKeyOrder(value, parsed.data) as Project;
}

function assertSize(value: string) {
  if (value.length > PROJECT_BACKUP_MAX_BYTES || new TextEncoder().encode(value).byteLength > PROJECT_BACKUP_MAX_BYTES) {
    throw new ProjectTransferError('작업 보관파일은 10MB까지 불러올 수 있습니다.');
  }
}

function verifyEvidenceReferences(project: Project) {
  const evidenceIds = new Set(project.evidence.map((entry) => entry.id));
  const groups: { label: string; entries: { evidence?: string[] }[] }[] = [
    { label: '변경 제안', entries: project.spec.ops },
    { label: '제정 조문', entries: project.enact?.outline ?? [] },
    { label: '비교 제안', entries: project.compare?.ops ?? [] },
  ];
  for (const { label, entries } of groups) {
    for (const [index, entry] of entries.entries()) {
      const missing = entry.evidence?.find((id) => !evidenceIds.has(id));
      if (missing !== undefined) {
        throw new ProjectTransferError(`작업 보관파일의 ${label} ${index + 1}번이 존재하지 않는 근거 ID(${missing})를 참조합니다. 해당 근거 원문이 포함된 파일을 선택해 주세요.`);
      }
    }
  }
}

async function verifySource(project: Project, allowMissingHash: boolean) {
  verifyEvidenceReferences(project);
  const referenceCitations = [
    ...(project.knowledge ?? []).flatMap(record => record.citations),
    ...(project.workReview?.result.sources ?? []),
    ...(project.workReview?.result.retrieval.citations ?? []),
  ];
  for (const c of referenceCitations) {
    const canonical = await sha256(JSON.stringify([c.id, c.documentId, c.pdfPage, c.printedPage, c.section, c.sectionType, c.text]));
    if (c.contentHash !== await sha256(c.text) || (citationIndex as Record<string, string>)[c.id] !== canonical) {
      throw new ProjectTransferError(`입안 참고자료 ${c.id}의 발췌문·쪽수가 배포된 정본 색인과 일치하지 않습니다.`);
    }
  }
  const actual = await sha256(project.source.raw);
  if (!(!project.source.hash && allowMissingHash) && project.source.hash.toLowerCase() !== actual) {
    throw new ProjectTransferError('원문 SHA-256 지문이 일치하지 않습니다. 원문이 바뀌었거나 손상된 파일은 불러올 수 없습니다.');
  }
  if (project.sourceReview && project.sourceReview.hash.toLowerCase() !== actual) {
    throw new ProjectTransferError('입력 원문 확인 기록의 지문이 현재 원문과 일치하지 않습니다. 원문을 확인한 작업에서 다시 보관해 주세요.');
  }
  const evidenceMatches = await Promise.all(project.evidence.map(async (entry) => !entry.contentHash || entry.contentHash.toLowerCase() === await sha256(entry.text)));
  const invalidEvidence = evidenceMatches.indexOf(false);
  if (invalidEvidence !== -1) {
    throw new ProjectTransferError(`근거 ${project.evidence[invalidEvidence].id}의 원문 지문이 저장된 내용과 일치하지 않습니다. 원본 근거가 담긴 파일을 선택해 주세요.`);
  }
  if (project.impact && project.impact.institutionHash !== actual) {
    throw new ProjectTransferError('상위법 영향 분석의 기관 원문 지문이 현재 원문과 일치하지 않습니다. 분석 당시의 원문이 담긴 파일을 선택해 주세요.');
  }
  if (project.impact) {
    const issues = storedImpactIssues(project.impact, project.source.raw, project.kind);
    if (issues.length) throw new ProjectTransferError(`상위법 영향 분석의 원문 대조에 실패했습니다. ${issues[0]}`);
  }
  return actual;
}

/** Serialize a validated allowlist, never a Settings object or a whole browser store. */
export async function serializeProjectBackup(project: Project): Promise<string> {
  const clean = validateProject(project);
  const exportedAt = Date.now();
  // Older enactment projects saved an empty hash. Upgrade only the missing hash;
  // a non-empty mismatch remains an error instead of silently blessing changed text.
  clean.source.hash = await verifySource(clean, true);
  if (clean.evaluation) clean.evaluation = pausePilot(clean.evaluation, exportedAt);
  const backup = {
    format: FORMAT,
    version: PROJECT_BACKUP_VERSION,
    exportedAt,
    integrity: { algorithm: 'SHA-256', projectHash: await sha256(canonical(clean)) },
    project: clean,
  };
  const serialized = JSON.stringify(backup, null, 2);
  assertSize(serialized);
  return serialized;
}

export async function parseProjectBackup(serialized: string): Promise<PreparedProjectImport> {
  assertSize(serialized);
  let input: unknown;
  try {
    input = JSON.parse(serialized.replace(/^\uFEFF/, ''));
  } catch {
    throw new ProjectTransferError('JSON 파일을 읽지 못했습니다. 조목조목에서 받은 작업 보관파일(.json)을 선택해 주세요.');
  }
  if (input !== null && typeof input === 'object' && Object.hasOwn(input, 'format') && (input as Record<string, unknown>).format === FORMAT && (input as Record<string, unknown>).version !== PROJECT_BACKUP_VERSION) {
    throw new ProjectTransferError('이 작업 보관파일의 버전은 지원하지 않습니다. 같은 버전의 조목조목에서 다시 내보내 주세요.');
  }
  const result = envelopeSchema.safeParse(input);
  if (!result.success) throw schemaError(result.error);
  const project = keepKeyOrder((input as { project: unknown }).project, result.data.project) as Project;
  const projectHash = await sha256(canonical(project));
  if (projectHash !== result.data.integrity.projectHash.toLowerCase()) {
    throw new ProjectTransferError('작업 내용의 무결성 지문이 일치하지 않습니다. 내용이 바뀌었거나 손상된 파일은 불러올 수 없습니다.');
  }
  await verifySource(project, false);
  const profileKnown = !!project.profileSnapshot || PROFILES.some((profile) => profile.id === project.profileId);
  const warnings: string[] = [];
  if (!profileKnown) warnings.push(`보관파일의 기관 프로필(${project.profileId})을 이 앱에서 찾을 수 없습니다. 복원할 기관을 직접 선택해 주세요.`);
  if (project.log.some((entry) => entry.status === 'running' || entry.status === 'wait')) warnings.push('진행 중이던 AI 실행은 자동으로 재개하지 않습니다. 저장된 초안과 검토 상태부터 이어서 확인하세요.');
  return { project, exportedAt: result.data.exportedAt, projectHash, profileKnown, warnings };
}

/** Save under a fresh ID. A failed IndexedDB write is an error, never a success. */
export async function restoreProjectBackup(
  prepared: PreparedProjectImport,
  options: { profileId?: string; profileSnapshot?: Profile } = {},
  persist: (project: Project) => Promise<boolean> = saveProject,
): Promise<Project> {
  const project = validateProject(prepared.project);
  if (await sha256(canonical(project)) !== prepared.projectHash) throw new ProjectTransferError('미리보기 이후 작업 내용이 바뀌었습니다. 파일을 다시 선택해 주세요.');
  await verifySource(project, false);
  const profileId = options.profileId ?? options.profileSnapshot?.id ?? project.profileId;
  let profileSnapshot = project.profileSnapshot;
  if (options.profileSnapshot) {
    const result = profileSchema.safeParse(options.profileSnapshot);
    if (!result.success || result.data.id !== profileId) throw new ProjectTransferError('복원에 사용할 기관 설정의 형식과 ID를 확인해 주세요.');
    profileSnapshot = result.data;
  } else if (profileId !== project.profileId) {
    const replacement = PROFILES.find((profile) => profile.id === profileId);
    if (!replacement) throw new ProjectTransferError('복원에 사용할 기관 프로필을 선택해 주세요.');
    profileSnapshot = snapshotProfile(replacement);
  }
  if (!profileSnapshot && !PROFILES.some((profile) => profile.id === profileId)) throw new ProjectTransferError('복원에 사용할 기관 프로필을 선택해 주세요.');
  const profileChanged = profileId !== project.profileId || canonical(profileSnapshot ?? null) !== canonical(project.profileSnapshot ?? null);
  const restored: Project = {
    ...project,
    id: `import-${typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : newId()}`,
    updatedAt: Date.now(),
    profileId,
    ...(profileSnapshot ? { profileSnapshot } : {}),
    log: project.log.map((entry) => entry.status === 'running' || entry.status === 'wait' ? {
      ...entry,
      status: 'skipped',
      detail: [entry.detail, '백업 시점에 완료되지 않은 실행입니다. 필요하면 새 작업으로 AI 다시 실행하세요.'].filter(Boolean).join('\n'),
    } : entry),
    ...(project.evaluation ? { evaluation: pausePilot(project.evaluation, prepared.exportedAt) } : {}),
    ...(profileChanged && project.prose ? { prose: { ...project.prose, reviewed: false } } : {}),
  };
  let saved = false;
  try {
    saved = await persist(restored);
  } catch {
    // Browsers can reject IndexedDB writes in private mode or when storage is full.
  }
  if (!saved) throw new ProjectTransferError('브라우저에 작업을 저장하지 못했습니다. 저장 공간과 브라우저의 저장 허용 설정을 확인한 뒤 다시 불러와 주세요.');
  return restored;
}

export function projectBackupFileName(project: Pick<Project, 'title' | 'enact'>, at = Date.now()): string {
  const day = new Date(at).toISOString().slice(0, 10).replace(/-/g, '');
  const name = (project.enact?.title || project.title || '제목 없는 작업').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '').trim().slice(0, 100);
  return `${day}_${name || '작업'}_작업보관.jomok.json`;
}
