'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { loadSettings } from '@/lib/settings';

export interface ModelStatus {
  id: string; label: string; connected: boolean; configured?: boolean; verified?: boolean;
  verifiedAt?: string; actualModel?: string; note: string; family: string; limits?: string;
  keyEnv?: string; keyAliases?: string[];
}
export function useModels() {
  const [models, setModels] = useState<ModelStatus[] | null>(null);
  useEffect(() => {
    let active = true;
    const refresh = () => { void fetch('/api/models', { cache: 'no-store' }).then((r) => r.json()).then((j) => { if (active) setModels(Array.isArray(j.models) ? j.models : []); }).catch(() => { if (active) setModels([]); }); };
    refresh();
    window.addEventListener('jj:models-changed', refresh);
    return () => { active = false; window.removeEventListener('jj:models-changed', refresh); };
  }, []);
  return models;
}

export default function Header({ children }: { children?: React.ReactNode }) {
  const models = useModels();
  const [conn, setConn] = useState('default');
  const [demo, setDemo] = useState(false);
  useEffect(() => {
    const refresh = () => { const s = loadSettings(); setConn(s.connection); setDemo(!!s.forceCassette); };
    refresh(); window.addEventListener('jj:settings-changed', refresh);
    return () => window.removeEventListener('jj:settings-changed', refresh);
  }, []);
  const configured = models?.filter((m) => m.configured ?? m.connected) ?? [];
  const verified = configured.find((m) => m.verified);
  const ai =
    demo ? { cls: 'half', text: 'AI: 예시 모드' } :
    conn === 'byok' ? { cls: 'half', text: 'AI: 내 키 설정' } :
    conn === 'org' ? { cls: 'half', text: 'AI: 기관 서버 설정' } :
    models === null ? { cls: 'off', text: 'AI 설정 확인 중' } :
    verified ? { cls: 'on', text: `AI: 응답 확인 · ${verified.label.split(' · ')[0]}` } :
    configured.length ? { cls: 'on', text: `AI 연결 · 모델 ${configured.length}개` } : { cls: 'half', text: 'AI 예시 모드' };
  return (
    <header className="top">
      <div className="top-in">
        <Link href="/" className="brand" aria-label="조목조목 홈"><span className="brand-mark">조목<span>조목</span></span><span className="brand-sub">규정 제·개정 도우미</span></Link>
        {children}
        <nav className="nav" aria-label="주 메뉴"><Link href="/start?mode=enact">제정</Link><Link href="/start?mode=amend">개정</Link><Link href="/impact">상위법 영향</Link><Link href="/law">조례 조사</Link><Link href="/knowledge">입안 자료실</Link><Link href="/guide">사용 안내</Link><Link href="/settings">설정</Link></nav>
        <div className="status"><Link href="/settings" className={`chip ${ai.cls}`} title="AI 연결 설정과 실제 응답 시험"><span className={`dot ${ai.cls === 'half' ? 'half' : ai.cls === 'off' ? 'off' : ''}`} />{ai.text}</Link></div>
      </div>
    </header>
  );
}
