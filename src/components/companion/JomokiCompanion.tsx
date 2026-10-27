'use client';
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import Jomoki, { type JomokiMood } from '@/components/Jomoki';
import { assistModeFor, localIntent, suggestedQuestions, typingFrames, type CompanionAction, type CompanionActionId, type CompanionBrief, type CompanionStage } from '@/lib/companion';
import { knowledgeAssistResultSchema, type KnowledgeAssistResult } from '@/lib/work-review';
import { knowledgePageLabel, knowledgeSourceHref, type KnowledgeCitation } from '@/lib/knowledge';
import { aiHeaders } from '@/lib/ai';
import { loadSettings } from '@/lib/settings';
import styles from './JomokiCompanion.module.css';

type Message =
  | { id: string; role: 'user'; text: string }
  | { id: string; role: 'jomoki'; text: string[]; actions?: CompanionAction[]; result?: KnowledgeAssistResult; pending?: boolean; error?: boolean };

const uid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const read = (key: string) => { try { return window.localStorage.getItem(key); } catch { return null; } };
const write = (key: string, value: string) => { try { window.localStorage.setItem(key, value); } catch { /* 저장소를 쓸 수 없어도 동작은 같다. */ } };

interface SpeechRecognitionLike { lang: string; interimResults: boolean; onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null; onend: (() => void) | null; onerror: (() => void) | null; start: () => void; stop: () => void }

/**
 * 조목이 동행 도우미 — 화면 오른쪽 아래에서 작업 상태를 말로 알려 주고,
 * 버튼 한 번으로 다음 행동을 실행하며, 입안 기준서 근거로 질문에 답한다.
 */
