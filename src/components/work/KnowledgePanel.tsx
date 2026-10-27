'use client';

import Link from 'next/link';
import { knowledgePageLabel, knowledgeSourceHref, type KnowledgeCitation, type KnowledgeRecord } from '@/lib/knowledge';
import styles from '../Knowledge.module.css';
import guideStyles from './KnowledgeGuide.module.css';

const ROLE_NAMES: Record<string, string> = {
  plan: '개정 계획', amend_plan: '개정 계획', enact_outline: '제정 조문체계',
  enact_draft: '제정 초안', reasons: '이유·주요내용', reason: '이유·주요내용',
  impact_review: '상위법 영향 검토', knowledge_assist: '입안 자료 검토',
  fix_suggest: '점검 결과 정비', compare: '검토 의견 비교',
};
const STATUS_NAMES = { retrieved: '참고자료 검색됨', empty: '관련 근거 못 찾음', failed: '자료 검색 실패' };
function roleName(role: string) {
  const batch = /^enact_draft:([\d,]+)$/.exec(role);
  return batch ? `제정 초안 · ${batch[1].split(',').map(number => `제${number}조`).join('·')}` : ROLE_NAMES[role] ?? role;
}

function retrievedAt(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('ko-KR');
}

export default function KnowledgePanel({ records = [], question = '', kind = 'ordinance', document = '', documentLabel = '', onReview, reviewDisabled = false }: {
  records?: KnowledgeRecord[]; question?: string; kind?: string; document?: string; documentLabel?: string; onReview?: () => void; reviewDisabled?: boolean;
}) {
  const sorted = [...records].sort((a, b) => b.retrievedAt.localeCompare(a.retrievedAt));
  const latest = sorted[0];
  const citations = [...new Map(sorted.flatMap(r => r.citations).map(c => [c.id, c])).values()] as KnowledgeCitation[];
  const params = new URLSearchParams({ from: 'work', mode: 'review', kind });
  const preserveContext = () => {
    try {
      window.sessionStorage.setItem('jj:knowledge:prefill', JSON.stringify({ question: question.slice(0, 2000), kind, document: document.length <= 12000 ? document : '', createdAt: Date.now() }));
    } catch { /* 저장 공간을 사용할 수 없으면 자료실에서 질문과 본문을 직접 입력합니다. */ }
  };
  return <section className={styles.knowledgePanel} aria-label="입안 참고자료">
    <div className={guideStyles.heading}><div><span>원문 근거로 확인하는</span><h3>입안 참고자료·검토</h3></div></div>
    <p className={guideStyles.intro}>{onReview ? '현재 초안을 기준서 근거로 검토하고, 원하는 수정만 골라 반영해요. 짧은 질문은 오른쪽 아래 조목이에게 물어보세요.' : '입안 기준과 원문 근거를 함께 살펴봐요.'}</p>
    <div className={styles.panelActions}>
      {onReview ? <button type="button" className={styles.primaryLink} onClick={onReview} disabled={reviewDisabled}>이 작업 이어서 검토</button> : <Link className={styles.primaryLink} href={`/knowledge?${params}`} onClick={preserveContext}>이 작업 이어서 검토</Link>}
      <Link className={styles.secondaryLink} href="/knowledge?tab=library">원본 자료</Link>
    </div>
    {reviewDisabled && <p className={styles.panelIntro}>현재 조문 작성이 끝나면 검토를 열 수 있어요.</p>}
    <h4 className={guideStyles.sourceTitle}>이 작업에 사용한 참고자료</h4>
    <p className={styles.panelIntro}>이 작업의 AI 요청에 전달한 자료입니다. 원문과 앞뒤 문맥을 함께 확인하세요.</p>
    {latest ? <p className={styles.panelStatus}>{STATUS_NAMES[latest.status]} · {roleName(latest.role)}<small>{retrievedAt(latest.retrievedAt)}</small></p> : <p className={styles.panelStatus}>아직 이 작업에 기록된 자료 검색이 없습니다.</p>}
    {!!citations.length && <ul className={styles.panelSources}>{citations.slice(0, 3).map(c => <li key={c.id}><a href={knowledgeSourceHref(c)} target="_blank" rel="noreferrer">{c.title} ↗</a><small>{knowledgePageLabel(c)} · {c.edition}</small></li>)}</ul>}
    {citations.length > 3 && <p className={styles.panelIntro}>그 밖의 원문 {citations.length - 3}건은 아래 검색 기록에서 확인할 수 있습니다.</p>}
    {!!sorted.length && <details className={styles.panelDetails}><summary>전체 검색 기록 {sorted.length}건 확인</summary>{sorted.map((r, index) => <article key={`${r.role}-${r.retrievedAt}-${index}`} className={styles.record}><h4>{roleName(r.role)} · {STATUS_NAMES[r.status]}</h4><small>{retrievedAt(r.retrievedAt)} · {r.version}</small><p>검색어: {r.query}</p>{r.note && <p>{r.note}</p>}{r.citations.map(c => <details key={c.id}><summary>{c.title} · {knowledgePageLabel(c)}</summary><blockquote>{c.text}</blockquote><a href={knowledgeSourceHref(c)} target="_blank" rel="noreferrer">해당 원문 보기 ↗</a></details>)}</article>)}</details>}
    {!!document && !!documentLabel && <p className={styles.panelIntro}>검토할 본문: {documentLabel}. {onReview ? '이 화면에서 검토할 조문을 고를 수 있어요.' : '자료실에서 내용을 확인한 뒤 AI 검토를 요청합니다.'}</p>}
    {document.length > 12000 && <p className={styles.panelIntro}>긴 초안은 검토할 조문과 관련 부칙을 골라 나누어 검토할 수 있습니다.</p>}
    <p className={styles.panelNote}>매뉴얼은 입안 참고 기준입니다. 현행 법령·위임 근거의 확인을 대신하지 않습니다. 역할별 최근 검색을 보관하며 모든 실행 이력을 담지는 않습니다.</p>
  </section>;
}
