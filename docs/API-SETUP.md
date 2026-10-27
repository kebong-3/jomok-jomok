# 조목조목 v0.6 — API 연결과 운영 설정

대상: 운영자·다른 기관으로 앱을 옮기는 담당자. 구현 기준 2026-10-26. 실제 운영 계정의 연결 성공·배포 확인 범위는 [v0.6 검증 기록](VALIDATION-v0.6.md)을 기준으로 합니다. 이 문서는 키를 발급받아 어디에 설정하고 무엇을 시험해야 하는지 설명합니다.

**가장 먼저 구분할 것은 두 연결입니다.** AI 키는 설명과 초안을 만드는 데 사용하고, 법제처 `LAW_OC`는 실제 법령·자치법규 원문을 조회하는 데 사용합니다. 수록 자료 6종의 로컬 검색과 원본 다운로드는 두 키 모두 없어도 사용할 수 있습니다. 벡터 DB나 임베딩 API 키는 필요하지 않습니다.

## 1. 필요한 연결 선택

| 원하는 기능 | 필요한 설정 | 선택 여부 |
|---|---|---|
| 수록 입안 자료 검색·원본 내려받기 | 배포된 원본과 검색 색인 | 추가 외부 API 없음 |
| 자료 근거 설명·제정·개정 초안 | 사용 가능한 AI 연결 한 개 이상 | 실제 AI 사용 시 필요 |
| 공식 법령·행정규칙·자치법규 조회 | `LAW_OC` | 해당 조회 기능에 필요 |
| 다른 기관 규정 검색·두 원문 비교 | `LAW_OC` | AI 키와 별개 |
| 기본 우선 AI | `GOOGLE_API_KEY` | 이 앱의 기본 후보 |
| 비교 또는 예비 AI | `GROQ_API_KEY` | 선택 |
| OpenAI 연결 | `OPENAI_API_KEY` | 선택 |
| 기관에서 운영하는 모델 | `CUSTOM_LLM_*` | 선택, OpenAI 호환 서버 |

현재 앱의 모델 목록은 [모델 레지스트리](../src/config/models.ts), 실제 호출 방식은 [서버 어댑터](../src/server/llm.ts), 전체 환경변수 양식은 [.env.example](../.env.example)을 기준으로 합니다. 목록에 이름이 있다는 사실과 현재 계정에서 실제 요청이 성공한다는 사실은 다릅니다.

## 2. Vercel에 올바르게 적용하기

현재 `jomokjomok.vercel.app` 도메인에 연결된 프로젝트는 **`kevin-jeong/jomokjomok-law`**입니다. 저장소 이름과 Vercel 프로젝트 이름이 같다고 가정해 다른 프로젝트에 키를 넣으면 앱에는 적용되지 않습니다.

1. Vercel에서 해당 팀·프로젝트를 열고 Domains에 운영 도메인이 연결되어 있는지 확인합니다.
2. 프로젝트의 Environment Variables 설정에서 필요한 변수 이름과 값을 입력합니다. 운영 사이트에는 **Production** 환경을 선택합니다. Preview만 선택한 키는 운영 배포에 적용되지 않습니다.
3. 값을 저장한 뒤 운영 배포를 **Redeploy**하거나 새 Production 배포를 만듭니다. 기존 배포의 값을 바꿨다고 생각하고 브라우저만 새로고침하지 마세요.
4. 운영 도메인의 **설정·진단**에서 키 설정 상태를 확인하고, 사용할 모델을 지정해 **실제 응답 시험**을 실행합니다.
5. 법제처 연결도 별도로 진단하고 실제 검색 결과의 제목·시행일·원문을 확인합니다.
6. 자료 근거 AI 검토, 실제 제·개정 문서 작성, 다운로드와 보관파일 복원까지 이어서 확인합니다. 짧은 모델 시험 하나가 전체 앱 검증을 대신하지 않습니다.

