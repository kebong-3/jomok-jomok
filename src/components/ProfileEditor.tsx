'use client';

import { useRef, useState } from 'react';
import { procedureSteps, availableProfiles, createCustomProfile, CUSTOM_PROFILE_LIMIT, parseProfile, PROCEDURE_GROUPS, procedureTemplate, PROFILE_FILE_MAX_BYTES, PROFILE_TYPES, profileById, profileSchema, serializeProfile, snapshotProfile, type ProcedureStep, type Profile } from '@/config/profiles';
import type { Settings } from '@/lib/settings';

type Group = keyof Profile['procedures'];
const FIELD_LABELS: Record<string, string> = { name: '기관명', type: '기관 유형', typeLabel: '기관 유형 설명', headTitle: '기관장 직위', legalDept: '법제 담당부서', council: '의회 이름', noticeNo: '공고번호 형식', noticeDays: '예고기간 일수', opinionContact: '의견제출 담당부서·공개 연락처', style: '신구조문대비표 표시', procedures: '기관의 제·개정 절차', procedureNote: '절차·기간 검토 메모' };

export default function ProfileEditor({ settings, onSave }: {
  settings: Settings;
  onSave: (patch: Pick<Settings, 'profileId' | 'customProfiles'>) => boolean;
}) {
  const profiles = availableProfiles(settings.customProfiles);
  const current = profileById(settings.profileId, settings.customProfiles);
  const [draft, setDraft] = useState<Profile | null>(null);
  const [group, setGroup] = useState<Group>('ordinance');
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const custom = current.id.startsWith('custom-');

  function patch(value: Partial<Profile>) {
    setDraft(p => p ? { ...p, ...value, procedureConfirmed: false, procedureCheckedAt: undefined } : p);
    setError(''); setStatus('');
  }

  function editStep(index: number, value: Partial<ProcedureStep>) {
    if (!draft) return;
    patch({ procedures: { ...draft.procedures, [group]: (draft.procedures[group] ?? procedureSteps(draft, group)).map((step, i) => i === index ? { ...step, ...value } : step) } });
  }

  function save() {
    if (!draft) return;
    const procedures = Object.fromEntries(Object.entries(draft.procedures).map(([kind, steps]) => [kind, steps.map(step => ({ ...step, ...(step.docs ? { docs: step.docs.map(value => value.trim()).filter(Boolean) } : {}) }))]));
    const result = profileSchema.safeParse({ ...draft, procedures });
    if (!result.success) { const field = FIELD_LABELS[String(result.error.issues[0]?.path[0])] ?? '기관 설정'; setError(`${field}의 필수 입력값과 허용 범위를 확인해 주세요.`); return; }
    const stored = settings.customProfiles ?? [];
    if (!stored.some(p => p.id === result.data.id) && stored.length >= CUSTOM_PROFILE_LIMIT) { setError(`기관 설정은 ${CUSTOM_PROFILE_LIMIT}개까지 저장할 수 있습니다. 사용하지 않는 설정을 삭제한 뒤 저장해 주세요.`); return; }
    const customProfiles = [...stored.filter(p => p.id !== result.data.id), result.data];
    if (!onSave({ customProfiles, profileId: result.data.id })) { setError('기관 설정을 저장하지 못했습니다. 브라우저 저장 허용과 남은 공간을 확인한 뒤 다시 시도해 주세요.'); return; }
    setDraft(null); setError(''); setStatus(`${result.data.name} 기관 설정을 저장했습니다. 이후 새로 만드는 작업에 적용합니다.`);
  }

  async function importFile(file?: File) {
    setError(''); setStatus('');
    if (!file) return;
    try {
      if (file.size > PROFILE_FILE_MAX_BYTES) throw new Error('기관 설정 파일은 256KB까지 불러올 수 있습니다.');
      setDraft(parseProfile(await file.text()));
      setStatus('기관 설정을 읽었습니다. 내용과 절차를 확인한 뒤 저장해 주세요. 기존 설정은 덮어쓰지 않습니다.');
    } catch (failure) { setError(failure instanceof Error ? failure.message : '기관 설정을 읽지 못했습니다.'); }
    finally { if (fileInput.current) fileInput.current.value = ''; }
  }

  function exportFile() {
    try {
      const serialized = serializeProfile(current);
      const url = URL.createObjectURL(new Blob([serialized], { type: 'application/json;charset=utf-8' }));
      const anchor = document.createElement('a'); anchor.href = url;
      anchor.download = `${current.name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '').slice(0, 60)}_기관설정.jomok-profile.json`;
      document.body.appendChild(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000);
      setStatus('기관 설정 파일의 다운로드를 시작했습니다. API 키와 연결 주소는 포함하지 않습니다.');
    } catch (failure) { setError(failure instanceof Error ? failure.message : '기관 설정을 내보내지 못했습니다.'); }
  }

  const textField = (key: 'name' | 'headTitle' | 'council' | 'legalDept' | 'noticeNo' | 'opinionContact' | 'typeLabel', label: string, max: number, placeholder?: string) => (
    <label>{label}<input className="field" value={draft?.[key] ?? ''} maxLength={max} onChange={event => patch({ [key]: event.target.value })} placeholder={placeholder} /></label>
  );

  return <section className="step" aria-labelledby="profile-editor-heading">
    <div className="step-h"><h2 id="profile-editor-heading">우리 기관</h2></div>
    <label>새 작업에 사용할 기관<select className="field" value={current.id} onChange={event => { if (onSave({ profileId: event.target.value, customProfiles: settings.customProfiles })) { setDraft(null); setError(''); setStatus('새 작업에 사용할 기관을 바꾸었습니다.'); } else setError('기관 선택을 저장하지 못했습니다.'); }}>
      {profiles.map(profile => <option key={profile.id} value={profile.id}>{profile.name} · {profile.typeLabel}{profile.id.startsWith('custom-') ? ' · 직접 설정' : ''}</option>)}
    </select></label>
    <p className="help">기관명, 공고 연락처, 대비표 표기와 절차를 직접 설정할 수 있습니다. 한빛시·한빛공단은 가상 예시입니다. 저장한 작업에는 당시 기관 설정이 함께 보관되어 이후 설정을 고쳐도 문서가 바뀌지 않습니다.</p>
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
      <button type="button" className="btn small" onClick={() => { setDraft(createCustomProfile(current)); setError(''); setStatus(''); }}>새 기관 만들기</button>
      {custom && <button type="button" className="btn small" onClick={() => { setDraft(snapshotProfile(current)); setError(''); setStatus(''); }}>기관 설정 수정</button>}
      <button type="button" className="btn small" onClick={exportFile}>기관 설정 내보내기</button>
      {custom && <button type="button" className="btn small" onClick={() => { if (onSave({ profileId: 'hanbit-city', customProfiles: (settings.customProfiles ?? []).filter(p => p.id !== current.id) })) { setDraft(null); setStatus('기관 선택 목록에서 삭제했습니다. 저장된 작업의 기관 설정은 유지됩니다.'); } else setError('기관 설정을 삭제하지 못했습니다.'); }}>선택 목록에서 삭제</button>}
    </div>
    <label>다른 기관 설정 불러오기(JSON · 256KB 이하)<input ref={fileInput} className="field" type="file" accept=".json,application/json" onChange={event => { void importFile(event.target.files?.[0]); }} /></label>
    <p className="help">기관 설정 파일에는 기관명·담당부서·공개 연락처와 서식·절차만 포함됩니다. 가져온 설정의 절차·기간은 기관 사정에 맞게 다시 확인하세요.</p>
    {status && <p role="status" className="help">{status}</p>}
    {error && <p role="alert" className="err">{error}</p>}
    {draft && <form onSubmit={event => { event.preventDefault(); save(); }} style={{ marginTop: 20, borderTop: '1px solid var(--line)', paddingTop: 16 }}>
      <h3>{settings.customProfiles?.some(p => p.id === draft.id) ? '기관 설정 수정' : '새 기관 설정'}</h3>
      <div className="grid2">
        {textField('name', '기관명', 120, '예) ○○시·○○공단')}
        <label>기관 유형<select className="field" value={draft.type} onChange={event => { const type = event.target.value as Profile['type']; patch({ type, typeLabel: PROFILE_TYPES[type] }); }}>{Object.entries(PROFILE_TYPES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        {textField('typeLabel', '기관 유형 설명', 120, '예) 기초자치단체')}
        {textField('headTitle', '기관장 직위', 80, '예) 시장·구청장·이사장')}
        {textField('legalDept', '법제 담당부서', 120)}
        {textField('council', '의회 이름(해당 시)', 120)}
        {textField('noticeNo', '공고번호 형식', 200, '○○시 공고 제{yyyy}-{n}호')}
        <label>예고기간 계산에 사용할 일수<input className="field" type="number" min={1} max={365} value={Number.isNaN(draft.noticeDays) ? '' : draft.noticeDays} onChange={event => patch({ noticeDays: event.target.valueAsNumber })} /></label>
      </div>
      {textField('opinionContact', '의견제출 담당부서·공개 연락처', 1000, '주소, 전화, 팩스, 전자우편 등')}
      <p className="help">{'{yyyy}'}는 연도, {'{n}'}은 확정 전 공고번호 자리입니다. 입력한 예고 일수는 날짜 계산용이며, 법정기간을 확인한 것으로 처리하지 않습니다.</p>
      <details style={{ margin: '16px 0' }}><summary>신구조문대비표 표시 설정</summary>
        <div className="grid2" style={{ marginTop: 12 }}>
          <label>바뀌지 않은 부분<select className="field" value={draft.style.unchangedMark} onChange={event => patch({ style: { ...draft.style, unchangedMark: event.target.value as Profile['style']['unchangedMark'] } })}><option value="dash">줄표로 표시</option><option value="ellipsis">말줄임표로 표시</option><option value="full">전문 표시</option></select></label>
          <label className="opt"><input type="checkbox" checked={draft.style.titleAlways} onChange={event => patch({ style: { ...draft.style, titleAlways: event.target.checked } })} />조 제목을 항상 표시</label>
          {([['omitText', '생략 표시'], ['sameText', '현행과 같은 부분 표시'], ['insertMark', '신설 표시'], ['deleteMark', '삭제 표시']] as const).map(([key, label]) => <label key={key}>{label}<input className="field" maxLength={80} value={draft.style[key]} onChange={event => patch({ style: { ...draft.style, [key]: event.target.value } })} /></label>)}
        </div>
      </details>
      <details style={{ margin: '16px 0' }}><summary>기관의 제·개정 절차 편집</summary>
        <p className="help">절차는 확인할 항목의 초안입니다. 담당자 검토에 따라 추가·수정하세요. 기관 유형을 바꾼 경우 필요하면 아래 기본 항목을 다시 불러오세요.</p>
        <button type="button" className="btn small" onClick={() => patch({ procedures: procedureTemplate(draft.type) })}>현재 기관 유형의 기본 절차 불러오기</button>
        <label style={{ display: 'block', marginTop: 12 }}>편집할 규정 유형<select className="field" value={group} onChange={event => setGroup(event.target.value as Group)}>{Object.entries(PROCEDURE_GROUPS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        {(draft.procedures[group] ?? procedureSteps(draft, group)).map((step, index) => <fieldset key={step.id} style={{ margin: '12px 0', padding: 12, border: '1px solid var(--line)' }}><legend>절차 {index + 1}</legend>
          <label>절차 이름<input className="field" value={step.name} maxLength={200} onChange={event => editStep(index, { name: event.target.value })} /></label>
          <div className="grid2">
            <label>기관에서 확인한 기한(일, 선택)<input className="field" type="number" min={1} max={3650} value={step.days ?? ''} onChange={event => editStep(index, { days: event.target.value === '' ? undefined : event.target.valueAsNumber })} /></label>
            <label>필요 문서(쉼표로 구분)<input className="field" maxLength={2000} value={step.docs?.join(',') ?? ''} onChange={event => editStep(index, { docs: event.target.value.split(',') })} /></label>
          </div>
          <label>확인할 근거·기관 규정<input className="field" value={step.basis ?? ''} maxLength={1000} onChange={event => editStep(index, { basis: event.target.value })} /></label>
          <label>실무 메모<textarea className="field" rows={2} maxLength={2000} value={step.tip ?? ''} onChange={event => editStep(index, { tip: event.target.value })} /></label>
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button type="button" className="btn small" disabled={index === 0} onClick={() => { const steps = [...(draft.procedures[group] ?? procedureSteps(draft, group))]; [steps[index - 1], steps[index]] = [steps[index], steps[index - 1]]; patch({ procedures: { ...draft.procedures, [group]: steps } }); }} aria-label={`절차 ${index + 1} 위로 이동`}>위로</button>
            <button type="button" className="btn small" onClick={() => patch({ procedures: { ...draft.procedures, [group]: (draft.procedures[group] ?? procedureSteps(draft, group)).filter((_, i) => i !== index) } })} aria-label={`절차 ${index + 1} 삭제`}>삭제</button>
          </div>
        </fieldset>)}
        <button type="button" className="btn small" disabled={(draft.procedures[group] ?? procedureSteps(draft, group)).length >= 25} onClick={() => patch({ procedures: { ...draft.procedures, [group]: [...(draft.procedures[group] ?? procedureSteps(draft, group)), { id: `step-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`, name: '' }] } })}>절차 추가</button>
      </details>
      <label>절차·기간 검토 메모<textarea className="field" rows={2} maxLength={2000} value={draft.procedureNote ?? ''} onChange={event => patch({ procedureNote: event.target.value })} placeholder="확인한 법령·기관 규정, 적용 조건 등을 적어 주세요." /></label>
      <label className="opt"><input type="checkbox" checked={!!draft.procedureConfirmed} onChange={event => setDraft({ ...draft, procedureConfirmed: event.target.checked, procedureCheckedAt: event.target.checked ? new Date().toISOString() : undefined })} />이 기관에 적용할 절차와 예고기간을 담당자가 확인했습니다.</label>
      <p className="help">미확인 상태로도 저장할 수 있으며 작업 화면에 확인 필요로 표시합니다. 설정을 편집하면 확인 표시가 해제됩니다.</p>
      <div style={{ display: 'flex', gap: 8 }}><button className="btn primary" type="submit">기관 설정 저장</button><button className="btn" type="button" onClick={() => { setDraft(null); setError(''); }}>취소</button></div>
    </form>}
  </section>;
}
