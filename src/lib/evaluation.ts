import { z } from 'zod';
import type { Project } from './project';

/** Opt-in, local measurements. These are user reports, not verified pilot results. */
export const PilotRecordSchema = z.object({
  version: z.literal(1),
  status: z.enum(['running', 'paused', 'finished']),
  startedAt: z.number().int().nonnegative().max(8_640_000_000_000_000),
  runningSince: z.number().int().nonnegative().max(8_640_000_000_000_000).optional(),
  activeMs: z.number().nonnegative().max(365 * 24 * 60 * 60 * 1000),
  finishedAt: z.number().int().nonnegative().max(8_640_000_000_000_000).optional(),
  participantCode: z.string().max(40),
  caseCode: z.string().max(80),
  baselineMinutes: z.number().positive().max(100000).optional(),
  manualCorrections: z.number().int().min(0).max(100000),
  remainingErrors: z.number().int().min(0).max(100000),
  outcome: z.enum(['in_progress', 'completed', 'incomplete']),
  rating: z.number().int().min(1).max(5).optional(),
  notes: z.string().max(2000),
  exportCount: z.number().int().nonnegative().max(100000),
  firstExportAt: z.number().int().nonnegative().max(8_640_000_000_000_000).optional(),
}).strict();
export type PilotRecord = z.infer<typeof PilotRecordSchema>;

export function startPilot(now = Date.now()): PilotRecord {
  return { version: 1, status: 'running', startedAt: now, runningSince: now, activeMs: 0,
    participantCode: '', caseCode: '', manualCorrections: 0, remainingErrors: 0,
    outcome: 'in_progress', notes: '', exportCount: 0 };
}

export function pilotElapsed(record: PilotRecord, now = Date.now()): number {
  const delta = record.status === 'running' && record.runningSince !== undefined ? Math.max(0, now - record.runningSince) : 0;
  return Math.min(365 * 24 * 60 * 60 * 1000, record.activeMs + delta);
}

/** Freeze at the time of export, so importing an archive cannot add idle days. */
export function pausePilot(record: PilotRecord, now = Date.now()): PilotRecord {
  return { ...record, activeMs: pilotElapsed(record, now), runningSince: undefined,
    status: record.status === 'finished' ? 'finished' : 'paused' };
}

export function resumePilot(record: PilotRecord, now = Date.now()): PilotRecord {
  if (record.status === 'running') return record;
  return { ...record, status: 'running', runningSince: now, finishedAt: undefined, outcome: 'in_progress' };
}

export function finishPilot(record: PilotRecord, now = Date.now()): PilotRecord {
  return { ...pausePilot(record, now), status: 'finished', finishedAt: now,
    outcome: record.outcome === 'in_progress' ? 'completed' : record.outcome };
}

/** CSV cells are quoted and formula-like user input is neutralized. */
function csvCell(value: string | number): string {
  const raw = String(value);
  const safe = /^[\s]*[=+\-@]/.test(raw) ? `'${raw}` : raw;
  return `"${safe.replace(/"/g, '""')}"`;
}

export function pilotCsv(project: Project, now = Date.now()): string {
  const r = project.evaluation;
  if (!r) throw new Error('사용 기록을 먼저 시작해 주세요.');
  const minutes = Math.round(pilotElapsed(r, now) / 600) / 100;
  const saved = r.status === 'finished' && r.outcome === 'completed' && r.baselineMinutes
    ? Math.round((1 - minutes / r.baselineMinutes) * 1000) / 10 : '';
  const header = ['기록버전', '참여자코드', '과제코드', '작업종류', '기록상태', '결과', '기록시작', '기록종료', '경과분(일시정지제외)', '기존방식소요분(사용자입력)', '시간변화율%(조건부)', '수동수정건수(사용자입력)', '남은오류(사용자입력)', '만족도(1~5)', '문서세트다운로드횟수', '계획모델', '실제모델', 'AI방식', '메모(사용자입력)'];
  const values: (string | number)[] = [1, r.participantCode, r.caseCode, project.mode, r.status, r.outcome,
    new Date(r.startedAt).toISOString(), r.finishedAt ? new Date(r.finishedAt).toISOString() : '', minutes,
    r.baselineMinutes ?? '', saved, r.manualCorrections, r.remainingErrors, r.rating ?? '', r.exportCount,
    project.planModelId ?? '', project.planTrace?.actualModel ?? '', project.planVia ?? '', r.notes];
  return '\uFEFF' + [header, values].map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
