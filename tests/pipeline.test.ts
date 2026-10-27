import { beforeEach, describe, expect, it, vi } from 'vitest';
import { derive, parseRule } from '@/engine';
import { callRole } from '@/lib/ai';
import { runReason } from '@/lib/pipeline';
import type { Project } from '@/lib/project';

vi.mock('@/lib/ai', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/ai')>(), callRole: vi.fn() }));
const ai = vi.mocked(callRole);
const source = '시험 규칙\n제1조(제출) ① 신청한다.\n② 결과를 통지한다.\n제2조(준용) 제1조제2항에 따른다.';
const before = parseRule(source);
const fixture = (): Project => ({
  id: 'reason-test', createdAt: 0, updatedAt: 0, mode: 'amend', title: '시험 규칙', kind: 'rule', profileId: 'hanbit-city',
  source: { type: 'paste', raw: source, hash: '' }, intent: '첫째 항 다음에 전자우편 제출 항을 넣어 주세요.',
  spec: { ops: [{ id: 'insert', status: 'accepted', provenance: 'human', change: { op: 'insert_paragraph', art: { art: 1 }, position: 2, text: '전자우편으로 제출할 수 있다.' } }], addenda: { effective: 'promulgation' } },
  excludedFixes: [], evidence: [], log: [],
});

describe('개정이유 입력과 검토 상태', () => {
  beforeEach(() => { ai.mockReset(); });

  it('사용자가 제외한 인용 정정을 이유서 입력에 다시 넣지 않는다', async () => {
    const p = fixture();
    const d = derive(before, p.spec);
    expect(d.fixes).toHaveLength(1);
    p.excludedFixes = d.fixes.map((f) => f.id);
    ai.mockResolvedValue({ data: { reason: '제출 방법을 정비하려는 것임.', mainPoints: ['전자우편 제출을 허용함.'] }, via: 'live', ms: 10 });
    await runReason(p, before);
    const vars = ai.mock.calls[0][1];
    expect(vars.changes).toContain('신설');
    expect(vars.changes).not.toContain('제2조 중');
  });

  it('AI 실패 시 명령형 입력을 이유서로 확정하지 않고 직접 작성을 요청한다', async () => {
    ai.mockRejectedValue(new Error('응답 시간 초과'));
    const result = await runReason(fixture(), before);
    expect(result.via).toBe('template');
    expect(result.reason).toBe('');
    expect(result.mainPoints.join(' ')).toContain('신설');
    expect(result.mainPoints.join(' ')).not.toContain('주세요');
    expect(result.note).toContain('응답 시간 초과');
    expect(result.note).toContain('직접 작성');
  });
});

const enactFixture = (): Project => ({
  ...fixture(), mode: 'enact', title: '시험 자료공유 지침', kind: 'guideline',
  purpose: '3개 조만 만들고 신구대비표는 빼 주세요. 저는 담당자입니다.',
  enact: { title: '시험 자료공유 지침', outlineConfirmed: true, outline: [
    { id: 'e1', title: '목적', summary: '이전 목차 요약은 외부 주민 지원', paragraphs: ['이 지침은 내부 자료의 공유 절차를 정함을 목적으로 한다.'], provenance: 'ai_accepted' },
    { id: 'e2', title: '제출', summary: '오래된 제출기한 7일', paragraphs: ['담당자는 자료를 요청일부터 5일 이내에 제출하여야 한다.'], provenance: 'human' },
  ] },
});

describe('제정이유는 현재 제정안 본문에서 작성', () => {
  beforeEach(() => { ai.mockReset(); });
  it('제정 mode와 현재 조문을 보내며 사용자 명령문과 오래된 체계 요약은 보내지 않는다', async () => {
    const p = enactFixture();
    const { enactRule } = await import('@/lib/pipeline');
    ai.mockResolvedValue({ data: { reason: '자료 공유의 절차를 정하려는 것임.', mainPoints: ['자료 제출기한을 5일로 정함(안 제2조).'] }, via: 'live', ms: 20 });
    const result = await runReason(p, enactRule(p));
    const [role, vars, options] = ai.mock.calls[0];
    expect(role).toBe('reason'); expect(vars.mode).toBe('제정');
    expect(vars.changes).toContain('제2조(제출)'); expect(vars.changes).toContain('5일 이내');
    expect(JSON.stringify(vars)).not.toMatch(/3개 조만|담당자입니다|외부 주민|7일/);
    expect(options).toEqual({ allowCassette: false }); expect(result.via).toBe('live');
  });
  it('제정 이유서 실패 시 빈 이유와 현재 본문을 돌려주고 명령형 요청을 문서로 복사하지 않는다', async () => {
    const p = enactFixture();
    const { enactRule } = await import('@/lib/pipeline');
    ai.mockRejectedValue(new Error('AI 응답 시간 초과'));
    const result = await runReason(p, enactRule(p));
    expect(result.reason).toBe(''); expect(result.via).toBe('template');
    expect(result.mainPoints.join(' ')).toContain('5일 이내'); expect(result.mainPoints.join(' ')).toContain('안 제2조');
    expect(JSON.stringify(result)).not.toMatch(/3개 조만|담당자입니다|외부 주민|7일/);
    expect(result.note).toContain('제정이유를 직접 작성');
  });
  it('체계 미확정 또는 내용이 빈 조문은 AI 이유서 호출을 시작하지 않는다', async () => {
    const { enactRule, enactReasonReady } = await import('@/lib/pipeline');
    const p = enactFixture(); p.enact!.outlineConfirmed = false;
    expect(enactReasonReady(p)).toBe(false);
    await runReason(p, enactRule(p));
    p.enact!.outlineConfirmed = true; p.enact!.outline[1].paragraphs = ['  '];
    expect(enactReasonReady(p)).toBe(false);
    await runReason(p, enactRule(p));
    expect(ai).not.toHaveBeenCalled();
  });
});
