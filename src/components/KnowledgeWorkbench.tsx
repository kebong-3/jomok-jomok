'use client';

import Link from 'next/link';
import { useCallback, useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';
import SimilarRules from '@/components/SimilarRules';
import AiProgress from '@/components/AiProgress';
import { knowledgeAssistResultSchema, type KnowledgeAssistResult, type KnowledgeAssistRequest } from '@/lib/work-review';
import { aiHeaders } from '@/lib/ai';
import { loadSettings } from '@/lib/settings';
import {
  KNOWLEDGE_DOCUMENTS, KNOWLEDGE_CORE_DOCUMENTS, KNOWLEDGE_MANIFEST, KNOWLEDGE_MODES,
  knowledgePageLabel, knowledgeSourceHref, knowledgeCoverageText,
  type KnowledgeAnswer, type KnowledgeCitation, type KnowledgeMode,
  type KnowledgeRecord, type KnowledgeSearchResult,
} from '@/lib/knowledge';
import styles from './Knowledge.module.css';

export type KnowledgeTab = 'assist' | 'search' | 'library' | 'similar';
export interface KnowledgeWorkbenchProps {
  initialQuestion?: string;
  initialDocument?: string;
  initialKind?: string;
  initialMode?: KnowledgeMode;
  initialTab?: KnowledgeTab;
  embedded?: boolean;
  lockDocument?: boolean;
  assistDisabledReason?: string;
  initialResult?: KnowledgeAssistResult | null;
  onAssistStart?: (request: KnowledgeAssistRequest) => void;
  onAssistResult?: (result: KnowledgeAssistResult, request: KnowledgeAssistRequest) => void;
  renderChangeAction?: (index: number) => ReactNode;
  renderResultActions?: (result: KnowledgeAssistResult) => ReactNode;
}

const TABS: { id: KnowledgeTab; label: string }[] = [
  { id: 'assist', label: 'AI 실무도움' },
  { id: 'search', label: '자료 검색' },
  { id: 'library', label: `원본 자료 ${KNOWLEDGE_CORE_DOCUMENTS.length}종` },
  { id: 'similar', label: '유사 규정' },
];
const KINDS = [
  ['ordinance', '조례'], ['rule', '규칙'], ['directive', '훈령'],
  ['established_rule', '예규'], ['notice', '고시'], ['guideline', '내부지침'],
  ['bylaw', '공공기관 내규'], ['law', '법률·법령'],
] as const;
const MODES = Object.keys(KNOWLEDGE_MODES) as KnowledgeMode[];
const kindName = (value: string) => KINDS.find(([id]) => id === value)?.[1] ?? value;
const validKind = (value: string | null | undefined) => KINDS.some(([id]) => id === value);
const validMode = (value: string | null | undefined): value is KnowledgeMode => MODES.includes(value as KnowledgeMode);
const validTab = (value: string | null | undefined): value is KnowledgeTab => TABS.some(({ id }) => id === value);

type AssistResult = KnowledgeAssistResult;
const SAMPLES: { label: string; mode: KnowledgeMode; question: string; document?: string }[] = [
  { label: '일부개정과 전부개정', mode: 'explain', question: '조례를 일부개정할지 전부개정할지 판단할 때 어떤 기준과 예외를 확인해야 하나요?' },
  { label: '위원회와 경과조치', mode: 'review', question: '위원회 위원의 연임 제한을 바꾸려 합니다. 현직 위원에게 적용할 때 확인할 사항과 경과조치 쟁점을 검토해 주세요.' },
  { label: '뜻을 지키는 문장 정비', mode: 'plain_language', question: '다음 가상 조문을 알기 쉽게 다듬되, 신청 대상과 의무의 의미가 바뀔 수 있는 부분은 따로 표시해 주세요.', document: '제5조(신청) 지원을 받고자 하는 자는 신청서를 시장에게 제출하여야 한다.' },
  { label: '의견제시 요청 준비', mode: 'opinion_request', question: '자치법규 의견제시를 요청하기 전에 확인할 요청 자격, 대상, 질의 요건과 준비할 자료를 알려 주세요. 아직 확인되지 않은 사실이나 대립 의견은 만들어 쓰지 말아 주세요.' },
];

function sizeLabel(bytes: number) {
  return bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}
function dateLabel(value: string) {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleString('ko-KR');
}
function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : '요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.';
}
function sourceText(c: KnowledgeCitation, origin: string) {
  return `${c.id}\n${c.title} · ${c.edition} · ${knowledgePageLabel(c)}\n수록 기준: ${c.coverageDate}\n원문: ${origin}${knowledgeSourceHref(c)}\n공식 출처: ${c.sourceUrl ?? '사용자가 제공한 출처 안내'}\n[검색 발췌문]\n${c.text}`;
}

