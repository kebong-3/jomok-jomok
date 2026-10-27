'use client';

import { useId } from 'react';
import Jomoki from '@/components/Jomoki';
import { trackSummary } from '@/lib/procedure-track';
import { useWork } from './ctx';
import { procedureGroupOf, procedureSteps } from '@/config/profiles';
import styles from './NextSteps.module.css';
import { amendmentKind } from '@/lib/amendment-method';
import { authorityArticleReviews } from '@/lib/authority-review';

const STAGE_NAMES = { articles: '조문 작성', lint: '점검', docs: '문서 준비' } as const;
type Stage = keyof typeof STAGE_NAMES;

function focusSection(id: string) {
  const target = document.getElementById(id);
  if (!target) return;
  target.focus({ preventScroll: true });
  target.scrollIntoView({ block: 'start', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
}

export default function NextSteps({ stage, onReview }: { stage: Stage; onReview?: () => void }) {
  const { p, d, enactRule, enactLint, prof, setTab } = useWork();
  const headingId = useId();
  const enact = p.mode === 'enact';
  const articles = p.enact?.outline ?? [];
  const missing = articles.filter(a => !a.paragraphs.some(text => text.trim())).length;
  const unreviewed = articles.filter(a => a.provenance === 'ai').length;
  const accepted = p.spec.ops.filter(op => op.status === 'accepted').length;
  const proposed = p.spec.ops.filter(op => op.status === 'proposed').length;
  const issues = (enact ? enactLint : d?.lint ?? []).filter(issue => enact || issue.origin === 'introduced');
  const must = issues.filter(issue => issue.tier === 'must').length;
  const running = p.log.some(entry => entry.status === 'running');
  const procedures = procedureSteps(prof, procedureGroupOf(p.kind));
  const method = amendmentKind(p);
  const currentRule = enactRule ?? d?.after;
  const authorityPending = currentRule ? authorityArticleReviews(p, currentRule).filter(row => row.status !== 'reviewed').length : 0;

  let title = '필요한 문서를 골라 받아 주세요';
  let detail = '입법예고문과 점검표를 준비해요. 검토가 남은 내용은 초안으로 받고, 제출 전 기관 절차와 입력 항목을 확인하세요.';
  let button = '문서·서식 받으러 가기';
  let action = () => focusSection('document-downloads');
  let tip = '예고 대상·기간과 협의 부서는 기관마다 달라요. 아래 ‘행정 절차·일정’에서 단계와 기한을 함께 챙겨요.';

  if (stage === 'articles') {
    if (running) {
      title = '초안을 작성하고 있어요';
      detail = '완성된 조문부터 보관합니다. 현재 작성 상황을 확인하고, 필요하면 작성 화면에서 중단할 수 있어요.';
      button = '현재 작성 상황 보기';
      action = () => focusSection('work-stage-content');
    } else if (enact && !articles.length) {
      title = '제정 목적에 맞는 조문 체계가 필요해요';
      detail = '아직 작성된 조문 체계가 없어요. 화면 위의 ‘새 작업으로 AI 다시 실행’으로 체계를 만들거나, 처음 화면에서 제정 목적을 구체화해 주세요.';
      button = '현재 작업 상태 살펴보기';
      action = () => focusSection('work-stage-content');
    } else if (enact && !p.enact?.outlineConfirmed) {
      title = '조문의 제목과 순서부터 살펴볼까요?';
      detail = '목적에 맞는 조문인지 확인하고, 필요한 항목을 더하거나 순서를 바꿔 주세요. 아래에서 체계를 확정하면 본문을 작성합니다.';
      button = '조문 체계 살펴보기';
      action = () => focusSection('work-stage-content');
    } else if (enact && missing > 0) {
      title = `남은 ${missing}개 조문을 이어서 써 주세요`;
      detail = `전체 ${articles.length}개 중 ${articles.length - missing}개 조문이 작성되어 있어요. 작성 화면에서 이어쓰거나 직접 입력할 수 있습니다.`;
      button = '조문 작성 계속하기';
      action = () => focusSection('work-stage-content');
    } else if (enact && unreviewed > 0) {
      title = '초안에서 중요한 조건부터 살펴봐요';
      detail = `AI가 쓴 ${unreviewed}개 조문에 검토 표시가 남아 있어요. 대상·권한·금액·시행일을 먼저 확인하고, 헷갈리는 문장은 조목이에게 물어보세요.`;
      button = onReview ? '조목이와 초안 검토' : '작성한 조문 살펴보기';
      action = onReview ?? (() => focusSection('work-stage-content'));
    } else if (!enact && method === 'full' && !p.replacementDraft) {
      title = '전부개정할 새 본칙 전체를 준비해요';
      detail = '원문을 바탕으로 전체 편집을 시작하고, 새 조문과 별표·서식을 빠짐없이 작성해 주세요. 종전 부칙은 별도로 검토합니다.';
      button = '전체 편집 시작하기'; action = () => focusSection('amendment-method');
    } else if (!enact && method === 'repeal') {
      title = '폐지 이유와 남아 있는 업무를 챙겨요';
      detail = '진행 중인 신청·계약·제재와 종전 부칙, 다른 규정의 인용을 확인하세요. 폐지안과 새 부칙으로 문서를 준비합니다.';
      button = '폐지 전 점검하기'; action = () => setTab('lint');
    } else if (!enact && method === 'partial' && proposed > 0) {
      title = '개정 의도에 맞는 제안부터 골라 주세요';
      detail = `아직 검토하지 않은 제안이 ${proposed}건 있어요. 바꾸기 전·후 문장을 보고 필요한 제안을 반영하면 대비표까지 이어집니다.`;
      button = '개정 제안 살펴보기';
      action = () => focusSection('work-stage-content');
    } else if (!enact && method === 'partial' && accepted === 0) {
      title = '바꿀 조문을 먼저 정해 주세요';
      detail = '개정 제안을 확인하거나 직접 변경 내용을 입력하세요. 선택한 변경을 바탕으로 연결된 인용과 문서를 정리합니다.';
      button = '개정 내용 살펴보기';
      action = () => focusSection('work-stage-content');
    } else if (must > 0) {
      title = `함께 고칠 곳이 ${must}건 남았어요`;
      detail = '방금 반영한 변경 때문에 삭제·이동된 조항을 인용하는 문장이 생겼어요. 점검 화면에서 위치를 보고 조목이의 수정 제안을 반영하세요.';
      button = '다음: 점검에서 고치기'; action = () => setTab('lint');
    } else if (authorityPending > 0) {
      title = '누구에게 적용하는지, 근거부터 같이 봐요';
      detail = `권한·근거표 ${authorityPending}개 조문에 확인이 남아 있어요. 먼저 볼 표현을 안내하고, 이미 적은 대상과 근거는 다시 사용합니다.`;
      button = '다음: 조문별 근거 확인'; action = () => setTab('lint');
    } else {
      title = '연결된 조문과 형식을 확인할 차례예요';
      detail = '조 번호·인용·부칙처럼 놓치기 쉬운 부분을 점검해요. 점검 화면에서 수정할 곳과 확인할 곳을 나눠 볼 수 있습니다.';
      button = '다음: 점검하기';
      action = () => setTab('lint');
    }
    tip = '다른 기관의 조례는 참고 사례예요. 우리 기관의 권한과 상위법 위임 근거는 따로 확인해 주세요.';
  } else if (stage === 'lint') {
    if (enact && (!p.enact?.outlineConfirmed || !articles.length || missing > 0)) {
      title = '작성 중인 조문을 먼저 마무리해 주세요';
      detail = '조문 체계를 확정하고 각 조의 본문을 작성해야 빠진 인용과 형식까지 함께 점검할 수 있어요.';
      button = '조문 작성으로 돌아가기';
      action = () => setTab('articles');
    } else if (must > 0) {
      title = `먼저 살펴볼 문제가 ${must}건 있어요`;
      detail = '점검 결과의 위치와 설명부터 확인해 주세요. AI 검토로 이유를 살펴보고, 반영할 수정은 직접 선택할 수 있습니다.';
      button = '점검한 위치 살펴보기';
      action = () => focusSection('work-stage-content');
    } else if (authorityPending > 0) {
      title = '누구에게 적용하는지, 근거부터 같이 봐요';
      detail = `조문별 권한·근거표에서 ${authorityPending}개 조문의 적용 대상과 판단 근거를 확인해 주세요. 미검토 상태로도 검토용 문서를 받을 수 있어요.`;
      button = '조문별 근거표 살펴보기'; action = () => focusSection('authority-review');
    } else {
      title = '남은 확인사항을 살피고 문서를 준비해요';
      detail = '자동 점검에서 반드시 고칠 문제는 발견하지 못했어요. 위임 범위와 실제 적용 대상은 검토한 뒤 문서 단계로 이어 가세요.';
      button = '다음: 문서 받기';
      action = () => setTab('docs');
    }
    tip = '시행일·경과조치는 함께 보세요. 이미 진행 중인 신청이나 절차에 어떤 규정을 적용할지 확인하면 좋아요.';
  } else if (enact && (!p.enact?.outlineConfirmed || !articles.length)) {
    title = '문서에 담을 조문 체계부터 정해 주세요';
    detail = '조문 제목과 순서를 확정하면 작성 중인 내용도 검토용 초안으로 받아 편집할 수 있어요.';
    button = '조문 체계 정하러 가기';
    action = () => setTab('articles');
  } else if (enact && missing > 0) {
    title = '작성 중인 초안도 보관할 수 있어요';
    detail = `본문이 비어 있는 조문 ${missing}개를 포함해 현재 내용으로 받을 수 있어요. 문서에는 ‘검토용 초안’과 미작성 안내가 함께 표시됩니다.`;
  }

  const showReview = !!onReview && button !== '조목이와 초안 검토';
  const track = trackSummary(p.kind, prof, p.procedureTrack, p.mode);

  return <section className={`${styles.nextSteps} no-print`} aria-labelledby={headingId}>
    <div className={styles.hero}>
      <div className={styles.guide}><Jomoki size={92} mood={running ? 'thinking' : must > 0 ? 'care' : stage === 'docs' ? 'smile' : 'guide'} /><span>조목이</span></div>
      <div className={styles.main}>
        <div className={styles.eyebrow}><span>다음 할 일</span><span className={styles.stage}>{STAGE_NAMES[stage]}</span></div>
        <h2 id={headingId}>{title}</h2>
        <p className={styles.description}>{detail}</p>
        <div className={styles.actions}>
          <button type="button" className={styles.primary} onClick={action}>{button}<span aria-hidden="true">→</span></button>
          {showReview && <button type="button" className={styles.secondary} onClick={onReview}>조목이와 이 단계 검토</button>}
          {stage === 'docs' && <button type="button" className={styles.secondary} onClick={() => setTab('procedure')}>다음: 절차·일정 챙기기</button>}
          {stage === 'articles' && enact && missing === 0 && !!articles.length && unreviewed > 0 && <button type="button" className={styles.textAction} onClick={() => setTab('lint')}>점검 화면 보기</button>}
        </div>
      </div>
    </div>
    <div className={styles.tip}><span className={styles.tipLabel}>작은 도움</span><p>{tip}</p></div>
    <button type="button" className={styles.procedureLink} onClick={() => setTab('procedure')}>
      <span><strong>행정 절차·일정</strong><span className={styles.profile}>{prof.name} · {procedures.length}단계 · {track.current ? `지금: ${track.current.step.name}` : '모두 완료'}</span></span>
      <span className={styles.expandHint}>{track.done}/{track.total} 완료 · 진행판 열기 <span aria-hidden="true">→</span></span>
    </button>
  </section>;
}
