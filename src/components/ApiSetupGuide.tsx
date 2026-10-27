import Link from 'next/link';
import referenceManifest from '@/data/knowledge/manifest.json';

const registryExample = JSON.stringify([{
  id: 'org-ai', label: '기관 AI', family: 'other', adapter: 'openai',
  baseURL: 'https://ai.example.go.kr/v1', model: '기관에_배포한_모델_ID',
  keyEnv: 'ORG_AI_API_KEY', note: '운영자가 등록한 기관 모델', official: false,
}], null, 2);
const codeStyle = { margin: '12px 0', padding: 16, background: 'var(--desk)', borderRadius: 8, fontSize: '1.3rem', lineHeight: 1.7, whiteSpace: 'pre-wrap' as const, overflowWrap: 'anywhere' as const };

/** Operator-facing instructions match the registry and API contracts. No key
 * values or live environment variables are read into this component. */
export default function ApiSetupGuide() {
  return (
    <section id="api-setup" className="step" aria-labelledby="api-setup-heading">
      <div className="step-h"><h2 id="api-setup-heading">API 연결·배포 안내</h2></div>
      <p>AI 초안·답변은 아래 AI 제공자 중 <b>하나 이상</b>을 연결하면 사용할 수 있습니다. 현재 법령·유사 규정 조회에는 법제처 인증이 별도로 필요합니다.</p>
      <p className="help"><Link href="/knowledge">입안 자료실</Link>의 원본 {referenceManifest.documents.length}개, PDF {referenceManifest.totalPdfPages.toLocaleString('ko-KR')}쪽과 검색 단위 {referenceManifest.chunkCount.toLocaleString('ko-KR')}개는 앱에 포함되어 있습니다. 자료 검색·원본 다운로드에는 추가 AI 키나 벡터 DB가 필요하지 않습니다. 검색한 자료로 AI 답변을 작성할 때는 위에서 선택한 AI 연결을 사용합니다.</p>

      <div style={{ overflowX: 'auto', marginTop: 16 }} tabIndex={0} role="region" aria-label="API 제공자별 환경변수 안내">
        <table className="plain">
          <thead><tr><th scope="col">연결</th><th scope="col">서버 환경변수</th><th scope="col">설정할 값</th></tr></thead>
          <tbody>
            <tr><th scope="row">Google · Gemma</th><td><code>GOOGLE_API_KEY</code><br /><code>GEMMA_MODEL</code></td><td><a href="https://aistudio.google.com/api-keys" target="_blank" rel="noopener noreferrer">Google AI Studio에서 발급한 키</a><br />모델 기본값: <code>gemma-4-31b-it</code></td></tr>
            <tr><th scope="row">Groq · GPT-OSS</th><td><code>GROQ_API_KEY</code><br /><code>GROQ_GPTOSS_MODEL</code></td><td><a href="https://console.groq.com/keys" target="_blank" rel="noopener noreferrer">Groq에서 발급한 키</a><br />모델 기본값: <code>openai/gpt-oss-120b</code></td></tr>
            <tr><th scope="row">OpenAI · 선택 연결</th><td><code>OPENAI_API_KEY</code><br /><code>OPENAI_MODEL</code></td><td>OpenAI API 계정에서 발급한 키<br />모델 기본값: <code>gpt-5.4-mini</code></td></tr>
            <tr><th scope="row">법제처 · 현재 법령 조회</th><td><code>LAW_OC</code><br /><code>LAW_REFERER</code> (해당 시)</td><td><a href="https://open.law.go.kr" target="_blank" rel="noopener noreferrer">국가법령정보 공동활용</a>에서 신청·승인받은 API 인증값을 그대로 입력합니다. 이메일 주소를 임의로 잘라 만들지 않습니다. 등록 도메인 정보가 필요한 경우 승인 정보에 맞춰 <code>LAW_REFERER</code>를 설정합니다.</td></tr>
          </tbody>
        </table>
      </div>
      <p className="help">표의 모델 이름은 이 앱의 기본 설정입니다. 해당 계정의 모델 접근 권한·요금·호출 한도는 제공자에서 확인하고 실제 응답 시험으로 검증하세요. Google 키는 <code>GEMINI_API_KEY</code>·<code>GOOGLE_GENERATIVE_AI_API_KEY</code>도 인식합니다. 기존 모델 변수 <code>GOOGLE_MODEL</code>·<code>GROQ_MODEL</code>도 호환되며 새 이름이 우선합니다.</p>

      <h3 style={{ marginTop: 24 }}>Vercel에 반영하는 순서</h3>
      <ol style={{ paddingLeft: 24, lineHeight: 1.85 }}>
        <li>Vercel에서 <b>jomokjomok-law</b> 프로젝트를 엽니다. 이 운영 주소 <code>jomokjomok.vercel.app</code>가 연결된 프로젝트인지 도메인 설정에서 확인합니다.</li>
        <li><b>Settings → Environment Variables</b>에서 사용할 키를 추가하고 <b>Production</b> 환경에 적용합니다. 같은 GitHub 저장소의 다른 Vercel 프로젝트에는 값이 공유되지 않습니다.</li>
        <li>모델명을 바꿀 때만 해당 모델 변수를 지정합니다. 자동 선택의 우선 모델은 <code>DEFAULT_MODEL_ID=gemma4-31b@google</code>처럼 앱의 모델 ID로 설정합니다. 화면에서 지정한 모델이 이 값보다 우선합니다.</li>
        <li>새 Production 배포를 실행합니다. 환경변수 저장만으로 기존 배포가 갱신되지는 않습니다.</li>
        <li>이 화면에서 <b>법제처·자료실·배포 확인하기</b>와 모델별 <b>실제 응답 시험</b>을 실행합니다. 짧은 시험 후 실제 제정 또는 개정 작업을 문서 출력까지 확인합니다.</li>
      </ol>
      <p className="help"><code>DEFAULT_MODEL_ID</code>의 예: <code>gemma4-31b@google</code>, <code>gptoss-120b@groq</code>, <code>gpt54-mini@openai</code>. 이는 우선순위 설정이며, 실제 사용 모델과 대체 시도는 작업 기록에서 확인합니다. 비밀 키는 서버 환경변수에 넣고 <code>NEXT_PUBLIC_</code> 접두사를 붙이지 않습니다.</p>

      <details style={{ marginTop: 20 }}>
        <summary style={{ cursor: 'pointer', fontWeight: 700 }}>기관 AI 서버·추가 모델 연결</summary>
        <p>기관의 OpenAI 호환 서버를 등록하려면 운영자가 다음 환경변수를 설정하고 재배포합니다. 주소는 API 기본 주소이며 실제 배포한 모델의 식별자를 사용합니다.</p>
        <pre style={codeStyle}><code>{'CUSTOM_LLM_BASEURL=https://ai.example.go.kr/v1\nCUSTOM_LLM_MODEL=기관에_배포한_모델_ID\nCUSTOM_LLM_KEY=기관에서_발급한_키\nDEFAULT_MODEL_ID=custom'}</code></pre>
        <p className="help">위 주소와 모델명은 예시입니다. 등록된 서버 키를 쓰려면 기본 연결에서 기관 모델을 선택합니다. 화면의 ‘기관 서버’ 연결을 사용할 때는 주소·모델·키를 입력해야 하며, 키는 브라우저 세션에 보관됩니다. 추가로 허용할 기관 주소는 <code>CUSTOM_LLM_ALLOWED_BASEURLS</code>에 쉼표로 구분해 등록합니다.</p>
        <p>공개 Vercel 앱에서는 기관 서버를 선택해도 요청이 앱 서버를 거칩니다. 내부망 안에서만 처리하려면 이 앱도 기관의 내부 환경에 배포해야 합니다.</p>
        <h4>여러 모델을 목록에 추가하려면</h4>
        <p><code>MODELS_JSON</code>에는 모델 객체의 JSON 배열을 넣습니다. 새 <code>id</code>는 추가되고, 같은 <code>id</code>는 기존 항목 전체를 대체합니다. 일부 필드만 덧붙이는 방식이 아니므로 주소·모델·어댑터·키 변수 이름 등을 함께 적습니다.</p>
        <pre style={codeStyle}><code>{registryExample}</code></pre>
        <p className="help">이 예시는 <code>ORG_AI_API_KEY</code>라는 별도 환경변수에 키를 넣고 <code>DEFAULT_MODEL_ID=org-ai</code>로 우선 사용할 수 있습니다. JSON에 실제 키를 쓰지 않습니다. 필수 식별 필드는 <code>id</code>·<code>label</code>·<code>family</code>·<code>adapter</code>·<code>baseURL</code>·<code>model</code>이며, 위 예시처럼 설명과 키 변수도 함께 지정하세요. 잘못된 JSON이나 필수 필드가 빠진 항목은 목록에 반영되지 않습니다.</p>
      </details>

      <details style={{ marginTop: 20 }}>
        <summary style={{ cursor: 'pointer', fontWeight: 700 }}>설정했는데 AI가 실행되지 않을 때</summary>
        <ul style={{ paddingLeft: 24, lineHeight: 1.85 }}>
          <li><b>설정 감지 안 됨:</b> 운영 도메인의 프로젝트, Production 적용, 변수 이름, 재배포 여부를 확인합니다.</li>
          <li><b>인증·권한 오류:</b> 해당 제공자에서 키와 모델 접근 권한을 확인합니다. 법제처는 승인된 인증값·도메인·접속 환경을 확인합니다.</li>
          <li><b>한도·잔액 오류:</b> 제공자의 요청·토큰 한도 또는 잔액을 확인합니다. 모델에 따라 계정별 조건이 다릅니다.</li>
          <li><b>모델 없음:</b> 제공자가 해당 계정에 허용하는 모델 ID와 환경변수 값을 맞춥니다.</li>
          <li><b>시간 초과·입력 과다:</b> 검토할 조문 범위를 줄여 다시 실행하고, 필요하면 사용할 다른 모델을 명시적으로 선택합니다.</li>
        </ul>
        <p>‘설정 감지’는 키·주소·모델 설정을 읽었다는 뜻입니다. ‘실제 응답 성공’은 짧은 확인 요청이 성공했다는 뜻이고, 긴 규정의 제·개정 작업 성공 여부는 별도로 확인해야 합니다. 자료실 검색 성공도 AI 또는 법제처 연결 성공과 구분됩니다.</p>
        <p className="help"><code>TRIAL_DAILY_LIMIT</code>는 기본 연결에 적용되는 서버 인스턴스별 하루 호출 근사 한도입니다. 전체 배포의 정확한 사용량 집계나 제공자의 과금 한도를 대신하지 않습니다.</p>
      </details>
    </section>
  );
}
