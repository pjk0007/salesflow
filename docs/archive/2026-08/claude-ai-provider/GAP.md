# GAP — AI provider를 Claude(Anthropic)로 전환

- **사이클 ID**: `2026-08-28-claude-ai-provider`
- **대조 분모**: `behaviors.json` B1~B17 (17건) + DESIGN §3 파일 계획 · §5 설계 결정 7항
- **분석 일시**: 2026-08-28

## 결론

**unproven: 0 — 통과.** (Match Rate 16/17 = 94% · 참고)

증거 없이 통과를 주장한 항목은 0건. 유일한 미통과 B15는 **정당한 미통과**(운영 배포 전이라 조회할 DB 레코드가 없음)다.

### 실행한 검증

| 명령 | 결과 |
|---|---|
| `pnpm test` | `tests 68 / pass 68 / fail 0` |
| `npx tsc --noEmit` | exit 0, 클린 |
| `git diff --name-only` | `search.ts`·`email.ts`·`alimtalk.ts`·`form.ts`·`json-utils.ts`·`quota.ts` **전부 무수정** 확인 |
| 실호출 (운영 프롬프트·레코드) | 리서치/제품조사/필드보강/메일생성/알림톡/웹폼 전부 성공 |
| **실제 메일 발송** | NHN `isSuccessful=true`, `resultCode=0` → ghty6323@gmail.com 수신 확인 |

## 1. behavior 판정

### ✅ 통과 (16)

B1~B14, B16, B17. 근거는 `behaviors.json`의 각 `evidence` 참조.

핵심 항목:
- **B3** — `models.test.ts:28`이 `assert.notEqual(m.id, DEFAULT_MODEL_ID)`로 "기본값 폴백이 아님"을 명시 assert. 운영 DB의 `gemini-3.5-flash-lite` 12건이 조용히 Claude로 바뀌지 않음을 고정.
- **B9** — `claude-parse.ts:26` `if (!Array.isArray(content)) continue`. DESIGN §6이 "최대 함정"으로 지목한 union 에러갈래 분기 구현 + 테스트 2건.
- **B14** — `claude.ts`의 try/catch는 재시도 판정용일 뿐 래핑하지 않고 `throw err` 원문 전파. 실호출에서 `401 {"type":"error",...}` 확인, `search.ts:141`의 `msg.includes("401")` 분류가 그대로 동작.
- **B17** — 초기 `passes:false`로 **과소 보고**돼 있었으나 `models.test.ts:47`에 자동 검증이 실재하고 통과함. `passes:true`로 정정(15/17 → 16/17).

### ❌ 미통과 (1) — 정당함

**B15** (`logAiUsage`에 provider=claude 기록). 코드 경로는 확인됨 — 호출부 13곳 전부 `provider: client.provider`를 넘기고 `client.ts`가 `"claude"`를 반환하므로 논리적으로 필연. 그러나 **`ai_usage_logs`에 claude 레코드가 적재된 것을 조회한 근거가 없다** — 배포 전이라 조회할 행이 없다. 검증 스크립트는 라이브러리 함수를 직접 호출해 `logAiUsage`를 타지 않았다. `passes:false` + `evidence:null` 유지가 정직한 기록. **배포 후 `SELECT provider FROM ai_usage_logs WHERE provider='claude'` 1회로 닫힌다.**

### ➕ 설계 밖 구현 (1) — 정당한 추가

**`stripCitationTags`** (`claude-parse.ts:42-44`) — 스코프 크립 아님.

- 설계 시점에 알 수 없던 사실. DESIGN §0의 실호출 3건에서는 관측되지 않았고, `do(5)` 단계에서 웹검색 응답에 `(cite index="21-1">…</cite>`가 섞여 나오는 것이 처음 드러났다.
- 방치하면 **사용자 노출 결함**이다(콜드메일 본문·회사 설명에 태그 노출).
- DESIGN 원칙 준수: 순수함수로 `claude-parse.ts`에 배치, TDD 6케이스(RED→GREEN)로 고정.
- 검색 경로 1곳에만 적용. 텍스트 생성 경로는 실측상 깨끗해서 적용하지 않음(YAGNI).

## 2. DESIGN §5 설계 결정 대조 (7/7 ✅)

| # | 결정 | 구현 |
|---|---|---|
| (a) | 에러 래핑 금지 · 401/403/400 재시도 안 함 | `claude.ts:35-38` `isRetryableStatus`가 `429\|500\|529`만 true |
| (b) | `pause_turn` 재개 + usage 누적 | `claude.ts:104-108` 누적, `:120` 블록을 그대로 push |
| (c) | `MAX_SEARCH_CONTINUATIONS = 3` | `claude.ts:12` 상수 |
| (d) | `allowed_callers: ["direct"]` | `claude.ts:19` + 이유 주석 |
| (e) | thinking 미사용 | params에 `thinking` 없음 |
| (f) | `max_tokens = 4096` | `claude.ts:8`, 3경로 전부 사용 |
| (g) | structured outputs 미사용 · `extractJson` 재사용 | `truncated`를 3번째 인자로 전달해 잘림 복구까지 연결 |

부가: `pausedOut` 시 `console.warn`(§5.2 요구), `gemini.ts` dispatch 주석, `GenerateEmailResult` export 전환(타입 재정의 없음).

## 3. 파일 계획 / 범위 대조

