'use client';

import { useEffect, useState } from 'react';
import Jomoki, { type JomokiMood } from './Jomoki';
import styles from './JomokiShowcase.module.css';

const EXPRESSIONS: { mood: JomokiMood; label: string; title: string; message: string; shape: string }[] = [
  { mood: 'wave', label: '인사', title: '반가워요, 조목이에요!', message: '처음이어도 괜찮아요. 한 조씩 같이 시작해요.', shape: '✦' },
  { mood: 'smile', label: '미소', title: '막막한 시작, 같이 풀어요.', message: '제정인지 개정인지 고르면 다음 일을 안내할게요.', shape: '⌣' },
  { mood: 'laugh', label: '활짝 웃음', title: '조목조목, 함께 해봐요!', message: '어려운 문장은 쉽게, 빠뜨린 내용은 꼼꼼히.', shape: '◡' },
  { mood: 'thinking', label: '생각', title: '근거부터 차근차근 살펴요.', message: '위임 범위와 시행일, 놓치기 쉬운 부분을 챙겨요.', shape: '···' },
  { mood: 'celebrate', label: '응원', title: '한 걸음씩 채워가요!', message: '작은 시작부터 초안 검토까지 함께할게요.', shape: '☆' },
  { mood: 'care', label: '다정함', title: '잠깐 막혀도 괜찮아요.', message: '헷갈리는 조문은 하나씩 골라 함께 살펴요.', shape: '♡' },
];

/** Home-only expression preview, separate from the actual drafting status. */
export default function JomokiShowcase({ className = '', compact = false }: { className?: string; compact?: boolean }) {
  const [index, setIndex] = useState(0);
  const [automatic, setAutomatic] = useState(true);
  const [paused, setPaused] = useState(false);
  const [reduced, setReduced] = useState(false);
  const [visible, setVisible] = useState(true);
  const expression = EXPRESSIONS[index];

  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => {
      setReduced(preference.matches);
      if (preference.matches) setAutomatic(false);
    };
    sync();
    preference.addEventListener('change', sync);
    return () => preference.removeEventListener('change', sync);
  }, []);

  useEffect(() => {
    let timer: number | undefined;
    const sync = () => {
      setVisible(!document.hidden);
      if (timer !== undefined) window.clearInterval(timer);
      timer = undefined;
      if (automatic && !paused && !reduced && !document.hidden) {
        timer = window.setInterval(() => setIndex(current => (current + 1) % EXPRESSIONS.length), 8_000);
      }
    };
    sync();
    document.addEventListener('visibilitychange', sync);
    return () => {
      if (timer !== undefined) window.clearInterval(timer);
      document.removeEventListener('visibilitychange', sync);
    };
  }, [automatic, paused, reduced]);

  const choose = (next: number) => { setIndex(next); setAutomatic(false); };

  return <section className={`${styles.showcase} ${className}`} aria-label="조목이의 표정과 움직임">
    <div className={styles.stage}>
      <div className={styles.orbit} aria-hidden="true" />
      <div className={styles.speech} aria-live="off"><strong>{expression.title}</strong><p>{expression.message}</p></div>
      <div className={styles.character}><Jomoki key={expression.mood} size={252} mood={expression.mood} motion={paused || reduced || !visible ? 'none' : 'loop'} decorative={false} /></div>
      <span className={styles.note} aria-hidden="true">조 · 항 · 호 · 목<br /><b>꼼꼼히 챙겨요</b></span>
    </div>
    {compact ? <div className={styles.compactControls}>
      <button type="button" onClick={() => choose((index + 1) % EXPRESSIONS.length)}>조목이 표정 바꾸기 <span aria-hidden="true">↻</span></button>
      <button type="button" onClick={() => setPaused(value => !value)} disabled={reduced}>{reduced ? '움직임 줄이기 적용 중' : paused ? '움직임 켜기' : '움직임 멈추기'}</button>
    </div> : <>
    <div className={styles.controls}>
      <div className={styles.controlHeading}><h2>지금 조목이는 <span>{expression.label}</span></h2><span className={styles.preview}>표정 미리보기</span></div>
      <div className={styles.expressions} role="group" aria-label="조목이 표정 선택">{EXPRESSIONS.map((item, i) => <button key={item.mood} type="button" aria-pressed={i === index} onClick={() => choose(i)}><span aria-hidden="true">{item.shape}</span>{item.label}</button>)}</div>
      <div className={styles.motionControls}>
        <button type="button" onClick={() => setPaused(value => !value)} disabled={reduced}>{reduced ? '움직임 줄이기 적용 중' : paused ? '움직임 켜기' : '움직임 멈추기'}</button>
        <button type="button" onClick={() => setAutomatic(value => !value)} disabled={reduced}>{automatic ? '자동 전환 끄기' : '자동 전환 켜기'}</button>
      </div>
      <p className={styles.help}>{reduced ? '기기의 움직임 줄이기 설정을 따르고 있어요. 표정은 직접 골라볼 수 있어요.' : paused ? '움직임과 자동 전환을 잠시 멈췄어요.' : automatic ? '8초마다 다른 표정으로 인사해요. 표정을 고르면 그 모습으로 머물러요.' : '고른 표정으로 머물러요. 자동 전환을 켜면 다른 표정도 볼 수 있어요.'}</p>
    </div>
    </>}
  </section>;
}
