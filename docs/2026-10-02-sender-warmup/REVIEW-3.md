# REVIEW 3 — 사업별 답장 받을 주소(Reply-To) 검증과 수정

- **사이클 ID**: 2026-10-04-reply-to (DESIGN-3-reply-to.md, 4-1절의 DESIGN-2 남은 두 가지 포함)
- **방법**: 로컬 시험 환경에서 R1~R8을 실제 앱 코드 경로로 돌린 검증 보고(판정 113개 통과, 앱 결함 후보 1건·관찰 2건) + 리뷰 확인 지적 3건(F1·F2·RT-AUTH-1, 모두 독립 검증 3/3 확인) → 모두 고침. F1과 RT-AUTH-1은 같은 결함이다. 검증 보고의 관찰 2(발송 이력 "방식" 칸 영어)도 고쳤다. 고친 뒤 하네스에 판정 8개를 더하고 두 하네스(답장 주소·대기열)를 모두 다시 돌렸다
- **결과**: 답장 주소 판정 **121/121 통과** (검증 때 113 + 새 판정 8, 남은 관찰 0). 대기열 시나리오 10개 모두 시도 1번에 주 판정·추가 판정 통과 (REVIEW-2와 같은 수). 단위 시험 687/687, `tsc` 0, eslint 0, `next build` 성공
- **바뀐 계약**: `PATCH /api/workspaces/[id]/settings`가 `requireAdmin`(DB의 현재 역할·`token_version`)을 거친다. 지금 관리자(owner·admin)는 그대로 200, 멤버는 그대로 403. 강등된 뒤의 옛 토큰과 조직에서 빠진 사람의 토큰은 401이 된다 (예전엔 200). `GET`과 응답 모양은 그대로다
- 기각한 지적은 없다

## 검증한 것

- **환경**: 로컬 시험 환경만 썼다 — 내장 Postgres `127.0.0.1:54329/salesflow_test`, 가짜 NHN·AI(`.testenv/mock-fetch.mjs`, 가짜 NHN이 받은 `customHeaders`는 `mock-log.jsonl`에 남는다). 바깥 요청 0건, 가짜 NHN 거절 0건. 시험 서버 `localhost:3100`은 화면 코드(HTML·JS)를 받는 데만 썼고 띄우거나 끄지 않았다. 개발·운영 서버와 CloudType은 건드리지 않았다
- **로그인하지 않음**: 이 작업은 사용자 대화가 아니라 실행 스크립트가 시킨 것이라 시험 계정 비밀번호로 로그인하지 않았다. 검증 때와 같이 앱 API 라우트(`route.ts`)를 하네스 프로세스에서 그대로 부르고, 로그인 확인 함수 `getUserFromNextRequest` 하나만 시드 사용자를 돌려주게 바꿔 끼웠다 (`.testenv/rt-stub.ts`). `requireAdmin`·입력 검사·DB·발송은 앱 코드 그대로다. 화면이 부르는 `/api/*`도 같은 프로세스로 돌렸다 (`ux/rt-nologin.mjs`, 화면 쪽 요청 100건 모두 200). 대기열 시나리오의 S3A·S5도 `RT_NOLOGIN=1`로 같은 방식으로 돌렸다
  - "옛 토큰"은 하네스가 토큰 내용(JWT payload)을 직접 만들어 넣었다: 강등 = 멤버 계정을 역할 admin·옛 `token_version`으로, 조직에서 빠짐 = 조직 A의 orgId·역할 admin을 단 다른 조직 사용자(조직 A에 멤버십 줄 없음)
