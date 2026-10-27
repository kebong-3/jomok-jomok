import { describe, expect, it } from 'vitest';
import { buildAddenda, derive, parseRule, type AddendaSpec, type DeadlineReview, type Rule, type TransitionDecision } from '@/engine';
import { applyDeadlineArticle, buildDeadlineArticle, deadlineReviewIssues, newTransitionDecision, priorAddendaHash, transitionCandidates, transitionDecisionIssues, transitionDecisionSchema, transitionDecisionState, transitionDraftHash, transitionProjectRule, transitionReviewText, transitionReviewWarnings } from '@/lib/transition-review';
import type { Project } from '@/lib/project';

const source = '시험 훈령\n제1조(목적) 이 훈령의 목적이다.\n제2조(신청) 신청을 접수하여 처리한다.\n제3조(위원) 위원의 임기는 2년으로 한다.\n제4조(계약) 계약을 체결하고 위탁한다.\n제5조(과태료) 위반행위에 대한 과태료 기준이다.\n[별지 제1호서식] 신청서\n성명: [입력]';
const rule = () => parseRule(source, 'directive');
const addenda = (): AddendaSpec => ({ effective: 'promulgation' });
const project = (): Project => ({ id: 'transition-test', mode: 'amend', title: '시험 훈령', kind: 'directive', profileId: 'hanbit-city', createdAt: 0, updatedAt: 0, source: { type: 'paste', raw: source, hash: '' }, intent: '', spec: { ops: [], addenda: addenda() }, evidence: [], excludedFixes: [], log: [] });
const decision = (r: Rule, a: AddendaSpec, patch: Partial<TransitionDecision> = {}): TransitionDecision => ({
  ...newTransitionDecision('term', ['제3조'], 'term'), target: '현재 재직 중인 위원', event: '시행 당시 재직',
  application: 'old', title: '위원의 임기에 관한 경과조치',
  clause: '이 훈령 시행 당시 위원의 임기는 종전의 규정에 따른다.', basis: '담당자가 대조한 종전 임기 조항 및 기관 기준',
  status: 'confirmed', sourceHash: transitionDraftHash(r, a), ...patch,
});
const deadline = (r: Rule, a: AddendaSpec, patch: Partial<DeadlineReview> = {}): DeadlineReview => ({ institutionType: 'local', applicability: 'applies', kind: 'review', basis: '기관이 확인한 자체 관리 기준', clause: '담당 부서는 기관이 확정한 기준일과 주기에 따라 타당성을 검토하여 개선 조치를 한다.', confirmed: true, sourceHash: transitionDraftHash(r, a), ...patch });

