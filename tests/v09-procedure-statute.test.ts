import { describe, expect, it } from 'vitest';
import { buildAddenda, derive, lintRule, parseRule, type ChangeOp, type SpecOp } from '@/engine';
import { buildAmendDocs, noticeEnd, type DocModel } from '@/lib/docs';
import { draftingChecks } from '@/lib/document-settings';
import { addDays, keyDeadlines, periodEnd, rollToWorkingDay, trackSummary, stepDocHints } from '@/lib/procedure-track';
import { parseProfile, procedureGroupOf, procedureSteps, profileById, PROFILES, serializeProfile, type Profile } from '@/config/profiles';
import { parseProjectBackup, serializeProjectBackup } from '@/lib/project-transfer';
import { sha256, type Project } from '@/lib/project';
import { strFromU8, unzipSync } from 'fflate';
import { toDocx, toHwpx } from '@/lib/export';
import { validateHwpxParts } from '@/lib/hwpx/validate';

const accepted = (change: ChangeOp, id = 'c'): SpecOp => ({ id, change, status: 'accepted', provenance: 'human' });
const text = (doc: DocModel) => doc.blocks.flatMap(b => b.type === 'p' ? [b.runs.map(r => r.text).join('')] : b.type === 'table' ? b.rows.flatMap(r => r.cells.flatMap(c => c.flatMap(p => p.map(x => x.text)))) : []).join('\n');

describe('v0.9 기한 계산 — 초일 불산입·말일 휴일 이월', () => {
  it('말일이 평일이면 그대로, 토·일이면 다음 평일로 넘긴다', () => {
    expect(addDays('2026-11-02', 20)).toBe('2026-11-22'); // 일요일
    expect(periodEnd('2026-11-02', 20)).toEqual({ date: '2026-11-23', rolled: true });
    expect(periodEnd('2026-11-04', 20)).toEqual({ date: '2026-11-24', rolled: false });
  });
  it('관공서 공휴일(설 연휴·대체공휴일)도 넘긴다', () => {
    expect(rollToWorkingDay('2026-02-16')).toEqual({ date: '2026-02-19', rolled: true });
    expect(rollToWorkingDay('2026-10-03').date).toBe('2026-10-06'); // 개천절(토) → 대체공휴일(월) → 화
  });
  it('기존 예고문 계산(noticeEnd)도 같은 규칙을 따른다', () => {
    const end = noticeEnd(new Date(2026, 10, 2), 20);
    expect([end.getFullYear(), end.getMonth() + 1, end.getDate()]).toEqual([2026, 11, 23]);
  });
  it('조례는 의결·이송일로 이송·공포·보고 기한을, 규칙은 공포 예정일 15일 전 보고를 계산한다', () => {
    const local = profileById('hanbit-city');
    const ord = keyDeadlines('ordinance', local, { noticeStart: '2026-11-04', resolved: '2026-12-10', transferred: '2026-12-14' });
    expect(ord.map(d => d.id)).toEqual(['notice-end', 'transfer', 'promulgate', 'report']);
    expect(ord.find(d => d.id === 'promulgate')!.date).toBe('2027-01-04'); // 12.14 + 20 = 1.3(일) → 1.4
    expect(ord.find(d => d.id === 'report')!.basis).toContain('제35조');
    const rule = keyDeadlines('rule', local, { promulgation: '2027-01-20' });
    expect(rule).toEqual([expect.objectContaining({ id: 'report', date: '2027-01-05', kind: 'before' })]);
  });
  it('국가 법령의 입법예고는 40일 이상으로 계산한다', () => {
    const ministry = profileById('hanbit-ministry');
    const [notice] = keyDeadlines('decree', ministry, { noticeStart: '2026-11-04' });
    expect(notice.label).toContain('40일');
    expect(notice.basis).toContain('40일');
  });
});

