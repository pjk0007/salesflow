# PLAN — AI provider를 Claude(Anthropic)로 전환

- **track**: Full
- **사이클 ID**: `2026-08-28-claude-ai-provider`

## 배경

2026-08-27 09:30:19부터 전체 조직의 AI 발송이 중단됐다. 원인은 Gemini 선불 크레딧 소진(`Your prepayment credits are depleted`). 앱 내부 쿼터는 9억 토큰 남아 있었으나 Google 결제가 바닥나 모든 AI 호출이 실패했다. 운영 DB 확인 결과 미발송 누적은 파티션 55 기준 어제 1,391건 + 오늘 5,794건.

## 목표

AI provider를 Gemini에서 Claude(Anthropic)로 전환한다. 텍스트 생성(이메일 본문·알림톡·웹폼)과 웹검색 리서치(제품 조사·회사 조사·필드 보강) **양쪽 모두** 전환해 Gemini 의존을 완전히 제거한다. 모델은 `claude-haiku-4-5`로 시작하되, 기존 `AI_MODELS` 상수 구조를 그대로 활용해 나중에 모델 교체가 코드 한 줄로 가능하도록 유지한다.

기존 provider 추상화(`gemini` | `deepseek`)가 이미 자리잡혀 있으므로 `claude`를 세 번째 provider로 추가하는 형태를 따른다. DeepSeek 경로는 건드리지 않는다.

## 단계별 작업

1. `@anthropic-ai/sdk` 설치 (사용자 승인 완료)
2. `models.ts` — `AiProvider`에 `"claude"` 추가, `AI_MODELS`에 Haiku 항목 추가, `DEFAULT_MODEL_ID`·`SEARCH_MODEL_ID`를 Claude로 변경
3. `client.ts` — `getAiClient`에 claude 분기, `getSearchAiClient`를 Claude 고정으로 변경
4. `claude.ts` 신규 — 텍스트 생성(`callClaudeEmail`/`callClaudeJson`)과 웹검색(`callClaudeWithSearch`) 구현
5. `gemini.ts` 호출부 3개에 claude 분기 추가 (기존 파일의 provider 분기 패턴 유지)
6. 기존 DB 저장값(`gemini-3.5-flash-lite` 12건, null 17건) 호환 처리
7. 검증 — 테스트 + 실제 호출

## 건드릴 파일

| 파일 | 변경 요지 |
|---|---|
| `package.json` | `@anthropic-ai/sdk` 의존성 추가 |
| `src/lib/ai/models.ts` | `AiProvider`에 `"claude"`, `AI_MODELS`에 Haiku 추가, 기본/검색 모델 ID 변경 |
| `src/lib/ai/client.ts` | `getAiClient` claude 분기(`ANTHROPIC_API_KEY`), `getSearchAiClient` Claude 고정 |
| `src/lib/ai/claude.ts` (신규) | Anthropic SDK 호출 — 이메일/JSON/웹검색 3종 |
| `src/lib/ai/gemini.ts` | `callGeminiEmail`·`callGeminiJson`·`callGeminiWithSearch`에 claude 분기 추가 |
| `src/lib/ai/index.ts` | 필요 시 re-export 정리 |
| `.env.local` | `ANTHROPIC_API_KEY` 추가 (운영은 CloudType 환경변수) |

`search.ts`·`email.ts`·`alimtalk.ts`·`form.ts`는 **수정하지 않는다** — 이들은 `callGemini*` 함수만 호출하므로 분기를 그 안에 두면 상위는 그대로 동작한다. 프롬프트도 그대로 재사용한다(모델별 튜닝은 테스트 후 별도 판단).

## behavior 목록

