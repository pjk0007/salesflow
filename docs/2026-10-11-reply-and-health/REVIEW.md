# 회신 받기·발신 건강 — 검증 결과와 검토 반영 (2026-10-11)

- **범위**: `DESIGN-RPL.md`(회신 받기)·`DESIGN-SND.md`(발송 결과 맞추기·발신 건강) 구현을 로컬 시험 환경에서 통합 검증하고, 검증 보고서의 앱 문제 1개와 검토에서 확정된 지적 22개(RH-SEC 6·F 8·OPS 8)를 고쳤다
- **저장소**: `F:/Dev/salesflow` dev, HEAD `630058a` 그대로. **커밋·push·git add·stash 하지 않음** (대표 승인 뒤 메인 세션이 커밋)
- **시험 환경**: 시험 DB `127.0.0.1:54329/salesflow_test`, 시험 서버 `localhost:3100`, 가짜 Gmail·NHN·구글 챗·Anthropic(`.testenv/mock-fetch.mjs`). 개발 DB·운영 DB·실제 외부 서비스는 쓰지 않았다
- **원자료**: `F:/Dev/sendb-testenv/ux/reply-health-results.md`(고친 뒤), `reply-health-results.before-fixes.md`(고치기 전), 실행 기록 `ux/reply-health-logs/`
- **이어진 작업 — 구글 챗 알림 QA (같은 날)**: 깊이·회신·회신 운영·발송 건강·웹훅 문제 알림의 구글 챗 전달을 따로 QA하고 고쳤다. 찾은 것·고친 것·켜기 전 확인·대표 결정은 `CHAT-QA.md` (마이그레이션 `0076_chat_alert_delivery.sql`, 새 환경 변수 `GOOGLE_CHAT_REQUEST_ID`·`GOOGLE_CHAT_THREADS`·`DEEP_ALERT_TEST_SERVER_LIVE`)

## 1. 검증 결과

통합 하네스 `F:/Dev/sendb-testenv/ux/reply-health-scenarios.mjs` 전체를 고치기 전(05:51)과 고친 뒤(07:19) 두 번 돌렸다. 고친 뒤 실행은 마지막 코드 그대로다.

| 단계 | 내용 | 고치기 전 | 고친 뒤 |
|---|---|---|---|
| unit | 단위 시험 전체 (`tsx --test "src/**/*.test.ts"`) | 838/838 | **850/850** (검토 반영 시험 12개 더함) |
| rpl | 회신 함수 시나리오 RS1~RS29 | 100/100 | 100/100 |
| snd | 발신 건강 함수·HTTP 시나리오 V2~V24 | 103/103 | **105/105** (V8j 조직 범위·V4d2 최근 창 400 더함, 기대값 4곳 바꿈 — 원자료 7절) |
| gap | 빈칸 메우기 (R1·R2·R10·R19·R34·R36·R39·R62·H24) + 검토 반영 G10~G13 | 19/19 | **26/26** |
| e2e ① dry | 시험 서버 회신 dry_run·건강 dry_run (섞인 메일함·민감 메일·대량 1,190통) | 20/20 | 20/20 |
| e2e ② live | 회신 on·live·건강 alert (밀린 효과·사람/대체 짝/자동응답/반송·며칠 뒤 워커) | 61/62 (L10b = R47 실패) | **62/62** |
| e2e ③ enforce | 건강 enforce (명단 보류·주소 멈춤·모든 대량 경로 막힘·풀기·화면) | 39/39 | 39/39 |
| 회귀 | `queue-scenarios.mjs` · `noreplyto-scenarios.mjs paths` | 10/10 · 27/27 | 10/10 · 27/27 |
| 관문 F1 | `.testenv/gate-migrate-lock.ts` — 빈 임시 DB, 0075 앞 8초 잠금 → 다시 해 성공 / 70초 잠금 → 세 번 다시 해도 실패 → false | — | **3/3** (8.1초 · 53.3초) |
| HTTP 범위 확인 | 시험 서버에 세 계정으로 로그인 (`.testenv/rh-chk-domain.mjs` 외) | — | 조직 A 관리자·멤버: 회신 탭 보임·연결 상태 있음·건강 카드 보임 / **조직 B 관리자: 회신 탭 안 보임·`meta.sync=null`·건강 카드 숨김**. 멤버가 새 도메인 프로필 → **403**(이유 글), 이미 쓰는 도메인 → 201, 관리자 새 도메인 → 201 |

