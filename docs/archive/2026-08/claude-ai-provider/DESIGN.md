# DESIGN — AI provider를 Claude(Anthropic)로 전환

- **사이클 ID**: `2026-08-28-claude-ai-provider`
- **근거 문서**: `docs/2026-08-28-claude-ai-provider/PLAN.md`, `behaviors.json` (B1~B17)

## 0. 실호출로 확정된 사실 (2026-08-28 검증 완료)

설계 착수 전 로컬에서 실제 API를 호출해 확인했다. 아래는 추측이 아니라 관측값이다.

1. **키 정상 동작** — `claude-haiku-4-5` 단발 호출 성공 (usage in/out = 14/4).
2. **`allowed_callers: ["direct"]`가 필수다.** 이걸 빼면 400이 난다:
   > `'claude-haiku-4-5-20251001' does not support programmatic tool calling. The following tools have `allowed_callers` that require it: web_search. Explicitly set `allowed_callers=["direct"]` on these tools, or use a model that supports programmatic tool calling.`

   Haiku 4.5는 programmatic tool calling을 지원하지 않으므로 web search 툴 정의에 **반드시** `allowed_callers: ["direct"]`를 넣는다.
3. **`web_search_20260209`가 Haiku 4.5에서 동작한다.** (§5.3의 폴백 설계는 불필요 — 아래에서 제거)
   - `stop_reason: "end_turn"`, 검색 결과 9건, `url`/`title` 정상 수집
   - block 순서: `text, server_tool_use, web_search_tool_result, text, text, ...` (text 블록이 **여러 개로 쪼개져** 나온다 → `extractText`가 전부 이어붙여야 함)
   - `usage.server_tool_use = {web_search_requests: 1, web_fetch_requests: 0}`
4. **검색 1회당 입력 토큰이 크다** — in/out = **11,625 / 446**. 검색 결과가 통째로 컨텍스트에 들어온다. 비용 추산의 근거값(§9 리스크 4).
5. **테스트 러너** — `pnpm test` = `tsx --test "src/**/*.test.ts"` (node:test). 기존 테스트 2개(`email-sender-pick.test.ts`, `attribution/parse-params.test.ts`).

## 1. 접근법

### 선택지

**안 A — `claude.ts` 신규 + `gemini.ts` 3개 함수에 provider 분기 추가 (선택)**
기존 DeepSeek 분기와 동일한 패턴. `callGeminiEmail`/`callGeminiJson`/`callGeminiWithSearch` 각 함수 맨 앞에 `if (client.provider === "claude") return callClaude*(...)`를 넣는다. 상위 4개 파일(`search.ts`·`email.ts`·`alimtalk.ts`·`form.ts`)은 무수정.

**안 B — dispatcher 레이어 신설 (`provider.ts`)**
`callAiEmail`/`callAiJson`/`callAiWithSearch`를 새로 만들어 provider별 구현으로 위임하고, 상위 4개 파일의 import를 전부 교체. `gemini.ts`는 Gemini 전용으로 축소.

**안 C — Anthropic SDK를 `gemini.ts` 안에 직접 인라인**
`callDeepseek`처럼 private 함수로 넣는다.

### 선택: 안 A

근거:
- **변경 최소화가 이번 사이클의 최우선.** 운영 AI가 20시간째 죽어 있다. 상위 파일 4개를 건드리면 회귀 표면이 넓어지고, B11~B13(무수정 통과)·B16(DeepSeek 회귀 없음)의 검증 비용이 커진다. 안 A는 `search.ts`의 catch 폴백 로직·프롬프트·정규식 패턴을 한 글자도 안 건드리므로 B11~B13이 "기존 코드가 그대로 통과"로 증명된다.
- 안 B는 구조적으로 더 깔끔하지만 **YAGNI**. provider가 3개뿐이고 분기 지점이 3개 함수로 이미 수렴돼 있다. dispatcher는 이름만 바꾼 같은 분기다. Gemini 코드 제거(범위 밖)를 할 때 안 B로 리팩토링하는 게 순서상 맞다.
- 안 C는 `gemini.ts`가 236줄 → 400줄+가 되어 200줄 규칙 위반.

