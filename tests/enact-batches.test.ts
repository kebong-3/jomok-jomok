import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AiUnavailable, callRole } from '@/lib/ai';
import { initialLog, runEnactDraft, validateDraftBatch, type DraftProgress } from '@/lib/pipeline';
import type { Project } from '@/lib/project';

vi.mock('@/lib/ai', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/ai')>(), callRole: vi.fn() }));
const ai = vi.mocked(callRole);
function fixture(count = 9): Project {
  return {
    id: 'batch-test', createdAt: 0, updatedAt: 0, mode: 'enact', kind: 'guideline', title: '검증용 지침', purpose: '내부 업무 절차를 정한다.', profileId: 'hanbit-city',
    source: { type: 'paste', raw: '', hash: '' }, intent: '', spec: { ops: [], addenda: { effective: 'promulgation' } }, excludedFixes: [], evidence: [], log: initialLog('enact'),
    enact: { title: '검증용 지침', outlineConfirmed: true, outline: Array.from({ length: count }, (_, i) => ({ id: `a${i + 1}`, title: `항목${i + 1}`, summary: `${i + 1}번째 업무`, paragraphs: [], provenance: 'ai' })) },
  };
}
function reply(vars: Record<string, string>) {
  const targets = JSON.parse(vars.targets) as { articleNo: number; title: string }[];
  return { data: { articles: targets.map(t => ({ ...t, paragraphs: [`담당자는 ${t.articleNo}번째 업무를 처리한다.`] })) }, via: 'live' as const, model: 'mock', modelLabel: '검증 모델', ms: 100,
    knowledge: { role: 'enact_draft', query: '검증', retrievedAt: new Date(0).toISOString(), version: 'test', method: 'hybrid-lexical' as const, status: 'empty' as const, citations: [] } };
}
beforeEach(() => { ai.mockReset(); ai.mockImplementation(async (_role, vars) => reply(vars)); });

describe('조문별 보관과 이어 쓰기', () => {
  it('9개 조문을 3개씩 작성하고 앞서 쓴 조문·전체 목차를 다음 요청 문맥으로 유지한다', async () => {
    let project = fixture(); const checkpoints: number[] = []; const progress: DraftProgress[] = [];
    await runEnactDraft(project, fn => { project = fn(project); checkpoints.push(project.enact!.outline.filter(a => a.paragraphs.length).length); }, { onProgress: p => progress.push(p) });
    expect(ai).toHaveBeenCalledTimes(3);
    expect(ai.mock.calls.map(([, vars]) => JSON.parse(vars.targets).map((a: { articleNo: number }) => a.articleNo))).toEqual([[1, 2, 3], [4, 5, 6], [7, 8, 9]]);
    expect(ai.mock.calls[0][1].previous).toBe('');
    expect(ai.mock.calls[1][1].previous).toContain('제1조(항목1) 담당자는 1번째');
    expect(ai.mock.calls[2][1].previous).toContain('제6조(항목6) 담당자는 6번째');
    expect(ai.mock.calls.every(([, vars]) => vars.outline.includes('제9조(항목9)'))).toBe(true);
    expect(checkpoints).toContain(3); expect(checkpoints).toContain(6); expect(checkpoints).toContain(9);
    expect(progress.at(-1)?.completed).toBe(9);
    expect(project.log.find(l => l.step === 'link')?.status).toBe('ok');
    expect(project.log.find(l => l.step === 'docs')?.status).toBe('wait');
    expect(project.knowledge?.map(record => record.role)).toEqual(['enact_draft:1,2,3', 'enact_draft:4,5,6', 'enact_draft:7,8,9']);
  });

  it('두 번째 묶음 실패 시 처음 3개를 보존하고 다시 실행할 때 남은 6개만 작성한다', async () => {
    let project = fixture();
    ai.mockImplementationOnce(async (_role, vars) => reply(vars)).mockRejectedValueOnce(new Error('검증용 연결 중단'));
    await runEnactDraft(project, fn => { project = fn(project); });
    const preserved = project.enact!.outline.slice(0, 3).map(a => a.paragraphs.join(''));
    expect(project.enact!.outline.filter(a => a.paragraphs.length)).toHaveLength(3);
    expect(project.log.find(l => l.step === 'lint')?.status).toBe('wait');
    expect(project.log.find(l => l.step === 'docs')?.status).toBe('wait');
    ai.mockClear();
    await runEnactDraft(project, fn => { project = fn(project); });
    expect(ai).toHaveBeenCalledTimes(2);
    expect(JSON.parse(ai.mock.calls[0][1].targets)[0].articleNo).toBe(4);
    expect(project.enact!.outline.slice(0, 3).map(a => a.paragraphs.join(''))).toEqual(preserved);
    expect(project.enact!.outline.every(a => a.paragraphs.length)).toBe(true);
    expect(project.planError).toBeUndefined();
  });

  it('첫 묶음의 실제 저장 완료를 기다린 뒤 다음 AI 요청을 보낸다', async () => {
    let project = fixture(6);
    let acknowledge: ((saved: boolean) => void) | undefined;
    const task = runEnactDraft(project, fn => {
      const before = project.enact!.outline.filter(a => a.paragraphs.length).length;
      project = fn(project);
      const after = project.enact!.outline.filter(a => a.paragraphs.length).length;
      if (before === 0 && after === 3) return new Promise<boolean>(resolve => { acknowledge = resolve; });
      return Promise.resolve(true);
    });
    await vi.waitFor(() => expect(acknowledge).toBeTypeOf('function'));
    expect(ai).toHaveBeenCalledTimes(1);
    expect(project.enact!.outline.filter(a => a.paragraphs.length)).toHaveLength(3);
    acknowledge!(true);
    await task;
    expect(ai).toHaveBeenCalledTimes(2);
    expect(project.enact!.outline.every(a => a.paragraphs.length)).toBe(true);
  });

  it('저장 실패 시 이번 본문은 화면에 유지하되 다음 유료 요청을 멈추고 보관 안내를 표시한다', async () => {
    let project = fixture(9);
    await runEnactDraft(project, fn => {
      const before = project.enact!.outline.filter(a => a.paragraphs.length).length;
      project = fn(project);
      const after = project.enact!.outline.filter(a => a.paragraphs.length).length;
      return Promise.resolve(!(after > before));
    });
    expect(ai).toHaveBeenCalledTimes(1);
    expect(project.enact!.outline.filter(a => a.paragraphs.length)).toHaveLength(3);
    expect(project.planError).toContain('기기 저장을 확인하지 못해');
    expect(project.planError).toContain('작업 보관');
    expect(project.planError).toContain('새로고침');
    expect(project.log.find(l => l.step === 'link')?.status).toBe('failed');
    expect(project.log.find(l => l.step === 'docs')?.status).toBe('wait');
  });

  it('중단 신호 뒤에는 다음 요청을 보내지 않고 저장한 본문과 직접 쓴 조문을 유지한다', async () => {
    let project = fixture(5); const controller = new AbortController();
    project.enact!.outline[1] = { ...project.enact!.outline[1], paragraphs: ['담당자가 직접 확정한 내용이다.'], provenance: 'human' };
    await runEnactDraft(project, fn => { project = fn(project); }, { signal: controller.signal, onProgress: progress => { if (progress.completed === 4) controller.abort(); } });
    expect(ai).toHaveBeenCalledTimes(1);
    expect(project.enact!.outline[1].paragraphs).toEqual(['담당자가 직접 확정한 내용이다.']);
    expect(project.enact!.outline[1].provenance).toBe('human');
    expect(project.enact!.outline[4].paragraphs).toEqual([]);
    expect(project.log.find(l => l.step === 'link')?.status).toBe('skipped');
    expect(project.planError).toBeUndefined();
  });

  it('틀린 조 번호·제목 또는 빈 본문을 위치 순서로 끼워 맞추지 않는다', () => {
    const request = fixture(2).enact!.outline.map((article, index) => ({ article, index }));
    for (const articles of [
      [{ articleNo: 2, title: '항목1', paragraphs: ['내용'] }, { articleNo: 1, title: '항목2', paragraphs: ['내용'] }],
      [{ title: '다른 제목', paragraphs: ['내용'] }, { title: '항목2', paragraphs: ['내용'] }],
      [{ title: '항목1', paragraphs: [] }, { title: '항목2', paragraphs: ['내용'] }],
      [{ title: '항목1', paragraphs: ['  '] }, { title: '항목2', paragraphs: ['내용'] }],
      [{ title: '항목1', paragraphs: ['내용'] }],
    ]) expect(() => validateDraftBatch(articles, request)).toThrow(AiUnavailable);
  });

  it('다른 작업으로 전환된 뒤 늦게 도착한 초안을 새 작업에 적용하지 않는다', async () => {
    let project = fixture(3); const old = project;
    ai.mockImplementationOnce(async (_role, vars) => { project = { ...fixture(3), id: 'another-project' }; return reply(vars); });
    await runEnactDraft(old, fn => { project = fn(project); });
    expect(project.id).toBe('another-project');
    expect(project.enact!.outline.every(a => a.paragraphs.length === 0)).toBe(true);
    expect(project.log.every(l => l.status === 'wait')).toBe(true);
  });
});