행동 번호 98개(R1~R63, H1~H35): 고치기 전 97개 통과·1개 실패(R47) → **고친 뒤 98개 모두 통과 증거, 실패 0**.

E2E에서 한 번 더 걸린 것: 처음 고친 판에서 L46이 실패했다 — 반송 안내(5.1.1)로 실패한 원본의 후속이 F4 확인에서 먼저 닫혀 `stop_reason`이 `first_failed`로 남았다 (멈춘 것은 맞고 사유 글자만 달랐다). 반송 안내로 실패한 원본은 `bounced`, NHN SST3로 실패한 원본은 `first_failed`로 나눠 고친 뒤 전체를 다시 돌려 62/62.

민감 메일·개인정보 판정(D8·L21·L55: 1단계 머리글 7개만, 카나리아가 DB 문장 기록·가짜 외부 요청·서버 로그 어디에도 없음)과 실제 바깥 호출 0(N29·V21)은 고친 뒤에도 그대로 통과했다.

## 2. 고친 것

### 2-1. 검증 보고서의 앱 문제

| 번호 | 문제 | 고친 내용 | 확인 |
|---|---|---|---|
| R47 (E2E L10b) · OPS-10 | 원본 머리글 없는 반송 안내를 대체 짝(`dsn_fallback`)으로 이으면 장부 줄의 규칙·단계가 비어 회신 탭에 AI 규칙 메일이 "직접 보낸 메일 · 첫 메일"로 보였다 | 대체 짝으로 이은 뒤 같은 트랜잭션에서 `parent_log_id` 사슬을 첫 메일까지 거슬러(`loadChains(…, tx)`) `root_log_id`·`rule_kind`·`rule_id`·`step_index`를 함께 적는다 (`email-reply-sync.ts` handleBounce) | E2E L10b, gap G13b |

### 2-2. 확정된 지적 (심각도 순)