**남는 부채(의도적)**: `gemini.ts`라는 파일명이 세 provider의 진입점이 된다. 이름과 내용이 어긋나지만, 이름 변경은 import 6곳을 건드리는 변경이라 이번엔 하지 않는다. 파일 상단 주석으로 "provider dispatch 진입점"임을 명시한다.

## 2. 아키텍처

```
상위 도메인 (무수정)
  email.ts        → callGeminiEmail
  alimtalk.ts     → callGeminiJson
  form.ts         → callGeminiJson
  search.ts       → callGeminiWithSearch
                        │
                   gemini.ts  ← provider dispatch 지점 (여기만 수정)
                    ├─ claude   → claude.ts  (신규)
                    ├─ deepseek → callDeepseek (기존, 무수정)
                    └─ gemini   → 기존 fetch (무수정, 롤백용 유지)

claude.ts (신규)
  callClaudeEmail   ─┐
  callClaudeJson    ─┼→ callClaudeMessage (내부 공통: SDK 호출 + 429/500/529 1회 재시도)
  callClaudeWithSearch ┘   └→ runSearchLoop (pause_turn 재개)
                            └→ claude-parse.ts (순수함수)
```

데이터 흐름은 기존과 동일. `AiClient { provider, apiKey, model }`가 그대로 흘러가고, `claude.ts`는 `client.apiKey`로 매 호출 `new Anthropic({ apiKey })`를 만든다(서버리스 환경이라 모듈 레벨 싱글턴은 두지 않는다 — 기존 fetch 방식과 수명 동일).

## 3. 파일 계획

### 신규

| 파일 | 역할 | 예상 줄수 |
|---|---|---|
| `src/lib/ai/claude.ts` | Anthropic SDK 호출 3종 + 내부 공통 호출/루프 | ~150 |
| `src/lib/ai/claude-parse.ts` | 응답 블록 → text/sources 추출 **순수함수**. SDK 타입만 의존, 네트워크 없음 | ~60 |
| `src/lib/ai/models.test.ts` | B1~B3, B16 | ~40 |
| `src/lib/ai/client.test.ts` | B4~B6 | ~50 |
| `src/lib/ai/claude-parse.test.ts` | B7·B9·B10 파싱 계약 (fixture 기반) | ~90 |

`claude-parse.ts`를 분리하는 이유: **테스트 가능성**. `claude.ts`는 SDK 클라이언트를 잡고 있어 단위테스트에 모킹이 필요하지만, 파싱은 순수함수라 fixture만으로 고정된다. B9/B10/B7의 실질적 계약은 전부 파싱 쪽에 있다.

### 수정

| 파일 | 변경 요지 |
|---|---|
| `src/lib/ai/models.ts` | `AiProvider`에 `"claude"` 추가. `AI_MODELS`에 Haiku 항목을 **배열 맨 앞**에 추가(드롭다운 첫 항목 = B17). Gemini/DeepSeek 항목은 **유지**(B3). `DEFAULT_MODEL_ID`·`SEARCH_MODEL_ID`를 `claude-haiku-4-5`로 변경. 파일 상단 주석의 "Gemini 고정" 문구 수정 |
| `src/lib/ai/client.ts` | `getAiClient`에 claude 분기(`ANTHROPIC_API_KEY`). `getSearchAiClient`를 Claude 고정으로 변경. 주석 수정 |
| `src/lib/ai/gemini.ts` | 3개 export 함수 앞머리에 claude 분기 3줄씩 추가. `GenerateEmailResult`를 export로 변경. 파일 상단에 dispatch 진입점 주석 |
| `src/lib/ai/index.ts` | `SEARCH_MODEL_ID` re-export 추가 |
| `.env.local` | `ANTHROPIC_API_KEY` — **추가 완료** (운영은 CloudType 환경변수, 배포 체크리스트 1번) |

**수정하지 않는 파일(명시)**: `search.ts`, `email.ts`, `alimtalk.ts`, `form.ts`, `json-utils.ts`, `quota.ts`, UI 5곳, API 라우트 8곳.

