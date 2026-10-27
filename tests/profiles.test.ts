import { afterEach, describe, expect, it, vi } from 'vitest';
import { derive, hashText, parseRule } from '@/engine';
import {
  availableProfiles, createCustomProfile, CUSTOM_PROFILE_LIMIT, normalizeCustomProfiles,
  parseProfile, procedureTemplate, PROFILE_FILE_MAX_BYTES, profileById, profileSchema,
  PROFILES, projectProfile, serializeProfile, snapshotProfile, type Profile,
} from '@/config/profiles';
import { buildAmendDocs } from '@/lib/docs';
import { sha256, type Project } from '@/lib/project';
import { parseProjectBackup, restoreProjectBackup, serializeProjectBackup } from '@/lib/project-transfer';
import { migrateLegacyReasonReview, reasonInputHash } from '@/lib/review';
import { loadSettings, saveSettings } from '@/lib/settings';

function institution(): Profile {
  return {
    ...createCustomProfile(), id: 'custom-saebom', name: '새봄시', headTitle: '시장', council: '새봄시의회',
    legalDept: '법제지원과', noticeNo: '새봄시 공고 제{yyyy}-{n}호', noticeDays: 23,
    opinionContact: '새봄시 법제지원과 / 000-1234-5678 / law@example.org',
    style: { ...PROFILES[0].style, unchangedMark: 'full', titleAlways: true, insertMark: '(신설 검토)' },
    procedures: { ...procedureTemplate('local'), rule: [{ id: 'draft', name: '기관 법제 검토', days: 7, docs: ['검토서'], basis: '기관 규정 확인 대상', tip: '시행일 확인' }] },
    procedureConfirmed: true, procedureCheckedAt: '2026-10-23T01:02:03.000Z', procedureNote: '기간은 담당 부서에서 적용 조건을 확인함.',
  };
}

async function work(profile?: Profile): Promise<Project> {
  const raw = '새봄시 직원 교육 규칙\n제1조(목적) 이 규칙은 직원 교육에 필요한 사항을 정한다.\n제2조(시간) 교육시간은 10시간으로 한다.';
  const p: Project = {
    id: 'profile-work', createdAt: 1_790_000_000_000, updatedAt: 1_790_000_000_000,
    mode: 'amend', title: '새봄시 직원 교육 규칙', kind: 'rule', profileId: profile?.id ?? 'hanbit-city',
    ...(profile ? { profileSnapshot: snapshotProfile(profile) } : {}),
    source: { type: 'paste', raw, hash: await sha256(raw) }, intent: '교육시간을 20시간으로 정비한다.',
    spec: { ops: [{ id: 'change-1', status: 'accepted', provenance: 'human', change: { op: 'replace_text', target: { kind: 'unit', ref: { art: 2 } }, find: '10시간', replace: '20시간' } }], addenda: { effective: 'promulgation' } },
    excludedFixes: [], evidence: [], log: [],
  };
  const d = derive(parseRule(raw, p.kind), p.spec, { style: projectProfile(p).style });
  p.prose = { reason: '담당자가 검토한 교육시간 개정이유', mainPoints: ['교육시간 정비'], via: 'template', reviewed: true, specHash: reasonInputHash(p, d.specHash) };
  return p;
}

function browserStorage() {
  const local = new Map<string, string>();
  const session = new Map<string, string>();
  const make = (store: Map<string, string>) => ({ getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => { store.set(key, value); }, removeItem: (key: string) => { store.delete(key); } });
  const browser = { localStorage: make(local), sessionStorage: make(session), dispatchEvent: vi.fn() };
  vi.stubGlobal('window', browser);
  return { browser, local, session };
}

afterEach(() => vi.unstubAllGlobals());

