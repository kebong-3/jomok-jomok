import Link from 'next/link';
import Header from '@/components/Header';
import { LINT_CATALOG } from '@/engine';

export const metadata = { title: '조목조목은 어떻게 일하나요' };

const ROWS: [string, string, string, string][] = [
  ['개정문·대비표', '사람이 한글에서 직접 작성', '대화 결과를 각각 옮겨 정리', '수락한 변경명세 하나에서 두 문서를 함께 생성'],
  ['항이 끼어들 때 뒤 번호·인용', '직접 찾아 고침', '빠뜨리기 쉬움', '번호를 밀고 인용하는 곳을 찾아 함께 고침(체크 해제 가능)'],
  ['상위 법령 근거', '국가법령정보센터 별도 검색', '그럴듯하지만 없는 조문을 지어낼 수 있음', '법제처 원문을 붙이고, 목록에 없는 근거는 빨간 칩으로 표시'],
  ['형식 점검', '법무 담당 검토', '—', `${LINT_CATALOG.length}가지 규칙을 AI 없이 점검, 이번 개정에서 생긴 문제와 원래 문제를 나눔`],
  ['결재 문서', '하나씩 작성', '복사해서 다시 편집', '개정안·대비표·이유서·입법예고문·점검표를 HWPX·DOCX 한 벌로'],
  ['AI가 꺼졌을 때', '—', '쓸 수 없음', '직접 고치면 나머지는 그대로 동작'],
];

export default function About() {
  return (
    <>
      <Header />
      <div className="settings" style={{ maxWidth: 1000 }}>
        <h1>조목조목은 어떻게 일하나요</h1>
        <p style={{ fontSize: '1.8rem', color: 'var(--ink-2)', maxWidth: '36em' }}>
          AI는 &ldquo;어디를 어떻게 바꿀지&rdquo;만 제안합니다. 대비표, 개정문, 바뀐 번호를 따라가는 인용 정정, 부칙, 형식 점검은 정해진 규칙대로 계산합니다.
          같은 변경명세에서 문서를 함께 만들어 문서 간 불일치를 줄입니다. 복잡한 조문이나 별표는 원문과 생성 결과를 대조해 확인해야 합니다.
        </p>

        <section className="step">
          <div className="step-h"><h2>무엇이 다른가요</h2></div>
          <div style={{ overflowX: 'auto' }}>
            <table className="plain">
              <thead><tr><th style={{ width: '16%' }}></th><th>지금 방식</th><th>일반 AI 대화</th><th>조목조목</th></tr></thead>
              <tbody>{ROWS.map((r) => <tr key={r[0]}><th style={{ background: 'none', color: 'var(--ink)' }}>{r[0]}</th><td>{r[1]}</td><td>{r[2]}</td><td><b style={{ fontWeight: 600 }}>{r[3]}</b></td></tr>)}</tbody>
            </table>
          </div>
          <p className="help">법제처 법령안편집기는 법령 입안 전 과정을 지원하는 공식 도구로, 인용 조문 검색·검사도 합니다. 조목조목은 자치법규·행정규칙·기관 내규를 고치는 담당자가 &ldquo;의도 한 줄&rdquo;에서 결재 문서 한 벌까지 가는 짧은 길을 맡습니다.</p>
        </section>

        <section className="step">
          <div className="step-h"><h2>네 일꾼이 나눠서 합니다</h2></div>
          <dl className="kv" style={{ gridTemplateColumns: '150px 1fr' }}>
            <dt><span className="badge b-law">법제처</span></dt><dd>국가법령정보 공동활용 API로 상위 법령 원문을 찾고 조문을 붙입니다. 연결이 안 되면 기준일이 적힌 저장본을 씁니다.</dd>
            <dt><span className="badge b-ai">AI</span></dt><dd>개정 의도를 읽고 바꿀 곳을 제안하고, 개정이유를 씁니다. 기본은 GPT-OSS 120B, 비교·예비는 Gemma 4. 기관 서버의 EXAONE·HyperCLOVA X도 연결할 수 있습니다.</dd>
            <dt><span className="badge b-rule">규칙 엔진</span></dt><dd>변경을 적용하고 번호를 다시 매기고 인용을 고칩니다. 대비표·개정문·부칙을 만들고 형식을 점검합니다. AI를 쓰지 않습니다.</dd>
            <dt><span className="badge b-human">사람</span></dt><dd>제안을 수락하거나 고치고, 번호 방식과 시행일을 정합니다. 문서에 들어가는 것은 사람이 수락한 변경뿐입니다.</dd>
          </dl>
        </section>

        <section className="step">
          <div className="step-h"><h2>믿고 쓸 수 있게</h2></div>
          <ul style={{ margin: 0, paddingLeft: 20, lineHeight: 1.9 }}>
            <li>AI가 쓴 문장에는 보라색 <span className="badge b-ai">AI</span> 표시가 붙고, 수락하면 <span className="badge b-ai-ok">AI✓</span>로 바뀝니다. 입안 점검표에 그대로 남습니다.</li>
            <li>근거 칩을 누르면 법제처 원문이 열립니다. 저장본이면 <span className="badge b-snap">◐ 저장본</span>과 기준일을 보여 줍니다.</li>
            <li>AI가 늦거나 끊기면 예시 규정에서는 미리 만든 응답으로 이어 가고, 그 사실을 화면 위에 알립니다.</li>
            <li>작업은 이 브라우저에 저장됩니다. AI를 실행하면 필요한 조문과 개정 의도가 조목조목 서버를 거쳐 선택한 AI 제공사에 전달됩니다. 서버에 작업 내용을 저장하는 기능은 없습니다.</li>
          </ul>
        </section>

        <section className="step">
          <div className="step-h"><h2>아직 못 하는 것</h2></div>
          <ul style={{ margin: 0, paddingLeft: 20, lineHeight: 1.9 }}>
            <li>별표·서식 안의 표 내용은 통째로 바꾸기만 하고, 칸 단위 대비는 하지 않습니다.</li>
            <li>HWPX 파일은 시험 단계입니다. 열리지 않으면 DOCX나 &ldquo;한글에 붙여넣기용 복사&rdquo;를 쓰세요.</li>
            <li>내용이 정책적으로 맞는지는 판단하지 않습니다. 그 판단은 담당자와 법무 담당의 몫입니다.</li>
          </ul>
        </section>

        <p><Link className="btn primary" href="/">예시로 해 보기</Link></p>
      </div>
    </>
  );
}