B15(provider가 `claude`로 기록)와 B17(드롭다운 노출)은 **코드 변경이 필요 없다**. 라우트는 이미 `provider: client.provider`를 넘기고 있고, UI는 `AI_MODELS.map()`으로 렌더한다. 두 behavior는 `models.ts`/`client.ts` 변경의 파생 효과이므로 검증만 한다.

## 4. 데이터 / 타입

### models.ts

```ts
export type AiProvider = "gemini" | "deepseek" | "claude";

export const AI_MODELS: AiModelOption[] = [
    { id: "claude-haiku-4-5",      label: "Claude Haiku 4.5",      provider: "claude" },
    { id: "gemini-3.5-flash-lite", label: "Gemini 3.5 Flash Lite", provider: "gemini" },
    { id: "deepseek-v4-flash",     label: "DeepSeek V4 Flash",     provider: "deepseek" },
];

export const DEFAULT_MODEL_ID = "claude-haiku-4-5";
export const SEARCH_MODEL_ID = "claude-haiku-4-5";
```

모델 교체는 이 3곳의 문자열만 바꾸면 된다(사용자 방침: 품질 미달 시 상위 모델 교체). `label`도 함께 바꿔야 UI가 일치한다 — 교체 절차를 파일 주석에 한 줄로 남긴다.

### claude.ts — 공개 시그니처 (반환 타입은 기존과 동일)

```ts
export async function callClaudeEmail(
    client: AiClient, systemPrompt: string, userPrompt: string
): Promise<GenerateEmailResult>;

export async function callClaudeJson(
    client: AiClient, systemPrompt: string, userPrompt: string
): Promise<{ content: string; usage: { promptTokens: number; completionTokens: number } }>;

export async function callClaudeWithSearch(
    client: AiClient, systemPrompt: string, userPrompt: string, jsonPattern: RegExp
): Promise<WebSearchResult>;
```

`GenerateEmailResult`는 현재 `gemini.ts`에 non-export로 선언돼 있다. `claude.ts`가 써야 하므로 `gemini.ts`에서 `export`로 바꾸고 import한다(타입 재정의 금지 — 시그니처 드리프트 방지). `WebSearchResult`는 이미 export돼 있다.

### web search 툴 정의 (실측 반영)

```ts
const SEARCH_TOOL = {
    type: "web_search_20260209",
    name: "web_search",
    max_uses: 3,
    allowed_callers: ["direct"],   // ★ Haiku 4.5 필수 — 없으면 400
} as const;
```

`allowed_callers: ["direct"]`는 §0-2에서 실측 확인한 필수 항목이다. 주석으로 이유를 남긴다(빼면 400이 나는데 원인을 찾기 어렵다).

### claude-parse.ts — 순수함수 시그니처

```ts
import type { ContentBlock, Usage } from "@anthropic-ai/sdk/resources/messages";

/** text 블록만 골라 이어붙인다. thinking·tool_use·web_search_tool_result 블록은 무시.
 *  실측상 text 블록이 여러 개로 쪼개져 오므로 전부 이어붙여야 한다. */
export function extractText(blocks: ContentBlock[]): string;

/**
 * web_search_tool_result 블록에서 출처를 뽑는다.
 * content가 WebSearchToolResultError(union의 에러 갈래)면 그 블록은 건너뛴다.
 * 같은 url이 여러 번 나오면 첫 항목만 남긴다(dedupe).
 */
export function extractSearchSources(
    blocks: ContentBlock[]
): Array<{ url: string; title: string }>;

/** Anthropic Usage → 기존 usage 형태로 매핑. 누락 필드는 0. */
export function toUsage(usage: Usage | undefined): { promptTokens: number; completionTokens: number };
```

`WebSearchResultBlock`의 `{ url, title }`은 기존 sources 형식과 그대로 호환된다. `title`이 빈 문자열이면 Gemini 경로와 동일하게 `url`로 폴백한다.

### claude.ts — 내부 시그니처