describe('기관 프로필 편집과 이식', () => {
  it('기본 기관은 유지하고 새 기관의 예고·법정기간을 자동 확인하지 않는다', () => {
    const before = structuredClone(PROFILES);
    const created = createCustomProfile(PROFILES[0]);
    expect(created.id).toMatch(/^custom-/);
    expect(created.name).toBe('');
    expect(created.council).toBe('');
    expect(created.opinionContact).toBe('');
    expect(created.procedureConfirmed).toBe(false);
    expect(Object.values(created.procedures).flat().every(step => step.days === undefined)).toBe(true);
    expect(procedureTemplate('central').admin.some(step => step.id === 'sunset')).toBe(true);
    expect(procedureTemplate('public').admin.some(step => step.id === 'sunset')).toBe(false);
    created.style.omitText = '독립된 사본';
    expect(PROFILES).toEqual(before);
  });

  it('기관 파일은 새 ID로 가져오고 확인 표시를 해제하며 모든 공개 설정을 보존한다', () => {
    const profile = institution();
    const imported = parseProfile(serializeProfile(profile));
    expect(imported.id).not.toBe(profile.id);
    expect(imported.id).toMatch(/^custom-/);
    expect(imported).toEqual({ ...profile, id: imported.id, procedureConfirmed: false, procedureCheckedAt: undefined });
    expect(profile.procedureConfirmed).toBe(true);
    expect(parseProfile(serializeProfile(profile)).id).not.toBe(imported.id);
  });

  it('파일의 숨은 API 키·연결 주소·중첩 필드를 내보내거나 가져오지 않는다', () => {
    const poisoned = JSON.parse(JSON.stringify(institution()));
    Object.assign(poisoned, { apiKey: 'SECRET-ROOT', orgBaseURL: 'https://private.invalid', byokKey: 'SECRET-BYOK' });
    Object.assign(poisoned.style, { orgKey: 'SECRET-STYLE' });
    Object.assign(poisoned.procedures.rule[0], { serverURL: 'https://private.invalid', token: 'SECRET-STEP' });
    Object.defineProperty(poisoned, '__proto__', { enumerable: true, value: { polluted: true } });
    const exported = serializeProfile(poisoned);
    expect(exported).not.toMatch(/SECRET|private\.invalid|__proto__/);
    const raw = JSON.stringify({ format: 'jomokjomok.profile', version: 1, apiKey: 'SECRET-ENVELOPE', profile: poisoned });
    expect(JSON.stringify(parseProfile(raw))).not.toMatch(/SECRET|private\.invalid|__proto__/);
    expect(Object.prototype).not.toHaveProperty('polluted');
  });

  it('JSON 크기·문자수·필수필드·숫자 범위·절차 중복을 검증한다', () => {
    const valid = institution();
    expect(() => parseProfile(' '.repeat(PROFILE_FILE_MAX_BYTES + 1))).toThrow('256KB');
    expect(() => parseProfile('가'.repeat(Math.ceil(PROFILE_FILE_MAX_BYTES / 3)))).toThrow('256KB');
    expect(() => parseProfile('{')).toThrow('JSON');
    for (const bad of [
      { ...valid, name: ' ' }, { ...valid, name: '가'.repeat(121) }, { ...valid, type: 'unknown' },
      { ...valid, noticeDays: 0 }, { ...valid, noticeDays: 366 }, { ...valid, noticeDays: 1.2 },
      { ...valid, opinionContact: '가'.repeat(1001) },
      { ...valid, procedures: { ...valid.procedures, rule: Array.from({ length: 26 }, (_, i) => ({ id: `p${i}`, name: '절차' })) } },
      { ...valid, procedures: { ...valid.procedures, rule: [{ id: 'same', name: '첫 절차' }, { id: 'same', name: '다음 절차' }] } },
    ]) expect(() => parseProfile(JSON.stringify({ format: 'jomokjomok.profile', version: 1, profile: bad }))).toThrow('형식이나 허용 범위');
    expect(() => parseProfile(JSON.stringify({ format: 'jomokjomok.profile', version: 2, profile: valid }))).toThrow('형식');
  });

  it('저장 목록은 기본 기관 덮어쓰기·중복·잘못된 설정을 제외하고 20개로 제한한다', () => {
    const p = institution();
    expect(normalizeCustomProfiles([PROFILES[0], p, { ...p, name: '중복' }, { ...p, id: 'custom-bad', name: '' }])).toEqual([p]);
    const many = Array.from({ length: CUSTOM_PROFILE_LIMIT + 5 }, (_, i) => ({ ...p, id: `custom-${i}` }));
    expect(normalizeCustomProfiles(many)).toHaveLength(20);
    expect(availableProfiles([p])).toHaveLength(PROFILES.length + 1);
    expect(profileById(p.id, [p]).name).toBe('새봄시');
    expect(profileById('missing', [p]).id).toBe(PROFILES[0].id);
    expect(normalizeCustomProfiles({ profiles: [p] })).toEqual([]);
  });

  it('저장한 작업의 기관 설정은 이후 목록 수정·삭제와 독립적이다', async () => {
    const profile = institution();
    const p = await work(profile);
    profile.name = '나중에 고친 기관';
    profile.style.insertMark = '다른 신설 표시';
    profile.procedures.rule[0].name = '다른 기관 절차';
    expect(projectProfile(p).name).toBe('새봄시');
    expect(projectProfile(p).style.insertMark).toBe('(신설 검토)');
    expect(projectProfile(p).procedures.rule[0].name).toBe('기관 법제 검토');
    expect(projectProfile({ profileId: 'hanbit-city' })).toEqual(PROFILES[0]);
    expect(projectProfile({ profileId: 'hanbit-city', profileSnapshot: p.profileSnapshot })).toEqual(PROFILES[0]);
    expect(projectProfile(null)).toEqual(PROFILES[0]);
    expect(projectProfile(undefined)).toEqual(PROFILES[0]);
  });

  it('기관 선택·설정을 저장하고 API 키는 세션 저장소에만 남긴다', () => {
    const { local, session, browser } = browserStorage();
    const p = institution();
    expect(saveSettings({ connection: 'byok', profileId: p.id, customProfiles: [p], byokKey: 'PRIVATE-BYOK', orgKey: 'PRIVATE-ORG' })).toBe(true);
    expect(local.get('jj:settings')).not.toContain('PRIVATE');
    expect(session.get('jj:settings:key')).toBe('PRIVATE-BYOK');
    expect(session.get('jj:settings:orgKey')).toBe('PRIVATE-ORG');
    expect(loadSettings()).toMatchObject({ profileId: p.id, customProfiles: [p], byokKey: 'PRIVATE-BYOK' });
    expect(browser.dispatchEvent).toHaveBeenCalledTimes(1);
  });

  it('구형 설정을 그대로 읽고 누락된 기관은 기본값을 쓰며 저장 실패를 알린다', () => {
    const { local, browser } = browserStorage();
    local.set('jj:settings', JSON.stringify({ connection: 'default', profileId: 'seogu' }));
    expect(loadSettings()).toMatchObject({ profileId: 'seogu', customProfiles: [] });
    local.set('jj:settings', JSON.stringify({ profileId: 'custom-missing', customProfiles: [{ id: 'custom-missing' }] }));
    expect(loadSettings().profileId).toBe('hanbit-city');
    browser.localStorage.setItem = () => { throw new Error('quota'); };
    expect(saveSettings({ connection: 'default', profileId: 'hanbit-city' })).toBe(false);
    expect(browser.dispatchEvent).not.toHaveBeenCalled();
  });
});

