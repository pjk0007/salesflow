# REVIEW 4 — Reply-To 걷어내기 (NHN 금지 헤더) 검증과 수정

- **사이클 ID**: 2026-10-04-no-reply-to (DESIGN-3-reply-to.md 6절 "실제 발송 결과(2026-10-04)와 바뀐 결정")
- **배경**: 9290217을 개발 서버(sendb-dev)에 올려 실제로 보내 보니, NHN이 사용자 지정 헤더 `Reply-To`를 금지 헤더로 거절했다 (`The 'customHeaders' contains an invalid name or body.`). 그래서 답장 받을 주소가 있는 사업의 메일이 모두 실패했다. 값을 비우자 12통 모두 성공했다(주소 3개에 4·4·4, 2통 미룸). 근거와 결정은 DESIGN-3 6절에 있다
- **목표 (안전 수정, 새 기능 없음)**: ① NHN이 막는 헤더를 어떤 경로로도 보내지 않고, 보내기 직전에 한 번 더 거른다 ② 워크스페이스 설정의 "답장 받을 주소" 칸을 빼고, 규칙 화면 안내를 MX 기준으로 바꾼다 ③ 템플릿 테스트 발송 창의 "답장 받을 주소 (사업)" 고르기를 뺀다 ④ 문서
- **방법**: 검증 보고(서버 없이 12/12 통과, 앱 버그 없음, (a)·(c)·(d)는 시험 DB·서버가 꺼져 실행하지 못함)와 리뷰에서 확인된 지적 4건(DOC-1·F1·F2·F3, 모두 독립 검증 3/3)을 처리했다. DOC-1과 F2는 같은 결함이다. 기각한 지적은 없다
- **결과**: 서버 없이 되는 검증 **12/12 통과** (고친 뒤 다시 돌림). 단위 시험 687/687, `tsc` 0, eslint 0, `next build` 성공. **(a) 발송 경로·(c) 대기열 시나리오·(d) 화면은 이번에도 실행하지 못했다** — 시험 DB(127.0.0.1:54329)와 시험 서버(localhost:3100)가 꺼져 있었고, 서버를 띄우거나 끄지 말라는 지시를 따랐다

## 바뀐 것 (9290217 대비)

### 1. NHN이 막는 헤더를 보내지 않는다

- **Reply-To 걷어냄**: `src/lib/email-reply-to.ts`를 지우고, `reply-to-rules.ts`의 `buildCustomHeaders`·`replyToHeaderValue`를 뺐다. 발송 경로(AI 첫 메일, AI·템플릿 후속, 템플릿 자동·반복, 수동 발송, 테스트 발송 세 곳, 미발송 다시 보내기 스크립트)가 워크스페이스 답장 주소를 읽지 않는다
- **수신거부 헤더는 바이트까지 그대로**: 발송 요청에 `customHeaders`를 싣는 곳은 5곳이고, 모두 9290217 전(ed2eee8)과 같은 줄 `{ customHeaders: buildListUnsubscribeHeaders(token) }`이다. `email-unsubscribe.ts`는 ed2eee8과 같다
- **보내기 직전 거르기** (`src/lib/nhn-email-headers.ts` 새 파일, `NhnEmailClient.sendEachMail`에서 부름)
  - NHN 콘솔 안내(사용자 지정 헤더)대로 거른다. 금지 이름 18개(대소문자 무관), 이름 형식(`[A-Za-z0-9-]{1,50}`), 값(빈 값, 1000바이트 초과, 줄바꿈·NUL), 대소문자만 다른 중복이 대상이다
  - 뺄 것이 없으면 받은 요청 객체를 그대로 보낸다. 그래서 요청 본문이 바이트까지 같다. 남는 헤더가 없으면 `customHeaders` 칸 자체를 싣지 않는다
  - 경고는 (이름, 까닭)마다 프로세스에서 한 번만 남기고(최대 200가지), 값은 적지 않는다. 수신거부 토큰이 로그에 남지 않게 하려는 것이다
  - NHN 발송 주소(`sender/eachMail`)를 부르는 곳은 `nhn-email.ts` 한 곳이고, `sendEachMail`을 부르는 10곳이 모두 이 거르기를 지난다

### 2. 화면

