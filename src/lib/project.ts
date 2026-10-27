import { del, get, set, keys } from 'idb-keyval';
import type { ChangeSpec, RuleKind, SpecOp } from '@/engine';
import type { UpperLawReview } from './impact';
import type { PilotRecord } from './evaluation';
import type { Profile } from '@/config/profiles';
import type { KnowledgeRecord } from './knowledge';
import type { DocumentSettings } from './document-settings';
import type { WorkReviewSession } from './work-review';
import type { AuthorityReviewState } from './authority-review';
import type { OpinionRequestState } from './opinion-request';
import type { ConsultationReviewState } from './consultation-review';
import type { LinkedRegulation } from './linked-regulations';
import type { ProcedureTrackState } from './procedure-track';

export interface Evidence {
  id: string; // EV-L-1 …
  kind: 'law' | 'rule' | 'user';
  label: string; // 「공무원 여비 규정」 제16조
  text: string;
  url?: string;
  via: 'live' | 'relay' | 'snapshot' | 'user';
  date?: string; // 조회일 또는 저장본 기준일
  lawId?: string;
  lawKind?: 'law' | 'admrul' | 'ordin';
  effectiveAt?: string;
  fetchedAt?: string;
  contentHash?: string;
  partial?: boolean;
  note?: string;
}

export interface AgentLog {
  step: 'load' | 'upper' | 'plan' | 'link' | 'lint' | 'docs';
  label: string;
  actor: '법제처' | 'AI' | '규칙 엔진' | '사람';
  status: 'wait' | 'running' | 'ok' | 'failed' | 'skipped';
  ms?: number;
  model?: string;
  detail?: string;
  tools?: string[];
}

export interface ProseBlock {
  reason: string;
  mainPoints: string[];
  model?: string;
  via: 'live' | 'cassette' | 'template';
  specHash: string;
  reviewed: boolean;
  note?: string;
}

export interface EnactArticle {
  id: string;
  title: string;
  summary?: string;
  paragraphs: string[];
  evidence?: string[];
  provenance: 'ai' | 'ai_accepted' | 'human';
}

export type AiMode = 'auto' | 'cassette' | 'off';

export interface Project {
  id: string;
  createdAt: number;
  updatedAt: number;
  mode: 'amend' | 'enact';
  /** Older projects without this field remain partial amendments. */
  amendmentKind?: 'partial' | 'full' | 'repeal';
  amendmentDecision?: { note: string; confirmedHash?: string };
  /** A full amendment has its own complete main text, separate from the source. */
  replacementDraft?: { raw: string; confirmedHash?: string };
  sampleId?: string;
  title: string;
  kind: RuleKind;
  profileId: string;
  /** Institution settings when this work began; portable and independent of later settings edits. */
  profileSnapshot?: Profile;
  source: { type: 'sample' | 'paste' | 'law' | 'file' | 'none'; raw: string; hash: string; name?: string };
  sourceReview?: { hash: string; confirmedAt?: number; issues: { code: string; message: string; location?: string; severity: 'warning' | 'blocking'; excerpt?: string }[] };
  impact?: UpperLawReview;
  evaluation?: PilotRecord;
  intent: string;
  purpose?: string;
  upperLaw?: string;
  spec: ChangeSpec;
  excludedFixes: string[];
  evidence: Evidence[];
  /** Drafting manuals remain separate from statutory delegation evidence. */
  knowledge?: KnowledgeRecord[];
  log: AgentLog[];
  prose?: ProseBlock;
  /** Publication fields and explicit manual checklist decisions, shared by all exported formats. */
  documentSettings?: DocumentSettings;
  /** The latest contextual review and explicit draft edits; never a legal approval. */
  workReview?: WorkReviewSession;
  authorityReview?: AuthorityReviewState;
  opinionRequest?: OpinionRequestState;
  consultationReview?: ConsultationReviewState;
  linkedRegulations?: LinkedRegulation[];
  /** 기관 절차 단계별 진행 상태와 기한 계산 기준일(담당자 입력). */
  procedureTrack?: ProcedureTrackState;
  enact?: { title: string; outline: EnactArticle[]; outlineConfirmed: boolean; via?: 'live' | 'cassette' };
  planVia?: 'live' | 'cassette' | 'manual';
  planModel?: string;
  planModelId?: string;
  planFamily?: string;
  planError?: string;
  planTrace?: { actualModel?: string; promptVersion?: string; tokens?: number; repairs?: number; fallbacks?: string[]; family?: string };
  /** 두 AI 비교 결과 */
  compare?: { otherModel: string; ops: SpecOp[]; via: 'live' | 'cassette' };
}

const PREFIX = 'jj:project:';

export function newId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

export async function saveProject(p: Project): Promise<boolean> {
  try {
    await set(PREFIX + p.id, { ...p, updatedAt: Date.now() });
    return true;
  } catch {
    return false;
  }
}

export async function loadProject(id: string): Promise<Project | undefined> {
  try {
    return (await get(PREFIX + id)) as Project | undefined;
  } catch {
    return undefined;
  }
}

export async function listProjects(): Promise<Project[]> {
  try {
    const ks = (await keys()).filter((k) => String(k).startsWith(PREFIX));
    const ps = await Promise.all(ks.map((k) => get(k)));
    return (ps.filter(Boolean) as Project[]).sort((a, b) => b.updatedAt - a.updatedAt);
  } catch {
    return [];
  }
}

export async function deleteProject(id: string) {
  try {
    await del(PREFIX + id);
  } catch {
    /* noop */
  }
}

export function emptySpec(): ChangeSpec {
  return { ops: [], addenda: { effective: 'promulgation' } };
}

export async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