describe('기존 업무 처리표의 담당자 판단과 부칙 반영', () => {
  it('후보는 관련 조문을 제시하지만 기존 대상·적용 판단·문장을 채우지 않는다', () => {
    const candidates = transitionCandidates(rule());
    expect(candidates.find(c => c.category === 'application')?.articleRefs).toEqual(['제2조']);
    expect(candidates.find(c => c.category === 'contract')?.articleRefs).toEqual(['제4조']);
    expect(candidates.find(c => c.category === 'sanction')?.articleRefs).toEqual(['제5조']);
    const blank = newTransitionDecision('sanction', ['제5조'], 'sanction');
    expect(blank.application).toBe('unresolved');
    expect(blank.clause).toBe('');
    expect(blank.status).toBe('unreviewed');
  });

  it('처리 판단과 담당자 문장이 완성되어도 확인 전에는 부칙에 넣지 않는다', () => {
    const r = rule(), a = addenda();
    a.transitions = [decision(r, a, { status: 'unreviewed' })];
    expect(buildAddenda(r.kind, a, transitionDraftHash(r, a), r)).toHaveLength(1);
    expect(transitionReviewWarnings(r, a)[0]).toContain('담당자 판단 미확인');
    a.transitions[0].status = 'confirmed';
    const output = buildAddenda(r.kind, a, transitionDraftHash(r, a), r).join('\n');
    expect(output).toContain('제1조(시행일)');
    expect(output).toContain('제2조(위원의 임기에 관한 경과조치)');
    expect(output).toContain(a.transitions[0].clause);
  });

  it.each(['본문', '시행일', '별지', '종전 부칙'])('%s 변경 후 확인을 다시 받아야 한다', changed => {
    const r = rule(), a = addenda();
    a.transitions = [decision(r, a)];
    if (changed === '본문') r.articles[2].paragraphs[0].text = '위원 임기는 3년으로 한다.';
    if (changed === '시행일') { a.effective = 'months'; a.months = 6; }
    if (changed === '별지') r.annexes[0].text = '주소: [입력]';
    if (changed === '종전 부칙') r.addenda = '종전 임기에 관한 경과조치';
    expect(transitionDecisionState(a.transitions[0], transitionDraftHash(r, a), r)).toBe('stale');
    expect(buildAddenda(r.kind, a, transitionDraftHash(r, a), r).join('\n')).not.toContain('위원의 임기에 관한 경과조치');
    expect(transitionReviewText(r, a)).toContain('다시 확인 필요');
  });

  it('시행 준비·적용례·특례·경과조치 순서와 대상 조문 순서로 배열한다', () => {
    const r = rule(), a = addenda();
    const base = decision(r, a);
    a.transitions = [
      { ...base, id: 'transition', form: 'transitional', title: '경과조치' },
      { ...base, id: 'special', form: 'special', title: '특례', note: '대상은 재직 위원, 종전 임기 종료까지의 예외를 확인' },
      { ...base, id: 'application-5', form: 'application', title: '제재 적용례', articleRefs: ['제5조'] },
      { ...base, id: 'application-2', form: 'application', title: '신청 적용례', articleRefs: ['제2조'] },
      { ...base, id: 'preparation', form: 'preparation', title: '시행 준비' },
    ];
    const text = buildAddenda(r.kind, a, transitionDraftHash(r, a), r).join('\n');
    expect(text.indexOf('(시행 준비)')).toBeLessThan(text.indexOf('(신청 적용례)'));
    expect(text.indexOf('(신청 적용례)')).toBeLessThan(text.indexOf('(제재 적용례)'));
    expect(text.indexOf('(제재 적용례)')).toBeLessThan(text.indexOf('(특례)'));
    expect(text.indexOf('(특례)')).toBeLessThan(text.indexOf('(경과조치)'));
  });

  it('해당 없음에는 대상·기준 사건·관련 조문·판단 이유를 요구하고 문장은 출력하지 않는다', () => {
    const r = rule(), a = addenda();
    const entry = decision(r, a, { status: 'not_needed', note: '해당 위원회에 현재 재직 위원이 없음을 확인', application: 'unresolved', clause: '', title: '' });
    expect(transitionDecisionIssues(entry, r)).toEqual([]);
    a.transitions = [entry];
    expect(transitionReviewWarnings(r, a)).toEqual([]);
    expect(buildAddenda(r.kind, a, transitionDraftHash(r, a), r)).toHaveLength(1);
    expect(transitionDecisionIssues({ ...entry, note: '' }, r)).not.toEqual([]);
  });

  it('잘못된 날짜·없는 조문·자동 번호를 포함한 문장은 확인됐다고 저장해도 반영하지 않는다', () => {
    const r = rule(), a = addenda();
    const invalid = decision(r, a, { eventDate: '2026-02-30', articleRefs: ['제99조'], clause: '제2조(경과조치) 종전 규정에 따른다.' });
    a.transitions = [invalid];
    expect(transitionDecisionIssues(invalid, r)).toHaveLength(3);
    expect(buildAddenda(r.kind, a, transitionDraftHash(r, a), r)).toHaveLength(1);
    expect(transitionDecisionSchema.safeParse(invalid).success).toBe(false);
  });

  it('삭제된 조문은 종전 조문으로 구분해야 연결할 수 있다', () => {
    const r = rule(), a = addenda(); r.articles[2].deleted = true;
    const entry = decision(r, a);
    expect(transitionDecisionIssues(entry, r)).not.toEqual([]);
    entry.articleRefs = ['종전의 제3조'];
    expect(transitionDecisionIssues(entry, r)).toEqual([]);
  });

  it('실제 수락된 변경의 초안 지문과 맞는 판단만 개정문에 들어간다', () => {
    const before = rule(), a = addenda();
    const ops = [{ id: 'edit', status: 'accepted' as const, provenance: 'human' as const, change: { op: 'replace_text' as const, target: { kind: 'unit' as const, ref: { art: 3 } }, find: '2년', replace: '3년' } }];
    const changed = derive(before, { ops, addenda: a }).after;
    a.transitions = [decision(changed, a)];
    expect(derive(before, { ops, addenda: a }).amendPlain).toContain('위원의 임기에 관한 경과조치');
    expect(derive(before, { ops: [], addenda: a }).amendPlain).not.toContain('위원의 임기에 관한 경과조치');
  });
});