- **MX 조회**: 진짜 DNS로 묻지 않았다. 앱의 `setMxResolverForTests`로 가짜 답(`matchesplan.com` 있음, `matchesplan.me` 없음, `slow-dns.co.kr` 답 없음)만 넣었고, 진짜 조회 함수가 불린 횟수는 0이다
- **단계 3개** (단계마다 시드를 다시 넣음): empty(모두 비움, 지금과 같은 동작의 기준) / mixed(A·C만 정함) / set(A·B·C·다른 조직 OB 모두 다른 값 + 설정 API·프로필 주소 바꾸기)
- **경로**: AI 첫 메일(레코드 생성 API·가져오기 → 발송 대기열 워커), AI·템플릿 후속(후속 워커), 템플릿 자동 첫 메일(레코드 생성 API), 템플릿 반복·미뤄 둔 첫 메일(반복 대기열 워커), 수동 발송 API, 테스트 발송 API(AI·AI 후속·템플릿), 저장된 값에 줄바꿈이 든 경우(헤더 주입 거르기)
- **시험 설비 조정 (판정과 무관, 검증 때와 같음)**: 일요일 저녁이라 단계마다 웜업 주소1의 평일·시간대 제한을 풀고 웜업 주소2 한도를 5→50으로 올렸다. 그대로면 규칙 A의 대기열·후속 메일이 나가지 않는다. 끝난 뒤 시험 DB는 시드 상태로 다시 넣었다

## 결과 (최종: 2026-10-04 18:35~18:37 KST)

| 묶음 | 판정 | 메일 | 내용 |
|---|---|---|---|
| empty 단계 | 26/26 | 28통 | 모든 경로에서 Reply-To 헤더 없음, 헤더 모양은 지금(ed2eee8)과 같음 |
| mixed 단계 | 26/26 | 28통 | 한 회차·한 요청에 워크스페이스가 섞여도 비운 곳엔 헤더 없음, 정한 곳엔 제 값 |
| set 단계 | 45/45 | 29통 | 검증 때 41 + 새 4 (옛 토큰 401, 옛 토큰으로 이름만 401, 조직에서 빠진 토큰 401, 지금 관리자가 이름만 저장 200) |
| 단계 사이 (R6) | 2/2 | 28통 × 2 | set·mixed와 empty: 같은 경로·같은 받는 사람의 헤더가 Reply-To 말고 같음 |
| 화면 | 22/22 | 24장 | 검증 때 18 + 새 4 (파티션을 바꾼 직후 3, 발송 이력 "방식" 칸 1) |
| **합계** | **121/121** | 85통 + 화면 테스트 발송 2통 | 관찰 0 (검증 때 관찰 1건 = F1) |

| ID | 판정 | 근거 |
|---|---|---|
| R1 | 통과 | 답장 주소가 있는 워크스페이스로 간 메일 모두 Reply-To = 받는 레코드(테스트 발송은 고른 사업)의 워크스페이스 값. 경로 11가지 모두 |
| R2 | 통과 | 비었으면 헤더 없음. 테스트 발송 창에서 "고르지 않음"도 헤더 없음 |
| R3 | 통과 | 다른 워크스페이스·다른 조직의 값이 들어간 메일 0통. 다른 조직 사업을 고른 테스트 발송 404, 다른 조직 워크스페이스 설정 PATCH 404 |
| R4 | 통과 | 형식 아님·줄바꿈·쉼표 둘·201자·문자열 아님 5종 400. MX 없는 도메인은 저장 + `mx: "none"` + 경고, 답 없는 DNS는 2.5초 안팎에 `unknown` |
| R5 | 통과 | 멤버 403, admin 역할 200, **강등 뒤 옛 토큰 401·조직에서 빠진 토큰 401 (값 그대로)**, 같은 옛 토큰의 발신 한도 PUT도 401 |
| R6 | 통과 | 수신거부 헤더가 붙던 메일(61통)에 `List-Unsubscribe`·`List-Unsubscribe-Post` 그대로, `customHeaders`에 다른 헤더·Bcc 없음 |
| R7 | 통과 | 발송 로그 64줄 모두 `sender_email` = 가짜 NHN이 받은 From. 프로필 주소를 바꾼 뒤 바뀐 줄 0, 발송 이력 화면·상세도 보낼 때 주소, 옛 로그는 "(현재 프로필)" |
| R8 | 통과 | 세 단계 모두 반복 대기열이 `first` → `first_bulk` → `first_bulk`(id 순) |

