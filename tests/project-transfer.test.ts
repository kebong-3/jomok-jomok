import { afterEach, describe, expect, it, vi } from 'vitest';
import { derive, parseRule, type SpecOp } from '@/engine';
import { TRAVEL_RULE } from '@/data/samples';
import { sha256, type Project } from '@/lib/project';
import { startPilot } from '@/lib/evaluation';
import {
  PROJECT_BACKUP_MAX_BYTES,
  parseProjectBackup,
  projectBackupFileName,
  restoreProjectBackup,
  serializeProjectBackup,
} from '@/lib/project-transfer';

async function fixture(): Promise<Project> {
  const raw = TRAVEL_RULE;
  const sourceHash = await sha256(raw);
  const evidenceText = '상위법령 조회 시점의 조문 원문을 보존합니다.';
  const project: Project = {
    id: 'original-project', createdAt: 1_790_000_000_000, updatedAt: 1_790_000_100_000,
    mode: 'amend', sampleId: 'travel', title: '한빛시 공무원 여비 지급 규칙', kind: 'rule', profileId: 'hanbit-city',
    source: { type: 'file', raw, hash: sourceHash, name: '원본 규칙.hwpx' },
    sourceReview: { hash: sourceHash, confirmedAt: 1_790_000_010_000, issues: [{ code: 'review-1', message: '표 구조를 확인했습니다.', location: '별표 1', severity: 'warning', excerpt: '상한액' }] },
    intent: '숙박비 지급 기준을 보완한다.', upperLaw: '공무원 여비 규정', purpose: '출장 정산 절차 정비',
    spec: {
      ops: [
        { id: 'accepted', status: 'accepted', provenance: 'ai_accepted', why: '예외 지급 기준 추가', evidence: ['EV-L-1'], change: { text: '초과 숙박비를 지급할 수 있다.', position: 2, art: { art: 5 }, op: 'insert_paragraph' } },
        { id: 'rejected', status: 'rejected', provenance: 'ai', why: '현행 기준 유지', change: { op: 'delete_paragraph', target: { art: 9, para: 2 } } },
        { id: 'proposed', status: 'proposed', provenance: 'human', derivedFrom: 'accepted', change: { op: 'set_title', target: { art: 2 }, title: '용어의 정의' } },
      ],
      addenda: { transitional: '종전의 기준을 적용한다.', effective: 'months', months: 3, reviewDeadline: false },
    },
    excludedFixes: [],
    evidence: [{ id: 'EV-L-1', kind: 'law', label: '공무원 여비 규정 제16조', text: evidenceText, url: 'https://www.law.go.kr/법령/공무원여비규정', via: 'live', date: '2026-10-22', lawId: 'law-1234', lawKind: 'law', effectiveAt: '2026-01-01', fetchedAt: '2026-10-22T04:30:00.000Z', contentHash: await sha256(evidenceText), partial: true, note: '관련 조문만 조회' }],
    log: [{ step: 'plan', label: '개정안 제안', actor: 'AI', status: 'ok', ms: 1234, model: 'model-label', detail: '개정안 3건 제안', tools: ['draft'] }],
    prose: { reason: '검토자가 직접 보완한 이유서입니다.', mainPoints: ['예외 지급 기준 정비'], via: 'live', specHash: '', reviewed: true, model: 'actual-model', note: '최종 내용 확인' },
    planVia: 'live', planModel: '선택한 모델', planModelId: 'provider/model', planFamily: 'provider', planError: '이전 실행 실패 기록',
    planTrace: { actualModel: 'actual-model', promptVersion: 'v2', tokens: 1200, repairs: 1, fallbacks: ['retry'], family: 'provider' },
    compare: { otherModel: '다른 모델', ops: [{ id: 'comparison-1', status: 'proposed', provenance: 'ai', change: { op: 'replace_text', target: { kind: 'unit', ref: { art: 1 } }, find: '목적', replace: '취지' } }], via: 'live' },
    impact: {
      version: 1, upperTitle: '공무원 여비 규정', before: { text: '제16조(숙박비) 상한액에 따라 지급한다.', effectiveAt: '2025-01-01' }, after: { text: '제16조(숙박비) 실제 지출액을 지급한다.', effectiveAt: '2026-01-01' },
      institutionHash: sourceHash, analyzedAt: 1_790_000_000_000, method: 'ai',
      candidates: [{ id: 'IC-1', target: '제5조', upperTarget: '제16조', institutionQuote: '숙박비는 별표 1의 상한액 범위에서 실제 숙박한 금액으로 지급한다.', beforeQuote: '상한액에 따라 지급한다.', afterQuote: '실제 지출액을 지급한다.', reason: '지급 기준 변경 검토', checks: ['기관의 별도 지급 기준 확인'], source: 'ai' }],
      selectedIds: ['IC-1'], elapsedMs: 3000, rejectedCount: 0, model: 'model-id', modelLabel: '모델 이름', actualModel: 'actual-model', promptVersion: 'impact-v1', trace: { tokens: 1500, repairs: 0, fallbacks: [], family: 'provider' }, note: '담당자 검토 필요',
    },
  };
  const initial = derive(parseRule(raw, project.kind), project.spec);
  project.excludedFixes = initial.fixes.filter((fix) => fix.reason === 'moved').slice(0, 1).map((fix) => fix.id);
  project.prose!.specHash = derive(parseRule(raw, project.kind), project.spec, { excludedFixes: new Set(project.excludedFixes) }).specHash;
  return project;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).filter((key) => object[key] !== undefined).sort().map((key) => `${JSON.stringify(key)}:${canonical(object[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

async function resign(project: unknown) {
  return JSON.stringify({ format: 'jomokjomok.project', version: 1, exportedAt: 1_790_000_200_000, integrity: { algorithm: 'SHA-256', projectHash: await sha256(canonical(project)) }, project });
}

afterEach(() => vi.useRealTimers());

describe('작업 보관과 새 작업 복원', () => {
  it('원문·수정안·채택/제외/대기·근거·검토 상태·분석기록을 같은 내용으로 복원하고 기존 작업은 보존한다', async () => {
    const original = await fixture();
    const snapshot = structuredClone(original);
    const prepared = await parseProjectBackup(await serializeProjectBackup(original));
    expect(prepared.project).toEqual(snapshot);
    expect(prepared.profileKnown).toBe(true);
    const store = new Map<string, Project>([[original.id, original]]);
    const persist = vi.fn(async (project: Project) => { store.set(project.id, project); return true; });
    const restored = await restoreProjectBackup(prepared, {}, persist);
    expect(restored.id).not.toBe(original.id);
    expect(store.size).toBe(2);
    expect(store.get(original.id)).toEqual(snapshot);
    expect(restored.createdAt).toBe(original.createdAt);
    expect(restored.spec.ops.map((op) => op.status)).toEqual(['accepted', 'rejected', 'proposed']);
    expect(restored.prose).toEqual(original.prose);
    expect(restored.evidence).toEqual(original.evidence);
    expect(restored.sourceReview).toEqual(original.sourceReview);
    expect(restored.impact).toEqual(original.impact);
    const before = derive(parseRule(original.source.raw, original.kind), original.spec, { excludedFixes: new Set(original.excludedFixes) });
    const after = derive(parseRule(restored.source.raw, restored.kind), restored.spec, { excludedFixes: new Set(restored.excludedFixes) });
    expect(after.specHash).toBe(before.specHash);
    expect(after.amendPlain).toBe(before.amendPlain);
    expect(persist).toHaveBeenCalledTimes(1);
  });

  it('구형 제정 작업의 빈 원문 지문과 근거 해시 누락은 허용하지만 없는 근거 ID는 거부한다', async () => {
    const original = await fixture();
    original.mode = 'enact';
    original.source = { type: 'none', raw: '', hash: '' };
    delete original.sourceReview;
    delete original.impact;
    delete original.evidence[0].contentHash;
    original.enact = { title: '새 규정', outlineConfirmed: true, via: 'live', outline: [
      { id: 'a1', title: '목적', summary: '목적 조문', paragraphs: ['목적을 규정한다.'], evidence: ['EV-L-1'], provenance: 'ai_accepted' },
      { id: 'a2', title: '적용 범위', paragraphs: ['범위를 규정한다.'], provenance: 'human' },
      { id: 'a3', title: '시행', paragraphs: ['시행한다.'], provenance: 'ai' },
    ] };
    const prepared = await parseProjectBackup(await serializeProjectBackup(original));
    expect(prepared.project.source.hash).toBe(await sha256(''));
    expect(prepared.project.enact).toEqual(original.enact);
    expect(original.source.hash).toBe('');
    const restored = await restoreProjectBackup(prepared, {}, async () => true);
    expect(restored.enact?.outlineConfirmed).toBe(true);
    expect(restored.evidence).toEqual(original.evidence);
    const broken = structuredClone(prepared.project);
    broken.enact!.outline[0].evidence = ['EV-MISSING'];
    await expect(parseProjectBackup(await resign(broken))).rejects.toThrow('존재하지 않는 근거 ID(EV-MISSING)');
  });

  it('근거가 지정되지 않았거나 빈 배열인 수정안·제정 조문·비교안은 그대로 복원한다', async () => {
    const original = await fixture();
    original.evidence = [];
    original.spec.ops[0].evidence = [];
    original.compare!.ops[0].evidence = [];
    original.enact = { title: '검토 중인 제정 초안', outlineConfirmed: false, outline: [
      { id: 'a1', title: '목적', paragraphs: ['목적을 규정한다.'], evidence: [], provenance: 'human' },
      { id: 'a2', title: '범위', paragraphs: ['범위를 규정한다.'], provenance: 'human' },
    ] };
    const prepared = await parseProjectBackup(await serializeProjectBackup(original));
    const restored = await restoreProjectBackup(prepared, {}, async () => true);
    expect(restored.evidence).toEqual([]);
    expect(restored.spec).toEqual(original.spec);
    expect(restored.enact).toEqual(original.enact);
    expect(restored.compare).toEqual(original.compare);
  });

  it('알 수 없는 기관은 자동으로 대체하지 않고 선택을 요구하며 기관 변경 시 이유서 확인을 다시 받는다', async () => {
    const original = await fixture();
    original.profileId = 'previous-organization';
    const prepared = await parseProjectBackup(await serializeProjectBackup(original));
    const persist = vi.fn(async () => true);
    expect(prepared.profileKnown).toBe(false);
    expect(prepared.warnings.join(' ')).toContain('기관 프로필');
    await expect(restoreProjectBackup(prepared, {}, persist)).rejects.toThrow('기관 프로필');
    expect(persist).not.toHaveBeenCalled();
    const restored = await restoreProjectBackup(prepared, { profileId: 'hanbit-city' }, persist);
    expect(restored.profileId).toBe('hanbit-city');
    expect(restored.prose?.reviewed).toBe(false);
    expect(restored.prose?.reason).toBe(original.prose?.reason);
    expect(restored.source.raw).toBe(original.source.raw);
  });

  it.each([false, 'throw'])('저장 실패(%s)를 성공으로 반환하지 않는다', async (result) => {
    const prepared = await parseProjectBackup(await serializeProjectBackup(await fixture()));
    const persist = vi.fn(async () => { if (result === 'throw') throw new Error('quota'); return false; });
    await expect(restoreProjectBackup(prepared, {}, persist)).rejects.toThrow('저장하지 못했습니다');
    expect(persist).toHaveBeenCalledTimes(1);
  });

  it('진행·대기 중인 실행은 skipped로 복원해 영구 로딩을 막고 기존 완료 기록은 유지한다', async () => {
    const original = await fixture();
    const completed = structuredClone(original.log[0]);
    original.log.push(
      { step: 'link', label: '인용 정정', actor: '규칙 엔진', status: 'running', detail: '기존 진행 기록' },
      { step: 'docs', label: '문서 작성', actor: '규칙 엔진', status: 'wait' },
    );
    const prepared = await parseProjectBackup(await serializeProjectBackup(original));
    const restored = await restoreProjectBackup(prepared, {}, async () => true);
    expect(restored.log.map((entry) => entry.status)).toEqual(['ok', 'skipped', 'skipped']);
    expect(restored.log[0]).toEqual(completed);
    expect(restored.log[1].detail).toContain('기존 진행 기록');
    expect(restored.log[1].detail).toContain('백업 시점에 완료되지 않은 실행');
    expect(prepared.project.log[1].status).toBe('running');
    expect(prepared.project.log[2].status).toBe('wait');
  });

  it('사용 기록은 보관 시각에 일시정지하며 며칠 뒤 복원해도 소요 시간이 늘지 않는다', async () => {
    vi.useFakeTimers();
    const exportedAt = 1_800_000_000_000;
    vi.setSystemTime(exportedAt);
    const original = await fixture();
    original.evaluation = { ...startPilot(exportedAt - 90_000), activeMs: 30_000, participantCode: 'P01', caseCode: 'CASE01', manualCorrections: 2, rating: 4, notes: '직접 입력한 기록' };
    const prepared = await parseProjectBackup(await serializeProjectBackup(original));
    expect(original.evaluation.status).toBe('running');
    expect(prepared.project.evaluation).toMatchObject({ status: 'paused', activeMs: 120_000, participantCode: 'P01', manualCorrections: 2, rating: 4 });
    vi.setSystemTime(exportedAt + 10 * 24 * 60 * 60 * 1000);
    const restored = await restoreProjectBackup(prepared, {}, async () => true);
    expect(restored.evaluation?.status).toBe('paused');
    expect(restored.evaluation?.activeMs).toBe(120_000);
    expect(restored.evaluation?.runningSince).toBeUndefined();
  });
});

describe('보관파일 검증과 비밀정보 제외', () => {
  it('모든 깊이의 미등록 필드·설정·기관 서버 키·prototype 필드를 제거한다', async () => {
    const project = JSON.parse(JSON.stringify(await fixture())) as Record<string, unknown>;
    project.settings = { orgKey: 'DO-NOT-EXPORT-ORG-KEY', orgBaseURL: 'https://private-server.invalid', byokKey: 'DO-NOT-EXPORT-API-KEY' };
    project.apiKey = 'DO-NOT-EXPORT-TOP-KEY';
    Object.assign(project.source as object, { apiKey: 'DO-NOT-EXPORT-SOURCE-KEY' });
    const ops = (project.spec as { ops: Record<string, unknown>[] }).ops;
    Object.assign(ops[0].change as object, { orgKey: 'DO-NOT-EXPORT-CHANGE-KEY' });
    Object.defineProperty(project, '__proto__', { value: { polluted: true }, enumerable: true });
    project.constructor = { prototype: { polluted: true } } as unknown as Function;
    const serialized = await serializeProjectBackup(project as unknown as Project);
    expect(serialized).not.toContain('DO-NOT-EXPORT');
    expect(serialized).not.toContain('private-server.invalid');
    expect(serialized).not.toContain('__proto__');
    expect(serialized).not.toContain('constructor');
    const envelope = JSON.parse(serialized);
    envelope.settings = { orgKey: 'IMPORT-SECRET' };
    envelope.project.source.secret = 'IMPORT-NESTED-SECRET';
    Object.defineProperty(envelope.project, '__proto__', { value: { polluted: true }, enumerable: true });
    const prepared = await parseProjectBackup(JSON.stringify(envelope));
    expect(JSON.stringify(prepared)).not.toContain('SECRET');
    expect(Object.prototype).not.toHaveProperty('polluted');
    expect(prepared.project).not.toHaveProperty('settings');
  });

  it('잘못된 JSON·지원하지 않는 버전·파일 종류를 거부한다', async () => {
    await expect(parseProjectBackup('{ broken')).rejects.toThrow('JSON');
    const envelope = JSON.parse(await serializeProjectBackup(await fixture()));
    await expect(parseProjectBackup(JSON.stringify({ ...envelope, version: 999 }))).rejects.toThrow('버전');
    await expect(parseProjectBackup(JSON.stringify({ ...envelope, format: 'another.app' }))).rejects.toThrow('형식');
  });

  it('원문 또는 검토 상태가 바뀐 파일은 무결성 검사에서 거부한다', async () => {
    const envelope = JSON.parse(await serializeProjectBackup(await fixture()));
    envelope.project.source.raw += '\n제100조(추가) 내용이 달라졌다.';
    await expect(parseProjectBackup(JSON.stringify(envelope))).rejects.toThrow('무결성');
    const second = JSON.parse(await serializeProjectBackup(await fixture()));
    second.project.spec.ops[1].status = 'accepted';
    await expect(parseProjectBackup(JSON.stringify(second))).rejects.toThrow('무결성');
  });

  it('전체 파일 지문을 다시 계산했더라도 원문 SHA-256이 불일치하면 거부한다', async () => {
    const project = await fixture();
    project.source.raw += '\n원문 수정';
    await expect(parseProjectBackup(await resign(project))).rejects.toThrow('원문 SHA-256');
    await expect(serializeProjectBackup(project)).rejects.toThrow('원문 SHA-256');
  });

  it('근거 텍스트가 해당 contentHash와 다르면 전체 지문을 다시 계산해도 거부한다', async () => {
    const project = await fixture();
    project.evidence[0].text = '다른 내용의 근거로 바꾸었습니다.';
    await expect(serializeProjectBackup(project)).rejects.toThrow('근거 EV-L-1의 원문 지문');
    await expect(parseProjectBackup(await resign(project))).rejects.toThrow('근거 EV-L-1의 원문 지문');
  });

  it.each([
    ['변경 제안', (project: Project) => { project.spec.ops[0].evidence = ['EV-L-1', 'EV-MISSING']; }],
    ['제정 조문', (project: Project) => {
      project.mode = 'enact';
      project.enact = { title: '새 규정', outlineConfirmed: true, outline: [
        { id: 'a1', title: '목적', paragraphs: ['목적을 규정한다.'], evidence: ['EV-MISSING'], provenance: 'ai_accepted' },
      ] };
    }],
    ['비교 제안', (project: Project) => { project.compare!.ops[0].evidence = ['EV-MISSING']; }],
  ])('%s의 근거 ID가 저장된 근거에 없으면 보관·불러오기·직접 복원 모두 거부한다', async (label, mutate) => {
    const project = await fixture();
    mutate(project);
    const snapshot = structuredClone(project);
    await expect(serializeProjectBackup(project)).rejects.toThrow(`${label} 1번`);
    const serialized = await resign(project);
    await expect(parseProjectBackup(serialized)).rejects.toThrow('존재하지 않는 근거 ID(EV-MISSING)');
    const envelope = JSON.parse(serialized);
    const persist = vi.fn(async () => true);
    await expect(restoreProjectBackup({
      project, exportedAt: envelope.exportedAt, projectHash: envelope.integrity.projectHash,
      profileKnown: true, warnings: [],
    }, {}, persist)).rejects.toThrow(`${label} 1번`);
    expect(persist).not.toHaveBeenCalled();
    expect(project).toEqual(snapshot);
  });

  it('이전 원문에 대해 확인한 sourceReview 기록을 현재 원문의 확인으로 복원하지 않는다', async () => {
    const project = await fixture();
    project.sourceReview!.hash = await sha256('이전 원문의 내용');
    await expect(parseProjectBackup(await resign(project))).rejects.toThrow('입력 원문 확인 기록');
    await expect(serializeProjectBackup(project)).rejects.toThrow('입력 원문 확인 기록');
  });

  it('미리보기 이후 수정된 프로젝트는 저장하지 않는다', async () => {
    const prepared = await parseProjectBackup(await serializeProjectBackup(await fixture()));
    prepared.project.prose!.reviewed = false;
    const persist = vi.fn(async () => true);
    await expect(restoreProjectBackup(prepared, {}, persist)).rejects.toThrow('미리보기');
    expect(persist).not.toHaveBeenCalled();
  });

  it('다른 기관 원문을 대상으로 한 상위법 영향 분석을 연결한 파일은 거부한다', async () => {
    const project = await fixture();
    project.impact!.institutionHash = await sha256('다른 기관의 다른 원문');
    await expect(serializeProjectBackup(project)).rejects.toThrow('영향 분석의 기관 원문');
    await expect(parseProjectBackup(await resign(project))).rejects.toThrow('영향 분석의 기관 원문');
  });

  it('존재하지 않거나 중복된 상위법 검토 후보 선택을 거부한다', async () => {
    const project = await fixture();
    project.impact!.selectedIds = ['IC-999'];
    await expect(parseProjectBackup(await resign(project))).rejects.toThrow('impact.selectedIds');
    project.impact!.selectedIds = ['IC-1', 'IC-1'];
    await expect(parseProjectBackup(await resign(project))).rejects.toThrow('impact.selectedIds');
  });

  it('기관 조문 인용이 다른 조에만 있거나 문자일치로 잘못 표시된 분석은 복원하지 않는다', async () => {
    const project = await fixture();
    project.impact!.candidates[0].target = '제2조';
    await expect(parseProjectBackup(await resign(project))).rejects.toThrow('원문 대조');
    project.impact!.candidates[0].target = '제5조';
    project.impact!.method = 'literal';
    project.impact!.candidates[0].source = 'literal';
    await expect(parseProjectBackup(await resign(project))).rejects.toThrow('직접 인용');
  });

  it.each([
    ['검토 상태', (project: Project) => { (project.spec.ops[0] as unknown as Record<string, unknown>).status = 'silently-approved'; }],
    ['변경 연산', (project: Project) => { (project.spec.ops[0].change as unknown as Record<string, unknown>).op = 'execute_script'; }],
    ['누락된 연산 필드', (project: Project) => { delete (project.spec.ops[0].change as unknown as Record<string, unknown>).art; }],
    ['조 번호', (project: Project) => { (project.spec.ops[0].change as { art: { art: number } }).art.art = -1; }],
    ['중복 ID', (project: Project) => { project.spec.ops[1].id = project.spec.ops[0].id; }],
    ['시행 날짜', (project: Project) => { project.spec.addenda.date = '2026-02-30'; }],
  ])('%s이 잘못된 파일을 거부한다', async (_label, mutate) => {
    const project = await fixture();
    mutate(project);
    await expect(parseProjectBackup(await resign(project))).rejects.toThrow('형식');
  });

  it.each(['javascript:alert(1)', 'data:text/html,hello', 'https://user:password@example.org/law', 'https://example.org/law?api_key=secret'])('근거 주소 %s를 거부한다', async (url) => {
    const project = await fixture();
    project.evidence[0].url = url;
    await expect(serializeProjectBackup(project)).rejects.toThrow('형식');
  });

  it('UTF-8 기준 10MB와 원문·배열 개수 한도를 지킨다', async () => {
    await expect(parseProjectBackup(' '.repeat(PROJECT_BACKUP_MAX_BYTES + 1))).rejects.toThrow('10MB');
    await expect(parseProjectBackup('가'.repeat(Math.ceil(PROJECT_BACKUP_MAX_BYTES / 3)))).rejects.toThrow('10MB');
    const project = await fixture();
    project.source.raw = '가'.repeat(1_000_001);
    await expect(serializeProjectBackup(project)).rejects.toThrow('source.raw');
    const many = await fixture();
    many.spec.ops = Array.from({ length: 1_001 }, (_, index): SpecOp => ({ ...many.spec.ops[0], id: `op-${index}` }));
    await expect(serializeProjectBackup(many)).rejects.toThrow('spec.ops');
  });

  it('파일명은 경로 구분자·제어문자를 제외하고 JSON 확장자를 고정한다', () => {
    expect(projectBackupFileName({ title: '../규정/<초안>:검토\u0000' }, 1_800_000_000_000)).toBe('20270115_..규정초안검토_작업보관.jomok.json');
  });
});