```ts
interface ClaudeCallResult {
    text: string;
    blocks: ContentBlock[];
    usage: { promptTokens: number; completionTokens: number };
    truncated: boolean;      // stop_reason === "max_tokens"
    pausedOut: boolean;      // pause_turn인데 재개 한도를 넘겨 끊긴 경우
}

async function callClaudeMessage(
    client: AiClient, systemPrompt: string, userPrompt: string
): Promise<ClaudeCallResult>;

async function runSearchLoop(
    client: AiClient, systemPrompt: string, userPrompt: string
): Promise<ClaudeCallResult>;
```

`usage`는 루프 전 구간을 **누적 합산**한다(재개 요청 각각이 과금되므로 마지막 응답값만 쓰면 쿼터가 과소 집계된다). `blocks`도 전 턴을 이어붙여야 앞 턴의 검색 출처가 유실되지 않는다.

## 5. 핵심 설계 결정

### 5.1 JSON 강제 출력 — structured outputs를 쓰지 않는다

**결정: 세 경로 모두 기존 프롬프트 + `extractJson(content, pattern)`을 재사용한다.**

근거:
- 리서치 경로는 web search 툴을 쓴다. `output_config.format`은 서버 툴/citations와 조합 시 제약이 있고 citations와는 400을 낸다 — 여기서 structured outputs를 쓸 수 없다.
- 그러면 텍스트 경로만 structured outputs를 쓰게 되는데, **경로마다 JSON 획득 방식이 갈리면 실패 모드가 두 벌**이 된다. `extractJson`은 코드블록 추출·중괄호 밸런싱·잘린 이메일 JSON 복구(step 4)까지 이미 갖춘 방어망이다.
- 프롬프트를 그대로 쓰는 것이 PLAN의 방침(범위 밖: 프롬프트 모델별 튜닝).
- `extractJson`은 이미 DeepSeek·Gemini 양쪽을 통과시키고 있다. Claude 출력도 같은 형태이므로 추가 작업이 0이다.

**prefill은 쓰지 않는다.** Claude 4.5 이후 모델은 assistant prefill이 제약되며, 실호출(§0-3)에서 서두 오염이 관측되지 않았다(text 블록이 쪼개져 나올 뿐 JSON은 정상). 기존 프롬프트에 "JSON 외의 텍스트를 포함하지 마세요"가 이미 있고, `extractJson`이 코드블록/중괄호 추출로 흡수한다. 실호출에서 오염이 확인되면 그때 프롬프트를 보강한다(코드 변경 아님).

### 5.2 `pause_turn` 처리 — `runSearchLoop`에서 재개, 한도 초과 시 부분결과

**전략**:
1. `messages = [{ role: "user", content: userPrompt }]`로 시작.
2. 응답을 받아 `blocks`·`usage`를 누적.
3. `stop_reason === "pause_turn"`이면 `messages.push({ role: "assistant", content: response.content })` 후 재요청. (assistant 턴을 **그대로** push해야 서버가 툴 상태를 이어받는다 — 텍스트만 추출해 넣으면 안 된다.)
4. `stop_reason`이 `pause_turn`이 아니면 루프 종료.

**`MAX_SEARCH_CONTINUATIONS = 3`** (초기 요청 1회 + 재개 최대 3회 = 총 4회 API 호출).
근거: web search 툴 루프는 10회 도달 시 pause한다. 실호출에서는 `max_uses: 3`으로 pause 없이 `end_turn`이 나왔다(§0-3). 3회는 정상 케이스에 충분한 여유이면서 비용 폭주를 막는 값이다. 상수로 두어 관측 후 조정 가능하게 한다.

**한도 초과 시 동작: throw하지 않고 `pausedOut: true`로 표시한 뒤 지금까지 모인 텍스트로 `extractJson`을 시도한다.**
근거:
- 여기서 throw하면 `search.ts`의 catch로 떨어지고, 메시지에 credit/API/key/auth/401/403이 없으므로 **"정보 없음" 폴백**이 반환된다. 리드는 조용히 빈 데이터로 저장된다 — 이번 장애와 같은 종류의 "조용한 실패"다.
- 부분 텍스트로 JSON 파싱이 되면 그건 유효한 결과다. 파싱이 실패하면 `extractJson`이 throw하고 기존 폴백 경로로 간다 — 기존 동작과 동일.
- **단, `pausedOut`일 때는 반드시 `console.warn`으로 원문 stop_reason과 누적 호출 횟수를 남긴다.** 조용히 지나가면 안 된다(전역 규칙: 에러 swallow 금지).

