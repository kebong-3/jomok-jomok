import { describe, expect, it } from 'vitest';
import { derive, hashText, parseRule } from '@/engine';
import { profileById } from '@/config/profiles';
import { finishPilot, pausePilot, pilotCsv, pilotElapsed, PilotRecordSchema, resumePilot, startPilot } from '@/lib/evaluation';
import { migrateLegacyReasonReview, reasonInputHash } from '@/lib/review';
import { scopedImpactOps } from '@/lib/pipeline';
import { buildAmendDocs } from '@/lib/docs';
import { evidenceRecordText, evidenceText } from '@/lib/evidence';
import type { Project } from '@/lib/project';

const fixture = (): Project => ({
  id: 'review-v3', createdAt: 1000, updatedAt: 1000, mode: 'amend', title: '시험 규칙', kind: 'rule', profileId: 'hanbit-city',
  source: { type: 'paste', raw: '시험 규칙\n제1조(목적) 원문을 보존한다.\n제2조(인원) 인원은 30명으로 한다.\n제2조의2(보고) 보고는 5일 이내에 한다.', hash: '' },
  intent: '인원을 20명으로 고친다.', spec: { ops: [], addenda: { effective: 'promulgation' } }, excludedFixes: [], evidence: [], log: [],
});

describe('사용시간과 평가 CSV', () => {
  it('일시정지·재개·종료 시간만 계산하고 백업 후 지난 시간을 더하지 않는다', () => {
    const start = startPilot(1000);
    const paused = pausePilot(start, 61000);
    expect(pilotElapsed(paused, 900000)).toBe(60000);
    const running = resumePilot(paused, 900000);
    const finished = finishPilot(running, 960000);
    expect(pilotElapsed(finished, 10000000)).toBe(120000);
    expect(finished.outcome).toBe('completed');
    expect(finished.status).toBe('finished');
  });
  it('시계가 뒤로 이동해도 음수 작업시간이 되지 않는다', () => {
    expect(pilotElapsed(startPilot(9000), 1000)).toBe(0);
  });
  it('완료 전에는 시간절감률을 만들지 않고 원문·API 연결정보를 CSV에 넣지 않는다', () => {
    const p = fixture();
    p.evaluation = { ...startPilot(1000), baselineMinutes: 10, participantCode: '=1+1', notes: '+HYPERLINK("bad")' };
    const csv = pilotCsv(p, 61000);
    expect(csv).toContain('"\'=1+1"');
    expect(csv).toContain('"\'+HYPERLINK');
    expect(csv).not.toContain('원문을 보존한다');
    expect(csv).not.toContain('"90"');
    p.evaluation = finishPilot(p.evaluation, 61000);
    expect(pilotCsv(p, 900000)).toContain('"90"');
  });
  it('잘못된 평가값과 날짜·연결정보를 허용하지 않는다', () => {
    expect(PilotRecordSchema.safeParse({ ...startPilot(1000), rating: 6 }).success).toBe(false);
    expect(PilotRecordSchema.safeParse({ ...startPilot(1000), startedAt: 9e15 }).success).toBe(false);
    expect(PilotRecordSchema.safeParse({ ...startPilot(1000), apiKey: 'secret' }).success).toBe(false);
  });
});

