import { afterEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { strFromU8, unzipSync } from 'fflate';
import { derive, parseRule } from '@/engine';
import { profileById } from '@/config/profiles';
import { buildAmendDocs, buildEnactDocs, type DocModel } from '@/lib/docs';
import { buildDownloadSet, createDownloadFile, download, startDownload, toClipboardHtml, toDocx, toHwpx } from '@/lib/export';
import { documentForExport, documentReadiness, preparedDownloadVersion, uniqueExportNotices } from '@/lib/export-readiness';
import { reasonInputHash } from '@/lib/review';
import { startPilot } from '@/lib/evaluation';
import type { Project } from '@/lib/project';
import { Ctx, type WorkCtx } from '@/components/work/ctx';
import DocsTab from '@/components/work/DocsTab';

const profile = profileById('seogu');
const flatten = (doc: DocModel) => doc.blocks.map(block => block.type === 'p' ? block.runs.map(run => run.text).join('') : block.rows.map(row => row.cells.flat(2).map(run => run.text).join('')).join('\n')).join('\n');
const entry = (bytes: Uint8Array, path: string) => strFromU8(unzipSync(bytes)[path]);

function enactFixture(): Project {
  return {
    id: 'export-draft', title: '가상 자료공유 조례', mode: 'enact', kind: 'ordinance', profileId: 'seogu', createdAt: 0, updatedAt: 0,
    source: { type: 'none', raw: '', hash: '' }, intent: '', purpose: '가상 검증', spec: { ops: [], addenda: { effective: 'promulgation' } }, excludedFixes: [], evidence: [], log: [],
    enact: { title: '가상 자료공유 조례', outlineConfirmed: true, outline: [
      { id: 'purpose', title: '목적', paragraphs: ['이 조례는 자료 공유의 절차를 정함을 목적으로 한다.'], provenance: 'ai' },
      { id: 'method', title: '방법', paragraphs: ['담당자는 전자문서로 자료를 공유할 수 있다.'], provenance: 'ai' },
      { id: 'contact', title: '담당부서', paragraphs: [], provenance: 'ai' },
    ] },
  };
}

function enactDocs(project: Project) {
  const rule = parseRule('가상 자료공유 조례\n제1조(목적) 이 조례는 자료 공유의 절차를 정함을 목적으로 한다.\n제2조(방법) 담당자는 전자문서로 자료를 공유할 수 있다.\n제3조(담당부서)', project.kind);
  return { rule, docs: buildEnactDocs(project, rule, [], profile, reasonInputHash(project)) };
}

describe('검토용 문서 다운로드', () => {
  it('이유서 미작성·조문 미확인 상태에서도 보이는 예고문과 점검표를 받을 수 있다', () => {
    const project = enactFixture();
    const { docs } = enactDocs(project);
    for (const id of ['notice', 'checklist'] as const) {
      const doc = docs.find(item => item.id === id)!;
      const state = documentReadiness(doc, project);
      expect(state.available).toBe(true);
      expect(state.draft).toBe(true);
      expect(state.notices.map(item => item.id)).toContain('unreviewed-articles');
      expect(documentForExport(doc, state).name).toMatch(/\(검토용\)$/);
    }
    expect(documentReadiness(docs.find(item => item.id === 'notice'), project).notices.map(item => item.id)).toContain('reason-missing');
  });

  it('개별 제정안은 관련 없는 이유서 작성·확인 상태로 차단하거나 미확인이라고 표시하지 않는다', () => {
    const project = enactFixture();
    project.enact!.outline = project.enact!.outline.slice(0, 2).map(article => ({ ...article, provenance: 'ai_accepted' }));
    const { docs } = enactDocs(project);
    const state = documentReadiness(docs.find(item => item.id === 'enact'), project, { reasonBusy: true });
    expect(state).toEqual({ available: true, draft: false, notices: [] });
    expect(documentReadiness(docs.find(item => item.id === 'reason'), project, { reasonBusy: true }).notices.map(item => item.id)).toContain('reason-writing');
  });

  it('이유서가 오래됐거나 AI 작성 중이어도 현재 내용에 그 상태를 기록해 저장한다', () => {
    const project = enactFixture();
    project.prose = { reason: '이전 이유문 본문', mainPoints: ['이전 요점'], via: 'live', reviewed: true, specHash: 'old-hash' };
    const reason = enactDocs(project).docs.find(item => item.id === 'reason')!;
    const state = documentReadiness(reason, project);
    expect(state.available).toBe(true);
    expect(state.notices.map(item => item.id)).toContain('reason-stale');
    const result = documentForExport(reason, state);
    expect(flatten(result)).toContain('이전 이유문 본문');
    expect(flatten(result)).toContain('현재 조문으로 갱신되기 전');
    expect(documentReadiness(reason, project, { reasonBusy: true }).notices.map(item => item.id)).toContain('reason-writing');
  });

  it('HWPX·DOCX·복사·미리보기에 같은 검토 상태를 넣으며 프로젝트를 자동 수락하지 않는다', async () => {
    const project = enactFixture();
    const original = JSON.stringify(project);
    const doc = enactDocs(project).docs.find(item => item.id === 'enact')!;
    const originalBlocks = JSON.stringify(doc.blocks);
    const state = documentReadiness(doc, project, { must: 1 });
    const marked = documentForExport(doc, state);
    expect(flatten(marked)).toContain('검토용 초안');
    expect(flatten(marked)).toContain('반드시 고칠 문제 1개');
    const hwpx = entry(toHwpx(marked), 'Contents/section0.xml');
    const docx = entry(await toDocx(marked), 'word/document.xml');
    const html = toClipboardHtml(marked);
    for (const content of [hwpx, docx, html]) {
      expect(content).toContain('검토용 초안');
      expect(content).toContain('반드시 고칠 문제 1개');
      expect(content).toContain('이 조례는 자료 공유의 절차를 정함을 목적으로 한다.');
    }
    expect(JSON.stringify(project)).toBe(original);
    expect(JSON.stringify(doc.blocks)).toBe(originalBlocks);
  });

  it('아무런 본문이 없는 경우에는 구체적 이유와 함께 아직 받을 수 없음을 구분한다', () => {
    expect(documentReadiness(undefined, enactFixture())).toMatchObject({ available: false, unavailableReason: expect.stringContaining('문서 내용') });
    expect(documentReadiness({ id: 'notice', name: '예고문', title: '', blocks: [{ type: 'p', runs: [{ text: '  ' }] }] }, enactFixture()).available).toBe(false);
  });

  it('미수락 또는 적용 실패 개정은 최종 반영한 것으로 표시하지 않는다', () => {
    const project = enactFixture();
    project.mode = 'amend';
    project.spec.ops = [{ id: 'pending', provenance: 'ai', status: 'proposed', change: { op: 'replace_text', target: { kind: 'unit', ref: { art: 1 } }, find: '전자문서', replace: '종이문서' } }];
    const before = parseRule('시험 조례\n제1조(방법) 담당자는 전자문서로 제출한다.', project.kind);
    const result = derive(before, project.spec);
    const doc = buildAmendDocs(project, before, result, profile).find(item => item.id === 'full')!;
    const state = documentReadiness(doc, project, { rejected: 1 });
    expect(state.available).toBe(true);
    expect(state.notices.map(item => item.id)).toEqual(expect.arrayContaining(['no-amendments', 'pending-amendments', 'rejected-amendments']));
    expect(flatten(documentForExport(doc, state))).toContain('전자문서');
    expect(flatten(documentForExport(doc, state))).not.toContain('종이문서');
    expect(project.spec.ops[0].status).toBe('proposed');
  });

  it('검토 미완료 실제 UI의 HWPX·DOCX·복사·인쇄 버튼을 활성화한다', () => {
    const p = enactFixture();
    const { rule } = enactDocs(p);
    const context: WorkCtx = { p, enactRule: rule, enactLint: [], before: null, d: null, prof: profile, update: vi.fn(), toast: vi.fn(), setTab: vi.fn(), openEvidence: vi.fn() };
    const html = renderToStaticMarkup(createElement(Ctx.Provider, { value: context }, createElement(DocsTab)));
    for (const label of ['이 문서 HWPX 받기', 'DOCX 받기', '한글에 붙여넣기용 복사', '인쇄', '검토용 문서 세트 받기']) {
      const button = [...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)].find(match => match[2] === label);
      expect(button, label).toBeTruthy();
      expect(button![1], label).not.toContain('disabled');
    }
    expect(html).toContain('id="document-downloads"');
    expect(html).toContain('검토용 초안');
  });

  it('문서 세트에도 개별 다운로드와 같은 검토 표시와 현시점 본문을 담는다', async () => {
    const project = enactFixture();
    const docs = enactDocs(project).docs;
    const states = docs.map(doc => documentReadiness(doc, project));
    const exportDocs = docs.map((doc, index) => documentForExport(doc, states[index]));
    const notices = uniqueExportNotices(states);
    expect(notices.filter(item => item.id === 'unreviewed-articles')).toHaveLength(1);
    const pkg = await buildDownloadSet('가상자료공유조례', exportDocs, 'both', { '문서검토상태.txt': notices.map(item => item.message).join('\n') });
    const files = unzipSync(pkg.bytes);
    expect(Object.keys(files).filter(name => name.endsWith('.hwpx'))).toHaveLength(exportDocs.length);
    expect(Object.keys(files).filter(name => name.endsWith('.docx'))).toHaveLength(exportDocs.length);
    expect(docs.map(doc => doc.id)).toEqual(expect.arrayContaining(['authority', 'transitions']));
    for (const [name, bytes] of Object.entries(files)) {
      if (name.endsWith('.hwpx')) expect(entry(bytes, 'Contents/section0.xml')).toContain('검토용 초안');
      if (name.endsWith('.docx')) expect(entry(bytes, 'word/document.xml')).toContain('검토용 초안');
    }
    expect(strFromU8(files['문서검토상태.txt'])).toContain('본문을 작성하지 않은 조문 1개');
  });

  it('개정 점검표는 화면에서 확인한 동일 지문을 사용하고 본문이 바뀐 때만 이전 검토로 표시한다', () => {
    const project = enactFixture(); project.mode = 'amend';
    const before = parseRule('시험 조례\n제1조(기준) 기준은 3일로 한다.', project.kind);
    project.spec.ops = [{ id: 'days', provenance: 'human', status: 'accepted', change: { op: 'replace_text', target: { kind: 'unit', ref: { art: 1 } }, find: '3일', replace: '5일' } }];
    const d = derive(before, project.spec);
    project.documentSettings = { checks: [{ id: 'local-01', result: 'checked', note: '검토한 근거', sourceHash: reasonInputHash(project, d.specHash) }] };
    const doc = buildAmendDocs(project, before, d, profile).find(item => item.id === 'checklist')!;
    expect(flatten(doc)).toContain('검토한 근거');
    expect(flatten(doc)).not.toContain('이전 초안 기록·재확인');
    project.intent = '개정 취지 변경';
    expect(flatten(buildAmendDocs(project, before, d, profile).find(item => item.id === 'checklist')!)).toContain('이전 초안 기록·재확인');
  });

  it('준비한 파일은 공고번호·기한·조문·문서선택·형식이 바뀌면 이전 생성본으로 구분한다', () => {
    const project = enactFixture();
    const docs = enactDocs(project).docs;
    const previous = preparedDownloadVersion(project, docs, 'notice', 'both');
    const numberChanged = { ...project, documentSettings: { notice: { number: '제2026-2호' } } };
    const deadlineChanged = { ...project, documentSettings: { notice: { deadline: '2026-11-30' } } };
    for (const changed of [numberChanged, deadlineChanged]) expect(preparedDownloadVersion(changed, docs, 'notice', 'both')).not.toBe(previous);
    expect(preparedDownloadVersion(project, docs, 'checklist', 'both')).not.toBe(previous);
    expect(preparedDownloadVersion(project, docs, 'notice', 'docx')).not.toBe(previous);
    const changedDocs = structuredClone(docs);
    changedDocs[0].blocks.push({ type: 'p', runs: [{ text: '추가된 조문' }] });
    expect(preparedDownloadVersion(project, changedDocs, 'notice', 'both')).not.toBe(previous);
  });

  it('파일 생성 직후 바뀌는 저장시각·다운로드횟수로 링크를 즉시 무효화하지 않으며 검토 기록 변경은 구분한다', () => {
    const project = enactFixture(); project.evaluation = startPilot(1000);
    const docs = enactDocs(project).docs;
    const previous = preparedDownloadVersion(project, docs, 'notice', 'both');
    const afterDownload = { ...project, updatedAt: 2000, evaluation: { ...project.evaluation, exportCount: 1, firstExportAt: 2000 } };
    expect(preparedDownloadVersion(afterDownload, structuredClone(docs), 'notice', 'both')).toBe(previous);
    afterDownload.evaluation.notes = '검토 메모를 새로 작성했습니다.';
    expect(preparedDownloadVersion(afterDownload, docs, 'notice', 'both')).not.toBe(previous);
  });
});