`stop_reason === "max_tokens"`는 `truncated: true`로 `extractJson`의 3번째 인자에 넘긴다 → 이메일 잘림 복구(step 4)가 동작한다. Gemini의 `finishReason === "MAX_TOKENS"`와 정확히 대응된다.

### 5.3 web search 툴 버전 — `web_search_20260209` 고정, 폴백 없음

§0-3에서 **Haiku 4.5에서 정상 동작을 실측 확인**했다. 따라서 `web_search_20250305` 폴백 코드는 **작성하지 않는다**(YAGNI — 검증된 경로에 방어 코드를 넣지 않는다).

툴 타입은 `SEARCH_TOOL` 상수에 있으므로 향후 변경 시 한 줄 교체로 끝난다.

### 5.4 thinking / max_tokens

**thinking은 쓰지 않는다.**
근거: 콜드메일 본문 작성과 회사 정보 JSON 정리는 추론 부담이 낮다. thinking을 켜면 (a) 응답 지연 증가 — 대량 발송에서 치명적, (b) 토큰 비용 증가 — 이미 단가가 올라가는 상황, (c) `thinking` 블록이 content에 섞여 파싱 표면이 넓어진다. 품질 미달이면 상위 모델 교체가 먼저다(사용자 방침).

**`max_tokens`**: 세 경로 모두 **4096**. HTML 이메일 본문이 가장 긴 출력이고, 기존에 잘림 복구 코드가 있다는 건 실제로 잘려본 적이 있다는 뜻이다. 리서치 JSON은 description 200~500자라 충분하다. `claude.ts` 상단 상수로 둔다.

### 5.5 에러 처리 — 원문 유지, 래핑 금지

**결정: SDK 에러를 잡아 재가공하지 않는다. 그대로 전파한다.**

근거 (검증 완료):
- `Anthropic.APIError.message`는 `` `${status} ${errorBody.message}` `` 형태다(`core/error.mjs`의 `makeMessage`에서 확인). 401 인증 에러의 message는 `"401 {\"type\":\"error\",...}"`처럼 **status 숫자가 앞에 붙는다**.
- `search.ts:141`의 `msg.includes("401") || msg.includes("403")` 검사가 **그대로 동작한다**. 크레딧/키 문제는 사용자에게 전파되고, 그 외 에러는 "정보 없음" 폴백 — 기존 Gemini 경로와 동일한 분류 동작이 보존된다.

따라서 `claude.ts`는 **try/catch로 에러를 감싸지 않는다**. `new Error("Claude API 호출에 실패했습니다")` 같은 래핑은 원문 메시지를 삭제하고 status 정보를 날려 위 분류 로직을 깨뜨리므로 **금지**.

예외 하나: **429/500/529는 1회 재시도**한다(기존 Gemini/DeepSeek 경로와 동일, 1~2초 랜덤 대기). 재시도 후에도 실패하면 원문 throw. **401/403/400은 재시도하지 않는다** — 재시도가 무의미한 에러다. PLAN이 지적한 Gemini의 재오판(크레딧 소진에도 재시도해 호출량 2배)을 Claude 경로에서는 반복하지 않는다.

### 5.6 `getSearchAiClient` — Claude 고정

```ts
export function getSearchAiClient(): AiClient | null {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return null;
    return { provider: "claude", apiKey, model: SEARCH_MODEL_ID };
}
```

규칙별 검색 모델 선택은 범위 밖(PLAN). 호출부는 무수정. 다만 `auto-personalized-email.ts`와 `test-send/route.ts`의 인라인 주석 `// 회사 리서치는 웹검색 필요 → Gemini 고정`은 사실과 어긋나게 된다 — **주석만** 수정한다(로직 무변경).

## 6. TDD로 고정할 계약

`pnpm test`(= `tsx --test "src/**/*.test.ts"`, node:test + node:assert). 기존 `src/lib/email-sender-pick.test.ts` 스타일을 따른다 — 테스트 제목 끝에 behavior ID를 괄호로 표기.