- **워크스페이스 설정**: "답장 받을 주소" 칸을 뺐다(`ReplyToEmailField.tsx` 삭제). `WorkspaceSettingsTab.tsx`·`useWorkspaceSettings.ts`·`src/types/index.ts`는 ed2eee8과 같아졌다
- **설정 API는 남김** (지시대로, 해가 없음): `GET`·`PATCH /api/workspaces/[id]/settings`의 `replyToEmail` 읽기·저장·형식 검사·MX 조회와 PATCH의 `requireAdmin`은 그대로다. 발송에는 쓰지 않는다. DB 칸 `workspaces.reply_to_email`도 남겼다(지우는 마이그레이션 없음)
- **AI 규칙 화면** (새로 만들기·수정)
  - 요약 칸: "답장 — 보낸 주소로 갑니다". 묶음에 MX 없는 도메인이 있으면 그 아래 노란 글 "받을 수 없는 도메인 N곳 — 발신 프로필 칸 참고"
  - 발신 프로필 칸 안내: "이 주소들은 답장을 받을 수 없습니다 — 도메인에 메일 수신(MX)을 연결해야 답장이 옵니다", MX 없는 도메인 목록, 그리고 끝 줄 "MX를 연결했다면 10분쯤 뒤 이 화면을 다시 열면 확인됩니다 (DNS 반영이 늦으면 더 걸릴 수 있습니다)."(F1). 워크스페이스 설정 링크는 없다
  - 파티션과 상관없어져 `partitionId` 인자를 뺐다 (`SenderPoolField`, `ReplyToSummaryRow`, `PoolReplyToNotice`, 두 페이지)
- **GET /api/email/reply-to**: 위 안내가 쓰므로 남겼다. `partitionId`·`workspaceId` 인자와 응답의 `workspace`를 뺐다. 응답은 `{ senders, pool, poolNoMxDomains }`이다

### 3. 템플릿 테스트 발송 창

- "답장 받을 주소 (사업)" 고르기와 `workspaceId` 인자를 화면·훅·API에서 뺐다. `EmailTestSendDialog.tsx`·`useEmailTestSend.ts`·`src/app/api/email/test-send/route.ts`는 ed2eee8과 같아졌다

### 4. 남긴 것 (맞게 동작, 그대로)

- `email_send_logs.sender_email` (보낼 때 주소 저장), 반복 대기열에서 `first`를 `first_bulk`보다 먼저 꺼내기 (DESIGN-3 4-1절)

## 검증

| 묶음 | 결과 | 내용 |
|---|---|---|
| 코드 훑기 | 4/4 | `customHeaders` 싣는 5곳 모두 수신거부 헤더뿐 · 코드에 헤더 이름 `Reply-To` 0곳(주석·시험·금지 목록 말고) · 지운 모듈을 부르는 곳 0 · `sender/eachMail`은 한 곳이고 거르기를 지남 |
| 관련 단위 시험 4파일 | 42/42 | `nhn-email-headers`·`reply-to-rules`·`email-mx-lookup`·`replyTo` (검증 때 3파일 32개 → MX 조회 파일과 F1 시험 추가) |
| NHN 클라이언트 (가짜 NHN, DB 안 씀) | 7/7 | C0 대조(거르기 없이 Reply-To → 실제 NHN과 같은 문구로 거절) · C1 수신거부만(본문 바이트까지 같음, 경고 0) · C2 Reply-To 섞임 ×3(모두 성공, 경고 1번, 값 없음) · C3 금지 이름 18개 · C4 금지 헤더만(`customHeaders` 칸 없음) · C5 헤더 없는 요청 · C6 틀린 이름·값 4개(경고 4줄) |
| 전체 단위 시험 | 687/687 | `TSX_DISABLE_CACHE=1 tsx --test "src/**/*.test.ts"` |
| (a) 모든 발송 경로 (모든 워크스페이스에 답장 주소가 있을 때) | **실행 못 함** | 시험 DB 꺼짐 |
| (c) 대기열 시나리오 S1~S9·S3A·S5 (`ux/queue-scenarios.mjs`) | **실행 못 함** | 시험 DB 꺼짐 |
| (d) 화면 (설정 칸 없음, 규칙 화면 답장 줄·MX 안내, 테스트 발송 창) | **실행 못 함** | 시험 DB·서버 꺼짐 |

- 실행: 2026-10-05 00:06 KST (고친 코드 그대로). 결과 `F:/Temp/sendb-testenv/ux/noreplyto-results.md`·`.json`, 실행 기록 `ux/noreplyto-logs/`(`unit.log`, `nrt-client.log`, `unit-all-review4.log`, `tsc-review4.log`, `eslint-review4.log`, `next-build-review4.log`). 고치기 전 결과는 `noreplyto-results.before-review4.*`에 있다
- 간접 근거: 이번 변경 뒤의 발송 헤더는 9290217에서 답장 주소를 비웠을 때와 같다(Reply-To 없음, 수신거부 두 줄). 그 상태로 개발 서버 실제 발송 12통이 모두 성공했다
- 검증 스크립트 `ux/noreplyto-scenarios.mjs`를 고쳤다: 단위 묶음에 `email-mx-lookup.test.ts`를 넣었고, (d) 규칙 A 판정에 F1 끝 줄 문구를 더했다. (d)는 실행하지 못해 이 판정도 아직 돌지 않았다

