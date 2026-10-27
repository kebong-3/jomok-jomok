// 절차·일정 진행판 — 기관 설정의 절차 단계를 작업별로 추적하고 법정 기한을 단순 계산한다.
// 원칙: 계산은 "참고용 단순 계산"이다. 기산점·예외·임시공휴일은 담당자가 확인한다.
import { z } from 'zod';
import type { ProcedureStep, Profile, ProcedureGroup } from '@/config/profiles';
import { procedureGroupOf, procedureSteps } from '@/config/profiles';
import type { RuleKind } from '@/engine';

export type StepStatus = 'todo' | 'doing' | 'done' | 'skip';
export const STEP_STATUS_LABEL: Record<StepStatus, string> = { todo: '대기', doing: '진행 중', done: '완료', skip: '해당 없음' };

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v);

export const procedureTrackSchema = z.object({
  steps: z.record(z.string().max(80), z.object({
    status: z.enum(['todo', 'doing', 'done', 'skip']),
    date: isoDate.optional(),
    note: z.string().max(2000).optional(),
  })).refine(v => Object.keys(v).length <= 40),
  dates: z.object({
    noticeStart: isoDate.optional(),
    resolved: isoDate.optional(),
    transferred: isoDate.optional(),
    promulgation: isoDate.optional(),
  }).optional(),
});
export type ProcedureTrackState = z.infer<typeof procedureTrackSchema>;
export const emptyProcedureTrack = (): ProcedureTrackState => ({ steps: {}, dates: {} });

/**
 * 관공서 공휴일(2026~2027, 대체공휴일 포함) — 기간 말일 조정용.
 * 임시공휴일·선거일 추가 지정 등은 반영하지 못할 수 있으므로 화면에서 확인을 요청한다.
 */
const HOLIDAYS = new Set([
  // 2026
  '2026-01-01', '2026-02-16', '2026-02-17', '2026-02-18', '2026-03-01', '2026-03-02', '2026-05-05', '2026-05-24', '2026-05-25',
  '2026-06-03', '2026-06-06', '2026-08-15', '2026-08-17', '2026-09-24', '2026-09-25', '2026-09-26', '2026-10-03', '2026-10-05',
  '2026-10-09', '2026-12-25',
  // 2027
  '2027-01-01', '2027-02-05', '2027-02-06', '2027-02-07', '2027-02-08', '2027-03-01', '2027-05-05', '2027-05-13', '2027-06-06',
  '2027-08-15', '2027-08-16', '2027-09-14', '2027-09-15', '2027-09-16', '2027-10-03', '2027-10-04', '2027-10-09', '2027-10-11',
  '2027-12-25', '2027-12-27',
]);
const FIXED = ['01-01', '03-01', '05-05', '06-06', '08-15', '10-03', '10-09', '12-25'];