### 그룹 1 — `models.test.ts` (순수함수, 모킹 없음)

| 계약 | behavior |
|---|---|
| `resolveModel("claude-haiku-4-5")`가 `provider === "claude"`인 항목을 반환 | B1 |
| `resolveModel(undefined)`가 `DEFAULT_MODEL_ID` 항목을 반환하고 provider가 `claude` | B2 |
| `resolveModel("gemini-3.5-flash-lite")`가 **id 그대로** `provider === "gemini"` 항목을 반환 (기본값 폴백 아님) | **B3 ★** |
| `resolveModel("deepseek-v4-flash")`가 deepseek 항목을 반환 | B16 |
| `resolveModel("")`, `resolveModel("존재하지-않는-모델")`이 기본 모델로 폴백 | B2 경계 |
| `AI_MODELS`의 모든 id가 유일하다 | 회귀 방지 |

★ B3이 이번 사이클에서 가장 중요한 계약이다. 운영 DB에 `gemini-3.5-flash-lite` 12건이 살아 있고, `AI_MODELS`에서 Gemini를 지우면 그 링크들이 조용히 Claude로 바뀐다. **"기본값으로 폴백하지 않는다"를 명시적으로 assert**한다.

### 그룹 2 — `client.test.ts` (env 조작, 모킹 없음)

각 테스트에서 `process.env`를 설정하고 `t.after`로 원복한다.

| 계약 | behavior |
|---|---|
| `ANTHROPIC_API_KEY` 설정 시 `getAiClient("claude-haiku-4-5")`가 `{ provider: "claude", apiKey, model }` | B4 |
| `ANTHROPIC_API_KEY` 미설정 시 `getAiClient("claude-haiku-4-5")`가 `null` | B5 |
| `ANTHROPIC_API_KEY` 설정 시 `getSearchAiClient()`가 `provider === "claude"`, `model === SEARCH_MODEL_ID` | B6 |
| `ANTHROPIC_API_KEY` 미설정 시 `getSearchAiClient()`가 `null` | B5 경계 |
| `getAiClient("deepseek-v4-flash")`가 여전히 `DEEPSEEK_API_KEY`를 읽는다 | **B16** |
| `getAiClient("gemini-3.5-flash-lite")`가 여전히 `GEMINI_API_KEY`를 읽는다 | B3 파생 |
| 미지정(`getAiClient()`)이 Claude 클라이언트를 만든다 | B2/B4 |

### 그룹 3 — `claude-parse.test.ts` (fixture 기반 순수함수, 네트워크 없음)

| 계약 | behavior |
|---|---|
| `extractText`가 text 블록만 이어붙이고 tool_use·web_search_tool_result 블록은 건너뛴다 | B7/B8 |
| `extractText`가 **쪼개진 text 블록 여러 개**를 순서대로 이어붙인다 (실측 §0-3) | B7 |
| `extractText`가 빈 blocks에서 `""` 반환 (throw 아님) | 경계 |
| `extractSearchSources`가 `web_search_result` 배열에서 `{url, title}`을 뽑는다 | **B10** |
| `extractSearchSources`가 `content`가 **`WebSearchToolResultError`**인 블록을 건너뛰고 나머지는 계속 수집 | **B9 ★** |
| `extractSearchSources`가 중복 url을 1건으로 dedupe한다 | B10 |
| `extractSearchSources`가 `title`이 빈 문자열이면 url로 대체한다 | B10 |
| `extractSearchSources`가 검색 결과 블록이 없으면 `[]` 반환 | B9 경계 |
| `toUsage`가 `{input_tokens, output_tokens}` → `{promptTokens, completionTokens}`로 매핑 | B7/B8 |
| `toUsage(undefined)`가 `{promptTokens: 0, completionTokens: 0}` | 경계 |

★ `WebSearchToolResultBlockContent`가 `WebSearchToolResultError | Array<WebSearchResultBlock>` union이라는 점이 이 설계의 최대 함정이다. 분기를 빼먹으면 에러 객체에 `.map`을 호출해 런타임 TypeError가 나고, `search.ts`의 catch가 이를 "정보 없음"으로 삼켜 **조용히 전량 실패**한다. 이 테스트를 먼저 쓴다.

