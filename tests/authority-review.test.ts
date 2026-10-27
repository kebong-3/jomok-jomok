import { describe, expect, it } from 'vitest';
import { parseRule, type Article } from '@/engine';
import type { Project } from '@/lib/project';
import { AUTHORITY_STATUS_LABELS, authorityArticleKey, authorityArticleReviews, authorityEntryIssues, authorityEvidenceEligibility, authorityQuoteMatches, authorityReviewStateSchema, detectAuthorityRisks, emptyAuthorityEntry, recordAuthorityReview, replaceAuthorityEntry, type AuthorityReviewEntry } from '@/lib/authority-review';
import { buildAuthorityReviewDoc } from '@/lib/authority-doc';

function fixture(text = '제1조(지원) 시장은 주민의 문화 활동을 지원할 수 있다.') {
  const raw = `가상시 문화 지원 조례\n${text}`;
  const p: Project = { id: 'authority-fixture', createdAt: 1, updatedAt: 1, mode: 'amend', title: '가상시 문화 지원 조례', kind: 'ordinance', profileId: 'hanbit-city', source: { type: 'paste', raw, hash: '' }, intent: '문화 지원 기준 정비', spec: { ops: [], addenda: { effective: 'promulgation' } }, excludedFixes: [], evidence: [], log: [] };
  const rule = parseRule(raw, p.kind);
  return { p, rule, article: rule.articles[0] };
}

function autonomous(p: Project, article: Article): AuthorityReviewEntry {
  return { ...emptyAuthorityEntry(authorityArticleKey(p, article)), target: '문화 지원을 받는 주민', matterKind: 'autonomous', rightsEffect: 'no_new_burden', decisionNote: '지역 문화 활동의 지원에 관한 자치사무로, 신규 신고·허가나 주민 의무를 정하지 않는다.' };
}