const toDate = (iso: string) => new Date(`${iso}T00:00:00Z`);
const toIso = (d: Date) => d.toISOString().slice(0, 10);
export function addDays(iso: string, n: number): string {
  const d = toDate(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return toIso(d);
}
export function isNonWorkingDay(iso: string): boolean {
  const day = toDate(iso).getUTCDay();
  if (day === 0 || day === 6) return true;
  return HOLIDAYS.has(iso) || FIXED.includes(iso.slice(5));
}
/** 「민법」 제161조: 기간의 말일이 토요일 또는 공휴일이면 그 다음 날 만료 */
export function rollToWorkingDay(iso: string): { date: string; rolled: boolean } {
  let date = iso;
  let guard = 0;
  while (isNonWorkingDay(date) && guard++ < 14) date = addDays(date, 1);
  return { date, rolled: date !== iso };
}
const WEEKDAY = ['일', '월', '화', '수', '목', '금', '토'];
export function formatKoreanDate(iso: string): string {
  const d = toDate(iso);
  return `${d.getUTCFullYear()}. ${d.getUTCMonth() + 1}. ${d.getUTCDate()}.(${WEEKDAY[d.getUTCDay()]})`;
}
export const holidayCoverage = (iso?: string): boolean => !iso || /^202[67]-/.test(iso);

/**
 * 기간 계산: 초일 불산입(「민법」 제157조) → 시작일 다음 날부터 n일째가 말일.
 * 말일이 토요일·공휴일이면 다음 날 만료(「민법」 제161조, 「행정기본법」 제6조).
 */
export function periodEnd(startIso: string, days: number): { date: string; rolled: boolean } {
  return rollToWorkingDay(addDays(startIso, days));
}

export interface Deadline {
  id: string;
  label: string;
  date: string;
  rolled?: boolean;
  basis: string;
  from: string;
  kind: 'notice' | 'deadline' | 'before';
}

/** 입력한 기준일로 규정 종류별 주요 기한을 계산한다. 입력이 없으면 계산하지 않는다. */
export function keyDeadlines(kind: RuleKind, profile: Pick<Profile, 'noticeDays' | 'type'>, dates: ProcedureTrackState['dates'] = {}): Deadline[] {
  const group = procedureGroupOf(kind);
  const out: Deadline[] = [];
  if (dates.noticeStart) {
    const days = group === 'law' ? Math.max(40, profile.noticeDays) : group === 'admin' || group === 'ordinance' || group === 'rule' ? Math.max(20, profile.noticeDays) : profile.noticeDays;
    const end = periodEnd(dates.noticeStart, days);
    out.push({ id: 'notice-end', label: `${group === 'admin' ? '행정예고' : group === 'bylaw' ? '의견수렴' : '입법예고'} ${days}일 · 의견제출 마감(최소 기간 기준)`, date: end.date, rolled: end.rolled, from: dates.noticeStart, kind: 'notice',
      basis: group === 'admin' ? '「행정절차법」 제46조(20일 이상)' : group === 'law' ? '「행정절차법」 제43조(법령 40일 이상)' : group === 'bylaw' ? '기관 정관·내규' : '「행정절차법」 제43조(자치법규 20일 이상)' });
  }
  if (group === 'ordinance') {
    if (dates.resolved) {
      const end = periodEnd(dates.resolved, 5);
      out.push({ id: 'transfer', label: '의장의 조례안 이송 기한(의결일부터 5일 이내)', date: end.date, rolled: end.rolled, from: dates.resolved, kind: 'deadline', basis: '「지방자치법」 제32조제1항' });
    }
    if (dates.transferred) {
      const promulgate = periodEnd(dates.transferred, 20);
      out.push({ id: 'promulgate', label: '공포 또는 재의요구 기한(이송받은 날부터 20일 이내)', date: promulgate.date, rolled: promulgate.rolled, from: dates.transferred, kind: 'deadline', basis: '「지방자치법」 제32조제2항·제3항' });
      const report = periodEnd(dates.transferred, 5);
      out.push({ id: 'report', label: '상급기관 보고 기한(이송된 날부터 5일 이내)', date: report.date, rolled: report.rolled, from: dates.transferred, kind: 'deadline', basis: '「지방자치법」 제35조' });
    }
  }
  if (group === 'rule' && dates.promulgation) {
    out.push({ id: 'report', label: '상급기관 보고(공포 예정일 15일 전까지)', date: addDays(dates.promulgation, -15), from: dates.promulgation, kind: 'before', basis: '「지방자치법」 제35조' });
  }
  return out;
}

export interface TrackRow { step: ProcedureStep; status: StepStatus; date?: string; note?: string; index: number }
export interface TrackSummary { rows: TrackRow[]; done: number; total: number; current?: TrackRow; group: ProcedureGroup }

/** 단계별 상태와 "지금 할 단계"(완료·해당 없음이 아닌 첫 단계)를 계산한다. */
export function trackSummary(kind: RuleKind, profile: Profile, state?: ProcedureTrackState): TrackSummary {
  const group = procedureGroupOf(kind);
  const steps = procedureSteps(profile, group);
  const rows = steps.map((step, index) => {
    const saved = state?.steps[step.id];
    return { step, index, status: saved?.status ?? 'todo', date: saved?.date, note: saved?.note } satisfies TrackRow;
  });
  const counted = rows.filter(r => r.status !== 'skip');
  return { rows, group, total: counted.length, done: counted.filter(r => r.status === 'done').length, current: rows.find(r => r.status !== 'done' && r.status !== 'skip') };
}

/** 문서 단계에서 만들 수 있는 산출물과 절차 단계의 준비 문서를 이어 준다. */
export function stepDocHints(step: ProcedureStep, mode: 'amend' | 'enact'): string[] {
  if (step.docs?.length) {
    if (mode === 'enact' && step.id === 'draft' && step.docs.join(',') === '개정안,대비표,이유서') return ['제정안', '조문체계표', '제정이유·주요내용'];
    return step.docs;
  }
  if (step.id === 'review' || step.id === 'pre') return ['입안점검표', '조문별 권한·근거검토표'];
  if (step.id === 'council' || step.id === 'assembly') return mode === 'enact' ? ['제정안', '제정이유·주요내용'] : ['개정안', '신·구조문대비표', '개정이유·주요내용'];
  if (step.id === 'promulgate' || step.id === 'issue') return ['개정 후 전문(참고)'];
  return [];
}

/** 추진 일정표 문서용 평문 */
export function scheduleLines(kind: RuleKind, profile: Profile, state?: ProcedureTrackState): string[][] {
  const summary = trackSummary(kind, profile, state);
  return summary.rows.map(r => [String(r.index + 1), r.step.name, STEP_STATUS_LABEL[r.status], r.date ? formatKoreanDate(r.date) : '—', [r.step.basis, r.note].filter(Boolean).join(' / ') || '—']);
}
