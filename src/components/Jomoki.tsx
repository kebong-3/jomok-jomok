import type { CSSProperties } from 'react';
import styles from './Jomoki.module.css';

export type JomokiMood = 'guide' | 'wave' | 'smile' | 'laugh' | 'thinking' | 'celebrate' | 'care';
export type JomokiMotion = 'once' | 'loop' | 'none';

const LABELS: Record<JomokiMood, string> = {
  guide: '조문을 함께 살피는 조목이',
  wave: '손을 흔들며 인사하는 조목이',
  smile: '방긋 웃는 조목이',
  laugh: '눈을 접고 활짝 웃는 조목이',
  thinking: '연필을 들고 곰곰이 생각하는 조목이',
  celebrate: '두 팔을 들고 응원하는 조목이',
  care: '고개를 기울여 다정하게 살피는 조목이',
};

/** Code-native companion. Expressions convey guidance, never legal approval. */
export default function Jomoki({ size = 88, mood = 'guide', motion = 'once', decorative = true, className = '' }: {
  size?: number;
  mood?: JomokiMood;
  motion?: JomokiMotion;
  decorative?: boolean;
  className?: string;
}) {
  const happyEyes = mood === 'laugh' || mood === 'celebrate';
  const waving = mood === 'wave' || mood === 'celebrate';
  return <span className={`${styles.character} ${styles[mood]} ${className}`} data-motion={motion} style={{ '--jomoki-size': `${size}px`, '--jomoki-repeat': motion === 'loop' ? 'infinite' : '1' } as CSSProperties}>
    <svg viewBox="0 0 128 136" role={decorative ? undefined : 'img'} aria-hidden={decorative || undefined} aria-label={decorative ? undefined : LABELS[mood]} focusable="false">
      <ellipse className={styles.shadow} cx="66" cy="128" rx="35" ry="5" fill="#d8e8e2" opacity=".65" />
      <g className={styles.body}>
        <path d="M47 114v10m31-10v10" stroke="#304e58" strokeWidth="5" strokeLinecap="round" />
        <path d="M40 125h12m21 0h12" stroke="#7983b5" strokeWidth="5" strokeLinecap="round" />
        <rect x="34" y="18" width="72" height="96" rx="13" fill="#d1eae2" stroke="#456367" strokeWidth="2.5" transform="rotate(5 70 66)" />
        <path d="M100 47h11a5 5 0 0 1 5 5v8h-16" fill="#d9d4f4" stroke="#666995" strokeWidth="1.5" />
        <path d="M100 63h11a5 5 0 0 1 5 5v8h-16" fill="#d3e9f5" stroke="#618395" strokeWidth="1.5" />
        <path d="M100 79h11a5 5 0 0 1 5 5v8h-16" fill="#f4e2b4" stroke="#9a8559" strokeWidth="1.5" />
        <path d="M100 95h11a5 5 0 0 1 5 5v8h-16" fill="#f3d4dd" stroke="#9b7481" strokeWidth="1.5" />
        <g fill="#344a56" fontSize="8" fontWeight="700" textAnchor="middle" fontFamily="sans-serif">
          <text x="108" y="57">조</text><text x="108" y="73">항</text><text x="108" y="89">호</text><text x="108" y="105">목</text>
        </g>
        <rect x="27" y="22" width="74" height="94" rx="13" fill="#fffcf2" stroke="#304e58" strokeWidth="2.5" />
        <path d="M42 23V13h15v18l-7.5-5-7.5 5V23Z" fill="#b9b1e7" stroke="#666995" strokeWidth="2" strokeLinejoin="round" />
        <g className={styles.leftArm}>
          <path d="M28 83c-9 1-11-6-12-11" fill="none" stroke="#304e58" strokeWidth="3" strokeLinecap="round" />
          <g transform="rotate(-22 17 63)">
            <path d="M13 47a4 4 0 0 1 8 0v28l-4 8-4-8Z" fill="#d4c9f2" stroke="#666995" strokeWidth="1.8" strokeLinejoin="round" />
            <path d="M13 51h8m-8 24h8" stroke="#666995" strokeWidth="1.5" />
            <path d="m15.5 80 1.5 3 1.5-3" fill="#304e58" />
          </g>
        </g>
        <g className={styles.rightArm} fill="none" stroke="#304e58" strokeWidth="3" strokeLinecap="round">
          {waving ? <><path d="M100 81c12-3 17-14 13-24" /><path d="m109 57 2-7m2 7 3-6m-1 9 6-3" strokeWidth="2.5" /></> : mood === 'care' ? <path d="M101 82c-5 4-13-1-17-5" /> : <path d="M100 81c7 2 12-1 13-7" />}
        </g>
        <g className={styles.cheeks} fill={mood === 'laugh' ? '#efadbd' : '#f3c8d1'}>
          <ellipse cx="43" cy="66" rx={happyEyes ? '7' : '6'} ry="3.5" />
          <ellipse cx="84" cy="66" rx={happyEyes ? '7' : '6'} ry="3.5" />
        </g>
        {mood === 'thinking' && <g fill="none" stroke="#304e58" strokeWidth="1.7" strokeLinecap="round"><path d="M46 46c3-2 6-2 9-1m18 0 8 2" /></g>}
        {mood === 'care' && <g fill="none" stroke="#617078" strokeWidth="1.7" strokeLinecap="round"><path d="m47 46 7 2m20 0 7-2" /></g>}
        {happyEyes ? <g fill="none" stroke="#304e58" strokeWidth="3" strokeLinecap="round"><path d="M45 56q6-9 12 0m14 0q6-9 12 0" /></g> : <g className={styles.eyes} fill="#304e58"><ellipse cx={mood === 'thinking' ? '53' : '51'} cy="56" rx="2.6" ry={mood === 'thinking' ? '2.7' : '3.6'} /><ellipse cx={mood === 'thinking' ? '79' : '77'} cy="56" rx="2.6" ry={mood === 'thinking' ? '2.7' : '3.6'} /></g>}
        <g className={styles.mouth}>
          {mood === 'thinking' ? <path d="M59 70c4-2 8-2 11-1" fill="none" stroke="#304e58" strokeWidth="2.3" strokeLinecap="round" /> : happyEyes ? <><path d="M55 66q9 4 18 0c-1 17-17 17-18 0Z" fill="#5e5262" stroke="#304e58" strokeWidth="1.8" strokeLinejoin="round" /><path d="M60 76q4-4 8 0-4 5-8 0" fill="#f1aabe" /></> : mood === 'wave' ? <path d="M57 67q7 2 14 0c-1 10-13 10-14 0Z" fill="#b97089" stroke="#304e58" strokeWidth="1.8" /> : mood === 'care' ? <path d="M59 69q5 4 10 0" fill="none" stroke="#304e58" strokeWidth="2.3" strokeLinecap="round" /> : <path d="M56 66c3 9 13 9 16 0" fill="none" stroke="#304e58" strokeWidth="2.5" strokeLinecap="round" />}
        </g>
        <path d="M43 85h23m-23 8h13" stroke="#b4c4c6" strokeWidth="3" strokeLinecap="round" />
        <circle cx="78" cy="94" r="11" fill="#dbede4" />
        <path d="m73 94 3.5 3.5 6.5-7" fill="none" stroke="#3c7565" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      </g>
      {mood === 'thinking' ? <g className={styles.thoughts} fill="#b8addc"><circle cx="110" cy="32" r="2" /><circle cx="116" cy="24" r="3" /><circle cx="120" cy="14" r="4" /></g> : mood === 'care' ? <path className={styles.heart} d="M109 17c-6-7-14 2 0 11 14-9 6-18 0-11Z" fill="#dca4ba" /> : <g className={styles.sparkle} fill="#b8addc"><path d="m15 22 2 5 5 2-5 2-2 5-2-5-5-2 5-2Z" /><path d="m111 8 1.5 4 4 1.5-4 1.5-1.5 4-1.5-4-4-1.5 4-1.5Z" /></g>}
      {mood === 'celebrate' && <g className={styles.confetti} fill="none" strokeLinecap="round" strokeWidth="2.5"><path d="m6 47 3-5m9-29 4 3" stroke="#d9a5b7" /><path d="m112 37 6-1m-27-30 1 5" stroke="#b4a9df" /><path d="m7 94 4-2m108 27 4-5" stroke="#a5cbbb" /></g>}
    </svg>
  </span>;
}