| 지적 | 심각도 | 문제 (한 줄) | 고친 내용 | 파일 | 확인 |
|---|---|---|---|---|---|
| RH-SEC-1 | high | text/html만 있는 큰 본문 하나로 정규식 처리 시간이 길이의 제곱으로 늘어 서버가 수십 분 멈출 수 있다 | ① 본문·보고 부분을 글 처리 전에 앞 64KB로 자름(`BODY_SCAN_MAX_CHARS`) ② 인용 시작 태그는 `[^<>]{0,2000}`, 태그 걷기는 `<[^<>]+>`, 주석·style/script 지우기는 indexOf 한 번 훑기, 수신거부 URL은 `\S{0,500}`, 끝 구분선 검사는 trim 뒤, 주소 머리글의 괄호·주소 찾기도 되돌아가기 없게, 주소 머리글은 32KB로 자름 | `email-reply-rules.ts` | 단위 시험: 2MB `<a `·`<!--`·`<style`·`http://`·긴 공백 줄·괄호·@ 없는 글이 모두 0.5초 안 (실측 합계 15ms) |
| F1 · OPS-1 | high | 0075가 잠금 5초 초과로 되돌아가면 서버는 옛 스키마로 떠서 발송 기록 insert가 모두 42703 → 모든 발송이 멈춘다 | ① `migrate.ts`: 55P03이면 3·10·20초 뒤 세 번 다시, 성공/실패를 돌려줌 ② `instrumentation.ts`: 실패하면 서버를 띄우지 않고 끝낸다(`process.exit(1)` — 플랫폼이 다시 띄우며 다시 시도). 급할 때만 `MIGRATION_FAILURE_MODE=continue` ③ 0075 주석·DESIGN-SND·배포 문서의 "조용히 쉰다" 설명 고침 | `db/migrate.ts`, `instrumentation.ts`, `0075_send_health.sql`, `DESIGN-SND.md` | 관문 `.testenv/gate-migrate-lock.ts`: 8초 잠금 → 55P03 뒤 3초 쉬고 성공(true), 70초 잠금 → 세 번 다시 해도 실패 → false·0075 되돌려짐 (3/3, `ux/reply-health-logs/gate-migrate-lock.log`) |
| F2 | high | 반송 막기가 발신 쪽 실패(5.7.x)·메일함 가득(5.2.2)까지 조직 전체에서 90일 막는다 | 막기 목록 갈래 `bounceBlockClass`·`bounceBlockSignal` (PRD SND-2): 발신 쪽(5.7.x·인증·정책 문구)은 막지 않음, 주소 없음(5.1.x·5.4.4·5.2.1·"user unknown" 등)은 바로, 그 밖의 hard(5.2.2 등)는 같은 주소에 서로 다른 반송 안내 3번일 때만. 레코드 '반송' 사건도 발신 쪽 실패는 남기지 않음. 발송 기록을 실패로 적는 것은 그대로 | `email-status-sync-rules.ts`, `email-reply-guard.ts`, `email-bounce-signal.ts`, `email-reply-effects.ts` | 단위 시험, gap G10a·b·c, E2E L46(5.1.1은 막힘) |
| RH-SEC-2 | medium | 운영에서 `REPLY_PRIVATE_DOMAINS`가 빠지면, 멤버가 별칭 도메인의 `hr@` 같은 주소로 발신 프로필을 만들어 대표 메일함의 채용·급여 메일이 읽힐 수 있다 | ① 운영 서버에서 `REPLY_PRIVATE_DOMAINS`가 비면 **메일함을 읽지 않는다**(`readBlockedReason`, 회신 탭 띠 경고). 정말 없으면 `none`. 모드는 그대로라 이미 저장된 회신의 막기는 계속 ② 회신 읽기 대상 조직에서 **처음 쓰는 발신 도메인**으로 프로필을 만들거나 바꾸는 것은 관리자만 (403 + 이유). 이미 쓰는 도메인의 다른 주소는 예전처럼 누구나 | `email-reply-rules.ts`, `email-reply-sync.ts`, `email-reply-list.ts`, `api/email/sender-profiles/route.ts`·`[id]/route.ts` | 단위 시험 (설정·도메인 판정) |
| RH-SEC-3 | medium | postgres-js 연결 끊김(`CONNECTION_CLOSED` 등)을 연결 오류로 알아보지 못해 사람 회신이 '알 수 없음' 최소 줄로 남고 후속이 계속 나간다 | `isConnectionError`가 SQLSTATE 08·53·57에 더해 드라이버·소켓 연결 code(`CONNECTION_CLOSED`·`CONNECTION_ENDED`·`CONNECTION_DESTROYED`·`CONNECT_TIMEOUT`·`ECONNRESET`·`ECONNREFUSED`·`EPIPE`·`ETIMEDOUT` 등)도 연결 오류로 본다 → 회차를 멈추고 커서를 그 묶음 앞에 둔다 | `email-reply-rules.ts` | 단위 시험 (감싼 오류 포함) |
| F3 | medium | 주소 위험이 PRD("명단 2개 이상에서 함께 5% 이상 → 멈춤")와 달라, 여러 명단에서 높은 주소가 멈추지도 즉시 알림되지도 않았다 | 이항 칸 판정(뚜렷이 높은 칸 2개)에 더해 **PRD 규칙**: 주소 자신이 명단 2개 이상에서 5% 이상(칸 50통·실패 3통 이상, 칸 합 200통 이상)이고 **주소 전체도 5% 이상**이면 위험 → enforce에서 자동 멈춤(하루 상한 안). 위험·보류 명단의 칸도 센다. 주소 자신이 위험이면 '명단과 함께'(danger_with) 알림은 따로 내지 않는다. 주소 전체 5% 조건은 혼자 보내는 나쁜 명단 몇 개 때문에 다른 명단에서 멀쩡한 주소까지 멈추지 않게 하려는 것 (4절 2번) | `sender-health-rules.ts`, `sender-health.ts` | 단위 시험 (작은 명단 5개·명단 탓·수용 기준 3), snd V8b·V8h·V10d |
| F4 | medium | 보류를 풀면 첫 메일이 이미 SST3로 실패한 주소의 후속까지 되살아나 다시 나간다 | 후속 처리 첫머리(보류 확인 앞)에서 원본 메일이 받는 쪽 실패(`failed` + SST3 또는 배달 실패 출처, 발신 쪽 아님)면 `cancelled` — `stop_reason`은 NHN SST3면 `'first_failed'`(후속 큐 화면 "(앞 메일 실패)"), 반송 안내로 실패했으면 반송 막기와 같은 `'bounced'`. AI·발신 자리 잡기 전에 닫혀 토큰도 쓰지 않는다 | `email-followup.ts`, `email-status-sync-rules.ts`, `FollowupQueueTable.tsx` | 단위 시험, gap G11 |
| F5 | medium | 정기 작업의 잠금 연결이 늘어 기본 풀(10)이 바닥나면 묶어 미루기 트랜잭션이 교착될 수 있다 | 풀 크기 기본 20(`DATABASE_POOL_MAX`, 5~200). 묶어 미루기 트랜잭션 안의 보류 확인은 트랜잭션 연결로 | `db/index.ts`, `partition-hold.ts`, `email-send-queue.ts` | tsc·대기열 회귀 |
| OPS-2 | medium | 발신 건강이 샌드비의 모든 조직을 판정·조치하고, 발송이 없는 조직까지 운영 스페이스에 매일 보고를 보냈다 | `SEND_HEALTH_ORG_IDS`(기본 = 회신·깊이 알림 워크스페이스의 조직, `*` = 전부). 판정 대상이 아닌 조직은 발송 건강 카드도 숨김. 운영 매일 보고는 발송이 있었거나 위험·주의·보류·멈춤·결과 확인 문제가 있을 때만 | `sender-health-rules.ts`, `sender-health.ts`, `sender-health-view.ts`, `SendHealthCard.tsx` | 단위 시험, snd V8j |
| OPS-3 | medium | 웹훅 설정 오류(401·403·404)로 쌓인 알림이 웹훅을 고치는 순간 2주치 한꺼번에 나간다 | 줄을 집기 전에 만든 지 24시간 넘은 pending 줄을 `skipped`("오래되어 보내지 않음")로 닫는다 (깊이 알림과 같은 규칙) | `sender-health.ts` | 코드 읽기 + snd V18 (웹훅 오류 경로) |
| OPS-4 · F7 | medium·low | 위험 알림 중복 키가 좋아질 때는 다시 알리고(7.2→6.4%), 회복 뒤 다시 위험해지면 알리지 않았다 | 키에 **위험 구간 시작**을 넣고(`danger:<p\|s>:<id>:<모드>:<하한>:e<구간>:<칸>`), 같은 구간 안에서는 이미 알린 가장 높은 칸보다 나빠질 때만 새 사건. 구간은 하루 건강의 지난 줄로 정한다 — 지난 회차도 위험이었거나 위험에서 벗어난 지 24시간이 안 됐으면 같은 구간(5% 언저리 오르내림에 알림이 몰리지 않게), 아니면 새 구간 | `sender-health-rules.ts`, `sender-health.ts` | 단위 시험, snd V9d·V9e·V9f, E2E L54 |
| OPS-6 · RH-SEC-5 | medium·low | 회신 탭과 메일함 연결 상태 띠(가린 메일함 주소·오류·경고·뺀 주소)가 모든 조직에 보였다 | 회신 읽기 대상 조직(`REPLY_WORKSPACE_IDS`의 조직)이 아니면 `meta.sync=null`, `meta.enabled=false`. 새 `GET /api/email/replies/status`로 이메일 화면이 회신 탭을 그 조직에만 보인다 | `api/email/replies/route.ts`·`status/route.ts`, `email-reply-list.ts`, `email/page.tsx`, `replies/hooks/useRepliesEnabled.ts` | tsc, E2E U1·U10 (대상 조직은 그대로 보임) |
| RH-SEC-4 | low | 주소 위험 알림이 다른 사업의 명단 이름·실패율을 이 사업 스페이스로 보냈다 | 사업 스페이스 글은 그 사업 명단만 이름·실패율을 싣고, 다른 사업 명단은 "다른 사업 명단 N개"로 숫자만. 운영 스페이스 글은 전부 (주소 위험·'명단과 함께' 글) | `sender-health-rules.ts`, `sender-health.ts` | 단위 시험 |
| RH-SEC-6 · F8 | low | 원본 머리글 없는 반송이 허용 워크스페이스 밖 발송에 이어져 장부 줄·실패 처리를 했다 (머리글 있는 반송은 버리는데) | SND 반송 신호에 허용 워크스페이스를 넘겨, 대체 짝짓기로 이은 발송이 허용 밖이면 신호·발송 실패·사건을 남기지 않고 장부 줄도 지운다(`outOfScope`로만 셈) — 원본 머리글 경로(R59)와 같게 | `email-bounce-signal.ts`, `email-reply-sync.ts` | gap G13a |
| OPS-7 | low | update-mails의 HTTP 400을 모두 "오래된 기간 거절"로 보고 커서를 넘겨, 설정 오류가 '정상'으로 묻혔다 | 창 시작이 24시간보다 오래됐을 때만 건너뛰고, 그 밖의 400은 일시 오류(커서 그대로·연속 오류·정체 알림). 건너뛴 창은 누적(`skippedWindowsTotal`·마지막 시각)으로 상태에 남겨 매일 보고와 발송 건강 카드에 보인다 | `email-status-sync-rules.ts`, `email-status-sync.ts`, `sender-health-rules.ts`, `sender-health-view.ts`, `send-health/utils/labels.ts` | 단위 시험, snd V4d·V4d2 |
| OPS-8 | low | NHN 결과 맞추기가 한 번도 돌지 않으면 enforce가 아무것도 안 하는데 알림·보고에 이유가 없었다 | 상태 줄이 없는데 1시간 넘게 지난 발송(48시간 안)이 있으면 운영 스페이스에 6시간마다 "status-sync 정기 작업이 한 번도 돌지 않았습니다" 알림, 매일 보고에 "한 번도 돌지 않음" 줄 (`NHN_STATUS_SYNC=off`면 알리지 않음) | `sender-health.ts`, `sender-health-rules.ts` | 단위 시험 (보고 줄) |
| F6 | low | 묶음 처리 중 보류를 풀면 그 줄이 주인 없는 held로 남아 영영 나가지 않는다 | `reviveOrphanHeldRows`: 발송 대기열·후속·템플릿 반복 워커가 회차 첫머리에 "걸린 보류가 없는 명단의 held 줄 → pending"(풀기와 같은 모양: 순서·미룸 사유 유지) | `partition-hold.ts`, `email-send-queue.ts`, `email-followup.ts`, `email-automation.ts` | gap G12 |

