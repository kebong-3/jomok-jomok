import { describe, expect, it } from 'vitest';
import { assistModeFor, localIntent, startBrief, suggestedQuestions, typingFrames, workBrief, workReaction, type WorkSnapshot } from '@/lib/companion';

const base: WorkSnapshot = {
  mode: 'amend', method: 'partial', stage: 'articles', title: '한빛시 공무원 여비 지급 규칙', kindLabel: '규칙', running: false, viaExample: false,
  proposed: 0, accepted: 0, autoFixes: 0, must: 0, check: 0, outlineReady: false, enactArticles: 0, enactMissing: 0, enactUnreviewed: 0,
  authorityPending: 0, reasonReady: false, noticeDeadlineSet: false, trackDone: 0, trackTotal: 6,
};

describe('조목이 동행 도우미 — 상태를 말로 풀기', () => {
  it('작업 중에는 생각하는 표정과 현재 단계를 말한다', () => {
    const b = workBrief({ ...base, running: true, runningLabel: '고칠 곳 정하기' });
    expect(b.mood).toBe('thinking');
    expect(b.lines.join(' ')).toContain('고칠 곳 정하기');
    expect(b.actions).toEqual([]);
  });
  it('제안이 있으면 첫 제안과 근거를 소개하고 일괄 수락은 확인 단계로 둔다', () => {
    const b = workBrief({ ...base, proposed: 3, firstProposal: { label: '제5조에 제2항 새로 넣기', why: '상위법이 허용합니다.' }, viaExample: true });
    expect(b.lines[0]).toContain('3건');
    expect(b.lines[0]).toContain('예시 응답');
    expect(b.lines[1]).toContain('제5조에 제2항 새로 넣기');
    expect(b.actions.map(a => a.id)).toContain('accept-all');
  });
  it('반영 후 반드시 고칠 곳이 남으면 점검으로 안내한다', () => {
    const b = workBrief({ ...base, accepted: 3, autoFixes: 3, must: 2 });
    expect(b.mood).toBe('care');
    expect(b.lines.join(' ')).toContain('3곳');
    expect(b.actions[0]).toMatchObject({ id: 'go-lint', primary: true });
  });
  it('문서 단계에서 예고 기한이 비어 있으면 절차·일정으로 이어 준다', () => {
    const b = workBrief({ ...base, stage: 'docs', reasonReady: true });
    expect(b.lines.join(' ')).toContain('의견제출 기한');
    expect(b.actions[0].id).toBe('go-procedure');
  });
  it('절차 단계는 지금 단계와 다가오는 기한을 말한다', () => {
    const b = workBrief({ ...base, stage: 'procedure', trackDone: 2, currentStep: '입법예고', nextDeadline: { label: '입법예고 20일', date: '2026. 11. 24.(화)' } });
    expect(b.lines.join(' ')).toContain('입법예고');
    expect(b.lines.join(' ')).toContain('2026. 11. 24.(화)');
    expect(b.status).toBe('2/6 완료');
  });
});

describe('조목이 동행 도우미 — 순간 반응', () => {
  it('수락이 늘면 축하하고 함께 고친 인용 수를 알려 준다', () => {
    const r = workReaction({ ...base, proposed: 3 }, { ...base, proposed: 0, accepted: 3, autoFixes: 3 });
    expect(r?.mood).toBe('celebrate');
    expect(r?.lines.join(' ')).toContain('인용 3곳');
  });
  it('AI 작업이 끝나면 결과를 알리고, 단계가 바뀐 경우에는 반응하지 않는다', () => {
    const done = workReaction({ ...base, running: true }, { ...base, proposed: 2, firstProposal: { label: '제3조 수정' } });
    expect(done?.lines[0]).toContain('2건');
    expect(done?.lines[1]).toBe('첫 번째는 ‘제3조 수정’이에요.');
    expect(workReaction({ ...base, stage: 'lint' }, { ...base, accepted: 2 })).toBeNull();
  });
  it('절차 단계를 완료하면 다음 단계를 알려 준다', () => {
    const r = workReaction({ ...base, stage: 'procedure', trackDone: 0, currentStep: '입안' }, { ...base, stage: 'procedure', trackDone: 1, currentStep: '입법예고' });
    expect(r?.lines[0]).toBe('한 단계 끝! 다음은 ‘입법예고’예요.');
  });
});

describe('조목이 동행 도우미 — 시작 화면과 대화', () => {
  it('시작 화면은 입력 순서대로 다음 칸을 안내한다', () => {
    const s = { mode: 'amend' as const, sample: false, hasSource: false, articles: 0, annexes: 0, sourceIssues: 0, sourceConfirmed: false, intentLength: 0, purposeLength: 0, kindLabel: '조례', statuteMismatch: false, peers: 0 };
    expect(startBrief(s).actions[0].id).toBe('focus-source');
    expect(startBrief({ ...s, hasSource: true, articles: 13, annexes: 3, title: '여비 규칙' }).lines[0]).toBe('「여비 규칙」 13개 조, 별표·서식 3개를 읽었어요.');
    expect(startBrief({ ...s, hasSource: true, articles: 13, intentLength: 20 }).actions[0].id).toBe('start-work');
    expect(startBrief({ ...s, mode: 'enact', kindLabel: '규칙' }).lines[1]).toContain('규칙으로');
    expect(startBrief({ ...s, statuteMismatch: true, kindLabel: '대통령령' }).lines[0]).toBe('대통령령을 고르셨네요.');
  });
  it('화면 이동 요청은 AI를 부르지 않고 바로 처리한다', () => {
    expect(localIntent('대비표 보여줘', 'articles')?.action).toBe('go-docs');
    expect(localIntent('예고 마감일 언제까지야?', 'docs')?.action).toBe('go-procedure');
    expect(localIntent('남은 제안 모두 수락해줘', 'articles')?.action).toBe('accept-all');
    expect(localIntent('이 개정에 경과조치가 필요할까요?', 'articles')).toBeNull();
    expect(localIntent('대비표 보여줘', 'start')).toBeNull();
  });
  it('질문 의도에 따라 설명·검토·쉬운 문장 방식을 고른다', () => {
    expect(assistModeFor('이 조문 쉽게 바꿔줘', true)).toBe('plain_language');
    expect(assistModeFor('이 초안 검토해 줘', true)).toBe('review');
    expect(assistModeFor('이 초안 검토해 줘', false)).toBe('explain');
    expect(suggestedQuestions('lint', 'amend', '조례')).toHaveLength(3);
    expect(typingFrames('조목이')).toEqual(['조', '목', '이']);
  });
});