## 확인된 지적과 처리

| 지적 | 심각도 | 내용 | 처리 | 확인 |
|---|---|---|---|---|
| DOC-1 = F2 | 하 | DESIGN-3에 실제 발송 결과 절과 REVIEW-4가 없는데 코드 주석 4곳이 그 절을 가리켰다. 지시대로 "5."를 붙이면 기존 "5. behavior"와 번호가 겹친다. 1·3절과 R1·R2·R6은 Reply-To를 지금 동작처럼 적고 있었다 | DESIGN-3 끝에 **6절** "실제 발송 결과(2026-10-04)와 바뀐 결정"을 덧붙였다 (6-1 무슨 일 · 6-2 NHN 근거와 금지 목록 · 6-3 바뀐 결정 · 6-4 behavior 다시 정리, R9·R10 추가). 머리말·1·2·3·4절에 철회·바뀜 표시를 달고, R1·R3은 철회, R6은 바뀜으로 표시했다. 주석 4곳(`nhn-email-headers.ts`, `reply-to-rules.ts`, `reply-to/utils/replyTo.ts`, `api/email/reply-to/route.ts`)은 `6절 "실제 발송 결과(2026-10-04)와 바뀐 결정"`으로 맞췄다. 이 문서도 썼다 | 주석이 가리키는 제목이 문서에 있음(grep) |
| F1 | 중 (검증 표: 하~중) | MX "없음" 결과를 하루 캐시해서, 안내대로 MX를 연결해도 최대 24시간(또는 서버를 다시 띄울 때까지) 경고가 남았다. 이번 변경으로 MX 연결이 유일한 해결책이 되면서 드러났다 | `none`도 10분만 캐시한다 (`MX_NONE_TTL_MS`, `ok`는 하루 그대로, `unknown`은 10분 그대로). 안내 상자 끝에 "MX를 연결했다면 10분쯤 뒤 이 화면을 다시 열면 확인됩니다 (DNS 반영이 늦으면 더 걸릴 수 있습니다)."를 더했다. 문구의 분은 상수에서 만든다 | 새 단위 시험: 없음 → MX 연결 → 9분 뒤 아직 없음(조회 1번) → 11분 뒤 ok(조회 2번) → ok는 다시 하루 캐시. 캐시 기간 시험과 끝 줄 문구 시험도 고쳤다 |
| F3 | 하 | 알림톡 발송 이력 표(`SendLogTable.tsx`, followup 이름표와 모르는 값 그대로 보이기)와 통합 로그 거르기(`UnifiedLogTable.tsx`, "템플릿 후속")의 변경이 "새 기능 없음" 안전 수정과 같은 작업 트리에 섞여 있다 | **되돌리지 않고 커밋 범위에서 뺐다** (아래 "커밋 범위"). 두 파일의 수정 시각(22:15)은 9290217(18:47) 뒤, 이 작업(23:2x) 앞이다. 내용은 REVIEW-3 "아직 확인하지 못한 것"의 알림톡 "방식" 칸 항목을 고친 것으로 보인다. 이 작업이 만든 변경이 아니어서, 되돌리면 다른 작업을 잃는다 | 두 파일은 이번 검증 대상이 아니다. 전체 `tsc`·eslint·빌드는 두 파일을 포함한 채 통과했다 |

## 제안·지시와 다르게 한 것

- **DESIGN-3 절 번호 6**: 지시 문구는 "5. 실제 발송 결과…"였지만, 문서에 이미 "## 5. behavior"가 있다. 번호가 겹치지 않게 6으로 붙였다. 기존 5절 번호를 바꾸지 않은 까닭은, 다른 문서·주석이 절 번호로 가리키는 것을 흔들지 않으려는 것이다
- **F1에 "다시 확인" 버튼은 두지 않음**: 화면은 SWR이라 창을 다시 누르거나 화면을 다시 열면 다시 읽는다. 서버 캐시만 짧으면 된다. 버튼을 달면 새 기능이 된다
- **F3 되돌리지 않음**: 위 표의 까닭 그대로다. 같은 커밋에 넣지 않으면 리뷰 지적의 목적(안전 수정 범위를 깨끗하게)은 이뤄진다
- **설정 GET의 MX 조회 (검증 보고 관찰, 사소)**: 그대로 두었다. 지시가 "해가 없으면 그대로"를 허용했고, 답장 주소 값이 있는 워크스페이스만 조회한다. 운영에는 아직 이 칸이 없고(0073 미적용), 생기더라도 모두 NULL로 시작해 조회가 없다. 값이 남은 워크스페이스도 이제 `none`은 10분, `ok`는 하루에 한 번 묻는 정도다