describe('이유서 확인은 현재 문서 입력에 묶인다', () => {
  it('제목·기관·부칙·근거 변경을 별도로 감지한다', () => {
    const p = fixture(); const original = reasonInputHash(p, 'accepted-ops');
    expect(reasonInputHash({ ...p, title: '새 규칙' }, 'accepted-ops')).not.toBe(original);
    expect(reasonInputHash({ ...p, profileId: 'other' }, 'accepted-ops')).not.toBe(original);
    expect(reasonInputHash({ ...p, spec: { ...p.spec, addenda: { effective: 'date', date: '2027-01-01' } } }, 'accepted-ops')).not.toBe(original);
    expect(reasonInputHash({ ...p, evidence: [{ id: 'EV-U', kind: 'user', label: '자료', text: '원문', via: 'user' }] }, 'accepted-ops')).not.toBe(original);
  });
  it('제정 조문 확인 클릭은 본문을 바꾸지 않으며 실제 수정은 확인 지문을 바꾼다', () => {
    const p = fixture(); p.mode = 'enact';
    p.enact = { title: '자료 지침', outlineConfirmed: true, outline: [{ id: 'a', title: '기준', paragraphs: ['5일 이내에 제출한다.'], provenance: 'ai' }] };
    const original = reasonInputHash(p);
    p.enact.outline[0].provenance = 'ai_accepted';
    expect(reasonInputHash(p)).toBe(original);
    p.enact.outline[0].paragraphs = ['7일 이내에 제출한다.'];
    expect(reasonInputHash(p)).not.toBe(original);
  });
  it('이전 개정 작업의 직접 편집 이유서는 그대로 보존하고 새 지문으로 재확인만 요구한다', () => {
    const p = fixture();
    const oldHash = derive(parseRule(p.source.raw, p.kind), p.spec).specHash;
    p.prose = { reason: '담당자가 직접 보완한 개정이유를 보존한다.', mainPoints: ['직접 편집한 주요내용'], reviewed: true, specHash: oldHash, via: 'live', model: 'previous-model', note: '검토 메모' };
    const migrated = migrateLegacyReasonReview(p, oldHash)!;
    expect(migrated).toEqual({ ...p.prose, specHash: reasonInputHash(p, oldHash), reviewed: false });
    expect(p.prose.reviewed).toBe(true);
    expect(migrateLegacyReasonReview({ ...p, prose: migrated }, oldHash)).toBeUndefined();
  });
  it('이전 제정 작업의 본문이 같을 때만 이유서를 이관하고, 이미 오래된 이유서는 자동 갱신 대상으로 남긴다', () => {
    const p = fixture(); p.mode = 'enact';
    p.enact = { title: '기관 지침', outlineConfirmed: true, outline: [{ id: 'a', title: '기준', paragraphs: ['5일 이내에 제출한다.'], provenance: 'human' }] };
    p.prose = { reason: '직접 작성한 제정이유', mainPoints: ['주요내용'], reviewed: true, specHash: hashText(JSON.stringify(p.enact.outline)), via: 'template' };
    expect(migrateLegacyReasonReview(p)).toMatchObject({ reason: p.prose.reason, reviewed: false, specHash: reasonInputHash(p) });
    p.enact.outline[0].paragraphs = ['10일 이내에 제출한다.'];
    expect(migrateLegacyReasonReview(p)).toBeUndefined();
    expect(migrateLegacyReasonReview({ ...fixture(), prose: { ...p.prose, specHash: 'different-old-fingerprint' } }, 'current-amendment')).toBeUndefined();
  });
});

describe('상위법 영향 검토의 선택 범위', () => {
  it('선택한 조·항만 허용하며 가지조·다른조·새조 삽입을 섞지 않는다', () => {
    const p = fixture();
    p.impact = { version: 1, upperTitle: '시험법', before: { text: '제1조 30명으로 한다.' }, after: { text: '제1조 20명으로 한다.' }, institutionHash: 'a'.repeat(64), analyzedAt: 1, method: 'ai', elapsedMs: 100, rejectedCount: 0,
      candidates: [{ id: 'IC-1', target: '제2조', upperTarget: '제1조', institutionQuote: '인원은 30명으로 한다.', beforeQuote: '30명으로 한다.', afterQuote: '20명으로 한다.', reason: '인원을 일치시킨다.', checks: ['적용 대상을 확인한다.'], source: 'ai' }], selectedIds: ['IC-1'] };
    const r = scopedImpactOps(p, [
      { type: 'replace_text', target: '제2조제1항', find: '30명', replace: '20명' },
      { type: 'replace_text', target: '제2조의2', find: '5일', replace: '7일' },
      { type: 'delete_article', target: '제1조' },
      { type: 'insert_article', after: '제2조', title: '추가', paragraphs: ['내용'] },
    ]);
    expect(r.allowed).toHaveLength(1); expect(r.allowed[0].target).toBe('제2조제1항'); expect(r.rejected).toBe(3);
    p.impact.selectedIds = [];
    expect(scopedImpactOps(p, r.allowed).allowed).toEqual([]);
  });
});

describe('보존 근거의 표시와 출력', () => {
  it('사용자 자료를 공식 조회로 표현하지 않고 시행일·조회시각·지문을 남긴다', () => {
    const p = fixture();
    p.evidence = [{ id: 'EV-U', kind: 'user', label: '사용자 제공 상위법', text: '등록 당시의 문구', via: 'user', effectiveAt: '2026-10-01', fetchedAt: '2026-10-22T03:00:00Z', contentHash: 'b'.repeat(64), partial: true }];
    const record = evidenceRecordText(p.evidence[0]);
    expect(record).toContain('사용자 제공'); expect(record).toContain('2026-10-01'); expect(record).toContain('b'.repeat(64));
    expect(evidenceText(p.evidence)).toContain('일부 발췌');
    const rule = parseRule(p.source.raw, p.kind);
    const checklist = buildAmendDocs(p, rule, derive(rule, p.spec), profileById(p.profileId)).find(d => d.id === 'checklist')!;
    const serialized = JSON.stringify(checklist.blocks);
    expect(serialized).toContain('사용자 제공'); expect(serialized).toContain('조회/등록 시각');
    expect(serialized).not.toContain('법제처 원문');
  });
});