export default function JomokiCompanion({ brief, reaction, onAction, stage, mode, kind, kindLabel, getDocument, storageKey }: {
  brief: CompanionBrief;
  reaction?: CompanionBrief | null;
  onAction: (id: CompanionActionId) => void;
  stage: CompanionStage;
  mode: 'amend' | 'enact';
  kind: string;
  kindLabel: string;
  getDocument?: () => string;
  storageKey?: string;
}) {
  const [shown, setShown] = useState<CompanionBrief>(brief);
  const [bubble, setBubble] = useState(false);
  const [quiet, setQuiet] = useState(false);
  const [unread, setUnread] = useState(false);
  const [typed, setTyped] = useState(0);
  const [chat, setChat] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [voice, setVoice] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [listening, setListening] = useState(false);
  const [reduced, setReduced] = useState(false);
  const [look, setLook] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const avatarRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const recognition = useRef<SpeechRecognitionLike | null>(null);
  const reactionTimer = useRef<number | undefined>(undefined);
  const mounted = useRef(false);

  // 사용자 설정: 말풍선 자동 표시, 소리로 읽기, 동작 줄이기
  useEffect(() => {
    setQuiet(read('jj:companion:quiet') === '1');
    setVoice(read('jj:companion:voice') === '1');
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => setReduced(media.matches);
    sync(); media.addEventListener('change', sync);
    return () => media.removeEventListener('change', sync);
  }, []);

  // 대화 기록은 이 작업의 브라우저 세션 동안만 유지(보관파일·서버에 저장하지 않음)
  useEffect(() => {
    if (!storageKey) return;
    try { const saved = window.sessionStorage.getItem(storageKey); if (saved) setMessages((JSON.parse(saved) as Message[]).filter(m => !(m.role === 'jomoki' && m.pending)).slice(-30)); } catch { /* 새 대화로 시작 */ }
  }, [storageKey]);
  useEffect(() => {
    if (!storageKey) return;
    try { window.sessionStorage.setItem(storageKey, JSON.stringify(messages.slice(-30))); } catch { /* 용량 부족 시 저장 생략 */ }
  }, [messages, storageKey]);

  // 새 상태·반응이 오면 말풍선으로 알려 준다. 반응은 잠시 보여 준 뒤 현재 안내로 돌아간다.
  const present = useCallback((next: CompanionBrief) => {
    setShown(next); setTyped(0);
    if (chat) return;
    if (quiet) setUnread(true); else setBubble(true);
  }, [chat, quiet]);
  useEffect(() => {
    if (!mounted.current) { mounted.current = true; setShown(brief); if (!quiet) { const t = window.setTimeout(() => setBubble(true), 700); return () => window.clearTimeout(t); } return; }
    if (reaction) return;
    present(brief);
  }, [brief.key]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!reaction) return;
    if (chat) { setMessages(m => [...m, { id: uid(), role: 'jomoki', text: reaction.lines }]); return; }
    present(reaction);
    window.clearTimeout(reactionTimer.current);
    reactionTimer.current = window.setTimeout(() => present(brief), 6500);
    return () => window.clearTimeout(reactionTimer.current);
  }, [reaction?.key]); // eslint-disable-line react-hooks/exhaustive-deps

  // 글자 단위로 말하듯 보여 주기
  const fullText = shown.lines.join('\n');
  const frames = useMemo(() => typingFrames(fullText), [fullText]);
  useEffect(() => {
    if (!bubble || reduced) { setTyped(frames.length); return; }
    setTyped(0);
    const timer = window.setInterval(() => setTyped(n => { if (n >= frames.length) { window.clearInterval(timer); return n; } return n + 2; }), 34);
    return () => window.clearInterval(timer);
  }, [frames, bubble, reduced]);
  const typing = bubble && typed < frames.length;

  // 소리로 읽기(브라우저 음성 합성, 선택)
  const speak = useCallback((text: string) => {
    if (!voice || typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text.replace(/[「」『』‘’“”]/g, ''));
    utterance.lang = 'ko-KR'; utterance.rate = 1.05; utterance.pitch = 1.15;
    const ko = window.speechSynthesis.getVoices().find(v => v.lang.startsWith('ko'));
    if (ko) utterance.voice = ko;
    utterance.onstart = () => setSpeaking(true);
    utterance.onend = () => setSpeaking(false);
    utterance.onerror = () => setSpeaking(false);
    window.speechSynthesis.speak(utterance);
  }, [voice]);
  useEffect(() => { if (bubble) speak(shown.lines.join(' ')); }, [shown.key, bubble]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { if (typeof window !== 'undefined' && 'speechSynthesis' in window) window.speechSynthesis.cancel(); }, []);

  // 눈동자가 마우스를 따라본다(동작 줄이기 설정이면 고정)
  useEffect(() => {
    if (reduced) { setLook({ x: 0, y: 0 }); return; }
    let frame = 0;
    const move = (e: PointerEvent) => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        const box = avatarRef.current?.getBoundingClientRect();
        if (!box) return;
        const dx = e.clientX - (box.left + box.width / 2), dy = e.clientY - (box.top + box.height / 2);
        const d = Math.max(1, Math.hypot(dx, dy));
        setLook({ x: dx / d, y: dy / d });
      });
    };
    window.addEventListener('pointermove', move, { passive: true });
    return () => { window.removeEventListener('pointermove', move); if (frame) window.cancelAnimationFrame(frame); };
  }, [reduced]);

  // 한동안 손이 멈추면(90초) 막힌 곳이 있는지 살며시 묻는다. 한 단계에서 한 번만.
  const nudged = useRef<string>('');
  useEffect(() => {
    if (quiet || chat) return;
    let timer = window.setTimeout(nudge, 90_000);
    function nudge() {
      if (nudged.current === stage || document.hidden) return;
      nudged.current = stage;
      const q = suggestedQuestions(stage, mode, kindLabel)[0];
      setShown({ key: `idle|${stage}`, mood: 'care', status: '도움이 필요하면', lines: ['잠깐 막히셨나요? 천천히 하셔도 괜찮아요.', `예를 들어 “${q}”처럼 물어보시면 기준서에서 근거를 찾아 드릴게요.`], actions: [{ id: 'open-chat', label: '조목이에게 묻기', primary: true }] });
      setTyped(0); setBubble(true);
    }
    const reset = () => { window.clearTimeout(timer); timer = window.setTimeout(nudge, 90_000); };
    window.addEventListener('pointerdown', reset); window.addEventListener('keydown', reset); window.addEventListener('scroll', reset, { passive: true });
    return () => { window.clearTimeout(timer); window.removeEventListener('pointerdown', reset); window.removeEventListener('keydown', reset); window.removeEventListener('scroll', reset); };
  }, [stage, quiet, chat, mode, kindLabel]);

  useEffect(() => { listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: reduced ? 'auto' : 'smooth' }); }, [messages, reduced]);
  useEffect(() => {
    if (!chat) return;
    const t = window.setTimeout(() => inputRef.current?.focus(), 60);
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setChat(false); };
    window.addEventListener('keydown', esc);
    return () => { window.clearTimeout(t); window.removeEventListener('keydown', esc); };
  }, [chat]);

  const openChat = () => {
    setChat(true); setBubble(false); setUnread(false);
    setMessages(list => list.length ? list : [{ id: uid(), role: 'jomoki', text: [...shown.lines, '규정 입안 기준이 궁금하면 편하게 물어보세요. 법제처 기준서 4권에서 근거 쪽수까지 찾아 드릴게요.'], actions: shown.actions.filter(a => a.id !== 'open-chat') }]);
  };
  const run = (id: CompanionActionId) => { if (id === 'open-chat') { openChat(); return; } onAction(id); };
  const toggleQuiet = () => { const next = !quiet; setQuiet(next); write('jj:companion:quiet', next ? '1' : '0'); if (next) setBubble(false); };
  const toggleVoice = () => { const next = !voice; setVoice(next); write('jj:companion:voice', next ? '1' : '0'); if (!next && 'speechSynthesis' in window) window.speechSynthesis.cancel(); };

  const listen = () => {
    const Ctor = (window as unknown as { SpeechRecognition?: new () => SpeechRecognitionLike; webkitSpeechRecognition?: new () => SpeechRecognitionLike }).SpeechRecognition
      ?? (window as unknown as { webkitSpeechRecognition?: new () => SpeechRecognitionLike }).webkitSpeechRecognition;
    if (!Ctor) return;
    if (listening) { recognition.current?.stop(); return; }
    const r = new Ctor(); r.lang = 'ko-KR'; r.interimResults = true;
    r.onresult = (e) => setInput(Array.from(e.results).map(x => x[0].transcript).join(''));
    r.onend = () => setListening(false); r.onerror = () => setListening(false);
    recognition.current = r; setListening(true); r.start();
  };
  const canListen = typeof window !== 'undefined' && !!((window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition ?? (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition);

  const ask = async (question: string) => {
    const q = question.trim();
    if (q.length < 2 || busy) return;
    setInput('');
    const userMsg: Message = { id: uid(), role: 'user', text: q };
    const intent = localIntent(q, stage);
    if (intent) {
      if (intent.action === 'open-chat') { setMessages(m => [...m, userMsg, { id: uid(), role: 'jomoki', text: shown.lines, actions: shown.actions.filter(a => a.id !== 'open-chat') }]); speak(shown.lines.join(' ')); return; }
      onAction(intent.action);
      setMessages(m => [...m, userMsg, { id: uid(), role: 'jomoki', text: [intent.reply] }]); speak(intent.reply);
      return;
    }
    const pendingId = uid();
    setMessages(m => [...m, userMsg, { id: pendingId, role: 'jomoki', text: ['기준서에서 근거를 찾고 있어요…'], pending: true }]);
    setBusy(true);
    const abort = new AbortController(); abortRef.current = abort;
    const timer = window.setTimeout(() => abort.abort(), 150_000);
    const document = (getDocument?.() ?? '').slice(0, 12000);
    const answerMode = assistModeFor(q, !!document.trim());
    try {
      const settings = loadSettings();
      const res = await fetch('/api/knowledge/assist', { method: 'POST', headers: aiHeaders(settings), signal: abort.signal,
        body: JSON.stringify({ question: q, document: answerMode === 'explain' ? document.slice(0, 4000) : document, mode: answerMode, kind, modelId: settings.modelId, strictModel: !!settings.modelId }) });
      const payload = await res.json().catch(() => null);
      if (!res.ok) throw new Error(payload?.error?.message ?? payload?.message ?? '답을 만들지 못했어요.');
      const checked = knowledgeAssistResultSchema.safeParse(payload);
      if (!checked.success) throw new Error('답변의 출처를 확인하지 못했어요. 자료실 검색으로 근거를 확인해 주세요.');
      const r = checked.data;
      const lines = r.status === 'answered' && r.answer ? [r.answer.summary]
        : r.sources.length ? [r.status === 'ai_unavailable' ? 'AI 설명은 지금 만들지 못했지만, 기준서에서 관련 원문을 찾았어요.' : '딱 맞는 설명은 보류했어요. 대신 관련 원문을 찾아 왔어요.', '아래 쪽수를 눌러 원문을 확인해 보세요.']
        : [r.message ?? '기준서에서 관련 근거를 찾지 못했어요. 조문 번호나 쟁점을 조금 더 구체적으로 물어봐 주세요.'];
      setMessages(m => m.map(x => x.id === pendingId ? { id: pendingId, role: 'jomoki', text: lines, result: r } : x));
      speak(lines.join(' '));
      if (r.trace?.model) window.dispatchEvent(new Event('jj:models-changed'));
    } catch (e) {
      const text = abort.signal.aborted ? ['답이 너무 오래 걸려서 멈췄어요. 질문을 조금 짧게 나눠 다시 물어봐 주세요.'] : [e instanceof Error ? e.message : '답을 만들지 못했어요.', '입안 자료실에서 원문을 직접 검색할 수도 있어요.'];
      setMessages(m => m.map(x => x.id === pendingId ? { id: pendingId, role: 'jomoki', text, error: true } : x));
    } finally {
      window.clearTimeout(timer); setBusy(false); abortRef.current = null;
    }
  };
  const submit = (e: FormEvent) => { e.preventDefault(); void ask(input); };

  const mood: JomokiMood = busy ? 'thinking' : shown.mood;
  const talking = typing || speaking;
  const suggestions = suggestedQuestions(stage, mode, kindLabel);
  const visibleText = frames.slice(0, typed).join('');

  return <div className={`${styles.dock} no-print`} data-open={chat || undefined}>
    {bubble && !chat && <div className={styles.bubble} role="status" aria-live="polite">
      <div className={styles.bubbleHead}><b>조목이</b><span className={styles.status}>{shown.status}</span><button type="button" className={styles.close} onClick={() => setBubble(false)} aria-label="말풍선 닫기">×</button></div>
      <p className={styles.sr}>{fullText}</p>
      <p className={styles.speech} aria-hidden="true">{visibleText}{typing && <span className={styles.caret} />}</p>
      {!typing && <div className={styles.actions}>
        {shown.actions.map(a => <button key={a.id} type="button" className={a.primary ? styles.primary : undefined} onClick={() => run(a.id)}>{a.label}</button>)}
        {!shown.actions.some(a => a.id === 'open-chat') && <button type="button" className={styles.link} onClick={openChat}>물어보기</button>}
      </div>}
    </div>}

    {chat && <section className={styles.chat} role="dialog" aria-label="조목이와 대화">
      <header className={styles.chatHead}>
        <Jomoki size={46} mood={mood} motion={reduced ? 'none' : 'loop'} talking={talking || busy} look={look} />
        <div><b>조목이</b><span>{busy ? '기준서를 찾아보는 중…' : '규정 입안 동행 도우미 · 법제처 기준서 근거'}</span></div>
        <button type="button" className={styles.iconBtn} onClick={toggleVoice} aria-pressed={voice} title={voice ? '소리 끄기' : '소리로 읽어 주기'} aria-label={voice ? '소리 끄기' : '소리로 읽어 주기'}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z" />{voice ? <path d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" fill="none" /> : <path d="m16.5 9.5 5 5m0-5-5 5" fill="none" />}</svg></button>
        <button type="button" className={styles.iconBtn} onClick={() => setChat(false)} aria-label="대화 닫기">×</button>
      </header>
      <div className={styles.messages} ref={listRef}>
        {messages.map(m => m.role === 'user'
          ? <p key={m.id} className={styles.user}>{m.text}</p>
          : <div key={m.id} className={`${styles.jomoki} ${m.error ? styles.err : ''}`}>
            {m.pending ? <p className={styles.dots} aria-label="답을 준비하는 중"><span /><span /><span /> {m.text[0]}</p> : m.text.map((line, i) => <p key={i}>{line}</p>)}
            {m.result && <Answer result={m.result} />}
            {!!m.actions?.length && <div className={styles.actions}>{m.actions.map(a => <button key={a.id} type="button" className={a.primary ? styles.primary : undefined} onClick={() => run(a.id)}>{a.label}</button>)}</div>}
          </div>)}
      </div>
      <div className={styles.suggest} aria-label="이렇게 물어보세요">{suggestions.map(q => <button key={q} type="button" onClick={() => void ask(q)} disabled={busy}>{q}</button>)}</div>
      <form className={styles.form} onSubmit={submit}>
        <textarea ref={inputRef} rows={1} maxLength={2000} value={input} placeholder={busy ? '답을 준비하고 있어요…' : '무엇이든 물어보세요'} onChange={e => setInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void ask(input); } }} aria-label="조목이에게 질문" />
        {canListen && <button type="button" className={styles.iconBtn} onClick={listen} aria-pressed={listening} title="말로 묻기" aria-label={listening ? '듣기 멈추기' : '말로 묻기'}><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" fill="none" /></svg></button>}
        {busy ? <button type="button" className={styles.send} onClick={() => abortRef.current?.abort()}>멈춤</button> : <button type="submit" className={styles.send} disabled={input.trim().length < 2}>보내기</button>}
      </form>
      <p className={styles.note}>답변은 입안 참고 기준서 근거 설명이에요. 현행 법령·위임 근거와 최종 판단은 담당자가 확인해 주세요.</p>
    </section>}

    <div className={styles.avatarRow}>
      {!chat && <button type="button" className={styles.quiet} onClick={toggleQuiet} title={quiet ? '말풍선 다시 켜기' : '말풍선 자동으로 띄우지 않기'}>{quiet ? '알림 켜기' : '조용히'}</button>}
      <button ref={avatarRef} type="button" className={styles.avatar} onClick={() => (chat ? setChat(false) : bubble ? openChat() : (setBubble(true), setUnread(false), setTyped(0)))} aria-label={chat ? '조목이 대화 닫기' : '조목이 도우미 열기'} aria-expanded={chat}>
        <Jomoki size={78} mood={mood} motion={reduced ? 'none' : 'loop'} talking={!chat && talking} look={look} />
        {unread && <span className={styles.dot} aria-label="새 안내" />}
      </button>
    </div>
  </div>;
}

