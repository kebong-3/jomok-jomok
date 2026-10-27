'use client';

import Link from 'next/link';
import { useId, useRef, useState } from 'react';
import { availableProfiles, snapshotProfile, type Profile } from '@/config/profiles';
import type { Project } from '@/lib/project';
import { loadSettings } from '@/lib/settings';
import {
  PROJECT_BACKUP_MAX_BYTES,
  parseProjectBackup,
  projectBackupFileName,
  restoreProjectBackup,
  serializeProjectBackup,
  type PreparedProjectImport,
} from '@/lib/project-transfer';
import styles from './ProjectTransfer.module.css';

function messageOf(error: unknown) {
  return error instanceof Error ? error.message : '작업 보관파일을 처리하지 못했습니다. 다시 시도해 주세요.';
}

export function ProjectBackupButton({ project, className = 'btn small', label = '작업 보관' }: {
  project: Project;
  className?: string;
  label?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [started, setStarted] = useState(false);

  const backup = async () => {
    setBusy(true);
    setError('');
    setStarted(false);
    try {
      const serialized = await serializeProjectBackup(project);
      const url = URL.createObjectURL(new Blob([serialized], { type: 'application/json;charset=utf-8' }));
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = projectBackupFileName(project);
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2_000);
      setStarted(true);
    } catch (error) {
      setError(messageOf(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <span className={styles.backupAction}>
      <button type="button" className={className} onClick={backup} disabled={busy} title="원문·수정안·근거·기관 설정·검토 상태를 JSON 파일로 내려받습니다">
        {busy ? '보관파일 만드는 중…' : label}
      </button>
      {started && <span className={styles.smallStatus} role="status">다운로드 시작</span>}
      {error && <span className={styles.error} role="alert">{error}</span>}
    </span>
  );
}

export function ProjectImport({ onImported }: { onImported?: (project: Project) => void }) {
  const inputId = useId();
  const profileId = useId();
  const fileInput = useRef<HTMLInputElement>(null);
  const [prepared, setPrepared] = useState<PreparedProjectImport | null>(null);
  const [fileName, setFileName] = useState('');
  const [selectedProfile, setSelectedProfile] = useState('');
  const [profiles, setProfiles] = useState<Profile[]>(() => availableProfiles());
  const [busy, setBusy] = useState<'read' | 'save' | null>(null);
  const [error, setError] = useState('');
  const [restored, setRestored] = useState<Project | null>(null);

  const chooseFile = async (file?: File) => {
    setPrepared(null);
    setRestored(null);
    setSelectedProfile('');
    setError('');
    setFileName(file?.name ?? '');
    if (!file) return;
    setBusy('read');
    try {
      if (file.size > PROJECT_BACKUP_MAX_BYTES) throw new Error('작업 보관파일은 10MB까지 불러올 수 있습니다.');
      const imported = await parseProjectBackup(await file.text());
      setProfiles(availableProfiles(loadSettings().customProfiles));
      setPrepared(imported);
    } catch (error) {
      setError(messageOf(error));
    } finally {
      setBusy(null);
    }
  };

  const restore = async () => {
    if (!prepared) return;
    setBusy('save');
    setError('');
    try {
      const replacement = profiles.find(profile => profile.id === selectedProfile);
      if (selectedProfile && !replacement) throw new Error('복원에 사용할 기관 설정을 다시 선택해 주세요.');
      const project = await restoreProjectBackup(prepared, replacement ? { profileId: replacement.id, profileSnapshot: snapshotProfile(replacement) } : {});
      setRestored(project);
      setPrepared(null);
      if (fileInput.current) fileInput.current.value = '';
      onImported?.(project);
    } catch (error) {
      setError(messageOf(error));
    } finally {
      setBusy(null);
    }
  };

  const project = prepared?.project;
  const counts = project ? {
    accepted: project.spec.ops.filter((op) => op.status === 'accepted').length,
    rejected: project.spec.ops.filter((op) => op.status === 'rejected').length,
    proposed: project.spec.ops.filter((op) => op.status === 'proposed').length,
  } : null;

  return (
    <section className={`panel ${styles.transferPanel}`} aria-labelledby={`${inputId}-heading`}>
      <div className={styles.heading}>
        <div>
          <h3 id={`${inputId}-heading`}>보관한 작업 불러오기</h3>
          <p>다른 브라우저에서도 원문, 수정안, 근거, 작업에 보관된 기관 설정과 검토 상태를 이어갈 수 있습니다. 새 작업으로 저장하므로 기존 작업은 그대로 남습니다.</p>
        </div>
        <span className="badge b-rule">JSON · 최대 10MB</span>
      </div>
      <label className={styles.fileLabel} htmlFor={inputId}>작업 보관파일 선택</label>
      <input ref={fileInput} id={inputId} className={styles.fileInput} type="file" accept=".json,application/json" disabled={busy !== null} onChange={(event) => { void chooseFile(event.target.files?.[0]); }} />
      <p className={styles.note}>작업 보관파일은 원문과 작성 내용을 포함합니다. API 키와 연결 설정은 포함하지 않으며, 불러온 파일은 이 브라우저에서 검증합니다.</p>

      {busy === 'read' && <p role="status">파일 형식과 원문 지문을 확인하고 있습니다…</p>}
      {error && <p className={styles.error} role="alert">{error}</p>}
      {prepared && project && counts && (
        <div className={styles.preview}>
          <div className={styles.previewHeading}>
            <strong>{project.enact?.title || project.title || '제목 없는 작업'}</strong>
            <span className={styles.verified}>원문·작업 지문 확인됨</span>
          </div>
          <p className={styles.fileName}>{fileName}</p>
          <dl className={styles.facts}>
            <div><dt>작업 구분</dt><dd>{project.mode === 'amend' ? '기존 규정 개정' : '새 규정 제정'}</dd></div>
            <div><dt>보관 시각</dt><dd>{new Date(prepared.exportedAt).toLocaleString('ko-KR')}</dd></div>
            <div><dt>기관</dt><dd>{project.profileSnapshot?.name ?? profiles.find((profile) => profile.id === project.profileId)?.name ?? '선택 필요'}{project.profileSnapshot ? ' (작업에 보관됨)' : ''}</dd></div>
            <div><dt>근거</dt><dd>{project.evidence.length}건</dd></div>
            <div><dt>{project.mode === 'amend' ? '수정안 검토' : '제정 조문'}</dt><dd>{project.mode === 'amend' ? `채택 ${counts.accepted} · 제외 ${counts.rejected} · 검토 대기 ${counts.proposed}` : `${project.enact?.outline.length ?? 0}개 조문`}</dd></div>
            <div><dt>이유서</dt><dd>{project.prose ? project.prose.reviewed ? '확인 기록 있음' : '확인 필요' : '아직 작성하지 않음'}</dd></div>
          </dl>
          {prepared.warnings.map((warning) => <p key={warning} className={styles.warning}>{warning}</p>)}
          {!prepared.profileKnown && (
            <div className={styles.profileChoice}>
              <label htmlFor={profileId}>복원한 작업에 사용할 기관</label>
              <select id={profileId} className="field" value={selectedProfile} onChange={(event) => setSelectedProfile(event.target.value)} disabled={busy !== null}>
                <option value="">기관을 직접 선택하세요</option>
                {profiles.map((profile, index) => <option key={profile.id} value={profile.id}>{profile.name}{index === 0 ? ' (기본 프로필·가상기관)' : ''}</option>)}
              </select>
              <p className={styles.note}>선택한 기관의 문서 서식을 사용합니다. 조문 원문은 유지하며, 이유서는 다시 확인해야 합니다.</p>
            </div>
          )}
          <div className={styles.actions}>
            <button type="button" className="btn primary" onClick={() => { void restore(); }} disabled={busy !== null || (!prepared.profileKnown && !selectedProfile)}>{busy === 'save' ? '새 작업으로 저장 중…' : '새 작업으로 불러오기'}</button>
            <button type="button" className="btn ghost" disabled={busy !== null} onClick={() => { setPrepared(null); setFileName(''); if (fileInput.current) fileInput.current.value = ''; }}>취소</button>
          </div>
        </div>
      )}
      {restored && (
        <div className={styles.success} role="status">
          <span><strong>{restored.enact?.title || restored.title || '제목 없는 작업'}</strong>을 새 작업으로 저장했습니다.</span>
          <Link className="btn primary small" href={`/work/${restored.id}`}>복원한 작업 열기</Link>
        </div>
      )}
    </section>
  );
}