## 관문 (수정 뒤, 2026-10-05 00:04~00:06 KST)

- 단위: `TSX_DISABLE_CACHE=1 tsx --test "src/**/*.test.ts"` → 687 통과, 실패 0
- `tsc --noEmit --incremental false` → 종료 코드 0
- eslint (`node_modules/.bin/eslint`): 바뀐·새 ts/tsx 38개 + 하네스 `.testenv/nrt-app.ts`·`nrt-client.ts` → 문제 0
- `next build` (`DATABASE_URL=postgres://build:build@127.0.0.1:1/build`, `JWT_SECRET=build-only-dummy`, `NEXT_TELEMETRY_DISABLED=1`) → 성공, 페이지 161개
- 줄 끝: CRLF였던 파일은 CRLF 그대로다(예: 설정 라우트 CR 161개 = 줄 161개). LF였던 파일은 LF, 새 파일(`nhn-email-headers.ts`·`.test.ts`, 이 문서)은 LF다
- 바깥 요청 없음: MX는 가짜 조회만 썼고, NHN은 가짜 NHN만 썼다. 커밋·푸시·서버 조작은 하지 않았다

## 커밋 범위

- **이 안전 수정에 넣을 파일** (`git status` 기준, 아래 두 파일 말고 전부)
  - 문서: `docs/2026-10-02-sender-warmup/DESIGN-3-reply-to.md`, `docs/2026-10-02-sender-warmup/REVIEW-4.md`(새)
  - 발송: `scripts/resend-unsent.ts`, `src/app/api/email/auto-personalized/test-followup/route.ts`, `src/app/api/email/auto-personalized/test-send/route.ts`, `src/app/api/email/send/route.ts`, `src/app/api/email/test-send/route.ts`, `src/lib/auto-personalized-email.ts`, `src/lib/email-automation.ts`, `src/lib/email-followup.ts`, `src/lib/email-send-queue.ts`, `src/lib/record-import.ts`, `src/lib/nhn-email.ts`, `src/lib/nhn-email-headers.ts`(새), `src/lib/nhn-email-headers.test.ts`(새), `src/lib/email-reply-to.ts`(삭제)
  - 답장 규칙·MX: `src/lib/reply-to-rules.ts`, `src/lib/reply-to-rules.test.ts`, `src/lib/email-mx-lookup.ts`, `src/lib/email-mx-lookup.test.ts`, `src/lib/db/schema.ts`(주석만)
  - API·화면: `src/app/api/email/reply-to/route.ts`, `src/app/api/workspaces/[id]/settings/route.ts`(주석만), `src/app/email/ai-auto/[id]/page.tsx`, `src/app/email/ai-auto/new/page.tsx`, `src/components/email/EmailTestSendDialog.tsx`, `src/components/email/hooks/useEmailTestSend.ts`, `src/components/email/reply-to/` 아래 9개(`ReplyToEmailField.tsx` 삭제 포함), `src/components/email/sender-profiles/ui/SenderPoolField.tsx`, `src/components/settings/WorkspaceSettingsTab.tsx`, `src/hooks/useWorkspaceSettings.ts`, `src/types/index.ts`
- **따로 커밋할 파일 (F3)**: `src/components/alimtalk/SendLogTable.tsx`, `src/components/logs/UnifiedLogTable.tsx`

## 남은 것