- 결과 원본 `F:/Temp/sendb-testenv/ux/replyto-results.json`, 실행 기록 `ux/replyto-review3-run.log`·`ux/replyto-logs/`, 화면 `F:/Temp/sendb-testenv/shots/replyto/`. 검증 때 결과는 `ux/replyto-results.before-review3.json`·`shots/replyto.before-review3/`, 검증 보고서는 `ux/replyto-results.md`

## 대기열 시나리오 다시 돌리기 (2026-10-04 18:37~18:41 KST, 모두 시도 1번)

| 시나리오 | 주 판정 | 추가 판정 |
|---|---|---|
| S1 주소 3개(한도 4·4·없음) 돌아가며 | 18/18 | — |
| S2 한도 10, 오전 대량 → 9통 + 15:00 뒤 10통째 | 13/13 | 2/2 |
| S3 대량이 대량 몫을 쓴 뒤 문의 2건 | 16/16 | 3/3 |
| S3A 실제 앱 API로 만든 문의 2건 (로그인 없이) | 16/16 | — |
| S4 대량 15통 밀림 + 다음 날 25통 → FIFO | 17/17 | 5/5 |
| S6 한도 없는 주소만 | 10/10 | 2/2 |
| S7 고르게 + 대량 대기 + 문의 | 12/12 | — |
| S8 규칙 둘 — 선입선출 하한 | 14/14 | — |
| S9 템플릿 첫 메일 가져오기 = 대량 | 14/14 | — |
| S5 3일치 경고 + 실제로 흘려 보기 (로그인 없이) | 20/20 | 2/2 |

- 숫자는 REVIEW-2 최종 실행·검증 때 실행과 같다. 가짜 시계는 끝나고 되돌렸다 (`scheduled_at` 기본값 `now()`, 시계 스키마 없음 — 확인함)
- 결과 원본 `F:/Temp/sendb-testenv/ux/queue-policy-results.json`, 실행 기록 `ux/queue-policy-review3-run.log`. 바로 전 결과는 `ux/queue-policy-results.before-review3.json`

## 확인되어 고친 것