describe('기관 설정을 포함한 작업 백업과 검토 지문', () => {
  it('다른 브라우저의 목록에 없는 기관도 작업 파일로 복원하고 문서 서식·연락처·절차를 유지한다', async () => {
    const p = await work(institution());
    const prepared = await parseProjectBackup(await serializeProjectBackup(p));
    expect(prepared.profileKnown).toBe(true);
    expect(prepared.warnings).toEqual([]);
    const persist = vi.fn(async () => true);
    const restored = await restoreProjectBackup(prepared, {}, persist);
    expect(restored.id).not.toBe(p.id);
    expect(restored.profileSnapshot).toEqual(p.profileSnapshot);
    expect(restored.prose).toEqual(p.prose);
    expect(projectProfile(restored).procedures.rule).toEqual(institution().procedures.rule);
    const rule = parseRule(restored.source.raw, restored.kind);
    const d = derive(rule, restored.spec, { style: projectProfile(restored).style });
    const docs = buildAmendDocs(restored, rule, d, projectProfile(restored));
    const notice = JSON.stringify(docs.find(doc => doc.id === 'notice'));
    expect(notice).toContain('새봄시장');
    expect(notice).toContain('law@example.org');
    expect(notice).toContain('새봄시 공고');
    expect(notice).not.toContain('한빛');
    expect(reasonInputHash(restored, d.specHash)).toBe(p.prose!.specHash);
    expect(persist).toHaveBeenCalledTimes(1);
  });

  it('기관 스냅샷 없는 기존 작업은 같은 백업 버전으로 확인 상태까지 보존한다', async () => {
    const p = await work();
    const originalHash = reasonInputHash(p, 'amendment');
    const expectedV2 = hashText(JSON.stringify({ version: 2, mode: p.mode, title: p.title, kind: p.kind, profileId: p.profileId, addenda: p.spec.addenda, intent: p.intent, content: 'amendment', evidence: [] }));
    expect(originalHash).toBe(expectedV2);
    const restored = await restoreProjectBackup(await parseProjectBackup(await serializeProjectBackup(p)), {}, async () => true);
    expect(restored.profileSnapshot).toBeUndefined();
    expect(restored.prose).toEqual(p.prose);
    expect(reasonInputHash(restored, 'amendment')).toBe(originalHash);
  });

  it('작업의 기관 ID와 스냅샷 ID가 다르거나 기관 내용이 변조된 파일을 거부한다', async () => {
    const p = await work(institution());
    await expect(serializeProjectBackup({ ...p, profileId: 'hanbit-city' })).rejects.toThrow('profileSnapshot.id');
    const envelope = JSON.parse(await serializeProjectBackup(p));
    envelope.project.profileSnapshot.opinionContact = '임의로 바꾼 연락처';
    await expect(parseProjectBackup(JSON.stringify(envelope))).rejects.toThrow('무결성');
    const prepared = await parseProjectBackup(await serializeProjectBackup(p));
    prepared.project.profileSnapshot!.style.insertMark = '임의로 바꾼 서식';
    await expect(restoreProjectBackup(prepared, {}, async () => true)).rejects.toThrow('미리보기 이후');
  });

  it('기관의 숨은 필드는 작업 백업에도 포함되지 않는다', async () => {
    const p = await work(institution());
    Object.assign(p.profileSnapshot!, { orgKey: 'HIDDEN-SECRET', orgBaseURL: 'https://private.invalid' });
    Object.assign(p.profileSnapshot!.procedures.rule[0], { apiKey: 'HIDDEN-SECRET' });
    const serialized = await serializeProjectBackup(p);
    expect(serialized).not.toMatch(/HIDDEN-SECRET|private\.invalid/);
    const prepared = await parseProjectBackup(serialized);
    expect(profileSchema.safeParse(prepared.project.profileSnapshot).success).toBe(true);
  });

  it('기관 ID가 같아도 서식·공개 연락처·절차가 달라지면 이유서 확인 지문이 바뀐다', async () => {
    const p = await work(institution());
    const original = reasonInputHash(p, 'same-amendment');
    for (const change of [
      (s: Profile) => { s.opinionContact = '새 담당 부서'; },
      (s: Profile) => { s.style.unchangedMark = 'dash'; },
      (s: Profile) => { s.procedures.rule[0].days = 15; },
      (s: Profile) => { s.name = '새 기관 이름'; },
    ]) {
      const changed = structuredClone(p);
      change(changed.profileSnapshot!);
      expect(reasonInputHash(changed, 'same-amendment')).not.toBe(original);
    }
  });

  it('기존 작업에 기관 스냅샷만 추가할 때 담당자가 쓴 이유서를 보존하고 재확인을 요구한다', async () => {
    const p = await work();
    p.prose!.specHash = reasonInputHash(p, 'amendment');
    p.profileSnapshot = snapshotProfile(PROFILES[0]);
    expect(migrateLegacyReasonReview(p, 'amendment')).toEqual({ ...p.prose, specHash: reasonInputHash(p, 'amendment'), reviewed: false });
    expect(p.prose!.reviewed).toBe(true);
  });

  it('기존 미상 기관을 저장한 커스텀 기관으로 교체해 복원하면 내용을 유지하고 이유서를 재확인한다', async () => {
    const p = await work(); p.profileId = 'previous-org';
    const prepared = await parseProjectBackup(await serializeProjectBackup(p));
    expect(prepared.profileKnown).toBe(false);
    await expect(restoreProjectBackup(prepared, {}, async () => true)).rejects.toThrow('기관 프로필');
    const replacement = institution();
    const restored = await restoreProjectBackup(prepared, { profileId: replacement.id, profileSnapshot: replacement }, async () => true);
    expect(restored.profileSnapshot).toEqual(replacement);
    expect(restored.profileId).toBe(replacement.id);
    expect(restored.prose!.reviewed).toBe(false);
    expect(restored.prose!.reason).toBe(p.prose!.reason);
    expect(restored.source).toEqual(p.source);
    await expect(restoreProjectBackup(prepared, { profileId: 'different', profileSnapshot: replacement }, async () => true)).rejects.toThrow('형식과 ID');
  });

  it('같은 ID의 다른 설정으로 복원하거나 기본 기관으로 교체할 때 확인 상태를 해제한다', async () => {
    const p = await work(institution());
    const prepared = await parseProjectBackup(await serializeProjectBackup(p));
    const altered = { ...institution(), name: '기관의 새 이름' };
    const changed = await restoreProjectBackup(prepared, { profileSnapshot: altered }, async () => true);
    expect(changed.profileId).toBe(p.profileId);
    expect(changed.prose!.reviewed).toBe(false);
    expect(changed.profileSnapshot!.name).toBe('기관의 새 이름');
    const builtin = await restoreProjectBackup(prepared, { profileId: 'hanbit-corp' }, async () => true);
    expect(builtin.profileSnapshot).toEqual(PROFILES[1]);
    expect(builtin.prose!.reviewed).toBe(false);
  });
});