## 3. 받지 않았거나 일부만 한 것

| 지적 | 판단 |
|---|---|
| OPS-5 (배포 문서가 "dev를 main에"만 부탁) | 검토에서 기각. 이번 작업은 아직 커밋하지 않았고, 배포 문서 8절에 "앞 커밋 4개와 따로 합쳐도 된다"를 적었다 |
| OPS-9 (`NEXT_PUBLIC_BASE_URL`이 비면 운영을 시험 서버로 판정) | 검토에서 기각. 시험 서버로 판정되면 더 조심하는 쪽(직원 주소 메일만, on·live 막힘)이라 고객 메일이 바뀌지 않는다. 배포 문서 8-3에 값을 그대로 두라고 적었다 |
| RH-SEC-2 제안 ② (메일함 계정의 sendAs 도메인을 자동으로 메일함 쪽 도메인에 더하기) | 하지 않음. 대표님이 Gmail에서 `cs@<발신 도메인>`으로 답장하려고 "다른 주소에서 메일 보내기"를 등록해 두면 그 발신 도메인이 통째로 메일함 쪽이 되어 회신을 조용히 읽지 않게 된다. 대신 ①(운영에서 값이 비면 읽지 않음)과 ③(새 도메인은 관리자만)으로 막았다 |
| F5 제안 (트랜잭션 안의 모든 조회를 tx로) | 보류 확인만 tx로 옮겼다. 회신·쿨다운·중복 조회(`resolveDrainRows`)는 예전부터 풀 연결을 쓰던 구조라 그대로 두고 풀 크기를 20으로 늘렸다. 남은 위험은 4절 6번 |
| F3 (danger_with에도 멈춤) | 주소 자신이 5% 이상이면 이제 주소 위험(멈춤)이 된다. 주소 자신은 낮은데 위험 명단의 주된 발신일 뿐인 경우(실패는 다른 주소 몫)는 멈추지 않고 알림만 둔다 — 멈출 근거가 없다 |

