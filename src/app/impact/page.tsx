'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Header from '@/components/Header';
import KnowledgePanel from '@/components/work/KnowledgePanel';
import type { KnowledgeRecord } from '@/lib/knowledge';
import { availableProfiles, profileById, snapshotProfile, type Profile } from '@/config/profiles';
import { parseRule, RULE_KIND_LABEL, type RuleKind } from '@/engine';
import { AiUnavailable, callRole, type AiResult } from '@/lib/ai';
import { buildImpactIntent, impactArticles, impactInputIssues, IMPACT_EXAMPLE, literalImpactCandidates, selectedImpactCandidates, validateImpactCandidates, type ImpactInputs, type ImpactResponse, type UpperLawReview } from '@/lib/impact';
import { startPilot } from '@/lib/evaluation';
import { initialLog } from '@/lib/pipeline';
import { emptySpec, newId, saveProject, sha256, type Project } from '@/lib/project';
import { loadSettings, saveSettings } from '@/lib/settings';
import '@/components/impact.css';

const EMPTY: ImpactInputs = { upperTitle: '', before: '', after: '', beforeDate: '', afterDate: '', institutionRaw: '', kind: 'rule' };
const KINDS = Object.keys(RULE_KIND_LABEL) as RuleKind[];

export default function ImpactPage() {
  const router = useRouter();
  const pageOpenedAt = useRef(Date.now());
  const [input, setInput] = useState<ImpactInputs>(EMPTY);
  const [profileId, setProfileId] = useState('hanbit-city');
  const [profiles, setProfiles] = useState<Profile[]>(() => availableProfiles());
  const [review, setReview] = useState<UpperLawReview | null>(null);
  const [reviewKnowledge, setReviewKnowledge] = useState<KnowledgeRecord | undefined>();
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [instruction, setInstruction] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [example, setExample] = useState(false);
  const [measureTime, setMeasureTime] = useState(false);
  useEffect(() => { const settings = loadSettings(); setProfileId(settings.profileId); setProfiles(availableProfiles(settings.customProfiles)); }, []);
  const institution = useMemo(() => input.institutionRaw.trim() ? parseRule(input.institutionRaw, input.kind) : null, [input.institutionRaw, input.kind]);
  const selected = review ? selectedImpactCandidates(review) : [];
  const locked = busy || saving || !!review;

  function update<K extends keyof ImpactInputs>(key: K, value: ImpactInputs[K]) {
    setInput((previous) => ({ ...previous, [key]: value }));
    setConfirmed(false);
    setError('');
  }

  function fillExample() {
    setInput({ ...IMPACT_EXAMPLE });
    setReview(null); setReviewKnowledge(undefined); setError(''); setInstruction(''); setConfirmed(false); setExample(true);
  }

  async function analyze() {
    setError('');
    const issues = impactInputIssues(input);
    if (issues.length) { setError(issues.join('\n')); return; }
    if (!confirmed) { setError('입력한 두 시점의 조문과 기관 원문을 확인해 주세요.'); return; }
    setBusy(true); setReview(null); setReviewKnowledge(undefined);
    const started = Date.now();
    let ai: AiResult<ImpactResponse> | undefined;
    try {
      const hash = await sha256(input.institutionRaw);
      let result: Pick<UpperLawReview, 'candidates' | 'method' | 'rejectedCount' | 'note'>;
      try {
        ai = await callRole<ImpactResponse>('impact_review', {
          upperTitle: input.upperTitle.trim(), before: input.before, after: input.after,
          beforeDate: input.beforeDate, afterDate: input.afterDate,
          institutionRaw: input.institutionRaw, kind: input.kind,
        }, { allowCassette: false });
        setReviewKnowledge(ai.knowledge);
        const validated = validateImpactCandidates(input, ai.data);
        if (!validated.candidates.length && validated.rejectedCount) {
          result = { candidates: literalImpactCandidates(input), method: 'literal', rejectedCount: validated.rejectedCount, note: 'AI가 반환한 후보의 인용을 원문에서 확인하지 못해 사용하지 않았습니다. 아래에는 법령명과 조 번호가 직접 일치하는 후보만 표시합니다.' };
        } else {
          result = { ...validated, method: 'ai', note: ai.note?.slice(0, 1_000) };
        }
      } catch (failure) {
        const reason = failure instanceof AiUnavailable ? failure.message : 'AI 응답이 검증 가능한 후보 형식과 맞지 않습니다.';
        result = { candidates: literalImpactCandidates(input), method: 'literal', rejectedCount: 0, note: `${reason} AI 분석을 완료하지 못해, 법령명과 조 번호의 직접 인용만 문자일치로 확인했습니다.`.slice(0, 1_000) };
      }
      setReview({
        version: 1, upperTitle: input.upperTitle.trim(),
        before: { text: input.before, effectiveAt: input.beforeDate || undefined },
        after: { text: input.after, effectiveAt: input.afterDate || undefined },
        institutionHash: hash, analyzedAt: Date.now(), elapsedMs: Date.now() - started,
        ...result, selectedIds: [], model: ai?.model, modelLabel: ai?.modelLabel,
        actualModel: ai?.actualModel, promptVersion: ai?.trace?.promptVersion,
        trace: ai?.trace && { tokens: ai.trace.tokens, repairs: ai.trace.repairs, fallbacks: ai.trace.fallbacks, family: ai.trace.family },
      });
    } catch {
      setError('입력 원문의 보존 정보를 만들지 못했습니다. 브라우저를 새로 열고 다시 시도해 주세요.');
    } finally { setBusy(false); }
  }

  function toggle(id: string) {
    setReview((previous) => previous && ({ ...previous, selectedIds: previous.selectedIds.includes(id) ? previous.selectedIds.filter((value) => value !== id) : [...previous.selectedIds, id] }));
  }

  async function startWork() {
    if (!review || !institution || !selected.length) return;
    setError(''); setSaving(true);
    try {
      const sourceHash = await sha256(input.institutionRaw);
      if (sourceHash !== review.institutionHash) throw new Error('기관 원문이 분석 당시와 달라졌습니다. 다시 분석해 주세요.');
      const [beforeHash, afterHash] = await Promise.all([sha256(review.before.text), sha256(review.after.text)]);
      const now = Date.now();
      const selectedProfile = profiles.find(profile => profile.id === profileId) ?? profileById(profileId, loadSettings().customProfiles);
      const project: Project = {
        id: newId(), createdAt: now, updatedAt: now, mode: 'amend',
        title: institution.title, kind: input.kind, profileId: selectedProfile.id,
        profileSnapshot: snapshotProfile(selectedProfile),
        source: { type: 'paste', raw: input.institutionRaw, hash: sourceHash },
        intent: buildImpactIntent(review, instruction), spec: emptySpec(), excludedFixes: [],
        evidence: [
          { id: 'EV-IMPACT-BEFORE', kind: 'user', label: `「${review.upperTitle}」 개정 전 · 담당자 제공`, text: review.before.text, via: 'user', date: review.before.effectiveAt, effectiveAt: review.before.effectiveAt, fetchedAt: new Date(now).toISOString(), contentHash: beforeHash, partial: true, note: '영향 검토에 사용한 담당자 제공 원문. 적용 범위·시행일은 별도 확인이 필요합니다.' },
          { id: 'EV-IMPACT-AFTER', kind: 'user', label: `「${review.upperTitle}」 개정 후 · 담당자 제공`, text: review.after.text, via: 'user', date: review.after.effectiveAt, effectiveAt: review.after.effectiveAt, fetchedAt: new Date(now).toISOString(), contentHash: afterHash, partial: true, note: '영향 검토에 사용한 담당자 제공 원문. 최신 법령 전체를 확인한 자료가 아닙니다.' },
        ],
        log: initialLog('amend'), impact: review,
        knowledge: reviewKnowledge ? [reviewKnowledge] : undefined,
        evaluation: measureTime ? startPilot(pageOpenedAt.current) : undefined,
      };
      if (!(await saveProject(project))) throw new Error('브라우저 저장소에 작업을 저장하지 못했습니다. 저장소 사용을 허용한 창에서 다시 시도해 주세요.');
      saveSettings({ ...loadSettings(), profileId: selectedProfile.id });
      router.push(`/work/${project.id}?run=1`);
    } catch (failure) { setError(failure instanceof Error ? failure.message : '개정 작업을 저장하지 못했습니다.'); setSaving(false); }
  }

  const step = (number: number, title: string, id: string) => <div className="step-h"><span className="step-n" aria-hidden>{number}</span><h2 id={id}>{title}</h2></div>;

  return <>
    <Header />
    <main className="impact-page">
      <div className="impact-heading">
        <div><p className="impact-eyebrow">상위법 개정 → 기관 규정 검토</p><h1>어느 조문을 검토해야 할까요?</h1></div>
        <Link className="btn small" href="/start?mode=amend">바꿀 조문을 알고 있어요</Link>
      </div>
      <p className="impact-lead">상위법의 개정 전·후 조문과 기관 규정을 넣으면, 원문을 인용한 영향 후보를 찾습니다. 담당자가 고른 조문으로 개정 작업을 이어갑니다.</p>
      <div className="impact-scope">입력한 두 시점 자료만 비교합니다. 같은 조 번호의 본문 변경이 대상이며, 신설·삭제·조 번호 이동·부칙·별표는 별도로 확인해 주세요. 후보 선택은 개정 의무의 확정을 뜻하지 않습니다.</div>

      <section className="impact-section" aria-labelledby="impact-input-title">
        {step(1, '비교할 원문을 넣어 주세요', 'impact-input-title')}
        <div className="impact-example">
          <span>처음이라면, 위원 수 30명 → 20명으로 바뀐 가상 자료로 확인해 보세요.</span>
          <button className="btn small" type="button" onClick={fillExample} disabled={busy || saving}>검증용 예시 채우기</button>
        </div>
        {example && <p className="help">예시의 법령·기관은 가상입니다. 입력만 채우며, 분석 버튼을 누르면 실제 AI에 요청합니다.</p>}
        <fieldset className="impact-fields" disabled={locked}>
          <label className="impact-label">상위법령명<input className="field" value={input.upperTitle} onChange={(event) => update('upperTitle', event.target.value)} maxLength={160} placeholder="예) ○○법 시행령" /></label>
          <div className="impact-columns">
            <div className="impact-version">
              <label className="impact-label">개정 전 기준일 <span className="help">선택 입력</span><input type="date" className="field" value={input.beforeDate} onChange={(event) => update('beforeDate', event.target.value)} /></label>
              <label className="impact-label">개정 전 조문<textarea className="field mono" value={input.before} onChange={(event) => update('before', event.target.value)} placeholder="제10조(위원회 구성) …" readOnly={!!review} /></label>
              <span className="help">{input.before.length.toLocaleString()} / 12,000자 · {impactArticles(input.before).length}개 조 인식</span>
            </div>
            <div className="impact-version">
              <label className="impact-label">개정 후 기준일 <span className="help">선택 입력</span><input type="date" className="field" value={input.afterDate} onChange={(event) => update('afterDate', event.target.value)} /></label>
              <label className="impact-label">개정 후 조문<textarea className="field mono" value={input.after} onChange={(event) => update('after', event.target.value)} placeholder="변경된 같은 조 번호의 본문을 넣어 주세요." readOnly={!!review} /></label>
              <span className="help">{input.after.length.toLocaleString()} / 12,000자 · {impactArticles(input.after).length}개 조 인식</span>
            </div>
          </div>
          <label className="impact-label">우리 기관의 현행 규정<textarea className="field mono impact-institution" value={input.institutionRaw} onChange={(event) => update('institutionRaw', event.target.value)} placeholder={'규정 제목\n제1조(목적) …\n제2조(구성) …'} readOnly={!!review} /></label>
          <p className="help">{input.institutionRaw.length.toLocaleString()} / 24,000자{institution && ` · ${institution.title} · ${institution.articles.length}개 조 인식`}{institution?.diagnostics.length ? ` · 읽기 확인이 필요한 부분 ${institution.diagnostics.length}곳` : ''}. 입력 원문은 개정 작업에 읽기 전용으로 보관됩니다.</p>
          <div className="impact-columns">
            <label className="impact-label">규정 종류<select className="field" value={input.kind} onChange={(event) => update('kind', event.target.value as RuleKind)}>{KINDS.map((kind) => <option key={kind} value={kind}>{RULE_KIND_LABEL[kind]}</option>)}</select></label>
            <label className="impact-label">기관 서식<select className="field" value={profileId} onChange={(event) => setProfileId(event.target.value)}>{profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name} · {profile.typeLabel}</option>)}</select></label>
          </div>
          <label className="impact-confirm"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} /><span>두 시점의 자료가 서로 바뀌지 않았고, 기관 규정의 조 번호와 본문을 확인했습니다.</span></label>
        </fieldset>
        {!review && <div className="impact-actions"><button type="button" className="btn primary" disabled={busy} onClick={analyze}>{busy ? '원문을 대조하며 후보 찾는 중…' : '영향 후보 찾기'}</button><span className="help">실제 AI 응답을 요청하고 인용을 원문과 대조합니다.</span></div>}
        {busy && <p className="impact-progress" role="status">보통 1분 이내에 결과가 나옵니다. 연결에 실패하면 직접 인용이 일치하는 후보만 별도로 표시합니다.</p>}
        {review && <button className="btn small" type="button" disabled={saving} onClick={() => { setReview(null); setReviewKnowledge(undefined); setConfirmed(false); setError(''); }}>입력 다시 수정·분석</button>}
      </section>

      {review && <section className="impact-section" aria-labelledby="impact-candidates-title" aria-live="polite">
        {step(2, '실제로 검토할 조문을 골라 주세요', 'impact-candidates-title')}
        {reviewKnowledge && <KnowledgePanel records={[reviewKnowledge]} question={`「${input.upperTitle}」 개정에 따른 기관 규정 검토`} kind={input.kind} document={input.institutionRaw} documentLabel="기관의 현행 규정" />}
        <div className={`impact-analysis ${review.method}`}>
          <strong>{review.method === 'ai' ? `AI 영향 후보 ${review.candidates.length}개 · 인용 대조 완료` : `문자일치 후보 ${review.candidates.length}개 · 담당자 영향 검토 필요`}</strong>
          <p>{review.method === 'ai' ? '원문 인용이 일치함을 확인했습니다. 적용 범위와 개정 필요성은 담당자가 검토해 주세요.' : '법령명과 조 번호의 직접 인용 관계만 확인했습니다. 의미상 영향 여부는 분석하지 못했습니다.'}</p>
          {review.method === 'ai' && <p className="help">실제 응답: {review.modelLabel || review.model || '연결 모델'}{review.actualModel ? ` · ${review.actualModel}` : ''} · {(review.elapsedMs / 1_000).toFixed(1)}초{review.promptVersion ? ` · ${review.promptVersion}` : ''}</p>}
          {review.note && <p className="help">{review.note}</p>}
          {!!review.rejectedCount && <p className="help">원문과 일치하지 않거나 중복된 AI 후보 {review.rejectedCount}개를 제외했습니다.</p>}
        </div>
        {!review.candidates.length && <div className="impact-empty"><h3>현재 자료에서 검증 가능한 후보를 찾지 못했습니다.</h3><p>영향이 없다는 뜻은 아닙니다. 비교 조문 범위를 확인하거나, 담당자가 개정 대상을 정해 기존 규정 고치기로 이어가세요.</p><Link className="btn small" href="/start?mode=amend">직접 개정 작업 시작</Link></div>}
        <div className="impact-candidates">
          {review.candidates.map((candidate) => <article key={candidate.id} className={`impact-candidate ${review.selectedIds.includes(candidate.id) ? 'selected' : ''}`}>
            <label className="impact-candidate-pick"><input type="checkbox" checked={review.selectedIds.includes(candidate.id)} onChange={() => toggle(candidate.id)} disabled={saving} /><span><strong>{candidate.target}</strong><span className="impact-target-upper">상위법 {candidate.upperTarget} 관련</span></span><span className="badge">{candidate.source === 'ai' ? 'AI 후보' : '문자일치'}</span></label>
            <p className="impact-reason">{candidate.reason}</p>
            <div className="impact-quote"><h3>기관 원문</h3><blockquote>{candidate.institutionQuote}</blockquote></div>
            <div className="impact-columns impact-quote-pair"><div className="impact-quote before"><h3>상위법 개정 전</h3><blockquote>{candidate.beforeQuote}</blockquote></div><div className="impact-quote after"><h3>상위법 개정 후</h3><blockquote>{candidate.afterQuote}</blockquote></div></div>
            <div className="impact-checks"><h3>담당자가 확인할 사항</h3><ul>{candidate.checks.map((check, index) => <li key={`${candidate.id}-${index}`}>{check}</li>)}</ul></div>
          </article>)}
        </div>
      </section>}

      {!!review?.candidates.length && <section className="impact-section" aria-labelledby="impact-start-title">
        {step(3, '선택한 조문으로 개정 초안을 만드세요', 'impact-start-title')}
        <p>선택한 조문: <strong>{selected.length ? [...new Set(selected.map((candidate) => candidate.target))].join(', ') : '아직 선택하지 않았습니다'}</strong></p>
        <label className="impact-label">담당자 추가 지시 <span className="help">선택 입력</span><textarea className="field" value={instruction} onChange={(event) => setInstruction(event.target.value)} maxLength={2_000} disabled={saving} placeholder="예) 제2조의 위원 정수를 개정 후 기준인 20명으로 바꾸고 나머지 문구는 유지해 주세요." /></label>
        <p className="help">선택한 범위의 변경 제안을 만들고, 개정문·신구조문 대비표·이유서로 이어집니다. 변경 제안은 다음 화면에서 검토·수락합니다.</p>
        <label className="impact-confirm"><input type="checkbox" checked={measureTime} onChange={(event) => setMeasureTime(event.target.checked)} disabled={saving} /><span>이 작업의 사용시간도 기록하기<span className="help" style={{ display: 'block' }}>이 화면을 연 때부터 측정하며 작업 화면에서 일시정지·종료할 수 있습니다.</span></span></label>
        <button className="btn primary" type="button" disabled={!selected.length || saving} onClick={startWork}>{saving ? '원문과 분석 기록 저장 중…' : `선택한 ${selected.length}개 후보로 개정 작업 시작`}</button>
      </section>}
      {error && <div className="impact-error" role="alert">{error}</div>}
    </main>
  </>;
}