| ID | 설명 | priority |
|---|---|---|
| B1 | `resolveModel("claude-haiku-4-5")`가 provider `claude`인 항목을 반환한다 | P1 |
| B2 | `resolveModel(undefined)`가 기본 모델(Claude)을 반환한다 | P1 |
| B3 | `resolveModel("gemini-3.5-flash-lite")`가 기존 Gemini 항목을 그대로 반환한다 (DB 저장값 12건 호환) | P1 |
| B4 | `getAiClient("claude-haiku-4-5")`가 `ANTHROPIC_API_KEY`로 claude 클라이언트를 만든다 | P1 |
| B5 | `ANTHROPIC_API_KEY` 미설정 시 `getAiClient`가 null을 반환한다 | P2 |
| B6 | `getSearchAiClient()`가 Claude 클라이언트를 반환한다 | P1 |
| B7 | `callClaudeEmail`이 subject/htmlBody를 파싱해 반환하고 usage 토큰을 채운다 | P1 |
| B8 | `callClaudeJson`이 JSON 문자열과 usage를 반환한다 | P1 |
| B9 | `callClaudeWithSearch`가 web search 툴을 써서 parsed + sources를 반환한다 | P1 |
| B10 | `callClaudeWithSearch`의 sources에 검색 출처 URL·title이 채워진다 | P2 |
| B11 | `generateCompanyResearch`가 Claude 경로로 회사 정보 JSON을 반환한다 (search.ts 무수정) | P1 |
| B12 | `generateProduct`가 Claude 경로로 동작한다 | P2 |
| B13 | `generateFieldEnrichment`가 Claude 경로로 동작한다 | P2 |
| B14 | Claude API 에러 시 원문 메시지를 담아 throw한다 (조용한 swallow 금지) | P1 |
| B15 | `logAiUsage`에 provider가 `claude`로 기록된다 | P2 |
| B16 | 기존 DeepSeek 경로가 회귀 없이 그대로 동작한다 | P1 |
| B17 | UI 모델 드롭다운에 Claude 항목이 노출된다 | P2 |

## 리스크/불확실성

- **웹검색 응답 형식 차이** — Gemini `groundingMetadata.groundingChunks` vs Claude `web_search_tool_result` 블록. 파싱 로직을 새로 써야 하며, sources 추출 방식이 다르다. 가장 큰 작업 덩어리.
- **Haiku 품질 미검증** — 콜드메일 본문은 무난할 것으로 보나, 웹검색 결과를 읽고 회사 특징을 뽑는 리서치는 부담이 더 크다. 기존 프롬프트가 Gemini에 맞춰 튜닝돼 있어 출력 품질이 달라질 수 있다. 사용자와 합의된 방침은 "일단 Haiku로 테스트 후 필요하면 상위 모델로 교체".
- **비용 증가** — Gemini flash-lite 대비 Haiku는 단가가 높다. 어제 사용량(8,721만 토큰) 기준 추산 필요.
- **JSON 강제 출력** — Gemini는 프롬프트로, DeepSeek은 `response_format`으로 JSON을 받는다. Claude는 structured outputs(`output_config.format`)를 쓸 수 있으나 web search 툴과 병용 시 제약이 있는지 확인 필요.
- **기존 DB 저장값** — `gemini-3.5-flash-lite` 12건이 남아 있어 `AI_MODELS`에서 Gemini를 제거하면 `resolveModel`이 기본값으로 폴백한다. B3으로 호환을 고정한다.

## 검증 방법

- **단위 테스트** — `resolveModel`·`getAiClient`·`getSearchAiClient` (B1~B6, B16). 기존 `pnpm test` 러너 사용.
- **파싱 테스트** — Claude 응답 fixture로 `callClaudeEmail`·`callClaudeWithSearch` 파싱 검증 (B7~B10, B14). 실제 API 호출 없이 fixture 기반.
- **실호출 검증** — 로컬에서 회사 리서치 1건, 메일 생성 1건 실제 호출해 출력 품질 육안 확인 (B11~B13). 결과를 PROGRESS.md에 기록.
- **타입/린트** — `npx tsc --noEmit` 클린, lint 신규 에러 0건.

## 범위 밖

- **미발송분 재처리** — 어제 1,391건 + 오늘 5,794건 재발송은 별도 작업. 운영 데이터를 건드리므로 사용자 승인 후 별도 진행.
- **대량 임포트 백그라운드 소실 문제** — `bulk-import/route.ts`가 fire-and-forget으로 던진 뒤 응답을 닫아 작업이 유실될 수 있는 구조. 이번 장애의 직접 원인은 아니었으나(크레딧 소진이 원인) 별도 사이클 대상.
- **실패 로그 미기록** — AI 발송 실패가 `email_send_logs`에 전혀 안 남아 장애를 20시간 몰랐다. 관측성 개선은 별도 사이클.
- **재시도 오판** — `gemini.ts:143`이 크레딧 소진처럼 재시도가 무의미한 에러도 재시도해 호출량이 2배가 된다. Gemini 경로를 안 쓰게 되면 자연 해소되나, 코드는 남는다.
- **Gemini 코드 제거** — 이번엔 claude 분기만 추가하고 Gemini 경로는 남긴다. 롤백 여지를 위해 유지.
- **프롬프트 모델별 튜닝** — 기존 프롬프트를 그대로 쓴다. 품질 문제가 확인되면 그때 별도 판단.
- **DeepSeek 경로 변경** — 손대지 않는다.