환경변수는 새 배포에 적용된다는 점은 [Vercel 공식 안내](https://vercel.com/docs/environment-variables/managing-environment-variables)를 따릅니다. 재배포 관리 절차는 [Deployments 안내](https://vercel.com/docs/deployments/managing-deployments)를 참조하세요. Preview와 Production은 각각의 연결·키·배포 버전으로 확인해야 합니다.

**비밀키는 채팅, Git 저장소, 공개 `NEXT_PUBLIC_*` 변수에 넣지 않습니다.** 사용자는 이 문서의 빈 환경변수 이름을 참고하고 실제 값은 Vercel의 비밀 환경변수 또는 기관의 비밀 저장소에 입력하면 됩니다. 진단 공유에는 오류 코드·모델명·시각·배포 ID만 사용하고 키 원문을 붙이지 마세요.

## 3. Google AI Studio — 기본 우선 연결

[Google AI Studio API 키 화면](https://aistudio.google.com/api-keys)에서 사용할 프로젝트와 키를 확인합니다. 현재 공식 키 안내는 키 유형·프로젝트 연결·허용 권한을 구분하고 있으므로 오래전에 만든 키가 유효하다고 단정하지 말고 [공식 API 키 안내](https://ai.google.dev/gemini-api/docs/api-key)의 현재 조건을 확인하세요.

```dotenv
GOOGLE_API_KEY=
GEMMA_MODEL=gemma-4-31b-it
DEFAULT_MODEL_ID=gemma4-31b@google
GOOGLE_THINKING_LEVEL=minimal
```

`GOOGLE_API_KEY` 대신 기존 `GEMINI_API_KEY` 또는 `GOOGLE_GENERATIVE_AI_API_KEY`도 읽습니다. 여러 이름에 값이 있으면 `GOOGLE_API_KEY`가 먼저 선택됩니다. 모델 이름은 새 `GEMMA_MODEL`이 우선이며 기존 `GOOGLE_MODEL`은 호환 별칭입니다. 서로 다른 값을 여러 변수에 중복 보관하는 것보다 사용할 값과 우선순위를 명확히 하는 편이 좋습니다.

앱의 Google 연결 ID는 `gemma4-31b@google`, 요청 기본 모델명은 `gemma-4-31b-it`입니다. 어댑터는 Google의 `generateContent` 형식을 사용합니다. 기본 추론 설정은 `minimal`이며 `GOOGLE_THINKING_LEVEL=high`는 더 긴 응답 시간으로 공개 서버 요청 제한에 걸릴 수 있습니다. 이 이름과 동작은 앱 구현 기준이며 모델의 영구 지원을 보장하지 않습니다.

제정·개정·이유서 등 `/api/llm` 생성 요청은 Vercel 실행 한도 300초, 서버의 제공자 호출·복구 합계 270초, 브라우저 연결 한도 310초로 맞췄습니다. 기존 Gemma 50초·전체 54초 중단은 이 경로에서 제거했습니다. NDJSON 연결 확인 신호를 10초마다 보내며, 이 신호는 제공자가 문장을 작성했다는 뜻이 아닙니다. 구형 JSON 클라이언트도 같은 API를 사용할 수 있습니다. `minimal`에는 불필요한 추론 출력 예산을 더하지 않습니다.

일시적인 HTTP 429는 제공자의 `Retry-After` 또는 Google `RetryInfo.retryDelay`를 읽어 같은 모델로 최대 두 번 다시 요청합니다. 대기 힌트가 없으면 20초 후 한 번만 다시 요청합니다. 일일 한도·명시적 잔액 부족은 바로 안내하며, 대기 시간이 남은 요청 예산을 넘으면 부분 결과를 보존합니다. 대기 중에도 작성 중단을 사용할 수 있습니다. 자동 연결에서는 다른 제공자 후보를 사용할 수 있지만 명시적으로 고른 모델은 조용히 바꾸지 않습니다. 같은 제공자·키의 다른 모델을 골라 대기 지시를 우회하지 않습니다.

제정 초안은 확정된 전체 체계와 앞서 작성한 본문을 함께 참고하면서 **최대 3개 조씩 순차 작성**합니다. 완성한 묶음을 브라우저 작업에 보관하고 중단·오류 뒤에는 빈 조문만 이어 씁니다. 작성한 본문과 직접 수정한 본문은 덮어쓰지 않으며, 조 번호·제목·개수가 요청과 다르거나 본문이 비면 해당 묶음을 적용하지 않습니다. 전체 작업의 54초 제한은 없지만 각 요청에는 호스팅·제공자의 실행 한도가 있습니다. 브라우저를 닫으면 진행 요청은 종료되고, 다시 열어 저장된 조문부터 이어서 작성할 수 있습니다.

`vercel.json`의 `fluid: true`를 통해 Fluid compute를 명시합니다. [Vercel 실행 시간 안내](https://vercel.com/docs/functions/configuring-functions/duration) 기준으로 Fluid의 Hobby 최대는 300초이고, Pro·Enterprise는 800초이며 일부 런타임에서 1,800초 확장이 베타로 제공됩니다. AI 제공자의 유료 API와 Vercel 호스팅 요금제는 별도입니다. 이 앱은 다른 기관으로 옮기기 쉬운 300초 설정을 쓰며 요금제를 자동 변경하지 않습니다. [Fluid 설정 안내](https://vercel.com/docs/fluid-compute)

입안 자료실과 작업 내 조목이 검토의 `/api/knowledge/assist`도 Vercel 300초·서버 270초·브라우저 대기 310초로 맞췄습니다. 기존 자료실 54초 제한을 제거했습니다. 중단 버튼으로 요청을 취소할 수 있습니다. 자료실은 최대 6개·발췌 합계 5,500자의 참고 문맥과 간결한 답변을 사용합니다. 실행 한도 상향만으로 제공자의 지연이 해결됐다고 판단하지 말고 실제 9개 조문 생성과 자료 근거 질문을 각각 확인하세요. [호출 구현](../src/server/llm.ts) · [자료실 API](../src/app/api/knowledge/assist/route.ts)

설정·진단에서 해당 모델을 지정해 시험하고 실제 반환 모델명을 확인하세요. 401/403은 키 인증·모델 권한, 429/402는 한도·잔액, 404 또는 모델 이용 불가는 모델명·계정 제공 범위를 확인해야 합니다. 단순히 키가 입력돼 있다는 표시로 성공을 판정하지 않습니다.

## 4. 법제처 국가법령정보 공동활용 — 실제 원문

[국가법령정보 공동활용](https://open.law.go.kr/)에서 필요한 서비스를 신청하고 승인된 **API 인증값(OC)**을 확인합니다. 공식 안내는 신청·승인 절차를 두고 있으며, API 가이드의 `OC`는 신청한 인증값을 필수로 요구합니다. 이메일 앞부분이나 아이디를 추측해 넣는 것으로 안내하지 않습니다. [이용 안내](https://open.law.go.kr/LSO/information/guide.do) · [공식 요청 변수](https://open.law.go.kr/LSO/openApi/guideResult.do?htmlName=lsNwListGuide)

```dotenv
LAW_OC=
LAW_REFERER=https://jomokjomok.vercel.app
```

`LAW_REFERER`에는 신청·등록된 접속 정보를 사용합니다. 이 값을 적는 행위만으로 접속 승인이 새로 생기지는 않습니다. 공식 서비스의 신청 내용, 허용 도메인·접속 환경과 실제 배포 경로가 맞아야 합니다.

앱은 `/api/law/search`, `/api/law/text`에서 국가 법령, 행정규칙, 자치법규를 구분합니다. 서버는 요청 목적에 맞는 공식 대상(`eflaw`, `admrul`, `ordin` 등)으로 조회하고 실제 원문 제목·식별자·시행일을 확인합니다. 원문을 가져와도 본문 중심의 부분 조회일 수 있으므로 부칙·별표·별지의 포함 여부를 확인해야 합니다. [법령 서버](../src/server/law.ts)

기본 연결 진단은 국가 법령 경로를 시험합니다. 자치법규와 행정규칙도 사용할 기관은 자료실의 검색 대상을 각각 선택해 실제 목록 조회와 본문 추가를 확인하세요. 대상별 JSON 구조가 다르며, 이번 버전은 공식 `OrdinSearch.law`, `LawService`, `AdmRulSearch`, `AdmRulService` 구조를 처리합니다. 조문식이 아닌 행정규칙은 조 번호를 만들어 비교하지 않고 공식 원문을 직접 검토하도록 안내합니다. [자치법규 목록 가이드](https://open.law.go.kr/LSO/openApi/guideResult.do?htmlName=ordinListGuide) · [자치법규 본문 가이드](https://open.law.go.kr/LSO/openApi/guideResult.do?htmlName=ordinInfoGuide) · [행정규칙 본문 가이드](https://open.law.go.kr/LSO/openApi/guideResult.do?htmlName=admrulInfoGuide)

기관에서 승인된 중계 환경을 별도로 운영하는 경우에는 다음을 추가할 수 있습니다.

```dotenv
LAW_RELAY_URL=
LAW_RELAY_SECRET=
```

중계는 등록·승인된 운영 경로를 연결하는 선택 기능입니다. 인증 실패, 자동 접속 차단, 데이터 대신 안내 페이지를 받은 경우를 우회해 성공으로 만드는 장치가 아닙니다. 실제 코드도 `LAW_AUTH`, `LAW_ANTIBOT`, `LAW_FORMAT`을 단순 우회하지 않습니다. 중계 서버 구성은 [relay 코드](../relay/render-law-relay.js)를 참고하세요.

법령 연결 실패 시 일부 화면에서 저장본을 사용할 수 있지만 저장 시점과 실패 원인이 표시됩니다. 저장본은 현행 원문 보증이 아니며 유사 규정 비교는 이를 현재 공식 원문처럼 받아들이지 않습니다. 진단은 실제 조회 경로와 결과를 확인해야 하고, API가 HTTP 200을 줬다는 사실만으로 인증·데이터 형식이 정상이라고 판단하지 않습니다.

## 5. Groq — 선택 비교·예비 연결

[Groq API 키 화면](https://console.groq.com/keys)에서 발급받은 키를 사용합니다. 공식 연결 방식은 [Groq Quickstart](https://console.groq.com/docs/quickstart)를 참고하세요.

```dotenv
GROQ_API_KEY=
GROQ_GPTOSS_MODEL=openai/gpt-oss-120b
```

앱 ID는 `gptoss-120b@groq`이며 새 `GROQ_GPTOSS_MODEL`이 기존 `GROQ_MODEL`보다 우선합니다. 기본 주소는 `https://api.groq.com/openai/v1`입니다. 모델별 한도·제공 여부는 실제 계정 기준으로 시험해야 합니다. 과거 버전의 인증 오류나 성공 기록을 현재 키의 상태로 재사용하지 않습니다.

기본 연결의 후보 중 선택해 사용할 수 있고, 다른 모델 의견 비교에 사용할 수도 있습니다. 선택 모델을 엄격하게 시험하는 동작에서는 그 모델이 실패했을 때 다른 모델로 조용히 바꿔 성공한 것처럼 보여 주지 않습니다.

## 6. OpenAI — GPT-5.4 mini 선택 연결

[OpenAI API 키 화면](https://platform.openai.com/api-keys)에서 프로젝트의 API 키를 준비합니다. ChatGPT 구독과 API 플랫폼은 결제 체계가 별개입니다. 사용 권한과 결제·한도는 [공식 결제 안내](https://help.openai.com/en/articles/9039756-managing-billing-for-chatgpt-and-the-api-platform)를 확인하세요.

```dotenv
OPENAI_API_KEY=
OPENAI_MODEL=gpt-5.4-mini
# OpenAI를 자동 연결의 첫 후보로 쓰려면 선택 설정
DEFAULT_MODEL_ID=gpt54-mini@openai
```

앱 ID는 **`gpt54-mini@openai`**, 표시 이름은 **GPT-5.4 mini · OpenAI**입니다. 기본 URL은 `https://api.openai.com/v1`이며 현재 구현은 `/chat/completions`를 호출합니다. [공식 모델 페이지](https://developers.openai.com/api/docs/models/gpt-5.4-mini)는 이 모델의 Chat Completions 지원과 기본 추론 수준을 안내합니다. 모델명을 바꿀 때에는 해당 엔드포인트와 매개변수 지원을 다시 확인하세요.

네이티브 OpenAI 어댑터는 `max_completion_tokens`를 사용하며, GPT-5·GPT-6 및 해당 추론 모델 계열에는 호환되지 않을 수 있는 `temperature`를 보내지 않습니다. 응답이 길이 제한으로 잘리거나 완성된 JSON으로 확인되지 않으면 불완전한 제안을 적용하지 않습니다. Responses 전용 모델·전용 서버는 이름만 바꾼 것으로 이 어댑터와 호환된다고 가정하지 마세요. [실제 어댑터](../src/server/llm.ts)

OpenAI 키만 설정되어 있어도 자동 후보 목록에 포함될 수 있습니다. 여러 제공자 키가 있는 경우 `DEFAULT_MODEL_ID`는 자동 연결에서 먼저 시도할 모델을 정합니다. 그 모델만 사용하려면 앱에서 모델을 명시적으로 선택해 엄격한 연결로 실행하세요. 자동 연결은 설정된 후보 중 최대 세 개를 시도하며 실제 사용 모델과 앞서 실패한 모델 목록이 응답 기록에 남습니다. `strictModel` 요청은 다른 모델로 전환하지 않습니다.

GPT-5.4 mini를 이 버전의 기본 OpenAI 연결값으로 설정한 것이 모든 계정의 접근·미래 지원·요금·최신성까지 보장하는 것은 아닙니다. 모델 교체 후에는 모델 지정 실제 응답 시험, 자료 근거 검토, 초안 작성과 문서 다운로드를 다시 확인하세요.

## 7. 기관 모델과 다른 제공자로 옮기기

### OpenAI 호환 기관 서버

EXAONE 등 기관에서 운영하는 모델을 연결할 때는 실제 서버가 이 앱의 Chat Completions 요청·응답 형식과 맞는지 확인합니다. 모델 이름만 같은 것으로 API 호환성이 정해지지는 않습니다.

```dotenv
CUSTOM_LLM_BASEURL=https://ai.example.go.kr/v1
CUSTOM_LLM_MODEL=institution-model
CUSTOM_LLM_KEY=
CUSTOM_LLM_ALLOWED_BASEURLS=https://ai-secondary.example.go.kr/v1
DEFAULT_MODEL_ID=custom
```

예시 주소와 모델명은 실제 기관 값으로 바꿔야 합니다. 서버 설정에는 주소·모델·키가 모두 있어야 기본 연결 후보가 됩니다. 운영자가 승인한 무인증 서버에 한해 `CUSTOM_LLM_KEY=none`으로 인증 헤더를 생략할 수 있습니다. 브라우저의 기관 연결에서 키를 비워 두는 경우도 서버는 `none`으로 처리합니다. 운영자가 등록하지 않은 임의 주소를 브라우저에서 입력해 앱 서버가 대신 호출하도록 허용하지 않습니다.

`CUSTOM_LLM_ALLOWED_BASEURLS`는 추가 허용 주소를 쉼표로 구분합니다. 기본 주소는 `CUSTOM_LLM_BASEURL`로 등록합니다. 주소는 `/chat/completions` 앞의 base URL이어야 합니다. 일반 OpenAI 호환 서버에는 `messages`, `model`, `max_tokens` 등 실제 요청 필드가 맞아야 하며, 네이티브 OpenAI·Groq에 적용한 제공자별 보정이 모든 기관 서버에도 동일하게 적용되는 것은 아닙니다.

**기관 내 처리 경로가 필요하면 앱 서버도 기관 환경에 배치해야 합니다.** 공개 Vercel 앱에 기관 모델 URL만 입력해도 요청은 앱 서버를 거칩니다. 내부망 서버의 네트워크 접근, 인증, 기관의 자료 처리 정책은 설치 환경에서 확인하세요.

### `MODELS_JSON`으로 등록·교체

모델 목록은 기존 목록과 JSON 배열을 병합합니다. 같은 `id`는 덮어쓰고 새 `id`는 추가합니다. 전체 기본 모델 목록을 제거하는 설정은 아닙니다. 비밀키 값 자체를 JSON에 넣지 않고 `keyEnv`로 별도 환경변수 이름을 지정합니다.

```json
[
  {
    "id": "institution-review",
    "label": "우리 기관 검토 모델",
    "family": "other",
    "adapter": "openai",
    "baseURL": "https://ai.example.go.kr/v1",
    "model": "institution-model",
    "keyEnv": "INSTITUTION_AI_KEY",
    "note": "기관에서 운영하는 Chat Completions 호환 연결",
    "official": false
  }
]
```

이 JSON을 `MODELS_JSON` 값으로 저장하고 별도로 `INSTITUTION_AI_KEY`를 등록합니다. 자동 우선 연결로 쓰려면 `DEFAULT_MODEL_ID=institution-review`를 지정합니다. 등록되지 않은 `DEFAULT_MODEL_ID`는 설정 오류로 처리하므로 오타를 확인하세요. 사용자 작업에서 명시한 모델은 운영자의 자동 우선 모델보다 우선합니다.

지원 `family` 값은 `gpt-oss`, `gemma`, `solar`, `hyperclovax`, `exaone`, `llama`, `other`이고, 어댑터는 `openai` 또는 `gemini`입니다. 제공자가 추가·변경한 요청 필드는 필요하면 서버 어댑터에서 다뤄야 합니다. 기존 목록의 Cerebras·OpenRouter·Upstage·CLOVA 연결도 해당 키와 현재 모델 지원을 별도로 시험해야 하며, 목록만으로 이 배포에서 연결 완료됐다고 표현하지 않습니다.

## 8. 오류를 읽는 순서

| 표시 코드·상황 | 우선 확인할 것 | 다음 조치 |
|---|---|---|
| `NO_KEY` | 현재 배포의 키, Production 적용, 선택 연결의 키 | 키를 안전하게 설정하고 재배포·실제 시험 |
| `LLM_AUTH`, 401/403 | 폐기·오입력 키, 모델·프로젝트 권한 | 제공자 콘솔에서 해당 권한 확인 |
| `LLM_MODEL`, 404 | 모델명, 제공 종료·미제공, 계정 접근 | 현재 지원 모델로 설정하고 같은 모델 지정 시험 |
| `LLM_QUOTA`, 402/429 | 잔액·요청·토큰 한도 | 제공자 결제·한도 또는 다음 허용 시점 확인 |
| `LLM_CONFIG`, 400 | 요청 매개변수·주소·기본 모델 ID | 레지스트리와 어댑터 계약 확인 |
| `LLM_INPUT` | 질문·본문 또는 모델 문맥 한도 | 검토할 조문 범위를 나누기 |
| `LLM_TIMEOUT` | 모델 지연·추론량·배포 시간 제한 | 입력을 줄이거나 다른 모델로 실제 시험 |
| `LLM_TRUNCATED` | 출력 길이 한도 | 작업 범위를 줄여 완성된 답변 요청 |
| `LLM_SCHEMA` | JSON 미완성·빈 응답·형식 불일치 | 모델·작업을 다시 시험하고 불완전 결과 사용 금지 |
| `LAW_NO_KEY` / `LAW_AUTH` | 승인된 OC, 접속 등록, 새 배포 | 공식 인증·허용 환경 확인 |
| `LAW_ANTIBOT` / `LAW_FORMAT` | 차단·안내 HTML·비정상 JSON | 공식 서비스의 접속 조건과 응답 확인 |
| `LAW_TITLE_MISMATCH` / `LAW_ID_MISMATCH` | 요청과 다른 제목·식별자의 원문 | 다시 검색해 일치하는 원문 선택 |
| `LAW_FUTURE` / `LAW_NOT_CURRENT` | 시행예정·연혁·폐지 표시 | 검토할 실제 현행 제목·시행일 선택 |
| `LAW_UNSTRUCTURED` | 조문식이 아닌 행정규칙 | 공식 원문에서 검토할 범위를 직접 입력 |
| `CORPUS_UNAVAILABLE` | 검색 색인 파일·manifest 지문·배포 포함 | 원본 다운로드를 유지하고 색인 빌드·배포 확인 |

자료실은 검색이 성공하고 AI 생성만 실패한 경우 검색 발췌문을 계속 보여 줍니다. 설정 오류를 해결하는 동안 자료 검색과 다운로드를 이용할 수 있습니다. 오류 코드가 돌아왔다고 원본 법령의 부존재 또는 정책의 위법으로 해석하지 마세요.

`TRIAL_DAILY_LIMIT=800`은 서버 인스턴스별 기본 연결의 하루 호출 **근사 한도**입니다. 여러 서버 인스턴스에 걸친 중앙 사용량 집계나 제공자 결제 한도를 대신하지 않습니다. 실제 지출 제한은 제공자 계정에서도 관리해야 합니다.

## 9. 로컬과 Docker 설치

Node.js 22에서 저장소를 준비합니다. `.env.local`에 필요한 비밀값을 직접 넣고 Git에 올리지 않습니다.

```bash
npm ci
cp .env.example .env.local
npm run dev
```

운영 빌드:

```bash
npm test
npm run typecheck
npm run build
npm start
```

Docker 사용 예:

```bash
docker build -t jomokjomok:0.6 .
docker run --rm -p 3000:3000 --env-file .env.local jomokjomok:0.6
```

실제 비밀값은 이미지에 구워 넣지 않습니다. Docker 이미지는 원본 파일과 `data/knowledge` 검색 색인을 포함하도록 구성되어 있습니다. 기존 색인으로 운영할 때 Python·Poppler·임베딩 서비스를 별도로 실행하지 않습니다. 자료 교체·색인 재생성은 [RAG 구조와 갱신 안내](RAG-ARCHITECTURE.md)를 따르세요.

## 10. 운영자가 남길 확인 기록

배포 커밋과 배포 ID, 실제 도메인, 환경, 모델 ID와 실제 반환 모델명, 시험 시각, 법령 조회 방식·제목·시행일, 다운로드와 복원 결과를 남깁니다. 오류 공유에는 분류된 메시지만 사용하고 키나 민감한 요청 본문을 기록하지 않습니다.

짧은 응답 시험과 법령 진단을 통과한 뒤에도 실제 업무 흐름을 확인해야 합니다. 자료실의 인용 링크, 개정·제정 문서 세트, 유사 규정, 기관 설정 이동, 작업 복원, 모바일 입력을 확인 대상으로 둡니다. 실행한 항목·실패한 항목·미실행 범위는 [v0.6 검증 기록](VALIDATION-v0.6.md)과 해당 커밋의 결과를 확인하세요. 모의 응답 검사와 짧은 연결 시험을 실제 입안 성공으로 계산하지 않습니다. [5역할 검토 결정](research/v04-team-decisions.md)