describe('조문별 권한·근거 검토', () => {
  it('주민 부담이 없는 자치사무에 개별 위임 조문을 일률적으로 요구하지 않는다', () => {
    const { p, article } = fixture();
    const entry = autonomous(p, article);
    expect(authorityEntryIssues(p, article, entry)).toEqual([]);
    expect(recordAuthorityReview(p, article, entry, 100).reviewedAt).toBe(100);
  });

  it('허가·신고·제재 탐지는 법적 결론이나 자동 검토 완료로 이어지지 않는다', () => {
    const { p, rule, article } = fixture('제1조(신고) 주민은 신고하여야 한다. 위반하면 과태료를 부과한다.');
    expect(detectAuthorityRisks(article).map(value => value.risk)).toEqual(expect.arrayContaining(['report', 'duty', 'sanction']));
    const row = authorityArticleReviews(p, rule)[0];
    expect(row.status).toBe('unreviewed');
    expect(row.entry.rightsEffect).toBe('unknown');
  });

  it('내부 직원의 의무 표현은 주민 부담 후보와 구분하여 기록할 수 있다', () => {
    const { p, article } = fixture('제1조(담당자 업무) 담당 직원은 집행 결과를 보고하여야 한다.');
    const entry = { ...autonomous(p, article), target: '담당 직원', matterKind: 'internal' as const, decisionNote: '주민이 아닌 해당 부서 직원의 내부 보고 업무이다.' };
    expect(detectAuthorityRisks(article).length).toBeGreaterThan(0);
    expect(authorityEntryIssues(p, article, entry)).toEqual([]);
  });

  it('법령명이나 조 번호만 입력한 경우 권한 근거가 확인된 것으로 기록하지 않는다', () => {
    const { p, article } = fixture();
    p.evidence = [{ id: 'EV-L-1', kind: 'law', label: '가상 검증법 제10조', text: '신고의 대상과 절차는 조례로 정한다.', via: 'user' }];
    const entry = { ...autonomous(p, article), rightsEffect: 'new_burden' as const, evidenceIds: ['EV-L-1'], basisQuote: '가상 검증법 제10조', allowedScope: '신고 대상과 절차', sourceChecked: true };
    expect(authorityQuoteMatches(entry, p.evidence)).toBe(false);
    expect(recordAuthorityReview(p, article, entry).reviewedHash).toBeUndefined();
  });

  it('근거 원문과 불일치하는 인용·허용 범위 없는 위임은 검토 기록을 완료할 수 없다', () => {
    const { p, article } = fixture();
    p.evidence = [{ id: 'EV-L-1', kind: 'law', label: '가상 검증법 제10조', text: '신고의 대상과 절차는 조례로 정한다.', via: 'user' }];
    const entry = { ...autonomous(p, article), matterKind: 'delegated' as const, evidenceIds: ['EV-L-1'], basisQuote: '허가의 대상과 절차는 조례로 정한다.' };
    const issues = authorityEntryIssues(p, article, entry).join(' ');
    expect(issues).toContain('그대로 인용');
    expect(issues).toContain('허용하는 대상');
    expect(issues).toContain('직접 대조');
    expect(recordAuthorityReview(p, article, entry).reviewedHash).toBeUndefined();
  });

  it('법령·인용문이 있어도 담당자의 적용 대상·범위 대조가 없으면 기록을 완료하지 않는다', () => {
    const { p, article } = fixture();
    p.evidence = [{ id: 'EV-L-1', kind: 'law', label: '가상 검증법 제10조', text: '신고의 대상과 절차는 조례로 정한다.', via: 'user' }];
    const entry = { ...autonomous(p, article), matterKind: 'delegated' as const, evidenceIds: ['EV-L-1'], basisQuote: '신고의 대상과 절차는 조례로 정한다.', allowedScope: '신고 대상·절차와 이 조문의 적용 대상을 대조함' };
    expect(authorityQuoteMatches(entry, p.evidence)).toBe(true);
    expect(recordAuthorityReview(p, article, entry).reviewedHash).toBeUndefined();
    expect(recordAuthorityReview(p, article, { ...entry, sourceChecked: true }).reviewedHash).toBeTruthy();
  });

  it('일시적인 parser UID가 달라도 새로고침·작업 복원 후 기록을 찾는다', () => {
    const { p, rule, article } = fixture();
    p.authorityReview = replaceAuthorityEntry(undefined, recordAuthorityReview(p, article, autonomous(p, article), 100));
    const reloaded = parseRule(p.source.raw, p.kind);
    expect(reloaded.articles[0].uid).not.toBe(article.uid);
    expect(authorityArticleReviews(p, rule)[0].status).toBe('reviewed');
    expect(authorityArticleReviews(JSON.parse(JSON.stringify(p)), reloaded)[0].status).toBe('reviewed');
  });

  it('제정 조 번호가 이동해도 저장된 outline ID로 찾고 변경 사실을 재확인한다', () => {
    const { p, article } = fixture();
    p.mode = 'enact';
    p.enact = { title: p.title, outlineConfirmed: true, outline: [{ id: 'outline-support', title: '지원', paragraphs: ['문화 지원'], provenance: 'human' }] };
    expect(authorityArticleKey(p, article)).toBe('enact:outline-support');
    const entry = recordAuthorityReview(p, article, autonomous(p, article), 100);
    p.authorityReview = { entries: [entry] };
    const changed = { ...article, title: '지원 대상' };
    expect(authorityArticleReviews(p, { ...fixture().rule, articles: [changed] })[0].status).toBe('stale');
  });

  it('초안·근거 텍스트·근거 URL·기관 변경은 과거 기록을 보관하고 재확인한다', () => {
    const { p, rule, article } = fixture();
    p.evidence = [{ id: 'EV-L-1', kind: 'law', label: '가상 지원법', text: '지역의 문화 활동을 지원할 수 있다.', url: 'https://www.law.go.kr', via: 'live' }];
    const entry = { ...autonomous(p, article), evidenceIds: ['EV-L-1'], basisQuote: '지역의 문화 활동을 지원할 수 있다.' };
    p.authorityReview = { entries: [recordAuthorityReview(p, article, entry, 100)] };
    for (const changed of [
      { ...p, source: { ...p.source, raw: p.source.raw + '\n부칙' } },
      { ...p, evidence: [{ ...p.evidence[0], text: p.evidence[0].text + ' 지방의 사무에 한한다.' }] },
      { ...p, evidence: [{ ...p.evidence[0], url: 'https://www.law.go.kr/changed' }] },
      { ...p, profileId: 'another-city' },
    ]) {
      expect(authorityArticleReviews(changed, rule)[0].status).toBe('stale');
      expect(changed.authorityReview?.entries[0].decisionNote).toBe(entry.decisionNote);
    }
  });

  it('연결 근거 삭제·시행예정 원문을 현재 근거로 승인하지 않는다', () => {
    const { p, article } = fixture();
    const entry = { ...autonomous(p, article), evidenceIds: ['EV-L-404'] };
    expect(authorityEntryIssues(p, article, entry).join('')).toContain('삭제');
    p.evidence = [{ id: 'EV-L-404', kind: 'law', label: '가상 지원법', text: '지역의 문화 활동을 지원할 수 있다.', via: 'live', effectiveAt: '2099-01-01' }];
    expect(authorityEntryIssues(p, article, entry).join('')).toContain('시행예정');
  });

  it('포괄적 시행규칙 문구는 위법 단정 대신 위임 사항과 범위를 묻는다', () => {
    const { p, article } = fixture('제1조(시행규칙) 이 조례의 시행에 필요한 사항은 규칙으로 정한다.');
    const entry = autonomous(p, article);
    expect(authorityEntryIssues(p, article, entry).join('')).toContain('단순 집행 문구');
    expect(recordAuthorityReview(p, article, { ...entry, delegationScope: '새 권리·의무를 정하는 위임이 아닌 단순 집행사항이며 별도 조문 필요성을 법무 부서와 검토하였다.' }).reviewedHash).toBeTruthy();
  });

  it('내부 규정으로 주민 부담을 정하는 사례를 개별 권한 검토로 남긴다', () => {
    const { p, article } = fixture();
    p.kind = 'directive';
    const entry = { ...autonomous(p, article), rightsEffect: 'new_burden' as const };
    expect(authorityEntryIssues(p, article, entry).join('')).toContain('규정 형식부터');
  });

  it('같은 조문의 중복 기록을 허용하지 않고 허용 목록 밖 데이터는 보관하지 않는다', () => {
    const entry = emptyAuthorityEntry('article:1:0');
    expect(authorityReviewStateSchema.safeParse({ entries: [entry, entry] }).success).toBe(false);
    const checked = authorityReviewStateSchema.parse({ entries: [{ ...entry, apiKey: 'not-a-real-key' }] });
    expect(checked.entries[0]).not.toHaveProperty('apiKey');
  });

  it('출력물에도 미검토·재확인과 남은 확인 사항을 그대로 남긴다', () => {
    const { p, rule, article } = fixture();
    p.authorityReview = { entries: [recordAuthorityReview(p, article, autonomous(p, article), 100)] };
    p.profileId = 'changed';
    const doc = buildAuthorityReviewDoc(p, rule);
    expect(doc.id).toBe('authority');
    expect(JSON.stringify(doc.blocks)).toContain(AUTHORITY_STATUS_LABELS.stale);
    expect(JSON.stringify(doc.blocks)).toContain('적법성 승인');
    expect(JSON.stringify(buildAuthorityReviewDoc(fixture().p, rule).blocks)).toContain('[작성 필요]');
  });

  it('전부개정의 다른 정의 조문 변경도 관련 권한 검토를 다시 확인한다', () => {
    const { p, rule, article } = fixture();
    p.amendmentKind = 'full';
    p.replacementDraft = { raw: `${p.source.raw}\n제2조(정의) 주민은 성년 주민을 말한다.` };
    p.authorityReview = { entries: [recordAuthorityReview(p, article, autonomous(p, article), 100)] };
    expect(authorityArticleReviews(p, rule)[0].status).toBe('reviewed');
    p.replacementDraft = { raw: p.replacementDraft.raw.replace('성년 주민', '모든 주민') };
    expect(authorityArticleReviews(p, rule)[0].status).toBe('stale');
  });

  it('비교용 조례·조사 기록·매뉴얼·일반 메모가 위임 근거로 승격되지 않는다', () => {
    const { p, article } = fixture();
    for (const evidence of [
      { id: 'EV-PEER-ordin-123', kind: 'user' as const, label: '유사 규정 참고', text: '신고의 대상과 절차는 조례로 정한다.', via: 'live' as const },
      { id: 'EV-HISTORY', kind: 'user' as const, label: '과거 조사', text: '신고의 대상과 절차는 조례로 정한다.', via: 'user' as const },
      { id: 'EV-L-FAKE', kind: 'law' as const, label: '자치법규 입안 길라잡이', text: '신고의 대상과 절차는 조례로 정한다.', via: 'user' as const },
      { id: 'EV-U-1', kind: 'user' as const, label: '사용자 메모', text: '신고의 대상과 절차는 조례로 정한다.', via: 'user' as const },
      { id: 'EV-SOURCE', kind: 'rule' as const, label: '검토 대상 원문', text: '신고의 대상과 절차는 조례로 정한다.', via: 'live' as const },
    ]) {
      p.evidence = [evidence];
      const entry = { ...autonomous(p, article), rightsEffect: 'new_burden' as const, evidenceIds: [evidence.id], basisQuote: evidence.text, allowedScope: '신고 대상과 절차', sourceChecked: true };
      expect(authorityEvidenceEligibility(evidence).eligible).toBe(false);
      expect(authorityQuoteMatches(entry, p.evidence)).toBe(false);
      expect(recordAuthorityReview(p, article, entry).reviewedHash).toBeUndefined();
    }
  });

  it('기존 수기 위임 조항 입력은 유지하되 원문 대조 전에는 검토 완료하지 않는다', () => {
    const { p, article } = fixture();
    p.evidence = [{ id: 'EV-DELEGATION', kind: 'user', label: '사용자 제공 위임 조항: 가상 검증법 제10조', text: '신고의 대상과 절차는 조례로 정한다.', via: 'user' }];
    const entry = { ...autonomous(p, article), matterKind: 'delegated' as const, evidenceIds: ['EV-DELEGATION'], basisQuote: p.evidence[0].text, allowedScope: '신고 대상과 절차 및 적용 범위를 공식 원문과 대조함' };
    expect(authorityEvidenceEligibility(p.evidence[0]).eligible).toBe(true);
    expect(recordAuthorityReview(p, article, entry).reviewedHash).toBeUndefined();
    expect(recordAuthorityReview(p, article, { ...entry, sourceChecked: true }).reviewedHash).toBeTruthy();
  });
});