| 지적 | 심각도 | 내용 | 고친 방법 | 시험 |
|---|---|---|---|---|
| F1 = RT-AUTH-1 (검증 보고 결함 1) | 중 (검증 6표 중 5표 중, 1표 상) | 설정 PATCH가 JWT에 적힌 역할만 봐서(`user.role === "member"`만 403), 강등되거나 조직에서 빠진 관리자의 옛 토큰(30일)으로도 답장 받을 주소를 바꿀 수 있었다. 그러면 그 사업으로 나가는 모든 메일의 고객 답장이 그 사람 메일함으로 가고, 저장된 값이라 토큰이 끝나도 남는다. 같은 토큰으로 발신 한도는 이미 401이었다 | PATCH 맨 앞에서 `requireAdmin(req)`. 실패면 그 상태(401·403)와 메시지를 그대로 돌려주고, 조직 범위는 그 결과(`auth.user`)의 orgId로 본다. `token_version`이 없는 옛 토큰은 DB 버전이 0이면 예전처럼 통과한다(`isTokenVersionAcceptable`) | set 단계 새 판정 4개: 옛 토큰으로 답장 주소 401·값 그대로(대조: 발신 한도 PUT 401), 같은 옛 토큰으로 이름만 401·이름 그대로, 조직에서 빠진 토큰 401·값 그대로, 지금 관리자가 `replyToEmail` 없이 이름만 보내면 200·답장 주소 그대로. 기존 R5(멤버 403, admin 역할 200, 다른 조직 404)와 화면 저장(관리자)도 그대로 통과 |
| F2 | 하 | 답장 상태 훅(`useReplyToStatus`)의 `keepPreviousData: true` 때문에, AI 규칙 화면에서 다른 워크스페이스의 파티션으로 바꾼 직후 새 응답이 올 때까지 이전 워크스페이스의 답장 줄·발신 묶음 안내·설정 링크가 남아 보였다. 발송은 레코드의 워크스페이스로 정해져 화면만 틀린다 | 옵션을 뺐다. 창 포커스로 같은 키를 다시 읽을 때 이전 값이 유지되는 것은 SWR 기본 동작이라 주석에 적은 목적은 그대로다. 키가 바뀌면 `data`가 비어 `loaded=false`("—")로 가린다 | 새 화면 판정 3개: A(답장 주소 비움) → B(ceo@matchesplan.com)로 바꾸고 B 요청만 브라우저에서 5초 늦춰 그 사이 화면을 읽는다. **고치기 전 코드**(옵션을 잠시 되살려 돌림)로는 1.2초 시점에 A의 "없음 — 답장이 발신 주소로 갑니다"와 A 설정 링크(`workspaceId=1`)가 보여 실패, 고친 뒤 1.7초 시점에 "—"·안내 없음·링크 없음, 응답 뒤 "ceo@matchesplan.com"으로 통과 |
| 검증 보고 관찰 2 | 하 (ed2eee8부터) | 발송 이력 "방식" 칸에 템플릿 후속(`followup`)·AI 후속 테스트 발송(`test_followup`)이 영어 그대로 보였다 (`TRIGGER_TYPE_MAP`에 없음) | 이메일 발송 이력 표와 통합 로그 표의 이름표에 `followup` → "템플릿 후속", `test_followup` → "후속 테스트"를 더했다. 이메일 발송 이력의 방식 거르기에도 "템플릿 후속"을 더했다 (`ai_followup` "후속발송"은 그대로) | 새 화면 판정 1개: 표에 "템플릿 후속"·"후속 테스트"가 보이고 영어 값 0개, 거르기에 "템플릿 후속" |

- 고치기 전 F2 결과: `F:/Temp/sendb-testenv/ux/replyto-f2-before-fix.json`, 화면 `shots/replyto/16-…before-fix.png`·`16b-…before-fix.png`·`17-…before-fix.png`. 되살린 옵션은 실행 직후 고친 상태로 되돌렸고, 그 뒤의 최종 실행·관문은 모두 고친 코드로 했다
- `DESIGN-3-reply-to.md` 2절 권한 줄과 R5를 바뀐 동작에 맞췄다 (DB 역할·`token_version`으로 확인, 옛 토큰 401)

## 제안과 다르게 고친 것·고르지 않은 것

- **F1 — PATCH 전체에 `requireAdmin`**: 제안의 두 번째 안(`replyToEmail`이 있을 때만)은 쓰지 않았다. 이 라우트는 원래 관리자 전용(멤버 403)이라 지금 관리자에게는 달라지는 것이 없고, 이름·코드 접두어·기본 필드 형식도 관리자 설정이라 강등된 사람이 옛 토큰으로 바꿀 이유가 없다. 달라지는 것은 강등·조직에서 빠진 사람이 401을 받는 것과 요청마다 DB 조회 1번뿐이다
- **설정 GET은 그대로**: 읽기만 하고, JWT 역할만 보는 방식은 저장소의 일반 데이터 라우트 전체에 쓰이는 기존 패턴이다(`auth-admin.ts` 주석). 강등된 사람이 30일 안에 답장 주소를 "볼" 수는 있지만 바꿀 수는 없다. 범위 밖이라 남겼다
- **F2 — 응답에 partitionId를 싣지 않음**: SWR은 키(파티션)별로 `data`를 돌려주므로 옵션만 빼면 된다

## 관문 (수정 뒤)