### TDD로 고정하지 않는 것

- `callClaude*` **자체** — SDK 클라이언트 모킹이 필요하고, 실질 계약(파싱·usage·소스 추출)은 그룹 3에서 이미 고정된다. SDK를 모킹하는 테스트는 SDK 인터페이스를 재확인할 뿐 우리 로직을 검증하지 않는다. 실호출 검증(B11~B13)으로 대체.
- `pause_turn` 루프 — 순수함수로 떼기 어렵고, 실제 pause를 재현하는 fixture는 서버 동작 추측이 된다. `console.warn` 로그로 운영에서 관측.
- UI 드롭다운(B17), `logAiUsage` provider 기록(B15) — 코드 변경이 없고 UI/DB 조회로 육안 확인.

### 작업 순서

1. 그룹 1·2 테스트 작성 → 실패 확인 → `models.ts`·`client.ts` 수정 → 통과 (B1~B6, B16)
2. 그룹 3 테스트 작성(fixture 먼저) → 실패 → `claude-parse.ts` 구현 → 통과 (B7·B9·B10 파싱부)
3. `claude.ts` 구현 → `gemini.ts` 분기 추가 → `npx tsc --noEmit` 클린
4. 실호출 검증: 회사 리서치 1건 + 메일 생성 1건 (B11~B14) → PROGRESS.md 기록

## 7. behavior → 구현 매핑

| ID | 구현 위치 | 검증 |
|---|---|---|
| B1 | `models.ts` `AI_MODELS` + `AiProvider` | `models.test.ts` |
| B2 | `models.ts` `DEFAULT_MODEL_ID` | `models.test.ts` |
| B3 | `models.ts` — Gemini 항목 **유지** | `models.test.ts` (폴백 아님을 assert) |
| B4 | `client.ts` `getAiClient` claude 분기 | `client.test.ts` |
| B5 | `client.ts` `getAiClient` — 키 없으면 null | `client.test.ts` |
| B6 | `client.ts` `getSearchAiClient` | `client.test.ts` |
| B7 | `claude.ts` `callClaudeEmail` + `extractText`/`toUsage` + 기존 `extractJson` | `claude-parse.test.ts` + 실호출 |
| B8 | `claude.ts` `callClaudeJson` + `extractText`/`toUsage` | `claude-parse.test.ts` + 실호출 |
| B9 | `claude.ts` `runSearchLoop` + `extractSearchSources` (union 분기) | `claude-parse.test.ts` + 실호출 |
| B10 | `claude-parse.ts` `extractSearchSources` | `claude-parse.test.ts` |
| B11 | `search.ts` **무수정** — `gemini.ts`의 claude 분기로 자동 통과 | 실호출 |
| B12 | `search.ts` `generateProduct` **무수정** | 실호출 |
| B13 | `search.ts` `generateFieldEnrichment` **무수정** | 실호출 |
| B14 | `claude.ts` — 래핑 금지, 원문 전파. 429/500/529만 1회 재시도 | 잘못된 키로 실호출 → 401 원문 확인 |
| B15 | **코드 변경 없음** — 라우트가 이미 `client.provider` 전달 | `ai_usage_logs` 조회 |
| B16 | `gemini.ts` deepseek 분기 **무수정**, `client.ts` deepseek 분기 유지 | `models.test.ts`·`client.test.ts` |
| B17 | **코드 변경 없음** — UI가 `AI_MODELS.map()` 렌더 | 브라우저 육안 |

## 8. 도메인 체크리스트

- **API 계약**: 상위 API 라우트의 요청/응답 형태 무변경. 에러 응답도 기존 `{success:false, error}` 그대로.
- **보안**: `ANTHROPIC_API_KEY`는 서버 전용 env. `claude.ts`는 서버 모듈만 import하고 클라이언트 번들에 들어가지 않는다(`models.ts`만 UI가 import — 여기엔 키가 없다). 키를 로그/에러 메시지에 절대 넣지 않는다.
- **동시성**: 대량 발송 시 Claude rate limit에 걸릴 수 있다. 429가 폭증하면 별도 대응 → 리스크 6.
- **성능**: `pause_turn` 재개는 API 호출 횟수를 최대 4배로 늘린다. `MAX_SEARCH_CONTINUATIONS`가 상한선. thinking 비활성으로 지연 최소화.
- **데이터 모델**: 스키마 변경 없음. `email_auto_personalized_links.model`에 새 값이 쌓이고, 기존 값 12건은 B3으로 계속 유효.