function Answer({ result }: { result: KnowledgeAssistResult }) {
  const sources = new Map(result.sources.map(s => [s.id, s]));
  const cite = (id: string) => sources.get(id) as KnowledgeCitation | undefined;
  const link = (c?: KnowledgeCitation) => c && <a href={knowledgeSourceHref(c)} target="_blank" rel="noreferrer">{c.title.replace(' 2026', '').replace(' 2025', '')} · {knowledgePageLabel(c)}</a>;
  if (result.status === 'answered' && result.answer) {
    const a = result.answer;
    return <div className={styles.answer}>
      {a.points.slice(0, 4).map((p, i) => <details key={i} open={i === 0}><summary>{p.heading}</summary><p>{p.explanation}</p><small>{p.citations.map(c => <span key={c.id}>{link(cite(c.id))}</span>)}</small></details>)}
      {!!a.changes.length && <div className={styles.changes}><b>이렇게 바꿔 볼 수 있어요</b>{a.changes.slice(0, 3).map((c, i) => <p key={i}><del>{c.before}</del> → <ins>{c.after || '(삭제)'}</ins><small>{c.reason}</small></p>)}</div>}
      {!!a.needsCheck.length && <div className={styles.check}><b>담당자님이 확인할 것</b><ul>{a.needsCheck.slice(0, 3).map((x, i) => <li key={i}>{x}</li>)}</ul></div>}
    </div>;
  }
  if (!result.sources.length) return null;
  return <ul className={styles.sources}>{result.sources.slice(0, 3).map(s => <li key={s.id}>{link(s)}<small>{s.text.slice(0, 140)}…</small></li>)}</ul>;
}