## 4. 대표 확인이 필요한 것

1. **명단 보류 중 문의 메일**: 설계대로 대량만 막는다. 실제로 막힌 것: 대기열 워커(AI 대량)·가져오기의 템플릿 첫 메일·AI 후속·템플릿 반복·수동 2건 이상(409). 나가는 것: 폼·단건 생성의 AI 바로 보내기와 템플릿 첫 메일, 수동 1건 (E2E N12·N13). 문의까지 막으려면 `getActiveHold`의 문의 예외를 없애면 된다
2. **주소 위험 규칙 (F3)**: PRD 문구 "명단 2개 이상에서 함께 5% 이상"에 "주소 전체 실패율도 5% 이상"을 더했다. 예: 주소 하나가 혼자 보낸 나쁜 명단 둘(각 6.4%)과 멀쩡한 명단 셋(각 1%)을 보냈으면 명단 둘만 보류되고 주소는 멈추지 않는다(전체 2.8%). 문구 그대로 하려면 조건 하나를 빼면 된다
3. **발신 건강 판정 범위 (OPS-2)**: 기본은 우리 조직만. 다른 고객사에도 켤지는 그 고객사 알림을 어디로 보낼지와 함께 정해야 한다 (지금 운영 알림은 우리 스페이스 하나)
4. **새 발신 도메인은 관리자만 (RH-SEC-2)**: 우리 조직에서 멤버가 처음 쓰는 도메인의 발신 프로필을 만들면 403이다. 발신 도메인을 늘리는 일은 지금도 관리자가 하므로 영향은 작다고 본다
5. **alert 모드 낮 시간 전송**: 밤(KST 22~08시)에는 조치 없는 알림을 보내지 않고 09시 매일 보고에 싣는다. 낮 시간 전송은 시각을 10:00으로 고정한 함수 시험(snd V9a)으로 확인했고, E2E는 실행 시각이 밤이라 skipped(L53)였다
6. **연결 풀 (F5)**: 풀 20이면 지금 정기 작업이 모두 겹쳐도(잠금 연결 최대 10개) 여유가 있다. 운영 DB의 `max_connections`가 작으면(예: 25 이하) `DATABASE_POOL_MAX`를 맞춰 줘야 한다 — 배포 전에 `SHOW max_connections;`