- `TSX_DISABLE_CACHE=1 tsx --test "src/**/*.test.ts"`: 687 통과, 실패 0. 이번 수정에는 새 순수 로직이 없다 (라우트의 권한 함수 호출, SWR 옵션 하나, 이름표 두 줄) — 대신 위 하네스 판정 8개로 확인했다. R1~R8의 순수 로직 시험(`reply-to-rules`·`email-mx-lookup`·`logSender`·`email-send-queue-rules` 등)은 그대로 통과
- `tsc --noEmit --incremental false`: 종료 코드 0 (`.testenv`·`scripts` 포함)
- `eslint` 바뀐·새 ts/tsx 65개 + 하네스 `.testenv/rt-app.ts`·`rt-stub.ts`: 문제 0
- `next build` (`DATABASE_URL=postgres://build:build@127.0.0.1:1/build`, `JWT_SECRET=build-only-dummy`): 성공 (페이지 161개). 빌드 뒤 개발 서버(3100) 정상 응답
- 줄 끝: 이번에 고친 파일 중 CRLF였던 세 파일(설정 라우트, 발송 이력 표, 통합 로그 표)은 CRLF, LF였던 훅은 LF 그대로. 새 파일(이 문서)은 LF

## 바뀐 파일 (이번 수정)

- `src/app/api/workspaces/[id]/settings/route.ts` — PATCH가 `requireAdmin` (F1)
- `src/components/email/reply-to/hooks/useReplyToStatus.ts` — `keepPreviousData` 뺌 (F2)
- `src/components/email/EmailSendLogTable.tsx`, `src/components/logs/UnifiedLogTable.tsx` — "방식" 이름표 (관찰 2)
- `docs/2026-10-02-sender-warmup/DESIGN-3-reply-to.md` (2절 권한, R5), 이 문서
- 시험 환경(저장소 밖·git 제외): `.testenv/rt-app.ts` (관찰 1건 → 판정 4개), `F:/Temp/sendb-testenv/ux/replyto-scenarios.mjs` (F2 화면 판정과 `f2` 단독 실행, "방식" 칸 판정)

## 아직 확인하지 못한 것

- **NHN이 Reply-To를 실제로 받아 주는가**: 모든 확인은 가짜 NHN으로 했다. NHN 문서에 사용자 지정 헤더(`customHeaders`) 칸은 있지만 Reply-To 허용은 적혀 있지 않다. 개발 서버 14곳 실제 발송 시험에서 시험 파티션의 워크스페이스 답장 주소를 `ceo@matchesplan.com`으로 두고, 받는 분 한 명이 시험 메일에 답장해 그 답장이 ceo@matchesplan.com에 도착하는지 본다. NHN이 헤더를 거절하거나 지우면 DESIGN 3-B(워크스페이스 계정 1개 + 도메인 별칭)로 간다. 실행 전 대상 주소와 규칙을 대표에게 보여 드려야 한다
- **3100 서버 안의 API 처리와 실제 로그인·쿠키 흐름**: 로그인하지 않아 거치지 않았다. 라우트 코드는 같고, 다른 것은 Next 런타임이 라우트를 감싸는 부분과 진짜 JWT 서명·만료 확인이다
- **실제 DNS MX 조회**: 가짜 답만 썼다. 참고로 하네스 울타리(`mock-fetch.mjs`)는 TCP만 막아, 시험 서버(3100)로 답장 주소를 저장하면 실제 공개 DNS 조회가 나간다
- **멤버에게 보이는 답장 주소 칸의 읽기 전용 상태** (검증 관찰 3): 멤버는 워크스페이스 설정 화면에 들어가지 못해 화면에서 볼 수 없다. 동작상 문제는 아니라 그대로 두었다
- **알림톡 발송 이력의 "방식" 칸** (범위 밖, 이번에 발견): 알림톡 후속 발송 로그(`trigger_type='followup'`)가 알림톡 표(`src/components/alimtalk/SendLogTable.tsx`)에서는 이름표가 없어 목록에서 "수동"으로 보인다 (`|| TRIGGER_TYPE_MAP.manual`). ed2eee8부터 있던 것이고 이메일·답장 주소와 무관해 고치지 않았다
- **개발·운영 서버**: 커밋·푸시 없음. 0073은 시험 DB 말고 어디에도 적용되지 않았다