function SourceCard({ source, compact = false }: { source: KnowledgeCitation; compact?: boolean }) {
  return (
    <article className={`${styles.sourceCard} ${compact ? styles.compactSource : ''}`} id={`source-${source.id}`}>
      <div className={styles.sourceTop}><span className={styles.badge}>입안 참고자료</span><span>{knowledgePageLabel(source)}</span></div>
      <h4>{source.title}</h4>
      <p className={styles.sourceMeta}>{source.edition} · 수록 기준 {source.coverageDate}</p>
      {source.section && <p className={styles.sectionLabel}>{source.section}</p>}
      <blockquote className={styles.excerpt}>{source.text}</blockquote>
      <div className={styles.linkRow}>
        <a href={knowledgeSourceHref(source)} target="_blank" rel="noreferrer">{source.pdfPage ? '이 쪽 원문 보기' : '원본 자료 보기'} ↗</a>
        <a href={source.downloadPath} download>원본 내려받기</a>
        {source.sourceUrl && <a href={source.sourceUrl} target="_blank" rel="noreferrer">공식 게시 페이지 ↗</a>}
      </div>
    </article>
  );
}

function ReferenceQuotes({ refs, sources }: {
  refs: { id: string; quote: string }[]; sources: Map<string, KnowledgeCitation>;
}) {
  return <details className={styles.quoteList}><summary>참고한 원문 {refs.length}건 · 인용 펼치기</summary>{refs.map((ref, index) => {
    const source = sources.get(ref.id);
    if (!source) return null;
    return <blockquote className={styles.verifiedQuote} key={`${ref.id}-${index}`}>
      <p>{ref.quote}</p>
      <cite><a href={knowledgeSourceHref(source)} target="_blank" rel="noreferrer">{source.title} · {knowledgePageLabel(source)} ↗</a><span>원문 인용 대조</span></cite>
    </blockquote>;
  })}</details>;
}

function reviewText(result: AssistResult, question: string, kind: string, mode: KnowledgeMode, origin: string) {
  const { answer, retrieval, trace } = result;
  const sources = new Map(result.sources.map(c => [c.id, c]));
  const refs = (citations: { id: string; quote: string }[]) => citations.filter(c => sources.has(c.id)).map(c => {
    const source = sources.get(c.id)!;
    return `인용: “${c.quote}”\n${source.title} · ${knowledgePageLabel(source)} · ${origin}${knowledgeSourceHref(source)}`;
  }).join('\n');
  return [
    '조목조목 · 자료 근거 검토 초안',
    'AI 작성 결과는 담당자 확인 전 초안입니다. 매뉴얼은 입안 참고 기준이며 현행 법령·위임 근거와 적법성 판단을 대신하지 않습니다.',
    `질문: ${question}\n규정 종류: ${kindName(kind)}\n검토 방식: ${KNOWLEDGE_MODES[mode].label}`,
    `검색 시각: ${retrieval.retrievedAt}\n자료 버전: ${retrieval.version}\n검색 상태: ${retrieval.status}`,
    retrieval.coverage ? knowledgeCoverageText(retrieval.coverage) : '이전 검토 기록에는 쟁점별 검색 범위가 저장되지 않았습니다.',
    trace ? `실제 요청 모델: ${trace.actualModel ?? trace.model}\n연결 표시: ${trace.modelLabel ?? trace.model}` : '실제 AI 응답 기록 없음',
    result.message ?? '',
    answer ? [
      `검토 요약\n${answer.summary}`,
      ...answer.points.map((point, index) => `${index + 1}. ${point.heading}\n${point.explanation}\n${refs(point.citations)}`),
      ...answer.changes.map((change, index) => `정비안 ${index + 1} · ${change.changeType === 'wording' ? '표현 정비' : change.changeType === 'substance' ? '내용 변경 검토' : '의미 확인 필요'}\n기존: ${change.before}\n제안: ${change.after}\n이유: ${change.reason}\n${refs(change.citations)}`),
      answer.draft ? `작성 초안\n${answer.draft}` : '',
      `다음 할 일\n${answer.nextSteps.map(v => `- ${v}`).join('\n')}`,
      `별도 확인할 사항\n${answer.needsCheck.map(v => `- ${v}`).join('\n')}`,
    ].filter(Boolean).join('\n\n') : '',
    result.warnings?.length ? `안내\n${result.warnings.join('\n')}` : '',
    '검색한 원문 근거',
    ...result.sources.map(c => sourceText(c, origin)),
    '원문에 인용문이 존재하는지 대조하는 것과 그 인용문이 법적 결론을 뒷받침하는지는 다른 검토입니다. 제출 전 현행 원문과 개별 사정을 확인하세요.',
  ].filter(Boolean).join('\n\n');
}