1. **(a)·(c)·(d) 실행**: 시험 DB와 시험 서버를 미리보기 실행기(세션 스크래치 `.claude/launch.json`의 `test-postgres`, `sendb-test`)로 띄운 뒤 `cd F:/Temp/sendb-testenv/ux && node noreplyto-scenarios.mjs`를 돌린다. 3100 서버가 `mock-fetch.mjs`를 고치기 전에 떴으면 앞에 `RT_NOLOGIN=1`을 붙인다. 스크립트가 끝에 시드를 다시 넣는다. (a)는 모든 워크스페이스에 답장 주소를 넣고 모든 경로의 헤더에 `Reply-To`가 없는지, 그리고 9290217 빈 값 단계(`replyto-results.json`)와 경로·받는 사람별로 같은지 본다
2. **개발 서버는 아직 9290217이다**: 이 변경을 dev에 올리기 전까지는 sendb-dev 워크스페이스 설정의 "답장 받을 주소"를 **비워 두어야 한다**. 값이 있으면 그 사업의 메일이 모두 실패한다. 올린 뒤에는 화면에서 칸이 사라지고, 값이 남아 있어도 발송에 쓰이지 않는다
3. **올린 뒤 실제 확인**: 개발 DB에는 실제 고객 데이터가 있으니, 대표 확인을 받고 받는 사람을 정해 몇 통 보내 본다. 실패 0인지, 받은 메일에 `List-Unsubscribe`가 있는지 본다
4. **답장을 받으려면 — 대표가 정할 일 (DESIGN-3 6-3, 3-B)**: 지금 발신 도메인 20개 중 메일을 받는 곳은 `matchesplan.com`뿐이다. 나머지 도메인 주소로 나간 메일에 고객이 답장하면 되돌아가고, 우리는 모른다. 받으려면 도메인마다 두 가지가 필요하다
   - DNS에 메일 수신(MX) 레코드를 연결한다. 이때 NHN 발송용 SPF·DKIM 레코드는 그대로 둔다
   - Google Workspace에 그 도메인을 도메인 별칭으로 붙여(도메인 확인용 TXT 레코드 포함), 계정 하나가 받게 한다
   - 대표가 정할 것: ① 어느 도메인부터 붙일지(전부, 또는 지금 규칙 묶음에 쓰는 도메인만) ② 답장을 어느 메일함에서 볼지(사업별 담당, 또는 한 곳) ③ DNS와 Google Workspace 관리자 권한을 누가 가지고 있는지. 비용과 별칭 수 한도는 붙이기 전에 Google Workspace 관리 콘솔에서 확인한다
   - 붙이고 나면 규칙 화면의 노란 안내가 10분 안에 그 도메인부터 사라진다 (F1)
5. **설정 API에 남은 답장 주소**: 칸·API·`requireAdmin`은 지시대로 남겼다. 3-B로 가면 쓸 일이 없으니, 나중에 지울지 정한다 (지우려면 마이그레이션이 필요하다)

## 추가 실행 — 시험 DB·서버를 다시 띄운 뒤 (2026-10-05 00:12~00:18 KST)

시험 DB(54329)와 시험 서버(3100)를 다시 띄웠다. 서버가 새 가짜 NHN(금지 헤더가 하나라도 있으면 실제 NHN과 같은 문구로 메일 전체를 거절)을 불러온 것을 확인한 뒤 `ux/noreplyto-scenarios.mjs`를 돌렸다. 발송 경로 판정 스크립트(`.testenv/nrt-app.ts`)에 없는 칸 이름(`error_message` → `result_message`)을 쓴 하네스 오류가 있어 고친 뒤 (a)만 다시 돌렸다.

| 묶음 | 결과 |
|---|---|
| (a) 모든 발송 경로 — 워크스페이스 4곳 모두 `reply_to_email` 값이 있는 채로 | **27/27 통과** — 11가지 경로 28통 모두 성공, Reply-To·금지 헤더 0통, 가짜 NHN 거절 0건, 수신거부 헤더는 9290217 검증의 빈 값 단계와 이름·순서·모양이 같음, `sender_email` = 실제 From 21줄 |
| (c) 대기열 시나리오 S1~S9·S3A·S5 | **10/10 통과** (주 판정 전부, 추가 판정 실패 0) |
| (d) 화면 | **8/8 통과** — 설정에 답장 칸 없음(DB 값이 있어도), 저장 요청에 replyToEmail 없음, 규칙 요약 "답장 보낸 주소로 갑니다" + MX 없는 도메인 안내, 테스트 발송 창 사업 고르기 없음, 화면 테스트 발송에 Reply-To 없음 |
| 합계 | **57/57 통과** (코드 훑기·단위 포함) |

결과: `F:/Temp/sendb-testenv/ux/noreplyto-results.md`, `noreplyto-results.json`, 실행 기록 `noreplyto-run-final.log`, `noreplyto-run-paths.log`. 끝난 뒤 시험 DB는 시드 상태로 다시 넣었다.

커밋 범위: 위 변경만. `src/components/alimtalk/SendLogTable.tsx`, `src/components/logs/UnifiedLogTable.tsx`의 작업 트리 수정은 다른 작업(알림톡 발송 이력 방식 이름표)의 것이라 이 커밋에 넣지 않는다.
