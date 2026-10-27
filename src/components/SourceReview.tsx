'use client';

import type { SourceReviewData } from '@/lib/source-review';
import './source-review.css';

export default function SourceReview({ review, confirmed, onConfirm }: {
  review: SourceReviewData;
  confirmed: boolean;
  onConfirm: (confirmed: boolean) => void;
}) {
  const blocked = review.issues.some((issue) => issue.severity === 'blocking');
  const { counts } = review;
  return (
    <section className="source-review" aria-labelledby="source-review-title">
      <div className="source-review-heading">
        <div>
          <h3 id="source-review-title">원문 인식 미리보기</h3>
          <p className="source-review-counts">{counts.articles}개 조 · {counts.paragraphs}개 본문·항 · {counts.items}개 호 · {counts.annexes}개 별표·서식</p>
        </div>
        <span className={`source-review-status${review.issues.length ? ' needs-review' : ''}`}>
          {blocked ? '원문 수정 필요' : review.issues.length ? `${review.issues.length}곳 확인 필요` : '자동 점검 완료'}
        </span>
      </div>
      <p className="help source-review-intro">아래 구조를 기준으로 개정합니다. 붙여넣거나 추출한 원문은 별도로 보관하고, 호·목은 본문 안의 줄로 유지합니다.</p>

      {review.issues.length > 0 && (
        <div className="source-review-issues" aria-label="원문 인식 확인할 곳">
          <h4>확인할 곳</h4>
          <ul>
            {review.issues.map((issue, i) => (
              <li key={`${issue.code}-${i}`}>
                <div className="source-issue-location"><b>{issue.severity === 'blocking' ? '수정 필요' : '확인 필요'}</b>{issue.location && <span>{issue.location}</span>}</div>
                <p>{issue.message}</p>
                {issue.excerpt && <blockquote>{issue.excerpt}</blockquote>}
              </li>
            ))}
          </ul>
        </div>
      )}

      <details className="source-review-structure">
        <summary>읽은 조문·항·별표 펼쳐 보기</summary>
        <p className="help">{review.rule.title} · 각 표제를 누르면 실제로 읽은 본문을 볼 수 있습니다.</p>
        {review.articles.length === 0 && <p className="help">읽은 조문이 없습니다.</p>}
        {review.articles.map((article, index) => (
          <details className="source-review-article" key={`${article.label}-${index}`}>
            <summary><b>{article.label}{article.title ? `(${article.title})` : ''}</b><span>{article.deleted ? '삭제' : `${article.paragraphs.length}개 본문·항`} · {article.location}</span></summary>
            {article.deleted ? <p className="help">삭제된 조로 읽었습니다.</p> : article.paragraphs.map((paragraph, i) => (
              <div className="source-review-paragraph" key={i}>
                <b>{paragraph.label}{paragraph.items ? ` · ${paragraph.items}개 호` : ''} · {paragraph.location}</b>
                <pre>{paragraph.text || '(본문 없음)'}</pre>
              </div>
            ))}
          </details>
        ))}
        {review.rule.addenda && <details className="source-review-article"><summary><b>부칙</b><span>{review.addendaLocation}</span></summary><pre>{review.rule.addenda}</pre></details>}
        {review.rule.annexes.map((annex, index) => (
          <details className="source-review-article" key={annex.uid}>
            <summary><b>{annex.kind === 'table' ? '별표' : '별지 서식'} {annex.num}{annex.br ? `의${annex.br}` : ''}{annex.title ? ` · ${annex.title}` : ''}</b><span>{review.annexLocations[index]}</span></summary>
            <pre>{annex.text || '(본문 없음)'}</pre>
          </details>
        ))}
      </details>

      {review.issues.length > 0 && !blocked && (
        <label className="source-review-confirm">
          <input type="checkbox" checked={confirmed} onChange={(event) => onConfirm(event.target.checked)} />
          <span>표시된 위치와 읽은 구조를 원문과 대조했습니다. 누락·순서를 확인한 이 원문으로 진행합니다.</span>
        </label>
      )}
      {blocked && <p className="source-review-blocked">수정이 필요한 곳을 먼저 고쳐 주세요. 원문을 고치면 다시 점검합니다.</p>}
      {review.issues.length > 0 && !blocked && <p className="help source-review-confirm-help">원문이나 규정 종류를 바꾸면 이 확인은 해제됩니다.</p>}
    </section>
  );
}