## 5. 남은 실제 환경 확인 (로컬에서는 할 수 없는 것)

1. **실제 Gmail 연결** (DESIGN-RPL 13절, 대표님): 회신 전용 메일함(13-0, 권장) → 구글 클라이언트·`gmail.readonly` 갱신 토큰(13-1~13-2) → 개발 서버 시험(13-3·14절: 시험 서버는 직원 주소가 보낸 메일만, 거슬러 읽기 0). 확인할 것: NHN Message-ID 앞부분 = 요청 번호(스레드로 이어지는지), 보조 도메인 라우팅 뒤 `To:`가 `cs@…`로 남는지, 실제 반송 안내의 MIME 모양(첨부로 오는지), Outlook·Gmail HTML 답장의 인용 떼기
2. **운영 `REPLY_PRIVATE_DOMAINS` 값**: 관리 콘솔 "사용자 별칭 도메인" 전부 (설계 값 `matchesplan.cloud,matchesplan.me,designer-hire.com,offio.kr,pixl.kr`). 비우면 운영에서 읽지 않는다
3. **실제 NHN 결과 맞추기**: `update-mails` 쪽 크기 최댓값(`NHN_STATUS_PAGE_SIZE`, 지금 100), 오래된 기간을 몇 일부터 거절하는지(하루 넘은 창만 건너뜀), SST3 `dsnCode` 실제 값. 개발 서버에서 `NHN_STATUS_SYNC` 회차 응답의 `skippedWindows`·`errors`·`unpaired` 숫자를 하루 본다
4. **운영 모드 올리기**: 회신 `dry_run` 이틀 → `on` → 하루 뒤 카드 `live`. 발신 건강 `dry_run` 하루 → `alert` 1주(오탐·알림 양 확인) → 대표 확인 뒤 `enforce`. Scheduler 세 작업(회신 5분, 결과 맞추기 10분, 건강 10분 5분 어긋나게) — 배포 문서 8-4
5. **배포 순간 마이그레이션**: 운영 `email_send_logs`가 커서 0075가 잠금을 못 얻으면 세 번 다시 해 보고, 그래도 안 되면 서버가 뜨지 않는다. 발송이 적은 저녁에 배포하고 로그 `[migrate] 마이그레이션 완료!`와 `[indexes] email_send_logs 색인 준비됨`을 본다
6. **개발 서버와 운영의 메일함**: 한 메일함은 한 환경만 `on`. 운영을 켜는 날 개발 서버는 `off`

