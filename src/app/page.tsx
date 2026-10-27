'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import Header from '@/components/Header';
import { SAMPLES } from '@/data/samples';
import { listProjects, type Project } from '@/lib/project';
import { ProjectBackupButton, ProjectImport } from '@/components/ProjectTransfer';
import transferStyles from '@/components/ProjectTransfer.module.css';
import JomokiShowcase from '@/components/JomokiShowcase';
import homeStyles from './Home.module.css';
import { workMethodLabel } from '@/lib/amendment-method';
import { RULE_KIND_LABEL } from '@/engine';

function when(t: number) {
  const d = new Date(t);
  return `${d.getMonth() + 1}. ${d.getDate()}. ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** 담당자가 "지금 무엇을 하려는지"로 고르는 시작점 */
const TASKS = [
  { href: '/start?mode=enact', tone: 'mint', kicker: '제정', title: '새 규정을 만들어요', body: '목적과 근거 법령만 알려 주세요. 조문 체계부터 정하고 표준 조문 초안을 함께 써요.', makes: '제정안 · 조문 체계표 · 제정이유 · 입법예고문' },
  { href: '/start?mode=amend', tone: 'lilac', kicker: '일부개정 · 전부개정 · 폐지', title: '기존 규정을 고쳐요', body: '현행 원문과 바꾸고 싶은 내용을 평소 말로 적어 주세요. 고칠 조문과 연결된 인용까지 찾아요.', makes: '개정안 · 신·구조문대비표 · 개정이유 · 예고문' },
  { href: '/impact', tone: 'sun', kicker: '상위법 개정 대응', title: '상위법이 바뀌었어요', body: '바뀐 법령의 전·후 조문과 우리 규정을 넣으면 영향받는 조문과 개정 후보를 골라 줘요.', makes: '영향 조문 후보 · 개정 초안으로 바로 이어가기' },
  { href: '/law', tone: 'sky', kicker: '조사 · 비교', title: '다른 기관 규정을 찾아봐요', body: '최근 5개년 제·개정 동향과 유사 규정 최대 4개를 원문으로 나란히 비교해요.', makes: '5개년 공포 목록 · 유사 규정 비교 · 입안 참고자료' },
] as const;

const FLOW = [
  { n: '①', title: '조문', body: 'AI가 제안하고, 담당자는 수락·거절만' },
  { n: '②', title: '점검', body: '조 번호·인용·부칙을 규칙 엔진이 확인' },
  { n: '③', title: '문서 한 벌', body: '개정안·대비표·이유서·예고문 HWPX·DOCX' },
  { n: '④', title: '절차·일정', body: '예고 마감·공포 기한까지 단계별 안내' },
];

export default function Home() {
  const [recent, setRecent] = useState<Project[] | null>(null);
  const [showImport, setShowImport] = useState(false);
  useEffect(() => {
    listProjects().then((ps) => setRecent(ps.slice(0, 5)));
  }, []);
  return (
    <>
      <Header />
      <main className="wrap">
        <section className={homeStyles.welcome} aria-labelledby="welcome-title">
          <div className={homeStyles.welcomeCopy}>
            <p className={homeStyles.eyebrow}>주무관 곁의 규정 제·개정 도우미</p>
            <h1 id="welcome-title"><span>조목이와 함께,</span><br />규정 제·개정<br /><em>쉽게 시작해요.</em></h1>
            <p className={homeStyles.lead}>무엇부터 해야 할지 막막할 때,<br className={homeStyles.desktopBreak} /> 근거 찾기부터 조문 초안, 문서 한 벌과 절차 일정까지.<br />조목이가 한 조씩, 차근차근 함께 챙길게요.</p>
            <div className={homeStyles.actions}>
              <Link className={homeStyles.primary} href="/start?mode=amend">기존 규정 고치기 <span aria-hidden="true">→</span></Link>
              <Link className={homeStyles.secondary} href="/start?mode=enact">새 규정 만들기</Link>
            </div>
            <p className={homeStyles.helper}>조례·규칙부터 훈령·예규·고시, 공공기관 내규, 법률·시행령·시행규칙까지 함께 다뤄요.</p>
          </div>
          <JomokiShowcase className={homeStyles.showcase} compact />
        </section>

        <section className={homeStyles.tasks} aria-labelledby="tasks-title">
          <div className={homeStyles.sectionHead}>
            <h2 id="tasks-title">오늘은 어떤 일을 하시나요?</h2>
            <p>하려는 일을 고르면 필요한 입력만 차례로 물어볼게요.</p>
          </div>
          <div className={homeStyles.taskGrid}>
            {TASKS.map(task => <Link key={task.href} href={task.href} className={`${homeStyles.task} ${homeStyles[task.tone]}`}>
              <span className={homeStyles.taskKicker}>{task.kicker}</span>
              <strong>{task.title}</strong>
              <p>{task.body}</p>
              <span className={homeStyles.taskMakes}>{task.makes}</span>
              <span className={homeStyles.taskGo} aria-hidden="true">시작하기 →</span>
            </Link>)}
          </div>
          <p className={homeStyles.subLink}>입안 기준이 궁금하다면 <Link href="/knowledge">입안 자료실에서 법제처 기준서 4권·1,997쪽을 근거로 물어보세요 →</Link></p>
        </section>

        <section className={homeStyles.tryExamples} aria-label="예시로 시작하기">
          <div><strong>처음이라면, 예시로 3분 체험</strong><p>가상 기관 예시로 조문 제안부터 문서 받기까지 한 번에 둘러봐요.</p></div>
          <div className={homeStyles.exampleLinks}>{SAMPLES.map(s => <Link key={s.id} className="btn small" href={`/start?sample=${s.id}`}>{s.label}<span aria-hidden="true">↗</span></Link>)}</div>
        </section>

        <section className={homeStyles.outputPreview} aria-label="작업 흐름과 결과물 예시">
          <div>
            <span className={homeStyles.eyebrow}>작업은 네 단계로 끝나요</span>
            <h2>AI는 제안하고,<br />확정은 담당자가 해요.</h2>
            <ol className={homeStyles.flowSteps}>{FLOW.map(f => <li key={f.n}><span>{f.n}</span><div><b>{f.title}</b><p>{f.body}</p></div></li>)}</ol>
            <Link href="/start?sample=travel">이 예시로 시작하기 →</Link>
          </div>
          <figure className="hero-demo" aria-label="신·구조문대비표 예시">
            <figcaption className="cap"><span>한빛시 공무원 여비 지급 규칙(가상) 신·구조문대비표</span><span className="badge b-rule">규칙</span></figcaption>
            <table className="mini-cmp">
              <thead><tr><th>현 행</th><th>개 정 안</th></tr></thead>
              <tbody>
                <tr>
                  <td>제5조(숙박비) ① (생 략)<br /><span style={{ color: 'var(--ink-3)' }}>&lt;신 설&gt;</span><br />② (생 략)</td>
                  <td>제5조 ① (현행과 같음)<br /><span className="ul-new ink-in">② 제1항에도 불구하고 대규모 행사 등으로 …</span><br /><span className="ul">③</span> (현행 제2항과 같음)</td>
                </tr>
                <tr>
                  <td>제8조(숙박비의 정산) <span className="ul">제5조제2항</span>에 따라 초과 숙박비를 지급받은 …</td>
                  <td>제8조 ------- <span className="ul-new ink-in">제5조제3항</span> -------------------.</td>
                </tr>
              </tbody>
            </table>
            <p className="fixline"><span className="badge b-rule">규칙</span>항 하나를 넣었더니 함께 고칠 인용 3곳을 찾았어요 — 제8조, 제11조제1항, 별지 제2호서식</p>
          </figure>
        </section>

        <section className="recent">
          <div className={transferStyles.recentIntro}>
            <h3>이어서 할 작업</h3>
            <p>이 브라우저에 저장된 작업이에요. 다른 PC에서 이어가려면 ‘작업 보관’ 파일을 받아 두세요. <button type="button" className={homeStyles.inlineButton} onClick={() => setShowImport(v => !v)} aria-expanded={showImport}>{showImport ? '불러오기 닫기' : '보관 파일 불러오기'}</button></p>
          </div>
          {showImport && <ProjectImport onImported={() => { void listProjects().then((ps) => setRecent(ps.slice(0, 5))); }} />}
          {recent === null ? null : recent.length === 0 ? (
            <div className="panel empty">아직 작업이 없어요. 위의 예시로 가볍게 시작해 보세요.</div>
          ) : (
            <ul>
              {recent.map((p) => (
                <li key={p.id} className={transferStyles.recentRow}>
                  <span className="t">{p.enact?.title ?? p.title} <small className={homeStyles.recentKind}>{RULE_KIND_LABEL[p.kind]} · {workMethodLabel(p)}</small></span>
                  <span className="meta">{when(p.updatedAt)}</span>
                  <ProjectBackupButton project={p} />
                  <Link className="btn small" href={`/work/${p.id}`}>이어하기</Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
      <footer className="foot">
        <div className="wrap">
          <span>조목조목 — 2026 공공 AI 대전환 챌린지 세션2 과제③ 규정 제·개정 에이전트 · <Link href="/about">다른 도구와 차이</Link> · <Link href="/knowledge">원본 자료 5종</Link></span>
          <span>AI가 쓴 문장은 초안이에요. 제출 전 담당자가 확인해 주세요.</span>
        </div>
      </footer>
    </>
  );
}