## 9. 리스크 / 열린 질문

### 리스크

1. **~~Haiku의 web search 지원 여부~~ — 해소됨** (§0-3 실측 확인). 대신 `allowed_callers: ["direct"]` 누락이 새 함정이다. 빼면 400이 나고 리서치 전량 실패 → 코드 주석으로 명시.
2. **`pause_turn` 조용한 절단** — 재개 로직을 빼먹으면 잘린 결과가 정상처럼 반환된다. `runSearchLoop`가 유일한 방어선이고 단위테스트로 못 잡는다. `console.warn` 로그 필수.
3. **union 분기 누락 시 전량 실패** — `WebSearchToolResultError`에 `.map` 호출 → TypeError → `search.ts` catch → "정보 없음" 조용한 폴백. 그룹 3 테스트로 고정.
4. **비용 — 실측 기반 추산** (§0-4): 검색 1회당 in/out = 11,625/446.
   - 어제 리서치 1,621건 기준: 입력 1,884만 → **$18.8**, 출력 72만 → **$3.6** ≈ **$22/일**
   - 메일 생성까지 더하면 **하루 $30~40** 추정. Gemini flash-lite 대비 확실히 비싸다.
   - 절감 여지: `max_uses`를 3→1~2로 낮추면 입력 토큰이 준다. 첫 24시간 사용량을 반드시 모니터링하고 PROGRESS에 기록.
5. **품질** — 프롬프트가 Gemini 튜닝 상태. 이메일 본문 톤이 달라질 수 있다. 사용자 방침대로 실호출 육안 확인 후 판단.
6. **rate limit** — 대량 발송 시 429. 1회 재시도 후 실패하면 `search.ts` 폴백으로 "정보 없음"이 저장된다(기존과 동일 동작이지만 규모가 다르면 문제). 관측 필요.
7. **운영 환경변수 누락** — CloudType에 `ANTHROPIC_API_KEY`를 등록하지 않고 배포하면 `getAiClient`가 null을 반환해 **장애가 그대로 지속**된다. 배포 체크리스트 1번 항목.
8. **API 키 노출** — 현재 키가 채팅 평문으로 오갔다. 운영 배포 전 재발급 권장.

### 열린 질문 — 2026-08-28 사용자 결정으로 전부 해소

- **Q1 (`MAX_SEARCH_CONTINUATIONS = 3`)** → 현 설계대로 3 유지. 실호출 관측 후 필요하면 조정.
- **Q2 (`pause_turn` 한도 초과 시 부분결과 vs throw)** → **현 설계 유지**(부분결과 + `console.warn`). 사용자 결정.
- **Q3 (Gemini 충전 계획)** → **충전 계획 없음.** Gemini는 실질 롤백 경로가 아니다. 다만 이번 사이클에서는 코드를 그대로 남긴다(변경 최소화). 다음 사이클에서 Gemini 경로 제거 + 안 B(dispatcher) 정리를 검토한다. `AI_MODELS`의 Gemini 항목은 B3(운영 DB 12건 호환) 때문에 제거 대상이 아니다 — 코드 경로 제거와 목록 항목은 별개.
- **Q4 (비용 절감)** → 현 수준 수용. `max_uses: 3` 유지, 리서치 유지. 첫 24시간 사용량은 그대로 모니터링한다.

## 10. 다음 단계

이 DESIGN으로 **`/tdd`** 진행 — 그룹 1~3이 명확한 계약을 가진 순수함수라 TDD 대상이다. `claude.ts`의 SDK 호출부와 `gemini.ts` 분기는 TDD 통과 후 구현하고 실호출로 검증한다. UI 변경은 없다.