## 6. 관문

| 관문 | 결과 |
|---|---|
| 단위 시험 `tsx --test "src/**/*.test.ts"` | **850 통과 / 0 실패** |
| `tsc --noEmit` (저장소 전체) | **0** |
| eslint (이번 작업의 바뀐·새 `.ts`·`.tsx` 98개) | **새 오류 0.** `src/app/records/page.tsx`의 오류 2개(104행 `Math.random`, 230행 선언 전 접근)와 경고 1개는 HEAD `630058a`에도 같은 줄에 있는 예전 것이다 (이 작업은 그 파일에 띠 한 줄만 더함) |
| `next build` | **성공** (`DATABASE_URL`이 있어야 모듈을 읽는다 — 시험 DB 주소로 빌드, 연결은 하지 않음). 새 경로 `/api/email/replies/status` 포함 |

## 7. 바뀐 파일 (이번 검토 반영)

앱 (저장소)

| 파일 | 지적 |
|---|---|
| `src/lib/email-reply-rules.ts` (+ `.test.ts`) | RH-SEC-1 본문 자르기·정규식, RH-SEC-2 `readBlockedReason`·`newSenderDomainNeedsAdmin`, RH-SEC-3 `isConnectionError` |
| `src/lib/email-reply-sync.ts` | RH-SEC-2 읽기 막기, RH-SEC-6·F8 허용 밖 반송 지우기, R47·OPS-10 사슬 찾기 |
| `src/lib/email-reply-list.ts` | RH-SEC-5·OPS-6 `replyScopeOrgIds`·`isReplyScopeOrg` |
| `src/lib/email-reply-guard.ts` | F2 막기 목록 갈래 |
| `src/lib/email-reply-effects.ts` | F2 발신 쪽 실패는 '반송' 사건 없음 |
| `src/lib/email-bounce-signal.ts` | F2 `blockClass`, RH-SEC-6 `allowedWorkspaceIds`·`outOfScope` |
| `src/lib/email-status-sync-rules.ts` (+ `.test.ts`) | F2 `bounceBlockClass`·`bounceBlockSignal`, F4 `isRecipientSideFailure`, OPS-7 `classifyNhnFailure` |
| `src/lib/email-status-sync.ts` | OPS-7 창 나이, 건너뛴 창 누적 |
| `src/lib/sender-health-rules.ts` (+ `.test.ts`) | F3 PRD 주소 규칙, F7·OPS-4 위험 구간 키, RH-SEC-4 사업별 글, OPS-2 `orgScope`, OPS-7·OPS-8 보고 줄 |
| `src/lib/sender-health.ts` | F3, F7·OPS-4 구간 읽기·쓰기, RH-SEC-4 `textFor`, OPS-2 조직 범위·운영 보고 조건, OPS-3 오래된 알림, OPS-8 한 번도 안 돎 알림 |
| `src/lib/sender-health-view.ts` | OPS-2 `inScope`, OPS-7 건너뛴 창 |
| `src/lib/partition-hold.ts` | F5 `getActiveHold(exec)`, F6 `reviveOrphanHeldRows` |
| `src/lib/email-followup.ts` | F4 원본 실패 후속 닫기, F6 회차 첫머리 정리 |
| `src/lib/email-send-queue.ts` | F5 보류 확인을 트랜잭션 연결로, F6 |
| `src/lib/email-automation.ts` | F6 |
| `src/lib/db/index.ts` | F5 풀 크기 `DATABASE_POOL_MAX`(기본 20) |
| `src/lib/db/migrate.ts`, `src/instrumentation.ts` | F1·OPS-1 다시 하기·실패하면 끝내기·`MIGRATION_FAILURE_MODE` |
| `drizzle/0075_send_health.sql` | F1 주석만 (SQL 같음) |
| `src/app/api/email/replies/route.ts`, `src/app/api/email/replies/status/route.ts`(새) | RH-SEC-5·OPS-6 |
| `src/app/api/email/sender-profiles/route.ts`, `[id]/route.ts` | RH-SEC-2 새 도메인은 관리자만 |
| `src/app/email/page.tsx`, `src/components/email/replies/{types/index.ts, api/replies.ts, hooks/useRepliesEnabled.ts(새)}` | OPS-6 회신 탭 조건부 |
| `src/components/email/send-health/{types/index.ts, utils/labels.ts, ui/SendHealthCard.tsx}` | OPS-2 카드 숨김, OPS-7 건너뛴 창 표시 |
| `src/components/email/FollowupQueueTable.tsx` | F4 "(앞 메일 실패)" |
| `docs/2026-10-11-reply-and-health/DESIGN-SND.md` | F1 설명 고침 |
| `docs/2026-10-11-reply-and-health/REVIEW.md`(새), `docs/ROLLOUT-2026-10-dev-to-main.md` | 이 문서, 배포 문서 8절 |

시험 환경 (저장소 밖이거나 git 제외 `.testenv/`, 커밋 대상 아님): `.testenv/snd-scenario.ts`(기대값·V8j·V4d2), `.testenv/rh-gap.ts`(G10~G13), `.testenv/gate-migrate-lock.ts`(새), `.testenv/rh-chk-domain.mjs`(새), `F:/Dev/sendb-testenv/ux/reply-health-scenarios.mjs`(보고서 제목 한 줄), 결과 `ux/reply-health-results.{md,json}`(고친 뒤), `ux/reply-health-results.before-fixes.{md,json}`(고치기 전), `ux/reply-health-results.fixes-run1.{md,json}`(L46 사유 글자 고치기 전 판)