describe('v0.9 절차·일정 진행판', () => {
  it('완료·해당 없음을 제외한 첫 단계를 지금 할 일로 고르고 진행률을 계산한다', () => {
    const prof = profileById('hanbit-city');
    const summary = trackSummary('ordinance', prof, { steps: { draft: { status: 'done' }, pre: { status: 'skip' }, notice: { status: 'doing', date: '2026-11-04' } }, dates: {} });
    expect(summary.current?.step.id).toBe('notice');
    expect(summary.total).toBe(procedureSteps(prof, 'ordinance').length - 1);
    expect(summary.done).toBe(1);
  });
  it('단계별 준비 문서를 제정·개정에 맞게 안내한다', () => {
    const [draft] = procedureSteps(profileById('hanbit-city'), 'ordinance');
    expect(stepDocHints(draft, 'enact')).toEqual(['제정안', '조문체계표', '제정이유·주요내용']);
    expect(stepDocHints(draft, 'amend')).toEqual(['개정안', '대비표', '이유서']);
  });
  it('진행 기록은 작업 보관파일로 그대로 옮겨진다', async () => {
    const raw = '시험 조례\n제1조(목적) 이 조례는 시험을 목적으로 한다.';
    const p: Project = { id: 'track-1', createdAt: 1, updatedAt: 2, mode: 'amend', title: '시험 조례', kind: 'ordinance', profileId: 'hanbit-city', source: { type: 'paste', raw, hash: await sha256(raw) }, intent: '시험', spec: { ops: [], addenda: { effective: 'promulgation' } }, excludedFixes: [], evidence: [], log: [],
      procedureTrack: { steps: { draft: { status: 'done', date: '2026-10-27', note: '초안 완료' } }, dates: { noticeStart: '2026-11-04' } } };
    const prepared = await parseProjectBackup(await serializeProjectBackup(p));
    expect(prepared.project.procedureTrack).toEqual(p.procedureTrack);
  });
  it('기록이 있으면 문서 세트에 추진 일정표가 포함된다', () => {
    const raw = '시험 조례\n제1조(목적) 이 조례는 시험을 목적으로 한다.';
    const before = parseRule(raw, 'ordinance');
    const p: Project = { id: 'track-2', createdAt: 1, updatedAt: 2, mode: 'amend', title: '시험 조례', kind: 'ordinance', profileId: 'hanbit-city', source: { type: 'paste', raw, hash: '' }, intent: '시험', spec: { ops: [], addenda: { effective: 'promulgation' } }, excludedFixes: [], evidence: [], log: [],
      procedureTrack: { steps: { draft: { status: 'done' } }, dates: {} } };
    const docs = buildAmendDocs(p, before, derive(before, p.spec), PROFILES[0]);
    const schedule = docs.find(d => d.id === 'schedule');
    expect(schedule).toBeDefined();
    expect(text(schedule!)).toContain('완료');
  });
  it('추진 일정표도 HWPX 구조 검사와 DOCX 생성을 통과한다', async () => {
    const raw = '시험 조례\n제1조(목적) 이 조례는 시험을 목적으로 한다.';
    const before = parseRule(raw, 'ordinance');
    const p: Project = { id: 'track-3', createdAt: 1, updatedAt: 2, mode: 'amend', title: '시험 조례', kind: 'ordinance', profileId: 'hanbit-city', source: { type: 'paste', raw, hash: '' }, intent: '시험', spec: { ops: [], addenda: { effective: 'promulgation' } }, excludedFixes: [], evidence: [], log: [],
      procedureTrack: { steps: { draft: { status: 'done', date: '2026-10-27', note: '메모 & <확인>' } }, dates: {} } };
    const schedule = buildAmendDocs(p, before, derive(before, p.spec), PROFILES[0]).find(d => d.id === 'schedule')!;
    const parts = Object.fromEntries(Object.entries(unzipSync(toHwpx(schedule))).map(([name, content]) => [name, strFromU8(content)]));
    expect(() => validateHwpxParts(parts)).not.toThrow();
    expect((await toDocx(schedule)).byteLength).toBeGreaterThan(1000);
  });
});

describe('v0.9 국가 법령(법률·대통령령·총리령·부령) 범위 확장', () => {
  const source = '○○법 시행령\n제1조(목적) 이 영은 「○○법」에서 위임된 사항을 규정함을 목적으로 한다.\n제2조(신청) ① 신청은 서면으로 한다.\n② 신청 기한은 10일로 한다.';
  it('제명·개정지시문·부칙이 「법령 입안·심사 기준」 형식을 따른다', () => {
    const before = parseRule(source, 'decree');
    const spec = { ops: [accepted({ op: 'replace_text', target: { kind: 'unit', ref: { art: 2, para: 2 } }, find: '10일', replace: '14일' })], addenda: { effective: 'promulgation' as const } };
    const d = derive(before, spec);
    expect(d.amendPlain).toContain('○○법 시행령 일부개정령안');
    expect(d.amendPlain).toContain('○○법 시행령 일부를 다음과 같이 개정한다.');
    expect(d.amendPlain).toContain('이 영은 공포한 날부터 시행한다.');
    expect(buildAddenda('act', { effective: 'promulgation' })).toEqual(['이 법은 공포한 날부터 시행한다.']);
    expect(buildAddenda('ministry_rule', { effective: 'months', months: 3 })).toEqual(['이 규칙은 공포 후 3개월이 경과한 날부터 시행한다.']);
  });
  it('문서 세트는 법령 서식 출처·입법예고·법령 체크리스트를 사용한다', () => {
    const before = parseRule(source, 'decree');
    const p: Project = { id: 'statute', createdAt: 1, updatedAt: 1, mode: 'amend', title: before.title, kind: 'decree', profileId: 'hanbit-ministry', source: { type: 'paste', raw: source, hash: '' }, intent: '기한 연장', spec: { ops: [], addenda: { effective: 'promulgation' } }, excludedFixes: [], evidence: [], log: [] };
    const docs = buildAmendDocs(p, before, derive(before, p.spec), profileById('hanbit-ministry'));
    expect(docs.find(d => d.id === 'amend')!.formSource?.url).toContain('legislation-2026');
    expect(docs.find(d => d.id === 'notice')!.name).toBe('입법예고문');
    expect(draftingChecks('decree').every(c => c.id.startsWith('law-'))).toBe(true);
    expect(procedureGroupOf('act')).toBe('law');
  });
  it('law 절차가 없는 이전 기관 설정 파일도 불러오고 기본 법령 절차를 쓴다', () => {
    const legacy = structuredClone(PROFILES[0]) as Profile;
    delete (legacy.procedures as Partial<Profile['procedures']>).law;
    const parsed = parseProfile(serializeProfile(legacy));
    expect(procedureSteps(parsed, 'law').some(step => step.days === 40)).toBe(true);
  });
});

describe('v0.9 점검 메시지 조사', () => {
  it('항 인용 메시지는 받침에 맞는 조사를 쓴다', () => {
    const before = parseRule('시험 규칙\n제1조(기준) ① 첫째.\n② 둘째.\n제2조(준용) 제1조제2항을 준용한다.');
    const d = derive(before, { ops: [accepted({ op: 'delete_paragraph', target: { art: 1, para: 2 } })], addenda: { effective: 'promulgation' } });
    const issue = d.lint.find(i => i.code === '인용-02');
    expect(issue?.message).toContain('"제1조제2항"은 삭제된 항');
    expect(lintRule(before).every(i => !/"[^"]*항"는/.test(i.message))).toBe(true);
  });
});