export default function KnowledgeWorkbench({
  initialQuestion = '', initialDocument = '', initialKind = 'ordinance',
  initialMode = 'explain', initialTab = 'assist', embedded = false, lockDocument = false, initialResult = null,
  onAssistStart, onAssistResult, renderChangeAction, renderResultActions, assistDisabledReason,
}: KnowledgeWorkbenchProps) {
  const id = useId();
  const [tab, setTab] = useState<KnowledgeTab>(initialTab);
  const [question, setQuestion] = useState(initialQuestion.slice(0, 2000));
  const [document, setDocument] = useState(initialDocument.length <= 12000 ? initialDocument : '');
  const [kind, setKind] = useState(validKind(initialKind) ? initialKind : 'ordinance');
  const [mode, setMode] = useState<KnowledgeMode>(initialMode);
  const [query, setQuery] = useState(initialQuestion.slice(0, 800));
  const [documentIds, setDocumentIds] = useState<string[]>([]);
  const [result, setResult] = useState<AssistResult | null>(initialResult);
  const [searchResult, setSearchResult] = useState<KnowledgeSearchResult | null>(null);
  const [busy, setBusy] = useState<'assist' | 'search' | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState(initialDocument.length > 12000 ? '작업 본문이 12,000자를 넘습니다. 검토할 조문과 관련 부칙을 골라 넣어 주세요.' : '');
  const [exportStatus, setExportStatus] = useState('');
  const [assistStarted, setAssistStarted] = useState<number>();
  const controller = useRef<AbortController | null>(null);
  const epoch = useRef(0);
  const mounted = useRef(false);
  const resultHeading = useRef<HTMLHeadingElement>(null);
  const tabButtons = useRef<(HTMLButtonElement | null)[]>([]);

  const invalidate = useCallback(() => {
    epoch.current += 1;
    controller.current?.abort();
    controller.current = null;
    setBusy(null); setResult(null); setSearchResult(null); setError(''); setExportStatus('');
  }, []);

  useEffect(() => {
    if (mounted.current) return;
    mounted.current = true;
    if (embedded) return;
    const params = new URLSearchParams(window.location.search);
    const requestedTab = params.get('tab');
    const requestedMode = params.get('mode');
    const requestedKind = params.get('kind');
    const requestedQuestion = params.get('q');
    if (validTab(requestedTab)) setTab(requestedTab);
    if (validMode(requestedMode)) setMode(requestedMode);
    if (validKind(requestedKind)) setKind(requestedKind!);
    if (requestedQuestion) { setQuestion(requestedQuestion.slice(0, 2000)); setQuery(requestedQuestion.slice(0, 800)); }
    if (params.get('from') === 'work') {
      try {
        const raw = window.sessionStorage.getItem('jj:knowledge:prefill');
        window.sessionStorage.removeItem('jj:knowledge:prefill');
        if (raw) {
          const p = JSON.parse(raw) as { question?: unknown; document?: unknown; kind?: unknown; createdAt?: unknown };
          const age = typeof p.createdAt === 'number' ? Date.now() - p.createdAt : Infinity;
          if (age >= 0 && age <= 15 * 60 * 1000) {
            if (typeof p.question === 'string') { setQuestion(p.question.slice(0, 2000)); setQuery(p.question.slice(0, 800)); }
            if (typeof p.kind === 'string' && validKind(p.kind)) setKind(p.kind);
            if (typeof p.document === 'string' && p.document.length <= 12000) setDocument(p.document);
            setNotice(p.document ? '이 작업의 문맥을 가져왔습니다. 검토할 내용과 질문을 확인한 뒤 요청하세요.' : '검토할 조문과 관련 부칙을 아래에 넣어 주세요. 본문이 길면 12,000자 이내의 검토 범위를 선택하세요.');
          } else setNotice('작업 문맥을 가져오는 시간이 지났습니다. 검토할 본문을 다시 넣어 주세요.');
        }
      } catch { setNotice('작업 문맥을 가져오지 못했습니다. 검토할 본문을 직접 넣어 주세요.'); }
    }
  }, []);

  useEffect(() => () => { epoch.current += 1; controller.current?.abort(); }, []);
  useEffect(() => { if (result || searchResult) resultHeading.current?.focus(); }, [result, searchResult]);

  const changeTab = (next: KnowledgeTab) => {
    if (next === tab) return;
    invalidate(); setNotice(''); setTab(next);
    if (next === 'search' && question.trim() && !query.trim()) setQuery(question.slice(0, 800));
  };
  const handleTabKey = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let next = index;
    if (event.key === 'ArrowRight') next = (index + 1) % TABS.length;
    else if (event.key === 'ArrowLeft') next = (index - 1 + TABS.length) % TABS.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = TABS.length - 1;
    else return;
    event.preventDefault(); changeTab(TABS[next].id); tabButtons.current[next]?.focus();
  };

  const submitAssist = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (assistDisabledReason) { setError(assistDisabledReason); return; }
    invalidate(); setNotice('');
    if (question.trim().length < 2) { setError('질문을 2자 이상 적어 주세요.'); return; }
    if ((mode === 'review' || mode === 'plain_language') && !document.trim()) { setError('이 검토 방식에는 검토할 본문이 필요합니다. 조문과 관련 부칙을 넣어 주세요.'); return; }
    if (question.length > 2000 || document.length > 12000) { setError('질문은 2,000자, 본문은 12,000자 이내로 넣어 주세요.'); return; }
    const requestEpoch = epoch.current;
    const request: KnowledgeAssistRequest = { question: question.trim(), document: document.trim(), kind, mode };
    onAssistStart?.(request);
    const abort = new AbortController(); controller.current = abort;
    let timedOut = false;
    const timeout = window.setTimeout(() => { timedOut = true; abort.abort(); }, 310_000);
    setBusy('assist'); setAssistStarted(Date.now());
    try {
      const settings = loadSettings();
      const response = await fetch('/api/knowledge/assist', {
        method: 'POST', headers: aiHeaders(settings), signal: abort.signal,
        body: JSON.stringify({ question: question.trim(), document: document.trim() || undefined, mode, kind, modelId: settings.modelId, strictModel: !!settings.modelId }),
      });
      const payload = await response.json().catch(() => null);
      if (requestEpoch !== epoch.current) return;
      if (!response.ok) throw new Error(payload?.error?.message ?? payload?.message ?? `검토 요청을 처리하지 못했습니다(HTTP ${response.status}).`);
      const checked = knowledgeAssistResultSchema.safeParse(payload);
      if (!checked.success) throw new Error('서버의 검토 응답과 출처 정보를 확인할 수 없습니다. 자료 검색으로 근거를 확인해 주세요.');
      setResult(checked.data);
      onAssistResult?.(checked.data, request);
      if (payload.trace?.model) window.dispatchEvent(new Event('jj:models-changed'));
    } catch (e) {
      if (requestEpoch !== epoch.current) return;
      setError(timedOut ? 'AI 응답 시간이 지났습니다. 자료 검색은 계속 사용할 수 있습니다. 설정·진단에서 연결을 확인한 뒤 다시 요청하세요.' : errorMessage(e));
    } finally {
      window.clearTimeout(timeout);
      if (requestEpoch === epoch.current) { setBusy(null); controller.current = null; }
    }
  };

  const submitSearch = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); invalidate(); setNotice('');
    if (query.trim().length < 2) { setError('찾을 내용을 2자 이상 적어 주세요.'); return; }
    const requestEpoch = epoch.current;
    const abort = new AbortController(); controller.current = abort;
    const timeout = window.setTimeout(() => abort.abort(), 25_000);
    setBusy('search');
    try {
      const params = new URLSearchParams({ q: query.trim(), kind, mode, limit: '8' });
      if (documentIds.length) params.set('documentIds', documentIds.join(','));
      const response = await fetch(`/api/knowledge/search?${params}`, { signal: abort.signal, cache: 'no-store' });
      const payload = await response.json().catch(() => null);
      if (requestEpoch !== epoch.current) return;
      if (!response.ok) throw new Error(payload?.error?.message ?? (typeof payload?.error === 'string' ? payload.error : undefined) ?? payload?.message ?? `자료를 찾지 못했습니다(HTTP ${response.status}).`);
      if (!payload || !Array.isArray(payload.hits) || typeof payload.version !== 'string') throw new Error('검색 응답 형식을 확인할 수 없습니다. 다시 검색해 주세요.');
      setSearchResult(payload as KnowledgeSearchResult);
    } catch (e) {
      if (requestEpoch !== epoch.current) return;
      setError(abort.signal.aborted ? '자료 검색 시간이 지났습니다. 잠시 후 다시 검색해 주세요.' : errorMessage(e));
    } finally {
      window.clearTimeout(timeout);
      if (requestEpoch === epoch.current) { setBusy(null); controller.current = null; }
    }
  };

  const copyReview = async () => {
    if (!result) return;
    try { await navigator.clipboard.writeText(reviewText(result, question, kind, mode, window.location.origin)); setExportStatus('검토문과 원문 출처를 복사했습니다.'); }
    catch { setExportStatus('브라우저에서 복사를 허용하지 않았습니다. 검토문 내려받기를 이용해 주세요.'); }
  };
  const downloadReview = () => {
    if (!result) return;
    const blob = new Blob(['\uFEFF', reviewText(result, question, kind, mode, window.location.origin)], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = window.document.createElement('a'); link.href = url; link.download = `조목조목_자료근거검토_${new Date().toISOString().slice(0, 10)}.txt`;
    link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 2000); setExportStatus('출처를 포함한 검토문 파일을 만들었습니다.');
  };
  const useSample = (sample: typeof SAMPLES[number]) => {
    invalidate(); setNotice(lockDocument ? '예시 질문만 넣었습니다. 현재 작업의 조문 본문은 그대로 유지합니다.' : sample.document ? '실무 연습을 위한 가상 조문입니다. 실제 검토에는 기관의 원문으로 바꿔 주세요.' : '예시 질문을 넣었습니다. 기관과 개정 의도에 맞게 고친 뒤 요청하세요.');
    setQuestion(sample.question); setQuery(sample.question.slice(0, 800)); setMode(sample.mode); if (!lockDocument) setDocument(sample.document ?? '');
  };
  const sources = new Map(result?.sources.map(c => [c.id, c]) ?? []);
  const Container = embedded ? 'div' : 'main';

  return <Container className={`${styles.workbench} ${embedded ? styles.embedded : ''}`}>
    {!embedded && <header className={styles.pageHeader}>
      <div><p className={styles.eyebrow}>조목조목 · 입안 근거를 함께 보는 작업실</p><h1>입안 자료실과 AI 검토</h1><p className={styles.lead}>기준을 묻고, 초안을 검토하고, 답변의 근거를 원문에서 확인하세요.</p></div>
      <div className={styles.headerActions}><Link className={styles.primaryLink} href="/start?mode=amend">개정 작업 시작</Link><Link className={styles.secondaryLink} href="/impact">상위법 영향 검토</Link></div>
    </header>}
    {!embedded && <section className={styles.overview} aria-label="수록 자료 범위">
      <div className={styles.stats}><div><strong>{KNOWLEDGE_CORE_DOCUMENTS.length}<span>종</span></strong><p>기준서 4권 · 요청서 1종</p></div><div><strong>{KNOWLEDGE_MANIFEST.totalPdfPages.toLocaleString('ko-KR')}<span>쪽</span></strong><p>PDF의 실제 페이지</p></div><div><strong>2026.10</strong><p>수집·제공한 판본 기준</p></div></div>
      <p className={styles.scopeNote}>매뉴얼은 <strong>입안 참고 기준</strong>입니다. 현행 법령·위임 근거와 실제 적용 여부는 별도로 확인합니다. 자료 검색과 원본 내려받기는 AI 연결 없이 사용할 수 있습니다.</p>
    </section>}
    <div className={styles.tabs} role="tablist" aria-label="자료실 기능">
      {TABS.map((item, index) => <button key={item.id} ref={el => { tabButtons.current[index] = el; }} type="button" role="tab" id={`${id}-tab-${item.id}`} aria-controls={`${id}-panel-${item.id}`} aria-selected={tab === item.id} tabIndex={tab === item.id ? 0 : -1} onClick={() => changeTab(item.id)} onKeyDown={event => handleTabKey(event, index)}>{item.label}</button>)}
    </div>
    <section className={styles.tabPanel} id={`${id}-panel-${tab}`} role="tabpanel" aria-labelledby={`${id}-tab-${tab}`}>
      {notice && <p className={styles.notice} role="status">{notice}</p>}

      {tab === 'assist' && <>
        <div className={styles.sectionIntro}><h2>자료를 근거로 실무 쟁점을 검토합니다</h2><p>어떤 규정을 다루는지 먼저 정하고, 검토할 상황을 구체적으로 알려 주세요.</p></div>
        <form onSubmit={submitAssist} className={styles.form} aria-busy={busy === 'assist'}>
          <div className={styles.formTop}><label className={styles.field}>규정 종류<select required disabled={lockDocument} value={kind} onChange={e => { invalidate(); setKind(e.target.value); }}>{KINDS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><p className={styles.fieldHelp}>국가 법령·지자체 조례·내부 규정은 적용할 권한과 절차가 다를 수 있습니다.</p></div>
          <fieldset className={styles.modeFieldset}><legend>어떤 도움이 필요한가요?</legend><div className={styles.modeGrid}>{MODES.map(value => <label className={`${styles.modeCard} ${mode === value ? styles.selectedMode : ''}`} key={value}><input type="radio" name={`${id}-mode`} value={value} checked={mode === value} onChange={() => { invalidate(); setMode(value); }} /><span><strong>{KNOWLEDGE_MODES[value].label}</strong><small>{KNOWLEDGE_MODES[value].help}</small></span></label>)}</div></fieldset>
          <div className={styles.samples}><span>질문 예시</span>{SAMPLES.map(sample => <button type="button" key={sample.label} onClick={() => useSample(sample)}>{sample.label}</button>)}</div>
          <label className={styles.field} htmlFor={`${id}-question`}>질문과 검토 의도 <span className={styles.required}>필수</span></label>
          <textarea id={`${id}-question`} className={styles.questionInput} required minLength={2} maxLength={2000} value={question} onChange={e => { invalidate(); setQuestion(e.target.value); }} placeholder="예: 위원회 위원의 연임 제한을 바꾸려고 합니다. 현직 위원에게 적용할 때 경과조치에서 확인할 사항을 알려 주세요." aria-describedby={`${id}-question-count`} />
          <div className={styles.inputMeta}><span>기관의 상황·적용 대상·입법 단계를 함께 적으면 쟁점을 좁힐 수 있습니다.</span><span id={`${id}-question-count`}>{question.length.toLocaleString('ko-KR')} / 2,000자</span></div>
          <label className={styles.field} htmlFor={`${id}-document`}>검토할 본문 <span className={mode === 'review' || mode === 'plain_language' ? styles.required : styles.optional}>{mode === 'review' || mode === 'plain_language' ? '필수' : '선택'}</span></label>
          <textarea id={`${id}-document`} readOnly={lockDocument} className={styles.documentInput} maxLength={12000} required={mode === 'review' || mode === 'plain_language'} value={document} onChange={e => { invalidate(); setDocument(e.target.value); }} placeholder="현행 조문, 개정 초안, 관련 부칙 또는 질의 배경을 넣어 주세요. 문장이 긴 경우 검토할 범위를 골라 넣어 주세요." aria-describedby={`${id}-document-count`} />
          <div className={styles.inputMeta}><span>표현 검토에서도 권리·의무, 대상, 금액, 기간, ‘및/또는’의 의미는 별도로 확인합니다.</span><span id={`${id}-document-count`}>{document.length.toLocaleString('ko-KR')} / 12,000자</span></div>
          <p className={styles.privacy}>질문과 본문, 검색된 참고 발췌문이 <Link href="/settings">설정한 AI 연결</Link>로 전달됩니다. {lockDocument ? ' 반영할 수정안을 선택한 뒤 ‘선택한 수정 반영’을 누르면 현재 초안에 적용됩니다.' : ' 이 화면의 검토 결과는 기존 작업에 자동 반영되지 않습니다.'}</p>
          {assistDisabledReason && <p className={styles.warning} role="status">{assistDisabledReason}</p>}
          <div className={styles.formActions}><button type="submit" className={styles.primaryButton} disabled={!!busy || !!assistDisabledReason}>{busy === 'assist' ? '자료 근거 검토 중…' : '자료 근거로 검토 요청'}</button>{busy && <button type="button" className={styles.secondaryButton} onClick={() => { invalidate(); setNotice('요청을 중단했습니다. 입력한 내용은 유지됩니다.'); }}>요청 중단</button>}<span className={styles.actionHint}>AI 연결은 설정·진단에서 실제 응답을 시험할 수 있습니다.</span></div>
        </form>
      </>}

      {tab === 'search' && <>
        <div className={styles.sectionIntro}><h2>자료의 원문을 바로 찾습니다</h2><p>발췌문과 쪽수를 보여 줍니다. AI 연결 없이 검색할 수 있습니다.</p></div>
        <form onSubmit={submitSearch} className={styles.form} aria-busy={busy === 'search'}>
          <label className={styles.field} htmlFor={`${id}-query`}>찾을 쟁점이나 문장</label><div className={styles.searchRow}><input id={`${id}-query`} type="search" required minLength={2} maxLength={800} value={query} onChange={e => { invalidate(); setQuery(e.target.value); }} placeholder="예: 기존 위원 연임 경과조치" /><button className={styles.primaryButton} type="submit" disabled={!!busy}>{busy === 'search' ? '자료 검색 중…' : '자료 검색'}</button></div>
          <div className={styles.filterRow}><label className={styles.field}>규정 종류<select disabled={lockDocument} value={kind} onChange={e => { invalidate(); setKind(e.target.value); }}>{KINDS.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label><label className={styles.field}>검토 관점<select value={mode} onChange={e => { invalidate(); setMode(e.target.value as KnowledgeMode); }}>{MODES.map(value => <option value={value} key={value}>{KNOWLEDGE_MODES[value].label}</option>)}</select></label></div>
          <fieldset className={styles.documentFilters}><legend>찾을 자료 <span>선택하지 않으면 전체 자료</span></legend><div>{KNOWLEDGE_DOCUMENTS.map(doc => <label key={doc.id}><input type="checkbox" checked={documentIds.includes(doc.id)} onChange={e => { invalidate(); setDocumentIds(previous => e.target.checked ? [...previous, doc.id] : previous.filter(value => value !== doc.id)); }} /><span>{doc.title}</span></label>)}</div></fieldset>
          <p className={styles.fieldHelp}>한 번에 한 쟁점을 검색해 보세요. 원하는 쪽이 없으면 자료를 지정하거나 구체적인 용어로 바꿔 검색할 수 있습니다.</p>
        </form>
      </>}

      {busy === 'assist' && <AiProgress title="조목이가 초안과 입안 자료를 함께 읽고 있어요" detail="검토 의견과 수정 제안을 정리하는 중입니다. 완료되면 아래에 표시합니다." phase="requesting" startedAt={assistStarted} onCancel={() => { invalidate(); setNotice('검토를 중단했습니다. 작성한 조문은 그대로 보관되어 있습니다.'); }} />}
      {busy === 'search' && <div className={styles.loading} role="status" aria-live="polite"><span className={styles.spinner} aria-hidden="true" /><div><strong>수록 자료에서 관련 문장을 찾고 있습니다.</strong><p>검색 중에 입력을 바꾸면 이전 요청은 중단됩니다.</p></div></div>}
      {error && <div className={styles.error} role="alert"><strong>요청을 완료하지 못했습니다</strong><p>{error}</p><div className={styles.linkRow}><button type="button" onClick={() => { invalidate(); setTab('search'); setQuery(question.slice(0, 800)); }}>자료 검색으로 근거 찾기</button><Link href="/settings">설정·진단 열기</Link></div></div>}

      {tab === 'assist' && result && <section className={styles.results} aria-label="자료 근거 검토 결과">
        <div className={styles.resultHeader}><div><span className={styles.eyebrow}>검토 결과</span><h2 ref={resultHeading} tabIndex={-1}>{result.status === 'answered' ? '자료 근거 검토 초안' : result.status === 'insufficient' ? '답변에 필요한 근거가 부족합니다' : 'AI 검토를 완료하지 못했습니다'}</h2></div>{result.answer && <span className={styles.reviewBadge}>AI 작성 · 담당자 확인 전</span>}</div>
        <p className={styles.sourceMeta}>검색 {dateLabel(result.retrieval.retrievedAt)} · 자료 버전 {result.retrieval.version}</p>
        {result.retrieval.coverage ? <section className={styles.coverage} aria-label="검색과 AI 입력 범위">
          <h3>이번 요청의 범위와 남은 쟁점</h3>
          <p>본문 {result.retrieval.coverage.documentCharacters.toLocaleString('ko-KR')}자를 검토 요청에 넣었습니다. 쟁점별로 관련 자료를 나누어 찾았으며, 모든 조문의 검토 완료를 뜻하지 않습니다.</p>
          <ul>{result.retrieval.coverage.issues.map(issue => <li key={issue.id} data-status={issue.status}><strong>{issue.label}</strong><span>{issue.status === 'included' ? `참고자료 ${issue.citationIds.length}개 입력에 포함` : issue.status === 'not_found' ? '관련 근거 미발견 · 별도 확인' : '발췌문 분량 한도로 제외 · 별도 검토'}</span></li>)}</ul>
          {!!result.retrieval.coverage.inputUnits.length && <details><summary>검토 요청의 조문·본문 범위 {result.retrieval.coverage.inputUnits.length}개 확인</summary><p>{result.retrieval.coverage.inputUnits.map(unit => unit.label).join(' · ')}</p><p>자동 탐지한 단서로 자료를 검색했습니다. 조문별 검토 결과나 적법 판정은 담당자가 실제 검토 의견과 근거를 대조해 확인해야 합니다.</p></details>}
          <p className={styles.fieldHelp}>원문 인용의 일치 여부와 해당 사안에 적용할 수 있는지는 각각 확인해야 합니다. 근거가 없거나 제외된 쟁점은 질문을 나누어 다시 검토해 주세요.</p>
        </section> : <p className={styles.scopeNote}>이전 검토에는 쟁점별 검색 범위가 저장되지 않았습니다. 현재 본문으로 다시 요청하면 범위를 함께 확인할 수 있습니다.</p>}
        {result.trace?.model && <p className={styles.trace}>실제 응답 · {result.trace.modelLabel ?? result.trace.model} {result.trace.actualModel ? `(${result.trace.actualModel})` : ''}{typeof result.trace.latencyMs === 'number' ? ` · ${(result.trace.latencyMs / 1000).toFixed(1)}초` : ''}</p>}
        {result.message && <p className={styles.notice}>{result.message}</p>}
        {!!result.warnings?.length && <div className={styles.warning}><strong>함께 확인할 안내</strong><ul>{result.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul></div>}
        {result.answer && <>
          <div className={styles.answerSummary}><strong className={styles.feedbackLabel}>먼저 살펴볼 검토 의견</strong><p>{result.answer.summary}</p></div>
          <div className={styles.points}>{result.answer.points.map((point, index) => <article className={styles.point} key={index}><span className={styles.feedbackLabel}>검토 의견</span><h3><span>{String(index + 1).padStart(2, '0')}</span>{point.heading}</h3><p>{point.explanation}</p><ReferenceQuotes refs={point.citations} sources={sources} /></article>)}</div>
          {!!result.answer.changes.length && <section className={styles.answerSection}><h3>본문 정비 제안</h3><p className={styles.fieldHelp}>표현을 고친 것인지, 요건과 효과가 달라지는지 구분해 확인하세요.</p>{result.answer.changes.map((change, index) => <article className={styles.changeCard} key={index}>{renderChangeAction?.(index)}<span className={`${styles.badge} ${change.changeType !== 'wording' ? styles.cautionBadge : ''}`}>{change.changeType === 'wording' ? '표현 정비' : change.changeType === 'substance' ? '내용 변경 검토' : '의미 확인 필요'}</span><div className={styles.beforeAfter}><div><h4>수정 전 문장</h4><p>{change.before}</p></div><div><h4>수정 제안 문장</h4><p>{change.after || '(삭제 제안)'}</p></div></div><p className={styles.changeReason}><strong>이렇게 제안한 이유</strong> {change.reason}</p><ReferenceQuotes refs={change.citations} sources={sources} /></article>)}</section>}
          {renderResultActions?.(result)}
          {result.answer.draft && <section className={styles.answerSection}><h3>작성 초안</h3><div className={styles.draft}>{result.answer.draft}</div></section>}
          <div className={styles.nextGrid}><section><h3>다음 할 일</h3>{result.answer.nextSteps.length ? <ol>{result.answer.nextSteps.map((step, index) => <li key={index}>{step}</li>)}</ol> : <p>검토 쟁점과 원문을 확인한 뒤 필요한 절차를 정해 주세요.</p>}</section><section><h3>별도 확인할 사항</h3><ul>{result.answer.needsCheck.map((item, index) => <li key={index}>{item}</li>)}</ul></section></div>
          <p className={styles.scopeNote}>원문에 인용문이 존재하는지 대조하는 것과 그 인용문이 법적 결론을 뒷받침하는지는 다른 검토입니다. 현행 법령·기관의 권한·위임 범위와 개별 사정을 확인하세요.</p>
        </>}
        {result.status !== 'answered' && <div className={styles.linkRow}><button type="button" onClick={() => { invalidate(); setTab('search'); setQuery(question.slice(0, 800)); }}>자료 검색으로 이어가기</button><Link href="/settings">AI 연결 확인</Link></div>}
        {!!result.sources.length && <section className={styles.answerSection}><h3>검색한 원문 근거 <span className={styles.count}>{result.sources.length}</span></h3><p className={styles.fieldHelp}>아래는 실제 검색된 발췌문입니다. 앞뒤 문맥과 예외는 원문에서 함께 확인하세요.</p><div className={styles.sourceGrid}>{result.sources.map(source => <SourceCard key={source.id} source={source} />)}</div></section>}
        <div className={styles.formActions}><button className={styles.secondaryButton} type="button" onClick={copyReview}>검토문 복사</button><button className={styles.secondaryButton} type="button" onClick={downloadReview}>출처 포함 검토문 내려받기</button></div><p className={styles.exportStatus} role="status" aria-live="polite">{exportStatus}</p>
      </section>}

      {tab === 'search' && searchResult && <section className={styles.results} aria-label="자료 검색 결과"><div className={styles.resultHeader}><h2 ref={resultHeading} tabIndex={-1}>검색 결과 <span className={styles.count}>{searchResult.hits.length}</span></h2><span className={styles.sourceMeta}>단어·문자 검색 · {Math.round(searchResult.elapsedMs)}ms</span></div><p className={styles.fieldHelp}>검색어 “{searchResult.query}” · 자료 버전 {searchResult.version}</p>{searchResult.note && <p className={styles.notice}>{searchResult.note}</p>}{searchResult.hits.length ? <div className={styles.sourceGrid}>{searchResult.hits.map(source => <SourceCard source={source} key={source.id} />)}</div> : <div className={styles.empty}><h3>관련 발췌문을 찾지 못했습니다</h3><p>검색 결과가 없다는 이유로 근거나 제한이 없다고 판단할 수는 없습니다. 쟁점을 나누거나 해당 자료를 지정해 다시 찾아보세요.</p><button type="button" className={styles.secondaryButton} onClick={() => changeTab('library')}>원본 자료 열기</button></div>}</section>}

      {tab === 'library' && <>
        <div className={styles.sectionIntro}><h2>입안 핵심 자료 {KNOWLEDGE_CORE_DOCUMENTS.length}종과 출처 안내</h2><p>기준서 PDF 4권과 의견제시 요청서 HWPX 1종을 그대로 내려받을 수 있습니다. 별도의 출처·파일 안내도 함께 제공합니다.</p></div>
        <p className={styles.libraryMeta}>총 원본 파일 {KNOWLEDGE_DOCUMENTS.length}개 · 합계 {sizeLabel(KNOWLEDGE_MANIFEST.originalBytes)} · PDF {KNOWLEDGE_MANIFEST.totalPdfPages.toLocaleString('ko-KR')}쪽 · 자료 버전 {KNOWLEDGE_MANIFEST.version}</p>
        <div className={styles.libraryGrid}>{KNOWLEDGE_DOCUMENTS.map((doc, index) => <article className={styles.libraryCard} key={doc.id}>
          <div className={styles.libraryCardTop}><span className={styles.documentNumber}>{String(index + 1).padStart(2, '0')}</span><span className={styles.badge}>{doc.id === 'source-guide' ? '사용자 제공 안내' : doc.format.toUpperCase()}</span></div>
          <h3>{doc.title}</h3><p className={styles.edition}>{doc.edition}</p><p className={styles.description}>{doc.description}</p>
          <div className={styles.fileFacts}><span>{doc.pages ? `${doc.pages.toLocaleString('ko-KR')} PDF쪽` : '고정 PDF 쪽수 없음'}</span><span>{sizeLabel(doc.bytes)}</span><span>{doc.publisher}</span></div>
          <div className={styles.libraryActions}><a className={styles.primaryLink} href={doc.downloadPath} download={doc.originalName || doc.fileName}>원본 내려받기 ↓</a><a className={styles.secondaryLink} href={doc.downloadPath} target="_blank" rel="noreferrer">{doc.format === 'pdf' ? 'PDF 열기 ↗' : '원본 열기 ↗'}</a></div>
          {doc.id === 'source-guide' && <p className={styles.provenanceNote}>사용자가 제공한 파일·출처 안내입니다. 법제처의 법령 또는 입안 기준 문서로 사용하지 않습니다.</p>}
          <details className={styles.fileDetails}><summary>판본·출처·파일 정보</summary><dl><dt>원본 파일명</dt><dd>{doc.originalName || doc.fileName}</dd><dt>{doc.id === 'opinion-request' ? '수집 기준' : '수록 기준'}</dt><dd>{doc.coverageDate}{doc.id === 'opinion-request' ? ' · 서식의 판·발행일은 별도 표시되지 않음' : ''}</dd><dt>수집 / 제공</dt><dd>{doc.collectedAt} / {doc.providedAt}</dd><dt>쪽수 안내</dt><dd>{doc.pageNote}</dd><dt>파일 SHA-256</dt><dd className={styles.hash}>{doc.sha256}</dd></dl><div className={styles.linkRow}>{doc.sourceUrl && <a href={doc.sourceUrl} target="_blank" rel="noreferrer">공식 게시 페이지 ↗</a>}{doc.officialDownloadUrl && <a href={doc.officialDownloadUrl} target="_blank" rel="noreferrer">공식 원본 링크 ↗</a>}</div></details>
          <p className={styles.usage}>{doc.usage}</p>
        </article>)}</div>
        <p className={styles.scopeNote}>파일 지문은 제공된 원본이 바뀌었는지 확인하는 값입니다. 공식 인증이나 최신성 보증을 뜻하지 않습니다. 매뉴얼의 예시 문장과 AI가 작성한 초안을 현행 조문으로 혼동하지 마세요.</p>
      </>}
      {tab === 'similar' && <><div className={styles.sectionIntro}><h2>다른 기관의 실제 규정을 참고합니다</h2><p>공식 원문을 검색하고 최대 4개 규정을 선택해 비교합니다. <a href="/law">조례 조사·5개년 비교</a>에서 공포연도별 변화를 확인하고 제정·개정 작업으로 이어갈 수도 있습니다.</p></div><SimilarRules /></>}
    </section>
  </Container>;
}