describe('브라우저 다운로드 파일 수명', () => {
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it('직접 저장 링크의 Blob은 명시적으로 해제하기 전까지 유지하며 중복 해제를 막는다', () => {
    const create = vi.fn(() => 'blob:review'); const revoke = vi.fn();
    vi.stubGlobal('URL', { createObjectURL: create, revokeObjectURL: revoke });
    const file = createDownloadFile('검토용.hwpx', new Uint8Array([1, 2]), 'application/hwp+zip');
    expect(file).toMatchObject({ name: '검토용.hwpx', url: 'blob:review' });
    expect(revoke).not.toHaveBeenCalled();
    file.revoke(); file.revoke();
    expect(revoke).toHaveBeenCalledExactlyOnceWith('blob:review');
  });

  it('다운로드 클릭이 실패해도 임시 DOM을 제거하며 준비한 파일 링크는 유지한다', () => {
    const remove = vi.fn(); const click = vi.fn(() => { throw new Error('browser blocked'); });
    const anchor = { href: '', download: '', click, remove };
    const appendChild = vi.fn();
    vi.stubGlobal('document', { createElement: vi.fn(() => anchor), body: { appendChild } });
    expect(() => startDownload({ name: '검토용.docx', url: 'blob:review' })).toThrow('browser blocked');
    expect(appendChild).toHaveBeenCalledWith(anchor);
    expect(anchor.href).toBe('blob:review');
    expect(anchor.download).toBe('검토용.docx');
    expect(remove).toHaveBeenCalledOnce();
  });

  it('일반 다운로드도 2초 뒤 급히 URL을 해제하지 않고 파일 수신 시간을 둔다', () => {
    vi.useFakeTimers();
    const revoke = vi.fn();
    vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:review'), revokeObjectURL: revoke });
    vi.stubGlobal('document', { createElement: () => ({ click: vi.fn(), remove: vi.fn() }), body: { appendChild: vi.fn() } });
    download('검토용.txt', '작성된 본문', 'text/plain');
    vi.advanceTimersByTime(2_000); expect(revoke).not.toHaveBeenCalled();
    vi.advanceTimersByTime(58_000); expect(revoke).toHaveBeenCalledExactlyOnceWith('blob:review');
  });
});
