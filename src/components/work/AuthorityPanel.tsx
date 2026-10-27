'use client';
import { useState } from 'react';
import { renderArticle } from '@/engine';
import Jomoki from '@/components/Jomoki';
import { evidenceSourceLabel } from '@/lib/evidence';
import { AUTHORITY_STATUS_LABELS, MATTER_LABELS, RIGHTS_LABELS, RISK_LABELS, authorityArticleReviews, authorityEvidenceEligibility, recordAuthorityReview, replaceAuthorityEntry, type AuthorityReviewEntry } from '@/lib/authority-review';
import { useWork } from './ctx';
import styles from './AuthorityPanel.module.css';

/** One article at a time; all existing input is reused and never auto-certified. */
export default function AuthorityPanel() {
  const { p, update, d, enactRule, openEvidence, toast } = useWork();
  const rule = p.mode === 'enact' ? enactRule : d?.after;
  const rows = rule ? authorityArticleReviews(p, rule) : [];
  const [chosen, choose] = useState('');
  const current = rows.find(row => row.entry.articleUid === chosen) ?? rows.find(row => row.findings.length && row.status !== 'reviewed') ?? rows[0];
  if (!rule || !current) return null;
  const id = `authority-${current.article.uid.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
  const change = (patch: Partial<AuthorityReviewEntry>) => {
    const uid = current.entry.articleUid;
    update(q => {
      const existing = q.authorityReview?.entries.find(entry => entry.articleUid === uid) ?? current.entry;
      const entry = { ...existing, ...patch, reviewedHash: undefined, reviewedAt: undefined };
      return { ...q, authorityReview: replaceAuthorityEntry(q.authorityReview, entry) };
    });
  };
  const entry = current.entry;
  const needsBasis = entry.matterKind === 'delegated' || entry.rightsEffect === 'new_burden';
  const redelegation = current.findings.some(finding => finding.risk === 'redelegation');
  const pending = rows.filter(row => row.status !== 'reviewed').length;
  return <section id="authority-review" tabIndex={-1} className={styles.panel} aria-labelledby={`${id}-title`}>
    <div className={styles.intro}><Jomoki size={76} mood="care" motion="none" /><div>
      <h3 id={`${id}-title`}>이 조문을 정할 권한, 같이 확인해요</h3>
      <p>누구에게 적용하는지와 근거가 허용하는 범위를 조문별로 남겨요. 새 제한·의무가 없는 자치사무에 개별 위임을 일률적으로 요구하지 않아요.</p>
      {p.amendmentKind === 'repeal' && <p>폐지 작업에서는 현재 적용 중인 본문의 권한·적용 대상을 참고로 검토합니다. 이 기록만으로 폐지 후 권리·의무나 종전 관계가 해결되었다고 처리하지 않아요.</p>}
    </div></div>
    <div className={styles.body}>
      <div className={styles.summary}><span>전체 {rows.length}개 조문</span><span>담당자 검토 기록 {rows.length - pending}개</span><span>작성·재확인 {pending}개</span></div>
      <label htmlFor={`${id}-article`}>검토할 조문</label>
      <select id={`${id}-article`} value={current.entry.articleUid} onChange={event => choose(event.target.value)}>{rows.map(row => <option key={row.entry.articleUid} value={row.entry.articleUid}>{row.label} · {AUTHORITY_STATUS_LABELS[row.status]}</option>)}</select>
      <span className={`${styles.status} ${current.stale ? styles.attention : ''}`}>{AUTHORITY_STATUS_LABELS[current.status]}</span>
      {current.stale && <p role="status">검토 당시와 조문·원문·연결 근거 또는 기관 정보가 달라졌어요. 기록은 보관하고, 현재 내용으로 다시 확인해 주세요.</p>}
      <details><summary>현재 조문 읽기</summary><pre>{renderArticle(current.article)}</pre></details>
      {!!current.findings.length && <p className={styles.findings}>먼저 볼 표현: {[...new Set(current.findings.map(finding => `${RISK_LABELS[finding.risk]} ‘${finding.text}’`))].join(' · ')}<br /><small>표현을 찾은 후보입니다. 새로운 주민 의무인지, 내부 직원의 업무인지와 실제 적용 범위는 담당자가 구분해 주세요.</small></p>}
      <label htmlFor={`${id}-target`}>누구에게 적용하나요?</label>
      <input id={`${id}-target`} value={entry.target} placeholder="예: 주민 신청인 / 해당 부서 직원 / 위탁 운영기관" onChange={event => change({ target: event.target.value })} />
      <div className={styles.grid}>
        <div><label htmlFor={`${id}-matter`}>어떤 사무인가요?</label><select id={`${id}-matter`} value={entry.matterKind} onChange={event => change({ matterKind: event.target.value as AuthorityReviewEntry['matterKind'], sourceChecked: false })}>{Object.entries(MATTER_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
        <div><label htmlFor={`${id}-rights`}>주민의 권리·의무에 영향이 있나요?</label><select id={`${id}-rights`} value={entry.rightsEffect} onChange={event => change({ rightsEffect: event.target.value as AuthorityReviewEntry['rightsEffect'], sourceChecked: false })}>{Object.entries(RIGHTS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
      </div>
      {needsBasis && <p className={styles.findings}>위임받은 사무나 주민 제한·의무를 정하는 조문이네요. 실제 권한 조문과 위임 경로를 대조해 주세요. 법령명을 적거나 검색했다는 사실만으로 권한이 확인되지는 않아요.</p>}
      <details className={styles.evidence} open={needsBasis || undefined}><summary>근거 조문 연결{needsBasis ? ' · 확인 필요' : ' · 필요할 때 기록'}</summary>
        {!p.evidence.length && <p>연결할 근거가 아직 없어요. 작업의 근거 영역에서 상위 법령을 조회하거나 원문을 등록한 뒤 선택해 주세요.</p>}
        {p.evidence.map(evidence => { const eligibility = authorityEvidenceEligibility(evidence); return <div key={evidence.id}><label className={styles.check}><input type="checkbox" checked={entry.evidenceIds.includes(evidence.id)} disabled={!eligibility.eligible && !entry.evidenceIds.includes(evidence.id)} onChange={event => change({ evidenceIds: event.target.checked ? [...entry.evidenceIds, evidence.id] : entry.evidenceIds.filter(value => value !== evidence.id), sourceChecked: false })} /><span>{evidence.label}<small>{evidence.id} · {evidenceSourceLabel(evidence)} · 시행일 {evidence.effectiveAt || '미확인'}</small>{eligibility.note && <small>{eligibility.note}</small>}</span></label><button type="button" className="btn ghost small" onClick={() => openEvidence(evidence)}>근거 원문 보기</button></div>; })}
        <label htmlFor={`${id}-quote`}>이 내용을 정할 수 있게 한 원문</label><textarea id={`${id}-quote`} value={entry.basisQuote} placeholder="선택한 근거에서 해당 부분을 그대로 붙여 주세요." onChange={event => change({ basisQuote: event.target.value, sourceChecked: false })} />
        <label htmlFor={`${id}-scope`}>허용한 대상·내용·범위와 이 조문의 관계</label><textarea id={`${id}-scope`} value={entry.allowedScope} placeholder="위임한 기관·규정 형식·대상과 범위를 확인하고, 이 조문이 그 범위에 드는 이유를 적어 주세요." onChange={event => change({ allowedScope: event.target.value, sourceChecked: false })} />
        <label className={styles.check}><input type="checkbox" checked={entry.sourceChecked} onChange={event => change({ sourceChecked: event.target.checked })} /><span>근거의 현행성, 위임 경로, 적용 대상·범위를 현재 조문과 직접 대조했습니다.<small>저장본·사용자 원문·일부 발췌는 공식 원문 전체와 부칙까지 별도로 확인해 주세요.</small></span></label>
      </details>
      {redelegation && <><label htmlFor={`${id}-delegation`}>규칙 등에 무엇을 맡기나요?</label><textarea id={`${id}-delegation`} value={entry.delegationScope} placeholder="맡길 사항·범위와 조례에 남기는 기준. 단순 집행 문구이면 그렇게 판단한 사유를 적어 주세요." onChange={event => change({ delegationScope: event.target.value })} /><small>‘시행에 필요한 사항은 규칙으로 정한다’는 표현 자체를 위법으로 판정하지 않습니다. 새 권리·의무를 정할 권한이 되는지도 구분해 주세요.</small></>}
      <label htmlFor={`${id}-decision`}>담당자가 판단한 이유·남은 확인 사항</label><textarea id={`${id}-decision`} value={entry.decisionNote} placeholder="사무 성격과 규정 형식을 선택한 이유, 다른 대상·범위가 아닌지 검토한 내용 등을 기록해 주세요." onChange={event => change({ decisionNote: event.target.value })} />
      {!!current.issues.length && <div className={styles.issues}><strong>기록 전에 함께 확인해요</strong><ul>{current.issues.map(issue => <li key={issue}>{issue}</li>)}</ul></div>}
      <div className={styles.footer}><button type="button" className="btn" disabled={!!current.issues.length} onClick={() => {
        const article = current.article;
        update(q => { const saved = q.authorityReview?.entries.find(value => value.articleUid === entry.articleUid) ?? entry; return { ...q, authorityReview: replaceAuthorityEntry(q.authorityReview, recordAuthorityReview(q, article, saved)) }; });
        toast('현재 조문과 근거에 대한 담당자 검토 기록을 남겼습니다.');
      }}>현재 내용으로 검토 기록</button><a href="/references/local-ordinance-2026.pdf#page=68" target="_blank" rel="noreferrer">입안 길라잡이 PDF 68쪽 근거 보기</a></div>
      <small>이 표는 담당자의 판단과 확인 범위를 기록합니다. 자동 탐지나 검토 기록 저장은 적법성 승인으로 처리되지 않습니다.</small>
    </div>
  </section>;
}