**신규 5건 전부 존재.** `claude.ts`(167줄), `claude-parse.ts`(51줄), 테스트 3종. 200줄 규칙 위반 없음.

**"수정하지 않는다"고 명시한 파일 전부 무수정.** 안 A(변경 최소화)의 핵심 주장이 지켜졌고, 이 덕분에 B11~B13이 "기존 코드가 그대로 통과"로 성립한다.

**PLAN "범위 밖" 7항 침범 0건.**

## 4. 이번 사이클에서 수정한 잔여 결함 (Gap 지적 반영)

- **스테일 로그 2곳** — `auto-enrich.ts:38`, `auto-personalized-email.ts:129`의 `GEMINI_API_KEY missing` → `ANTHROPIC_API_KEY missing`. DESIGN §9 리스크 7(운영 env 누락 시 장애 지속)이 실현될 때 운영자가 보게 될 유일한 단서가 틀린 키 이름을 가리키고 있었다.
- **검증용 임시 파일 정리** — `.verify-tmp.ts`, `.verify-env.ts` 삭제.
- **B17 정정** — `passes:false` → `true`.

## 5. 미해결 이슈 — 기존 부채로 판정

### (1) `search.ts` 폴백의 usage 유실

검색 결과가 없는 소규모 회사에서 모델이 JSON 대신 설명문 반환 → `extractJson` throw → `search.ts:136-153`의 catch가 `usage: {0, 0}` 반환 → **실제 소비 토큰이 쿼터에 미집계**. 재현율 2/5("달인슈퍼"는 2/2 결정적).

**기존 부채 판정 근거**:
1. 문제의 폴백 블록은 `search.ts` 안에 있고 이 파일은 `git diff`에 없다. 마지막 커밋 `0bc8bf2`(2026-03-10, 5개월 전).
2. provider 무관한 결함이다. Gemini에서도 `extractJson`이 throw하면 동일하게 `usage:{0,0}`이 나온다. Claude 전환이 만든 게 아니라 **노출 빈도가 드러난** 것.
3. DESIGN §5.2가 이 동작을 알고 명시적으로 보존을 선택했다("기존 폴백 경로로 간다 — 기존 동작과 동일").
4. PLAN이 "실패 로그 미기록 — 관측성 개선은 별도 사이클"로 이미 범위 밖 선언.

**단, 리스크 프로파일이 달라졌으므로 다음 사이클 1순위로 인계.** Claude 검색 1회는 입력 21,000~32,000 토큰이다. flash-lite 시절보다 1회 누락의 금액 손실이 훨씬 크다.

### (2) senderPersona와 사용자 프롬프트 충돌 (실발송에서 발견)

`email.ts:114-115`의 페르소나 지시("자기소개를 '{이름} {직함}입니다' 형태로", "1인칭 사용")가 사용자 프롬프트의 고정 문구와 충돌한다. 규칙 42(`use_signature_persona=1`)에서 실제 발송 결과:

| | Gemini(기존) | Claude(신규) |
|---|---|---|
| 3번째 문장 | "백오피스랩은 평균 경력 7년 이상의 전문가가 **배정되어**…" | "**저는 백오피스랩의 김이삭 대표입니다. 제가 배정해드리는**…" |
| 문장 수 | 5문장(규칙 준수) | 4문장(회사 특징 문장 소실) |

**코드 변경이 만든 버그가 아니다.** 프롬프트가 원래 모순돼 있었고, 시스템 프롬프트(페르소나) vs 유저 프롬프트(고정 문구) 충돌 시 Gemini는 후자를, Claude는 전자를 따랐다. PLAN이 "프롬프트 모델별 튜닝"을 범위 밖으로 선언했으므로 이번 사이클에서 고치지 않는다.

**선택지**(사용자 판단 대기):
- A. 규칙별 `use_signature_persona`를 0으로 (DB만 변경, 코드 무수정) — 권장
- B. `email.ts` 페르소나 프롬프트 완화 (프롬프트 튜닝 = 범위 밖, 별도 사이클)
- C. 현행 유지 (문장 수·고정 문구 규칙 미준수 감수)

## 6. 집계

- 설계 항목: **17건**
- ✅ 구현: **16**
- ⚠️ 부분: **0**
- ❌ 누락: **1** (B15 — 배포 전이라 조회 불가, 정당)
- ➕ 설계 밖: **1** (`stripCitationTags` — 필수 수정)
- **unproven = 0** ✅

## 7. 배포 체크리스트

1. **CloudType에 `ANTHROPIC_API_KEY` 등록** — 누락 시 `getAiClient`가 null을 반환해 장애가 그대로 지속된다(DESIGN §9 리스크 7). 채팅에 노출된 키 대신 **재발급 권장**.
2. 코드 배포 (**DB 변경보다 먼저** — 운영 코드가 `claude` provider를 모르는 상태에서 DB만 바꾸면 `resolveModel`이 기본값으로 폴백).
3. 활성 규칙 6건의 `model`을 `claude-haiku-4-5`로 UPDATE (id 3·31·32·34·40·42, 전부 매치스플랜).
4. **B15 확인** — `SELECT provider, count(*) FROM ai_usage_logs WHERE created_at > now() - interval '1 hour' GROUP BY 1`
5. 첫 24시간 토큰 사용량 모니터링 (실측 건당 입력 ~20,000 / 출력 ~800).
6. 미발송분 재처리 검토 — 어제 1,391건 + 오늘 5,794건.
