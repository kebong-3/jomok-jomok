import { normalizeCustomProfiles, profileById, type Profile } from '@/config/profiles';

export interface Settings {
  connection: 'default' | 'org' | 'byok';
  modelId?: string; // 기본 연결에서 우선 쓸 모델
  byokModelId?: string;
  byokKey?: string;
  orgBaseURL?: string;
  orgModel?: string;
  orgKey?: string;
  profileId: string;
  customProfiles?: Profile[];
  forceCassette?: boolean; // 진단: 녹화 응답으로 해보기
  forceLawOffline?: boolean; // 진단: 법제처 연결 끊고 해보기
}

const KEY = 'jj:settings';
const DEFAULT: Settings = { connection: 'default', profileId: 'hanbit-city' };

export function loadSettings(): Settings {
  try {
    const s = typeof window !== 'undefined' ? window.localStorage.getItem(KEY) : null;
    const ses = typeof window !== 'undefined' ? window.sessionStorage.getItem(KEY + ':key') : null;
    const org = typeof window !== 'undefined' ? window.sessionStorage.getItem(KEY + ':orgKey') : null;
    const base = s ? { ...DEFAULT, ...JSON.parse(s) } : { ...DEFAULT };
    base.customProfiles = normalizeCustomProfiles(base.customProfiles);
    base.profileId = profileById(base.profileId, base.customProfiles).id;
    if (base.orgKey && typeof window !== 'undefined') {
      window.sessionStorage.setItem(KEY + ':orgKey', base.orgKey);
      const { orgKey: _org, byokKey: _key, ...safe } = base;
      window.localStorage.setItem(KEY, JSON.stringify(safe));
      return { ...safe, byokKey: ses || undefined, orgKey: org || base.orgKey };
    }
    return { ...base, byokKey: ses || undefined, orgKey: org || undefined };
  } catch {
    return DEFAULT;
  }
}

export function saveSettings(s: Settings): boolean {
  try {
    const { byokKey, orgKey, ...rest } = s;
    window.localStorage.setItem(KEY, JSON.stringify({ ...rest, customProfiles: normalizeCustomProfiles(rest.customProfiles) }));
    // 내 키는 이 브라우저 세션에만 보관
    if (byokKey) window.sessionStorage.setItem(KEY + ':key', byokKey);
    else window.sessionStorage.removeItem(KEY + ':key');
    if (orgKey) window.sessionStorage.setItem(KEY + ':orgKey', orgKey);
    else window.sessionStorage.removeItem(KEY + ':orgKey');
    window.dispatchEvent(new Event('jj:settings-changed'));
    return true;
  } catch {
    return false;
  }
}
