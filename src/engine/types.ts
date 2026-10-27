// 조목조목 법제 엔진 — 공통 타입
// 원칙: 이 폴더(src/engine)는 순수 함수만 둔다. 네트워크·저장소·브라우저 API를 쓰지 않는다.

export type RuleKind =
  | 'ordinance' // 조례
  | 'rule' // 규칙
  | 'directive' // 훈령
  | 'established_rule' // 예규
  | 'notice' // 고시
  | 'guideline' // 내부 지침
  | 'bylaw' // 공공기관 내규
  | 'act' // 법률
  | 'decree' // 대통령령(시행령)
  | 'ministry_rule'; // 총리령·부령(시행규칙)

/** 모든 규정 종류 — 화면·보관파일 검증·검색 필터가 같은 목록을 쓴다. */
export const RULE_KINDS = ['ordinance', 'rule', 'directive', 'established_rule', 'notice', 'guideline', 'bylaw', 'act', 'decree', 'ministry_rule'] as const;
/** 국가 법령(법률·대통령령·총리령·부령) — 「법령 입안·심사 기준」 적용 대상 */
export const STATUTE_KINDS: readonly RuleKind[] = ['act', 'decree', 'ministry_rule'];
export const isStatuteKind = (kind: RuleKind): boolean => STATUTE_KINDS.includes(kind);

export const RULE_KIND_LABEL: Record<RuleKind, string> = {
  ordinance: '조례',
  rule: '규칙',
  directive: '훈령',
  established_rule: '예규',
  notice: '고시',
  guideline: '지침',
  bylaw: '내규',
  act: '법률',
  decree: '대통령령',
  ministry_rule: '총리령·부령',
};

/** 항 하나. 원문자가 없는 단일 항은 num = undefined */
export interface Paragraph {
  uid: string;
  num?: number;
  /** 항 본문(호 줄 포함, 줄바꿈으로 구분) */
  text: string;
  deleted?: boolean;
}

export interface Article {
  uid: string;
  /** 원문에서 이 조 앞에 놓인 장·절·관 표제. 전문 재구성 시 보존한다. */
  headings?: string[];
  num: number;
  br?: number; // 가지번호 (제5조의2 → br 2)
  title?: string;
  paragraphs: Paragraph[];
  deleted?: boolean; // "제7조 삭제"
}

/** 별표·별지 서식 블록 */
export interface Annex {
  uid: string;
  kind: 'table' | 'form';
  num: number;
  br?: number;
  title: string;
  text: string;
}

export interface Rule {
  title: string;
  kind: RuleKind;
  articles: Article[];
  addenda: string; // 부칙 원문(대비표 제외 대상)
  annexes: Annex[];
  diagnostics: ParseDiagnostic[];
  /** 제목과 본칙 사이의 안내·공포 정보 등 원문. */
  preamble?: string[];
}

export interface ParseDiagnostic {
  line: number;
  text: string;
  message: string;
}

/** 조·항 주소 */
export interface UnitRef {
  art: number;
  artBr?: number;
  para?: number;
}

// ───────── 변경명세(ChangeSpec) — 모든 산출물의 단일 원천 ─────────

export type Provenance = 'ai' | 'ai_accepted' | 'engine' | 'human';

export type ChangeOp =
  | { op: 'replace_text'; target: OpTarget; find: string; replace: string }
  | { op: 'insert_paragraph'; art: UnitRef; position: number; text: string }
  | { op: 'delete_paragraph'; target: UnitRef }
  | { op: 'insert_article'; after: UnitRef; title: string; paragraphs: string[]; policy: 'branch' | 'renumber' }
  | { op: 'delete_article'; target: UnitRef }
  | { op: 'set_title'; target: UnitRef; title: string };

/** 본문 단위 또는 별표·서식 */
export type OpTarget =
  | { kind: 'unit'; ref: UnitRef }
  | { kind: 'annex'; annexKind: 'table' | 'form'; num: number; br?: number };

export interface SpecOp {
  id: string;
  change: ChangeOp;
  status: 'proposed' | 'accepted' | 'rejected';
  provenance: Provenance;
  /** 변경 이유(카드 설명) */
  why?: string;
  /** 근거 ID(EV-…) */
  evidence?: string[];
  /** 엔진이 인용 정정으로 만든 연산의 원 연산 */
  derivedFrom?: string;
}

export interface ChangeSpec {
  ops: SpecOp[];
  addenda: AddendaSpec;
}

export interface AddendaSpec {
  effective: 'promulgation' | 'months' | 'date';
  months?: number;
  date?: string; // YYYY-MM-DD
  transitional?: string; // 경과조치 문장(선택)
  /** Legacy request to review a deadline; never an instruction to put it in addenda. */
  reviewDeadline?: boolean;
  transitions?: TransitionDecision[];
  deadlineReview?: DeadlineReview;
  priorAddendaReview?: PriorAddendaReview;
}

export type TransitionCategory = 'application' | 'contract' | 'term' | 'sanction' | 'preparation' | 'other';
export type TransitionForm = 'preparation' | 'application' | 'special' | 'transitional';

/** A human decision about one existing legal relationship, not an inferred legal conclusion. */
export interface TransitionDecision {
  id: string;
  category: TransitionCategory;
  articleRefs: string[];
  target: string;
  event: string;
  eventDate?: string;
  application: 'unresolved' | 'old' | 'new' | 'separate';
  form: TransitionForm;
  title: string;
  clause: string;
  basis: string;
  note: string;
  status: 'unreviewed' | 'confirmed' | 'not_needed';
  /** Fingerprint of the text/effective-date inputs when the human confirmed it. */
  sourceHash?: string;
}

export interface DeadlineReview {
  institutionType: 'unknown' | 'central' | 'local' | 'public';
  applicability: 'unreviewed' | 'applies' | 'excluded' | 'not_needed';
  kind: 'review' | 'sunset';
  basis: string;
  clause: string;
  confirmed: boolean;
  sourceHash?: string;
}

export interface PriorAddendaReview {
  decision: 'unreviewed' | 'retain' | 'replace' | 'not_needed';
  note: string;
  sourceHash?: string;
}

// ───────── 인용 ─────────

export interface Citation {
  /** 인용이 들어 있는 곳 */
  from: { kind: 'unit'; art: Article; paraUid?: string } | { kind: 'annex'; annex: Annex };
  raw: string;
  start: number; // 해당 텍스트 안 위치
  end: number;
  target: UnitRef;
  /** raw를 다시 쓸 때의 형태 */
  form: 'full' | 'para_only';
  external: boolean;
}

export interface CitationFix {
  id: string;
  where: string; // "제8조" 또는 "별지 제2호서식"
  before: string;
  after?: string; // 없으면 자동 정정 불가
  reason: 'moved' | 'deleted';
  /** 원본 텍스트 안의 위치(정정 연산 생성용) */
  target: OpTarget;
  derivedFrom?: string;
}

// ───────── 대비표 ─────────

export interface Segment {
  text: string;
  underline?: boolean;
}

export interface ComparisonRow {
  key: string;
  left: Segment[][]; // 줄 단위
  right: Segment[][];
}

// ───────── 점검 ─────────

export type LintTier = 'must' | 'check' | 'note';

export interface LintIssue {
  code: string; // 인용-01
  tier: LintTier;
  title: string; // 쉬운 이름
  where: string;
  message: string;
  origin: 'introduced' | 'preexisting';
  source: 'engine' | 'ai';
  fix?: { label: string; ops: ChangeOp[] };
  offline?: boolean;
}