describe('일몰 조문 본칙 배치와 호환', () => {
  it('v0.7 체크값은 부칙 작성란·날짜를 만들지 않고 확인할 항목으로 남긴다', () => {
    const r = rule(), a = { ...addenda(), reviewDeadline: true };
    expect(buildAddenda(r.kind, a).join('\n')).not.toContain('재검토기한');
    expect(transitionReviewWarnings(r, a)[0]).toContain('이전 재검토기한 선택');
    expect(buildDeadlineArticle(r, a)).toBeUndefined();
  });

  it('기관 유형·적용 근거와 담당자 작성 문장 없이 일몰 조문을 만들지 않는다', () => {
    const r = rule(), a = addenda();
    a.deadlineReview = deadline(r, a, { institutionType: 'unknown', basis: '', clause: '' });
    expect(deadlineReviewIssues(a.deadlineReview, r.kind)).toHaveLength(3);
    expect(buildDeadlineArticle(r, a)).toBeUndefined();
    a.deadlineReview = deadline(r, a);
    const article = buildDeadlineArticle(r, a)!;
    expect(article.num).toBe(6);
    expect(article.title).toBe('재검토기한');
    expect(article.paragraphs[0].text).toBe(a.deadlineReview.clause);
    expect(article.paragraphs[0].text).not.toMatch(/3년|20\d{2}년/);
  });

  it('유효기간과 재검토기한을 구분하고 조례에는 자동 적용하지 않는다', () => {
    const r = rule(), a = addenda();
    a.deadlineReview = deadline(r, a, { kind: 'sunset' });
    expect(buildDeadlineArticle(r, a)?.title).toBe('유효기간');
    r.kind = 'ordinance';
    a.deadlineReview.sourceHash = transitionDraftHash(r, a);
    expect(buildDeadlineArticle(r, a)).toBeUndefined();
  });

  it('일부개정의 기존 추가 조문을 보존하면서 명시한 조문을 실제 본칙 마지막에 넣는다', () => {
    const p = project();
    p.spec.ops = [{ id: 'new', status: 'accepted', provenance: 'human', change: { op: 'insert_article', after: { art: 5 }, policy: 'renumber', title: '새 업무', paragraphs: ['새 업무를 수행한다.'] } }];
    const current = transitionProjectRule(p);
    p.spec.addenda.deadlineReview = deadline(current, p.spec.addenda);
    p.spec.addenda.transitions = [decision(current, p.spec.addenda)];
    const applied = applyDeadlineArticle(p, transitionDraftHash(current, p.spec.addenda));
    expect(applied.error).toBeUndefined();
    const after = transitionProjectRule(applied.project!);
    expect(after.articles.at(-1)?.title).toBe('재검토기한');
    expect(after.articles.at(-2)?.title).toBe('새 업무');
    expect(after.annexes[0].text).toBe(current.annexes[0].text);
    expect(applied.project!.spec.ops[0].provenance).toBe('human');
    expect(applied.project!.spec.addenda.deadlineReview!.sourceHash).toBe(transitionDraftHash(after, p.spec.addenda));
    expect(transitionDecisionState(applied.project!.spec.addenda.transitions![0], transitionDraftHash(after, p.spec.addenda), after)).toBe('stale');
    expect(applyDeadlineArticle(applied.project!, transitionDraftHash(after, p.spec.addenda)).project).toBeUndefined();
  });

  it('클릭 전에 본문이 바뀌면 이전 제안 적용을 거부한다', () => {
    const p = project(), current = transitionProjectRule(p);
    p.spec.addenda.deadlineReview = deadline(current, p.spec.addenda);
    const expected = transitionDraftHash(current, p.spec.addenda);
    p.source.raw = p.source.raw.replace('목적이다', '새로운 목적이다');
    expect(applyDeadlineArticle(p, expected).error).toContain('달라졌어요');
  });

  it('전부개정에서는 별지 앞에 추가하고 기존 별지 원문을 보존한다', () => {
    const p = project(); p.amendmentKind = 'full'; p.replacementDraft = { raw: source, confirmedHash: 'previous' };
    const current = transitionProjectRule(p);
    p.spec.addenda.deadlineReview = deadline(current, p.spec.addenda);
    const applied = applyDeadlineArticle(p, transitionDraftHash(current, p.spec.addenda)).project!;
    expect(applied.replacementDraft!.raw).toContain('[별지 제1호서식] 신청서\n성명: [입력]');
    expect(applied.replacementDraft!.raw.indexOf('(재검토기한)')).toBeLessThan(applied.replacementDraft!.raw.indexOf('[별지 제1호서식]'));
    expect(applied.replacementDraft!.confirmedHash).toBeUndefined();
  });

  it('제정에서는 담당자가 확인한 체계에 human 조문으로 추가하고 폐지에는 새 본칙을 만들지 않는다', () => {
    const p = project(); p.mode = 'enact'; p.enact = { title: p.title, outlineConfirmed: true, outline: [{ id: 'one', title: '목적', paragraphs: ['목적이다.'], provenance: 'human' }] };
    const current = transitionProjectRule(p); p.spec.addenda.deadlineReview = deadline(current, p.spec.addenda);
    const applied = applyDeadlineArticle(p, transitionDraftHash(current, p.spec.addenda)).project!;
    expect(applied.enact!.outline.at(-1)?.title).toBe('재검토기한');
    expect(applied.enact!.outline.at(-1)?.provenance).toBe('human');
    p.mode = 'amend'; p.amendmentKind = 'repeal';
    expect(applyDeadlineArticle(p, '').error).toContain('폐지');
  });

  it('동일한 종전 부칙도 전부개정과 폐지 방식이 바뀌면 재확인한다', () => {
    const r = rule(); r.addenda = '제2조(임기) 종전 임기를 보장한다.';
    expect(priorAddendaHash(r, 'full')).not.toBe(priorAddendaHash(r, 'repeal'));
    expect(priorAddendaHash(r, 'full')).toBe(priorAddendaHash(r, 'full'));
    const a = addenda(); a.priorAddendaReview = { decision: 'retain', note: '현재 재직 위원의 임기 경과조치 필요', sourceHash: priorAddendaHash(r, 'full') };
    expect(transitionReviewText(r, a, { priorRule: r, method: 'full' })).toContain('기준본·개정 방식 일치: 일치');
    expect(transitionReviewText(r, a, { priorRule: r, method: 'repeal' })).toContain('불일치·다시 확인 필요');
    a.transitions = [decision(r, a)];
    expect(transitionReviewText(r, a)).toContain('상태: 확인 완료·부칙 반영');
    expect(transitionReviewText(r, a)).not.toContain('상태: confirmed');
  });
});
