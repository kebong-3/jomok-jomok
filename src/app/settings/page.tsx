'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import Header, { useModels } from '@/components/Header';
import ProfileEditor from '@/components/ProfileEditor';
import ApiSetupGuide from '@/components/ApiSetupGuide';
import { loadSettings, saveSettings, type Settings } from '@/lib/settings';
import { aiHeaders } from '@/lib/ai';

interface Diag {
  version?: string;
  commit: string;
  region: string;
  law: { law: { ok: boolean; via?: string; ms: number; note?: string; code?: string }; hasOC: boolean; hasRelay: boolean; snapshots: { title: string; date: string; articles: number; usable?: boolean }[] };
  knowledge?: { ok: boolean; version: string; documents: number; pages: number; chunks: number; method: string };
}
interface Probe {
  ok: boolean; modelId: string; modelLabel?: string; family?: string; actualModel?: string;
  checkedAt?: string; latencyMs?: number; error?: { code: string; message: string };
}

export default function SettingsPage() {
  const models = useModels();
  const [s, setS] = useState<Settings | null>(null);
  const [diag, setDiag] = useState<Diag | null>(null);
  const [diagBusy, setDiagBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [probes, setProbes] = useState<Record<string, Probe>>({});
  const [probing, setProbing] = useState<string | null>(null);
  const [diagError, setDiagError] = useState('');
  const [saveError, setSaveError] = useState('');
  const selectedProbeVersion = useRef(0);

  useEffect(() => setS(loadSettings()), []);
  const set = (patch: Partial<Settings>) => {
    if (!s) return false;
    const next = { ...s, ...patch };
    if (!saveSettings(next)) { setSaveError('설정을 저장하지 못했습니다. 브라우저 저장 허용과 남은 공간을 확인해 주세요.'); setSaved(false); return false; }
    if (Object.keys(patch).some(key => ['connection', 'byokKey', 'byokModelId', 'orgBaseURL', 'orgModel', 'orgKey'].includes(key))) {
      selectedProbeVersion.current++;
      setProbes(previous => { const { selected: _selected, ...rest } = previous; return rest; });
    }
    setS(next);
    setSaveError('');
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
    return true;
  };

  const runDiag = async () => {
    setDiagBusy(true);
    setDiagError('');
    setDiag(null);
    try {
      const r = await fetch('/api/diag', { cache: 'no-store', signal: AbortSignal.timeout(35_000) });
      if (!r.ok) throw new Error(`서버 진단 실패(HTTP ${r.status})`);
      setDiag(await r.json());
    } catch (error) {
      setDiagError((error as Error).message);
    } finally {
      setDiagBusy(false);
    }
  };

  const runProbe = async (modelId: string, selected = false) => {
    if (!s) return;
    const id = selected ? 'selected' : modelId;
    const selectedVersion = selectedProbeVersion.current;
    setProbing(id);
    try {
      const r = await fetch('/api/models/probe', {
        method: 'POST', headers: aiHeaders(selected ? s : { ...s, connection: 'default' }),
        body: JSON.stringify({ modelId }), signal: AbortSignal.timeout(30_000),
      });
      const result = await r.json().catch(() => null);
      if (!result) throw new Error(`응답을 읽지 못했습니다(HTTP ${r.status}).`);
      if (selected && selectedVersion !== selectedProbeVersion.current) return;
      setProbes((p) => ({ ...p, [id]: result }));
      window.dispatchEvent(new Event('jj:models-changed'));
    } catch (error) {
      if (selected && selectedVersion !== selectedProbeVersion.current) return;
      setProbes((p) => ({ ...p, [id]: { ok: false, modelId, error: { code: 'PROBE_FAILED', message: (error as Error).message } } }));
    } finally { setProbing(null); }
  };
  const probeResult = (r?: Probe) => !r ? null : <div role="status" style={{ marginTop: 6 }}>
    <span className={`badge ${r.ok ? 'b-law' : 'b-unk'}`}>{r.ok ? '실제 응답 성공' : '실제 응답 실패'}</span>
    <p className="help" style={{ margin: '4px 0' }}>{r.ok ? `${r.actualModel ?? r.modelLabel ?? r.modelId} · ${((r.latencyMs ?? 0) / 1000).toFixed(1)}초 · ${r.checkedAt ? new Date(r.checkedAt).toLocaleString('ko-KR') : ''}` : `${r.error?.message ?? '연결 설정을 확인하세요.'}${r.error?.code ? ` (${r.error.code})` : ''}`}</p>
  </div>;

  if (!s) return <Header />;

  return (
    <>
      <Header />
      <main className="settings">
        <h1>설정·진단 {saved && <span className="badge b-law" style={{ verticalAlign: 'middle' }}>저장됨</span>}</h1>
        <p className="help" style={{ marginBottom: 20 }}>AI 응답, 공식 법령 조회, 입안 자료실 검색을 각각 확인합니다. 처음 연결한다면 <a href="#api-setup">API 연결·배포 안내</a>를 보세요.</p>
        {saveError && <p role="alert" className="err">{saveError}</p>}

        <section className="step">
          <div className="step-h"><h2>AI 연결</h2></div>
          <label className="opt">
            <input type="radio" name="conn" checked={s.connection === 'default'} onChange={() => set({ connection: 'default' })} />
            <div>
              <b>기본 연결</b>
              <p className="help" style={{ margin: '2px 0 0' }}>운영자가 연결한 AI를 사용합니다. 작업은 이 브라우저에 보관되며, AI 실행에 필요한 원문·요청·근거는 앱 서버를 거쳐 선택한 제공자에게 전달됩니다. 제공자의 보관·이용 정책과 요금·호출 한도를 확인하세요.</p>
              {s.connection === 'default' && models && (
                <select className="field" style={{ marginTop: 10 }} value={s.modelId ?? ''} onChange={(e) => set({ modelId: e.target.value || undefined })} aria-label="기본 연결에서 우선 사용할 AI 모델">
                  <option value="">자동(운영자가 설정한 우선순위)</option>
                  {models.filter((m) => m.configured ?? m.connected).map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                </select>
              )}
            </div>
          </label>
          <label className="opt">
            <input type="radio" name="conn" checked={s.connection === 'org'} onChange={() => set({ connection: 'org' })} />
            <div style={{ flex: 1 }}>
              <b>기관 서버</b>
              <p className="help" style={{ margin: '2px 0 0' }}>운영자가 등록한 OpenAI 호환 기관 서버를 연결합니다. 등록되지 않은 주소는 연결할 수 없습니다. 이 공개 배포에서는 입력이 조목조목 서버를 거쳐 전달됩니다. 기관 내부에서만 처리하려면 앱도 내부망에 배포해야 합니다.</p>
              {s.connection === 'org' && (
                <div className="grid2" style={{ marginTop: 10 }}>
                  <input className="field" value={s.orgBaseURL ?? ''} onChange={(e) => set({ orgBaseURL: e.target.value })} placeholder="주소 예) https://ai.기관.go.kr/v1" aria-label="기관 서버 주소" />
                  <input className="field" value={s.orgModel ?? ''} onChange={(e) => set({ orgModel: e.target.value })} placeholder="모델 이름 예) exaone-4.0-32b" aria-label="모델 이름" />
                  <input className="field" type="password" autoComplete="off" value={s.orgKey ?? ''} onChange={(e) => set({ orgKey: e.target.value })} placeholder="기관 API 키(필수)" aria-label="기관 서버 API 키" />
                </div>
              )}
            </div>
          </label>
          <label className="opt">
            <input type="radio" name="conn" checked={s.connection === 'byok'} onChange={() => set({ connection: 'byok' })} />
            <div style={{ flex: 1 }}>
              <b>내 키</b>
              <p className="help" style={{ margin: '2px 0 0' }}>직접 발급한 키를 브라우저 세션 저장소에 보관합니다. 호출할 때 앱 서버로 전송되어 제공자 인증에 사용됩니다. 작업 보관파일에는 키가 들어가지 않으며, 사용을 마친 뒤 입력란을 비워 키를 지울 수 있습니다.</p>
              {s.connection === 'byok' && (
                <div className="grid2" style={{ marginTop: 10 }}>
                  <select className="field" value={s.byokModelId ?? 'gptoss-120b@groq'} onChange={(e) => set({ byokModelId: e.target.value })} aria-label="내 API 키로 사용할 AI 모델">
                    {(models ?? []).filter((m) => m.id !== 'custom').map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                  </select>
                  <input className="field" type="password" autoComplete="off" value={s.byokKey ?? ''} onChange={(e) => set({ byokKey: e.target.value })} placeholder="선택한 제공자의 API 키" aria-label="선택한 AI 제공자의 API 키" />
                </div>
              )}
            </div>
          </label>
          {s.connection !== 'default' && <div style={{ marginTop: 12 }}><button className="btn" disabled={!!probing} onClick={() => runProbe(s.connection === 'org' ? 'custom' : s.byokModelId ?? 'gptoss-120b@groq', true)}>{probing === 'selected' ? 'AI 응답 확인 중…' : '선택한 연결로 실제 응답 시험'}</button>{probeResult(probes.selected)}</div>}
        </section>

        <ProfileEditor settings={s} onSave={set} />

        <section className="step">
          <div className="step-h"><h2>모델 목록</h2><span className="help" style={{ margin: 0 }}>대회 권장 계열 표시</span></div>
          <p className="help">키 설정 여부와 실제 응답 성공을 구분합니다. 시험 버튼은 짧은 확인 문장만 보내며, 다른 모델로 바꾸거나 예시 답변을 쓰지 않습니다. 아래 목록은 서버의 기본 연결 기준입니다.</p>
          {models && !models.some((m) => m.configured ?? m.connected) && <div className="panel panel-b" role="status" style={{ marginBottom: 16 }}><b>현재 배포에서 사용할 AI 설정을 찾지 못했습니다.</b><p className="help">운영 주소가 연결된 Vercel 프로젝트 jomokjomok-law의 Production 환경에 GOOGLE_API_KEY, GROQ_API_KEY, OPENAI_API_KEY 중 사용할 제공자의 키를 설정한 뒤 새로 배포하세요. <a href="#api-setup">변수별 설정 방법</a>을 확인할 수 있습니다.</p></div>}
          <div style={{ overflowX: 'auto' }}><table className="plain">
            <thead><tr><th>모델</th><th>설명</th><th>한도</th><th>상태</th></tr></thead>
            <tbody>
              {(models ?? []).map((m) => (
                <tr key={m.id}>
                  <td><b>{m.label}</b></td>
                  <td>{m.note}</td>
                  <td>{m.limits ?? '—'}</td>
                  <td><span className={`badge ${(m.configured ?? m.connected) ? 'b-snap' : 'b-unk'}`}>{(m.configured ?? m.connected) ? '설정 감지' : '설정 없음'}</span><button className="btn small" style={{ display: 'block', marginTop: 6 }} disabled={!!probing || !(m.configured ?? m.connected)} onClick={() => runProbe(m.id)} aria-label={`${m.label} 실제 응답 시험`}>{probing === m.id ? '시험 중…' : '실제 응답 시험'}</button>{probeResult(probes[m.id])}</td>
                </tr>
              ))}
              {!models && <tr><td colSpan={4}>불러오는 중…</td></tr>}
            </tbody>
          </table></div>
          {Object.values(probes).some((p) => p.ok) && <p className="help">짧은 연결 시험이 성공했습니다. 대회 구동 입증에는 같은 모델로 실제 제정·개정 작업을 끝까지 실행한 결과가 추가로 필요합니다.</p>}
        </section>

        <section className="step">
          <div className="step-h" style={{ flexWrap: 'wrap' }}><h2>법제처·자료실·배포 진단</h2><button className="btn small" style={{ marginLeft: 'auto' }} onClick={runDiag} disabled={diagBusy}>{diagBusy ? '확인 중…' : '법제처·자료실·배포 확인하기'}</button></div>
          <p className="help" style={{ marginBottom: 16 }}>공식 법령 연결과 앱에 포함된 참고자료 색인을 별도로 점검합니다. 자료실 검색이 정상이어도 AI 연결은 위의 실제 응답 시험으로 확인해야 합니다.</p>
          {diagError && <p className="err" role="alert">{diagError}</p>}
          {diag && (
            <dl className="kv" style={{ marginBottom: 16 }}>
              <dt>법제처</dt>
              <dd>{diag.law.law.ok ? <span className="badge b-law">공식 조회 성공 · {diag.law.law.via === 'relay' ? '중계 서버' : '직접'} · {diag.law.law.ms}ms</span> : <span className="badge b-snap">공식 조회 실패 · 제공된 일부 저장본만 사용 가능</span>}{diag.law.law.note && <span className="help" style={{ display: 'block' }}>{diag.law.law.note}{diag.law.law.code ? ` (${diag.law.law.code})` : ''}</span>}</dd>
              <dt>인증키</dt>
              <dd>{diag.law.hasOC ? '있음' : '없음'} · 중계 서버 {diag.law.hasRelay ? '있음' : '없음'}</dd>
              <dt>저장본</dt>
              <dd>{diag.law.snapshots.map((x) => `${x.title}(${x.date} 기준, ${x.articles}개 조${x.usable === false ? ', 시행예정으로 사용 제외' : ''})`).join(', ')}</dd>
              <dt>입안 자료실</dt>
              <dd>{diag.knowledge ? <><span className={`badge ${diag.knowledge.ok ? 'b-law' : 'b-unk'}`}>{diag.knowledge.ok ? '자료 색인 검색 성공' : '자료 색인 확인 필요'}</span><span className="help" style={{ display: 'block' }}>원본 {diag.knowledge.documents}개 · PDF {diag.knowledge.pages.toLocaleString('ko-KR')}쪽 · 검색 단위 {diag.knowledge.chunks.toLocaleString('ko-KR')}개<br />자료 버전 {diag.knowledge.version} · 추가 검색 API 키 불필요</span></> : <span>이 배포에서 자료실 진단 정보를 받지 못했습니다. 배포 버전을 확인해 주세요.</span>}</dd>
              <dt>배포</dt>
              <dd>{diag.version ? `v${diag.version} · ` : ''}{diag.commit} · {diag.region}</dd>
            </dl>
          )}
          <label className="opt">
            <input type="checkbox" checked={!!s.forceCassette} onChange={(e) => set({ forceCassette: e.target.checked })} />
            <div><b>예시 응답으로 해보기</b><p className="help" style={{ margin: '2px 0 0' }}>지원되는 예시 규정에서 미리 만들어 둔 응답을 씁니다. 실제 AI 성공으로 표시하지 않습니다. 자료실 AI 답변과 모델 응답 시험은 실제 연결 상태를 확인합니다.</p></div>
          </label>
          <label className="opt">
            <input type="checkbox" checked={!!s.forceLawOffline} onChange={(e) => set({ forceLawOffline: e.target.checked })} />
            <div><b>법제처 연결 없이 해보기</b><p className="help" style={{ margin: '2px 0 0' }}>일부 법령의 저장본으로 진행 가능한 범위를 확인합니다. 기준일과 확인 필요 상태를 표시하며 유사 규정의 공식 검색 결과를 만들어 내지 않습니다.</p></div>
          </label>
        </section>
        <ApiSetupGuide />
        <p className="help"><Link href="/knowledge">입안 자료실</Link>에서 기준을 확인하거나 <Link href="/guide">사용 안내</Link>를 따라 실제 제·개정 작업을 시작할 수 있습니다.</p>
      </main>
    </>
  );
}
