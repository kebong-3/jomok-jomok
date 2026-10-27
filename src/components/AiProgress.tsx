'use client';
import { useEffect, useState } from 'react';
import type { AiProgressEvent } from '@/lib/ai-protocol';
import styles from './AiProgress.module.css';
import Jomoki from './Jomoki';

export interface AiProgressProps {
  title: string;
  detail?: string;
  completed?: number;
  total?: number;
  startedAt?: number;
  modelLabel?: string;
  phase?: AiProgressEvent['phase'];
  onCancel?: () => void;
}

/** Shows elapsed time and actual checkpoints, never an estimated success percentage. */
export default function AiProgress({ title, detail, completed, total, startedAt, modelLabel, phase, onCancel }: AiProgressProps) {
  const [mountedAt] = useState(() => Date.now());
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const tick = () => setElapsed(Math.max(0, Math.floor((Date.now() - (startedAt ?? mountedAt)) / 1000)));
    tick(); const timer = setInterval(tick, 1000); return () => clearInterval(timer);
  }, [startedAt, mountedAt]);
  const phaseText = phase === 'waiting' ? '제공자 요청 한도에 따라 잠시 대기한 뒤 다시 요청해요' : phase === 'validating' ? '응답 형식 확인 중' : phase === 'repairing' ? '응답 형식 다시 확인 중' : phase === 'requesting' ? 'AI 응답 기다리는 중' : '작성할 내용 준비 중';
  const checkpoints = typeof total === 'number' && total > 0 && typeof completed === 'number';
  return (
    <section className={styles.panel} aria-label="AI 작업 진행" aria-busy="true">
      <Jomoki size={94} mood="thinking" motion="loop" />
      <div className={styles.body}>
        <div className={styles.eyebrow}><span className={styles.dot} /> 조목이가 함께 살피는 중</div>
        <h3>{title}</h3>
        <p className={styles.detail} role="status" aria-live="polite">{detail || '완성된 응답이 도착하면 이 화면에 반영할게요.'}</p>
        {checkpoints && <div className={styles.checkpoints}><progress value={Math.min(completed, total)} max={total} aria-label="작성한 조문 수" /><span>{completed} / {total}개 조문 작성</span></div>}
        <div className={styles.meta}><span>{phaseText}</span>{modelLabel && <span>{modelLabel}</span>}<span aria-live="off">{elapsed >= 60 ? `${Math.floor(elapsed / 60)}분 ${elapsed % 60}초` : `${elapsed}초`} 경과</span></div>
        <p className={styles.note}>{checkpoints ? '완성된 묶음부터 보관합니다. 중단해도 작성한 조문을 유지하고 나머지만 이어 쓸 수 있어요.' : '아직 결과가 나온 상태는 아닙니다. 완성될 때까지 진행 상태를 표시하고, 응답이 도착하면 검토할 내용을 보여 드릴게요.'}</p>
        {elapsed >= 45 && <p className={styles.patience}>근거와 조문이 많으면 시간이 더 걸릴 수 있어요. 연결이 유지되는 동안 계속 기다립니다.</p>}
      </div>
      {onCancel && <button className="btn small" onClick={onCancel}>작성 중단</button>}
    </section>
  );
}
