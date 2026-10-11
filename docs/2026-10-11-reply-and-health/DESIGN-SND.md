# DESIGN-SND — 발송 결과 자동 맞추기 · 발신 건강 판정 · 멈춤과 알림

- 날짜: 2026-10-11 · 브랜치 `dev` (HEAD `630058a`) · 마이그레이션 `0075_send_health`
- 근거: PRD `matchesplan-marketing-master/dev-handoff/09-cold-email-system-prd.md`
  - SND-1 (NHN 발송 상태 자동 맞추기) 1판 + 2판의 "10분 주기"
  - SND-3 (발신 주소·명단 건강) 1판 알림 + 2판 자동 조치
  - 6절 비기능(조직 섞임 막기·개인정보·되돌리기·시험), 7절 표·경로 후보, 12절 질문 2번
- 대표 결정 (2026-10-11)
  - 12절 2번: **"예, 멈추고 알림"**. 실패율이 높으면 명단은 보류, 주소는 멈추고 바로 알린다.
  - 12절 1번: 회신 메일함을 샌드비가 자동으로 읽어도 된다. 회신 읽기는 짝 문서 `DESIGN-RPL.md` 몫이다. 이 문서는 그쪽이 찾아 주는 **반송 안내(DSN)** 만 받아 실패 신호로 쓴다 (4절).
- 이 문서가 하지 않는 것: 반송 주소 막기 목록(SND-2), 도메인 인증 화면(SND-5), 열람·사람 클릭 신호(MEA-1·SEQ-2), 후속 멈춤 조건(SEQ-1). 12절에 이어 받을 자리를 적었다.
- **검토 반영 (2026-10-11)**: 1차 검토 17건(SND-01~17)을 본문에 반영했다. 무엇을 어디서 바꿨는지는 **17절**. 짝 문서 `DESIGN-RPL.md`와 반송 안내(DSN) 계약·`email_send_logs` 색인 결론을 하나로 맞췄다 (SND-01 = RPL B2).

---

## 0. 한 줄 요약

10분마다 NHN "상태가 바뀐 메일 목록"(`update-mails`)을 커서로 이어 읽어 SST 코드 그대로 적는다 (장애 뒤에도 커서에서 이어 읽는다). 회신 메일함으로 들어온 반송 안내는 RPL이 넘겨주고, 이 문서의 `recordBounceSignal` 한 곳이 발송 기록에 적는다(같은 메일은 한 번만 센다). 반송 안내만으로 생긴 실패는 기준을 다시 맞출 때까지 실패율에 넣지 않고 따로 보고한다.
최근 7일(느린 명단은 30일) 동안 **명단 하나가 200통 이상에서 실패율 5% 이상이면 그 명단의 대량 발송을 보류**하고, **주소 하나가 명단 2개 이상에서 "같은 명단의 다른 주소보다 뚜렷이" 실패가 많으면 그 주소를 멈춘다.** SPF·DKIM·DMARC 같은 발신 쪽 실패가 한 시간에 몰리면 그 도메인 주소를 바로 멈춘다. 모두 구글 챗으로 바로 알린다. 실패율 3% 이상 같은 주의는 매일 아침 보고에만 싣는다.
`SEND_HEALTH_MODE` 한 칸으로 `off`(끔) · `dry_run`(기록만, 코드 기본값) · `alert`(알림만) · `enforce`(멈춤 + 알림)를 고른다. NHN 결과 동기화가 멈춰 있으면 `enforce`여도 알림만 한다. 문의(폼·광고·단건) 메일은 보류하지 않는다. 조직 기본 주소는 자동으로 멈추지 않는다. 풀기는 관리자가 한 번 누른다. 풀린 뒤에는 풀린 시각 뒤 발송만으로 다시 판정한다.

---

## 1. 코드에서 확인한 사실 (확정)

| # | 사실 | 근거 |
|---|---|---|
| F1 | 보낼 때는 NHN이 **접수했는지**만 적는다 (`status='sent'` = 접수). 실제 도착·실패는 화면 버튼을 눌러야 들어온다 | `src/app/api/email/logs/sync/route.ts:7`, 호출은 `src/hooks/useEmailLogs.ts:32` 하나 |
| F2 | 버튼 동기화는 SST3·SST7을 똑같이 `failed`로 적고 SST5·SST8은 버린다. 받는 주소를 대소문자 그대로 비교한다. 30일치 `sent`를 요청 번호마다 차례로 묻는다 — 대량에서 끝까지 못 돈다 | 같은 파일 `:45,:50,:103,:108`, `:76-125` |
| F3 | 버튼 동기화는 `mail.resultCode`·`mail.resultCodeName`을 적는데, NHN "메일 발송 리스트 조회" 응답에는 그 칸이 없고 `dsnCode`·`dsnMessage`가 있다. 실패 사유가 비어 들어갔을 가능성이 높다 (추론). `NhnEmailQueryResult`에 `mailSeq`·`dsnCode`·`dsnMessage`·`senderAddress`가 없다 | `src/lib/nhn-email.ts:44-57`, `docs/nhncloud/email.html` |
| F4 | `queryUpdatedMails`는 쿼리 이름을 `startUpdateDate`로 보내지만 문서 이름은 `startMailStatusUpdateDate`·`endMailStatusUpdateDate`다 (`GET /email/v2.1/appKeys/{appKey}/sender/update-mails`). 응답에 받는 주소는 없고 `requestId`·`mailSeq`·`mailStatusCode`(SST2·3·5·7·8)·`resultDate`·`dsnCode`·`dsnMessage`·`mailStatusUpdatedDate`가 있다. 샌드비 발송은 모두 `eachMail` 1통 1요청(F8)이라 **요청 번호만으로 짝지어진다** — 받는 주소가 없는 것은 걸림돌이 아니다 (SND-12). SST2는 "수신 완료 시간" 기준으로 잡힌다(문서 주의). 아무 데서도 안 쓴다 | `nhn-email.ts:217-235`, `docs/nhncloud/email.html` "메일 발송 업데이트 완료 목록 조회" |
| F5 | `queryMailsPaged`(기간 조회, 쪽·전체 건수)가 있고 아무 데서도 안 쓴다. 기본 쪽 크기는 15, 최댓값은 문서에 없다 **[확인 필요]** | `nhn-email.ts:239-275` |
| F6 | `email_send_logs`의 색인은 수신거부 토큰 하나뿐이다. `org_id`·`sent_at`·`request_id` 색인이 없다 | `drizzle/0060_email_unsubscribe.sql:27` |
| F7 | 발송 경로 다섯 곳 모두 기록에 `partition_id`·`sender_profile_id`·`sender_email`을 남긴다. 시험 후속은 `trigger_type='test_followup'` | `auto-personalized-email.ts:378`, `email-followup.ts:576,799`, `email-automation.ts:175`, `send/route.ts:188` |
| F8 | NHN 개별 발송(`eachMail`)은 받는 사람 하나에 요청 번호 하나다. NHN이 접수만 하고 받는 사람 단위로 거절하면 `requestId`가 있는 채로 `failed`가 된다 | `email-automation.ts:197-215` |
| F9 | 주소 정지 칸(`is_paused`)은 모든 발송 경로가 이미 따른다. 묶음(AI 첫 메일)은 정지 주소를 건너뛰고, 고정 주소(후속·템플릿·수동)는 다음 보낼 수 있는 날로 미룬다. 정지 칸은 관리자만 바꾼다 | `email-sender-limit-rules.ts:433,505-530`, `sender-profiles/[id]/route.ts:31` |
| F10 | 명단(파티션) 단위로 발송을 막는 장치는 없다 | — |
| F11 | 대기열 세 곳이 모두 `status='pending'`만 집는다: `email_send_queue`(AI 첫 메일, `pickBatch`), `email_followup_queue`(후속), `email_automation_queue`(템플릿 반복·미룬 첫 메일) | `email-send-queue.ts:374-390`, `email-followup.ts:362`, `email-automation.ts:470` |
| F12 | 구글 챗 보내기(`postGoogleChatText`)는 오류 글에서 웹훅 주소를 지운다. 깊이 알림 웹훅은 `DEEP_ALERT_WEBHOOK_URL_<워크스페이스>`이고 401·403·404는 설정 오류로 본다 | `src/lib/google-chat.ts`, `deep-visitor-alert-rules.ts:1422-1443`, `deep-visitor-alert-delivery.ts` `isWebhookConfigError` |
| F13 | advisory lock 키는 `0x5c4edf01`~`06`을 쓴다. cron 경로는 `CRON_SECRET`을 `x-secret` 헤더로 확인한다 | `email-send-queue.ts:42`, `queue/process/route.ts` |
| F14 | 마이그레이션은 부팅 때 한 트랜잭션으로 돈다 (`instrumentation.ts` → `migrate.ts`). 실패하면 로그만 남고 서버는 뜬다 (catch). 같은 트랜잭션의 `ALTER TABLE … ADD COLUMN`은 ACCESS EXCLUSIVE 잠금을 **커밋까지** 쥔다 → 그 뒤 같은 트랜잭션에서 색인을 만들면 그동안 그 표의 읽기(SELECT)까지 막힌다 (SND-15) | `drizzle/0071_email_sender_limits.sql` 머리 주석, `src/lib/db/migrate.ts` |
| F15 | 고칠 파일은 지금 모두 LF다. 새 파일도 LF로 쓴다 | 2026-10-11 확인 |
| F16 | 중복 수신자·쿨다운 확인은 발송 기록의 `status`만 본다: AI `checkDuplicateRecipientForAiAuto`(`status='sent'`)·쿨다운(`sent`·`pending`), 대기열 `loadDuplicateRecipients`·쿨다운, 템플릿 `checkDuplicateRecipient`·쿨다운. 배달 결과로 `sent → failed`를 바꾸면 이 확인에서 빠진다 (SND-11) | `auto-personalized-email.ts:40,62`, `email-send-queue.ts:800,820`, `email-automation.ts:50,73` |
| F17 | 템플릿 메일은 모두 조직 기본 발신 주소 하나로 나간다 (`claimSender(orgId, { mode: "fixed", ids: [] })`). 기본 주소가 멈추면 조직 전체의 템플릿 첫 메일(폼 문의 포함)·반복·템플릿 후속이 관리자가 풀 때까지 미뤄진다 (SND-08) | `email-automation.ts:133-143`, `processRepeatItem`의 `markOrgBlocked` |
| F18 | 웜업 일차는 `warmupStartedOn`부터 지난 "보낼 수 있는 날" 수다. 정지한 날도 센다 (주석: "정지 이력이 없어서다") (SND-10) | `email-sender-limit-rules.ts:234-257` |
| F19 | 바로 보내는 AI 경로(`automation-dispatch`)는 늘 `purpose: "inbound"`(문의)다. 템플릿 첫 메일은 `kind='first'`가 문의, `first_bulk`·반복이 대량이다 (SND-09) | `automation-dispatch.ts:24`, `email-automation.ts` `templatePurpose` |
| F20 | 대기열의 먼저 들어온 순 하한(`latestDeferredBulkAt`)은 `last_error LIKE 'deferred(이유)%'`로 미룬 대량 줄을 찾는다 (SND-14) | `email-send-queue.ts:221-267` |
| F21 | 수동 발송은 레코드를 조직 조건으로만 고르고, 기록의 `partition_id`는 템플릿 연결의 파티션으로 적는다 (SND-16) | `send/route.ts:103-106,191` |

---

## 2. 전체 흐름

```
[발송 경로 5곳] ──▶ email_send_logs (status=sent: NHN 접수)
                          │
   (부팅 뒤 1번) ensureSendLogIndexes() ── CREATE INDEX CONCURRENTLY (org_id, sent_at)·(request_id)            (8-3)
                          │
   (10분) /api/email/status-sync/process ── NHN update-mails(커서) + 늦은 기록만 queryMails(requestId)
                          └─▶ nhn_status_code·사유·실패 출처·실패 쪽(받는 쪽/발신 쪽) 기록                       (3절)
                          │
   (RPL 회신 읽기) 반송 안내 발견·풀기 ── recordBounceSignal() ──▶ email_bounce_signals (+ 받는 사람 같으면 실패 출처 'dsn')  (4절)
                          │
   (10분, 5분 어긋나게) /api/email/send-health/process
        ├─ 동기화 건강 확인 (마지막 성공·처음 채우기·미확정 비율) → 나쁘면 enforce여도 알림만          (6-1)
        ├─ 최근 7일 묶음 집계(+ 느린 명단 30일) → evaluateHealth()(순수) → email_health_daily                 (5절)
        ├─ 발신 쪽 실패 폭주(최근 1시간) → 도메인 주소 멈춤                                                       (5-3)
        ├─ planActions()(순수): 모드·예외·상한·기본 주소 → 명단 보류(대량만) / 주소 멈춤                          (6절)
        ├─ 사건 email_health_events + 알림 줄 email_health_alerts (조직·받는 곳마다 한 통으로 묶음)              (7절)
        ├─ 알림 보내기 (구글 챗, 깊이 알림과 같은 보내기 함수. 밤에는 조치가 있을 때만)
        └─ 09시(KST) 뒤 첫 회차: 매일 보고
                          │
[발송 경로 5곳] ◀── 명단 보류 확인(getActiveHold, 대량만) / 주소 정지(is_paused, 원래 있던 장치) / 반송 막기(RPL 7-4)
[화면] 규칙 카드·명단·발신 주소 배지 + 관리자 "풀기"
```

---

## 3. 신호 ① NHN 발송 결과 자동 맞추기 (SND-1)

### 3-1. 상태 코드 → 기록

모든 결과는 `nhn_status_code`에 코드 그대로 남긴다 (PRD SND-1 수용 기준 2: SST3·SST5·SST7·SST8을 따로 기록).

| NHN 코드 | 뜻 | 확정? | `status` | 실패율 셈 | `result_code`·`result_message` |
|---|---|---|---|---|---|
| SST0·SST1·SST4 | 준비·발송 중·예약 | 아니요 | 그대로 | 미확정 (뺀다) | 그대로 |
| SST2 | 발송 완료 | 예 | `sent` (단, 반송 안내로 이미 실패면 `failed` 유지) | 분모 (반송 안내가 붙었으면 5-1 "반송만") | 그대로 |
| SST3 | 발송 실패 | 예 | `failed` | 분모·분자 (단, 발신 쪽 실패면 뺀다) | `dsnCode`·`dsnMessage` (없으면 "발송 실패(SST3)") |
| SST5 | NHN 수신거부 | 예 | `failed` | 뺀다, 따로 셈 | "NHN 수신거부(SST5)" |
| SST7 | 미인증 (우리 발신 도메인) | 예 | `failed` | **뺀다**, 발신 쪽 실패로 따로 셈 | "발신 인증 실패(SST7)" |
| SST8 | 화이트리스트로 인한 실패 | 예 | `failed` | **뺀다**, 발신 쪽 실패로 따로 셈 | "화이트리스트로 인한 실패(SST8)" |
| 모르는 코드 | — | 아니요 | 그대로 | 미확정 | 그대로, 경고 로그 1번 |

- SST3이면 `delivery_fail_source = COALESCE(delivery_fail_source, 'nhn')`, `delivery_failed_at = COALESCE(delivery_failed_at, resultDate, now())`, `delivery_status_code = dsnCode`(예 `5.1.1`).
- **실패 쪽** `delivery_fail_side` (SND-06, 순수 `classifyFailSide(statusCode, message)`): SST7·SST8 → `sender`. SST3·반송 안내는 상태가 `5.7.`로 시작하거나 사유 글에 `SPF`·`DKIM`·`DMARC`·`policy`·`authenticat`(대소문자 무시)가 있으면 `sender`(우리 도메인 인증·정책 거절), 아니면 `recipient`. 발신 쪽 실패는 명단 실패율에서 빼고 주소·도메인 판정과 SND-2 막기 목록 제외에 쓴다.
- `completed_at`은 확정일 때만 `parseNhnDate(resultDate) ?? now()`.
- 실패 사유 글(`dsnMessage`)은 DB에만 두고 서버 로그·구글 챗에는 넣지 않는다 (받는 주소가 섞여 있을 수 있다, PRD 6절 개인정보).

### 3-2. 확인 방식 (S1 — 상태가 바뀐 메일 목록을 커서로, SND-12)

요청 번호마다 묻지 않는다. NHN `GET /sender/update-mails`(F4)가 "상태 코드가 바뀐 메일"을 기간·쪽으로 주므로 그것을 커서로 이어 읽는다.

- 상태 표 `email_status_sync_state`에 조직마다 `update_cursor`(마지막으로 다 읽은 상태 변경 시각)를 둔다. 처음에는 `now − NHN_STATUS_BACKFILL_DAYS(기본 8일)`로 잡는다 — **처음 채우기가 따로 없다.** 같은 장치가 8일을 거슬러 읽고 이어서 지금을 따라간다 (3-6)
- 회차마다 창 `[update_cursor − 5분, min(update_cursor + 1시간, now − 1분)]`을 읽는다. 5분 겹침은 NHN 쪽 늦은 기록을 위한 것이고, 다시 써도 결과가 같다 (3-8의 덮어쓰기 규칙)
  - 쿼리: `startMailStatusUpdateDate`·`endMailStatusUpdateDate` (KST `yyyy-MM-dd HH:mm:ss`, 새 순수 함수 `formatNhnDateTime`), `pageNum`, `pageSize=NHN_STATUS_PAGE_SIZE`(기본 100 — NHN 최댓값 [확인 필요]). 쪽 끝(`totalCount`)까지 읽고 나서야 커서를 창 끝으로 옮긴다
  - 창을 다 읽고 예산이 남으면 다음 창을 읽는다 (처음 8일 따라잡기도 회차 예산 안에서 창씩 이어 간다 — 멈춰도 다음 회차가 커서부터. PRD SND-1 수용 기준 1)
- 짝짓기 (`pairUpdatedMails`, 순수): 결과의 `requestId`로 `email_send_logs`를 찾는다 (`request_id = ANY($ids) AND org_id = $org`, `(request_id)` 색인 — 8-3). 샌드비 발송은 1통 1요청이라 요청 번호 안에 기록 하나면 그대로 짝짓는다. 기록이 여럿이면(예외) 그 요청 번호만 3-3의 요청 번호 조회로 넘겨 받는 주소로 짝짓는다 (`pairNhnRows`, `lower(trim(주소))`, PRD SND-1 수용 기준 3)
- 우리 기록이 없는 결과(같은 appKey를 쓰는 시험 발송·초대 메일 등)는 건너뛰고 건수 `unpaired`만 센다
- **같은 appKey를 쓰는 조직**은 한 번만 읽고 결과를 조직 조건으로 나눠 쓴다 (`email_configs`의 appKey로 묶음. 커서는 묶음마다 하나 — 상태 표의 대표 조직 줄에 두고 나머지 조직 줄은 같은 값을 따라 적는다)

### 3-3. 늦은 기록만 요청 번호로 묻기 (보조)

커서로 못 받은 기록을 메운다 (NHN이 목록에 빠뜨렸거나 짝이 여럿인 경우).

```sql
SELECT id, request_id, recipient_email, nhn_check_count
FROM email_send_logs
WHERE org_id = $org
  AND request_id IS NOT NULL
  AND sent_at >= now() - interval '48 hours'
  AND sent_at <= now() - interval '2 hours'           -- 커서가 보통 이 안에 결과를 준다
  AND (status IN ('sent', 'pending') OR delivery_fail_source = 'dsn')
  AND (nhn_status_code IS NULL OR nhn_status_code IN ('SST0', 'SST1', 'SST4'))
  AND nhn_check_count < 3
ORDER BY sent_at, id
LIMIT $fallbackLimit;                                    -- NHN_STATUS_FALLBACK_CALLS (기본 30)
```

- `delivery_fail_source = 'dsn'`을 넣는 까닭 (SND-01 (a)): 반송 안내가 먼저 와서 `status='failed'`가 된 기록도 NHN 코드를 받아야 5-1에서 갈래가 정해진다
- 같은 `request_id`는 한 번만 묻는다 (`queryMails({ requestId, pageSize: 15 })`). 물을 때마다 `nhn_check_count + 1`. 3번 물어도 없으면 그만 — 매일 보고의 "미확정"에 남는다
- 48시간이 지나도 커서는 계속 그 메일의 늦은 상태 변경(늦은 SST3 등)을 받는다 — 예전의 "48시간 뒤 늦은 SST3을 놓침"이 없다

### 3-4. 회차 예산·공평·잠금

- 회차마다 NHN 질문은 `NHN_STATUS_SYNC_MAX_CALLS`(기본 300) 이하 (`update-mails` 쪽 + 보조 질문), 시간은 4분 이하, 동시 3개.
- 여러 appKey 묶음이면 예산을 묶음 수로 나누고 남는 몫은 밀린 묶음에 다시 준다 (`splitBudget`, 순수).
- advisory lock `0x5c4edf08` — 두 회차가 겹치지 않는다 (PRD SND-1 수용 기준 4). 회신 읽기(RPL)는 `0x5c4edf07`, 건강 판정 `09`, 부팅 뒤 색인 `0a`.
- 평소 양(하루 약 2,200통 ≈ 시간당 90통)이면 회차마다 창 하나·쪽 하나 = 질문 1~2번이다. 예전 요청 번호 방식(하루 3,000~5,000번)보다 수십 배 적고, 발송(`eachMail`)과 같은 appKey 한도를 거의 쓰지 않는다.

### 3-5. NHN 오류

| 상황 | 처리 |
|---|---|
| HTTP 5xx·429·연결 오류·`isSuccessful=false` | 커서를 옮기지 않는다 (다음 회차가 같은 창부터). `consecutive_errors + 1`. 한 묶음에서 연속 5번이면 그 묶음은 이번 회차 그만 |
| HTTP 401·403 (키 문제) | 그 묶음은 이번 회차 그만. `last_error_code='auth'` + **운영 스페이스에 바로 알림** (6시간에 한 번, 다시 되면 한 번 — SND-02). 매일 보고에도 "NHN 키 확인 필요" |
| 동기화 정체: `last_ok_at`이 30분보다 오래됨 | 건강 회차가 운영 스페이스에 바로 알림 (6시간에 한 번) + 그동안 `enforce` 조치를 하지 않는다 (6-1 동기화 건강 관문) |
| 이메일 설정 없음 (`getEmailClient` null) | 조직을 건너뛴다 |

오류 글에는 받는 주소·키를 넣지 않는다.

### 3-6. 처음 채우기

- 따로 장치를 두지 않는다. 3-2의 커서를 처음에 `now − NHN_STATUS_BACKFILL_DAYS`(기본 8일, 0이면 `now − 1시간`)로 잡으면 같은 장치가 거슬러 읽는다. 따라잡는 동안은 `initial_done_at`이 비어 있고, 커서가 `now − 1시간` 안으로 들어오면 적는다 — 이 값이 비어 있으면 6-1 관문이 `enforce`를 알림으로 낮춘다
- NHN이 오래된 상태 변경 기간을 거절하면(문서에 기간 제한이 없다 [확인 필요]) 거절된 창은 건너뛰고(`skippedWindows`) 커서를 넘긴다. 그 기간의 기록은 3-3이 48시간 안 것만 메우고 나머지는 미확정으로 남는다 — 판정에서 빠질 뿐이다
- 이미 확정 코드가 있는 기록은 확정 코드로만 덮는다. 보낼 때 거절된 기록(F8)도 NHN이 목록에 주면 그 코드를 적는다.
- PRD의 "약 3달치 처음 채우기"(SND-2용)는 SND-2에서 `queryMailsPaged`(F5, 받는 주소 포함)로 따로 한다. 이 문서 범위에서는 8일이면 된다. **모든 쓰기는 3-8 `applyNhnStatuses` 한 문장을 지난다** — 처음 채우기·커서·보조 질문·화면 버튼 어디서 와도 반송 안내 보호(SND-01 (c))가 같다

### 3-7. 화면 버튼 (`POST /api/email/logs/sync`)

버튼도 같은 함수 `syncOrgStatuses(orgId, { maxCalls: 100, trigger: 'manual' })`를 부른다 (그 조직 묶음의 커서 따라잡기 + 3-3 보조). 결과 기록 규칙이 두 벌이면 한쪽만 고쳐진다. 응답 형식(`{ synced, updated, ... }`)은 이름을 맞춰 그대로 둔다. 예전 "30일 sent 전부 다시 보기" 단계는 없앤다.

### 3-8. 기록 쓰기 (한 문장 `applyNhnStatuses`)

```sql
UPDATE email_send_logs AS l SET
  nhn_status_code      = v.code,
  nhn_checked_at       = now(),
  -- 반송 안내(dsn)로 실패가 된 기록은 NHN이 SST2를 줘도 'failed'로 남는다 (SND-01 (b)(c))
  status               = CASE WHEN v.log_status IS NULL OR l.delivery_fail_source = 'dsn' THEN l.status ELSE v.log_status END,
  result_code          = CASE WHEN v.code IN ('SST3','SST5','SST7','SST8') THEN v.reason_code ELSE l.result_code END,
  result_message       = CASE WHEN v.code IN ('SST3','SST5','SST7','SST8') THEN v.reason_text ELSE l.result_message END,
  completed_at         = CASE WHEN v.final THEN COALESCE(v.result_at, now()) ELSE l.completed_at END,
  delivery_status_code = CASE WHEN v.code = 'SST3' THEN COALESCE(v.dsn_code, l.delivery_status_code) ELSE l.delivery_status_code END,
  delivery_fail_side   = CASE WHEN v.code IN ('SST7','SST8') THEN 'sender'
                              WHEN v.code = 'SST3' THEN v.fail_side
                              ELSE l.delivery_fail_side END,
  delivery_fail_source = CASE WHEN v.code = 'SST3' THEN COALESCE(l.delivery_fail_source, 'nhn') ELSE l.delivery_fail_source END,
  delivery_failed_at   = CASE WHEN v.code = 'SST3' THEN COALESCE(l.delivery_failed_at, v.result_at, now()) ELSE l.delivery_failed_at END
FROM (VALUES ...) AS v(id, code, log_status, final, reason_code, reason_text, result_at, dsn_code, fail_side)
WHERE l.id = v.id AND l.org_id = $org
  AND (l.nhn_status_code IS NULL OR l.nhn_status_code IN ('SST0','SST1','SST4') OR v.final);  -- 확정 코드는 확정 코드로만 덮는다
```

조직 조건을 꼭 단다 (PRD 6절). 한 회차의 결과는 200줄씩 묶어 쓴다. 이 문장 하나를 커서·보조 질문·버튼이 모두 쓴다 (`v.log_status`·`v.fail_side`는 순수 `mapNhnStatus`·`classifyFailSide`가 만든다).

---

## 4. 신호 ② 반송 안내(DSN) — 회신 읽기(RPL)와의 경계

두 문서의 계약은 이 절 하나다 (SND-01 = RPL B2. `DESIGN-RPL.md` 7-3에 같은 표가 있다).

### 4-1. 왜 필요한가

NHN의 Return-Path는 보낸 주소(`cs@<발신 도메인>`)다. 받는 서버가 접수한 **뒤에** 되돌려 보내는 반송 안내는 NHN 상태(SST2)를 바꾸지 않고 그 주소로 온다. 그 주소들은 모두 MX가 구글 워크스페이스라 회신 메일함(`REPLY_MAILBOX`)에 쌓인다. 그래서 회신 읽기가 이미 보는 메일 중 반송 안내를 실패 신호로 더한다.

### 4-2. 나눔

| 하는 일 | 맡는 쪽 |
|---|---|
| 메일함 읽기, "샌드비 발신 주소 앞으로 온 메일만" 거르기(머리글 먼저), 반송 안내 알아보기, `message/delivery-status` 풀기, 원본 Message-ID로 발송 찾기, 회신 장부 줄(`email_replies`, `kind='bounce'` — 화면·분류 고치기용) | RPL (`DESIGN-RPL.md` 4~7절) |
| 대체 짝짓기(받는 주소·우리 주소·7일), hard/soft 기준(`classifyDsn`), 받는 사람 같음 확인, `email_send_logs` 쓰기, 실패 한 번만 세기, 중복 막기, 신호 표 `email_bounce_signals`, 밀린 신호 적용 | SND (이 문서, `src/lib/email-bounce-signal.ts`) |
| 반송된 주소로 자동 메일을 다시 보내지 않기 (SEQ-1 "첫 메일 실패") | RPL 7-4 보내기 직전 막기가 `email_bounce_signals`를 읽는다. 대기열을 미리 고치지 않는다 |

- **`email_send_logs`의 배달 결과 칸을 쓰는 곳은 이 문서의 두 함수뿐이다**: NHN 결과 `applyNhnStatuses`(3-8)와 반송 안내 `recordBounceSignal`(4-5). RPL은 직접 쓰지 않는다.
- 판정은 늘 `delivery_fail_source`·`delivery_fail_side`·`nhn_status_code` 칸으로 한다. `result_code`는 표시용(`DSN:5.1.1` 모양)이고 **어느 문서도 `result_code LIKE 'DSN:%'`로 판정하지 않는다**.
- 반송 안내는 받는 이가 샌드비 발신 주소(Return-Path)이므로 RPL의 개인정보 거름을 통과한다. 그 밖의 메일은 SND가 보지 않는다.

### 4-3. 계약

```ts
// src/lib/email-bounce-signal.ts
export interface BounceSignalInput {
    orgIds: string[];                // 받은 우리 주소의 조직들 (RPL 4-1 지도). 하나면 그 조직
    gmailMessageId: string;          // Gmail 메시지 번호 — 중복 막기 열쇠
    receivedAt: Date;                // 메일함 도착 시각 (internalDate)
    toAddress: string;               // 반송 안내를 받은 우리 발신 주소 (정규화)
    threadLogId: number | null;      // RPL이 원본 Message-ID(요청 번호)로 찾은 발송 기록 id. 있으면 이것을 먼저 쓴다
    signal: 'dsn' | 'complaint';     // complaint = 스팸 신고(ARF feedback-report, RPL m7)
    apply: boolean;                  // RPL이 on이면 true. false면 신호 줄만 남기고 발송 기록은 그대로 (applied_at NULL)
    recipients: Array<{
        finalRecipient: string | null;     // Final-Recipient (rfc822; 를 뗀 주소)
        originalRecipient: string | null;  // Original-Recipient
        action: string | null;             // failed | delayed | delivered | relayed | expanded
        status: string | null;             // "5.1.1" 같은 DSN 상태
        diagnostic: string | null;         // Diagnostic-Code (앞 300자)
    }>;
}
export interface BounceSignalOutcome {
    signalId: number; sendLogId: number | null; recordId: number | null;
    kind: 'hard' | 'expired' | 'soft' | 'unknown' | 'complaint';
    recipientMatch: 'same' | 'different' | null;   // null = 발송을 못 이음
    applied: boolean; counted: boolean; duplicate: boolean;
}
export async function recordBounceSignal(input: BounceSignalInput, tx?: DbTx): Promise<BounceSignalOutcome[]>;
export async function applyPendingBounceSignals(orgIds: string[], since: Date, tx?: DbTx): Promise<BounceSignalOutcome[]>;
```

- 던지지 않는다. DB 오류만 던진다 (RPL의 메일 하나 격리가 받는다 — RPL 7-1).
- **`classifyDsn(action, status)` 하나** (순수, `email-status-sync-rules.ts`, RPL도 import):
  - `failed` + `5.x.x` (또는 Action 없이 `5.x.x`) → `hard` — 주소 없음 등 영구 실패
  - `failed` + `4.x.x` → `expired` — 재시도 끝(예 4.4.7). 배달은 실패했지만 주소가 없다는 뜻은 아니다
  - `delayed`, 또는 그 밖의 `4.x.x` → `soft` — 아직 시도 중
  - 그 밖(delivery-status 없음, `delivered`·`relayed`) → `unknown`
- 실패로 세는 것: `hard`·`expired`. 막기(RPL 7-4)는 `hard`만.

### 4-4. 짝짓기

받는 사람마다:

1. `threadLogId`가 있으면 그 기록 (조직이 `orgIds` 안일 때만).
2. 없으면 대체: 받는 주소 = `finalRecipient`(없으면 `originalRecipient`), 우리 주소 = `toAddress`, 7일.

```sql
SELECT l.id, l.org_id, l.record_id, l.recipient_email, l.nhn_status_code, l.delivery_fail_source
FROM email_send_logs l
WHERE l.org_id = ANY($orgIds)
  AND l.sent_at <= $receivedAt AND l.sent_at >= $receivedAt - interval '7 days'
  AND lower(btrim(l.recipient_email)) = $recipient
  AND lower(COALESCE(l.sender_email, '')) = $toAddress
ORDER BY l.sent_at DESC
LIMIT 2;
```

- `(org_id, sent_at)` 색인(8-3)으로 7일 범위를 좁힌 뒤 거른다. 가장 최근 발송 하나에 잇는다 (반송은 보통 몇 분~며칠 안, 후속은 며칠 뒤).
- 후보가 두 조직에 걸치면 못 이은 것으로 둔다(조직 섞임 막기). 조직이 하나로 정해지지 않으면 신호 줄의 `org_id`를 정할 수 없으므로 줄을 남기지 않고 건수만 RPL 회차 통계에 센다.
- 짝짓기 기간은 **7일 하나**다 (RPL의 예전 14일은 없앴다). 대부분의 MTA는 4~5일 재시도 뒤 포기한다.
- **받는 사람 같음 (`recipient_match`, RPL M3)**: 반송의 `finalRecipient`(없으면 `originalRecipient`)를 정규화한 값이 이어진 발송의 `recipient_email`과 같으면 `same`, 다르면 `different`(별칭 전개·전달받은 주소에서 난 반송). `different`는 신호 줄만 남기고 발송 기록을 바꾸지 않는다 — 실제로 잘 받은 원래 발송을 실패로 바꿔 실패율을 올리지 않게.
- `complaint`는 `threadLogId`로만 잇는다 (스팸 신고에는 받는 주소가 가려져 오는 일이 많다). 받는 주소 칸은 이어진 발송의 받는 주소, 못 이으면 빈 글자.

### 4-5. 중복 막기와 셈

- `email_bounce_signals`의 유일 키 `(org_id, gmail_message_id, recipient_email)` — 같은 안내를 두 번 받아도 한 줄 (`duplicate=true`).
- 발송 기록을 바꾸는 조건: `apply=true` AND `kind IN ('hard','expired')` AND `recipient_match='same'`. 그때 (한 기록에 실패는 한 번만 센다):

```sql
WITH prev AS (
  SELECT id, delivery_fail_source AS prev_source
  FROM email_send_logs WHERE id = $logId AND org_id = $org FOR UPDATE
)
UPDATE email_send_logs l SET
  delivery_fail_source = COALESCE(l.delivery_fail_source, 'dsn'),
  delivery_failed_at   = COALESCE(l.delivery_failed_at, $receivedAt),
  delivery_status_code = COALESCE(l.delivery_status_code, $status),
  delivery_fail_side   = COALESCE(l.delivery_fail_side, $failSide),        -- classifyFailSide($status, $diagnostic) — 5.7.x·SPF·DKIM·DMARC면 'sender'
  status               = CASE WHEN l.nhn_status_code IN ('SST5','SST7','SST8') THEN l.status ELSE 'failed' END,
  result_code          = CASE WHEN l.nhn_status_code = 'SST3' THEN l.result_code ELSE 'DSN:' || $status END,
  result_message       = CASE WHEN l.nhn_status_code = 'SST3' THEN l.result_message ELSE '반송 안내: ' || $statusLabel END
FROM prev
WHERE l.id = prev.id
RETURNING (prev.prev_source IS NULL) AS counted;   -- 이 신호로 처음 실패가 됐나
```

- 그리고 신호 줄에 `applied_at = now()`, `counted`(위 RETURNING).
- `apply=false`(RPL dry_run)면 신호 줄만 남긴다 (`applied_at` NULL). RPL이 on이 되면 `applyPendingBounceSignals(orgIds, now − 14일)`이 `applied_at IS NULL`인 줄에 위 UPDATE를 한다.
- **NHN 결과와의 순서 (SND-01 (a)(b)(c))** — 어느 순서로 와도 실패는 한 번, 갈래는 5-1이 정한다:
  - 반송 먼저 → NHN SST2: 커서(3-2)는 상태와 상관없이 요청 번호로 짝짓고, 보조 질문(3-3)도 `delivery_fail_source='dsn'`인 기록을 묻는다. 3-8의 `CASE`가 `status='failed'`를 지킨다. 5-1 갈래는 "반송만(SST2 뒤 반송)".
  - NHN SST2 먼저 → 반송: 위 UPDATE가 `failed`로 바꾼다. 같은 갈래.
  - NHN 결과 전 반송: 5-1 "미확정"(NHN 결과가 올 때까지 판정에서 빠진다 — SND-02).
  - 이미 SST3(`delivery_fail_source='nhn'`)이면 바뀌는 것이 없다 — 신호 줄만 남고 `counted=false`.
- 짝 없는 반송 안내 수, `different` 수, 스팸 신고 수는 매일 보고에 나온다.
- 반송 안내로 실패가 돼도 중복 수신자 확인에서 빠지지 않는다 — 중복 확인은 "NHN이 접수한 발송"을 본다 (6-6, SND-11).


---

## 5. 판정 규칙 (순수 — `src/lib/sender-health-rules.ts`)

PRD 7-4의 이름을 따른다. DB를 모른다 (`@/lib/db` import 금지). 웜업 규칙 파일과 같은 방식이다.

### 5-1. 무엇을 세나

발송 기록 하나는 아래 중 정확히 하나다.

| 갈래 | 조건 (위에서부터 먼저) | 실패율 |
|---|---|---|
| 시험 발송 | `trigger_type LIKE 'test%'` | 아예 안 셈 |
| 발신 쪽 실패 | `delivery_fail_side = 'sender'` (SST7·SST8, SST3·반송의 5.7.x·SPF·DKIM·DMARC·policy — 3-1) | 명단 실패율에서 **뺀다**. 주소·도메인 판정(5-3 "발신 쪽 실패 폭주")과 보고에 쓴다 (SND-06) |
| NHN 수신거부 | `nhn_status_code = 'SST5'` | 뺀다, 따로 보고 |
| 실패 | `nhn_status_code = 'SST3'` | 분자·분모 |
| 반송만 (NHN 성공 뒤 반송 안내) | `nhn_status_code = 'SST2' AND delivery_fail_source = 'dsn'` | `SEND_HEALTH_DSN_IN_RATE=on`이면 분자·분모. **기본(off)이면 뺀다** — 보고에 `dsn_only`로 따로 (SND-02) |
| 성공 | `nhn_status_code = 'SST2'` | 분모 |
| 보낼 때 거절 | `request_id IS NULL OR (status = 'failed' AND nhn_status_code IS NULL AND delivery_fail_source IS NULL)` | 뺀다 |
| 미확정 | 나머지 (NHN 결과 전·SST0/1/4 — **NHN 결과 없이 반송 안내만 있는 기록 포함**) | 뺀다, 보고에 건수. 6-1 동기화 건강 관문에 쓴다 |

- **확정 = 실패 + 성공 (+ `DSN_IN_RATE`면 반송만). 실패율 = 실패 ÷ 확정.** 분모에는 NHN 확정 코드(SST2·SST3)가 있는 기록만 들어간다 (SND-02 — NHN 동기화가 늦을 때 반송 안내만 실패로 들어가 실패율이 부푸는 일을 막는다)
- 반송 안내를 기본으로 빼는 까닭: 반송 안내는 10/10 MX 연결 뒤 처음 생긴 신호라, PRD 기준선(SST3만, 120일 1.7%)과 문턱 5%가 그 위에서 정해지지 않았다. `dry_run`·`alert` 기간 매일 보고에 `dsn_only`를 명단·주소마다 보이고, 대표가 문턱을 다시 본 뒤 `SEND_HEALTH_DSN_IN_RATE=on`으로 넣는다 (16절)
- 예전 판의 "보낼 때 거절" 조건(`status='failed' AND nhn_status_code IS NULL`)은 반송 안내가 먼저 온 기록을 거절로 잘못 넣었다 (SND-01 (a)) — `delivery_fail_source IS NULL`을 더했다
- 비교는 정수로 한다: `failed × 10000 ≥ final × 500` (5.00%), 비율 표시는 `rate_bp`(만분율).
- 후속·수동·템플릿 메일도 그 기록의 명단·주소에 센다 (명단에 가는 모든 메일). 수동 발송은 레코드의 명단으로 적는다 (6-2, SND-16)

### 5-2. 창

- **지금부터 거꾸로 7일(168시간) 굴리는 창.** PRD의 "7일 평균"·"회복 7일"과 맞춘다.
- **느린 명단의 보조 창 (SND-17)**: 7일 확정이 200통이 안 되는 명단은 **30일 창**(또는 명단의 첫 발송 이후 중 짧은 쪽)으로 한 번 더 본다. 30일 확정이 200통 이상이면 그 숫자로 위험·주의를 판정한다 (`eval_window='30d'`로 기록·알림 글에 표시). 웜업·주소 한도 아래에서 하루 25통씩 나가는 명단도 몇 주 안에 판정된다. 유예 하한은 그대로 걸린다.
- 집계는 시간 단위 묶음으로 읽는다 (6-0 집계 문장). 판정은 순수 함수가 묶음을 더해서 한다.
- **재판정 유예**: 명단 보류를 풀었거나 자동 멈춘 주소를 풀면, 그 대상은 **풀린 시각 뒤에 나간 발송만** 센다 (SND-05 — 예전 판의 "다음 정시부터"는 풀린 시각~다음 정시에 나간 메일을 영원히 판정 밖에 두었다). 보류·멈춤 동안에는 그 대상으로 나간 메일이 없으므로 풀린 시각이 정확한 경계다. 6-0 집계가 대상별 하한을 받아 `sent_at >= 하한`으로 가른다. 다시 200통(주소 칸은 50통)이 쌓여야 판정한다.
  - 명단: 그 명단의 가장 최근 `email_partition_holds.released_at`
  - 주소: `email_sender_profiles.health_reset_at`
  - **명단의 하한은 그 명단의 "주소 × 명단" 칸에도 걸린다** (SND-04 — 보류 전 실패가 풀린 뒤 주소 판정에 남지 않게)

### 5-3. 상태와 기준 (PRD SND-3 표 + 검토 반영)

| 상태 | 대상 | 기준 (확정 기준) | 1판 모드(`alert`) | 2판 모드(`enforce`) |
|---|---|---|---|---|
| 위험 — 명단 | 명단 | 7일(느린 명단은 30일) 확정 **200통 이상**, 실패율 **5% 이상** | 즉시 알림 | **명단 대량 발송 보류** + 즉시 알림 |
| 위험 — 주소 | 발신 주소 | "그 주소 × 명단" 칸 중 **뚜렷이 높은 칸(5-4)이 2개 이상** | 즉시 알림 | **주소 멈춤** + 즉시 알림 (조직 기본 주소는 알림만 — 6-3, SND-08) |
| 위험 — 주소 (명단과 함께) | 발신 주소 | 위험 명단 2개 이상의 **주된 발신**(그 명단 확정의 50% 이상을 이 주소가 보냄) (SND-07, PRD SND-3 수용 기준 3) | 즉시 알림 | 즉시 알림만 (명단이 이미 보류되어 발송은 멈춘다 — 대표 확인 필요, 16절) |
| 위험 — 발신 쪽 실패 폭주 | 발신 도메인 | 최근 **1시간** 그 도메인 발송에서 발신 쪽 실패(5-1)가 **3통 이상이면서 (확정 + 발신 쪽 실패)의 20% 이상**, 또는 10통 이상 (SND-06) | **즉시 운영 알림** | 그 도메인 주소 **모두 멈춤**(기본 주소는 알림만) + 즉시 알림. 상한은 따로 (6-4) |
| 주의 | 명단 | 확정 200통 이상, 실패율 3% 이상 5% 미만 | 매일 보고 | 매일 보고 (자동 조치 없음) |
| 주의 | 주소 | 주소 전체 확정 200통 이상에서 3% 이상, 또는 뚜렷이 높은 칸이 1개 | 매일 보고 | 매일 보고 |
| 주의 | 발신 도메인 | 최근 24시간 발신 쪽 실패가 1통 이상 (폭주 기준 아래) | 매일 보고 | 매일 보고 |
| 판정 보류 | 명단·주소 | 확정이 기준보다 적다 (명단은 7일·30일 모두 200 미만, 주소는 판정할 칸이 없음) | "판정 보류"로 표시, 알림 없음 | 같음 |
| 회복 | 명단·주소 | 지난 7일 안에 주의·위험이었고 지금 정상 | 표시 | 표시 (자동 해제는 하지 않는다, 6-5) |

- PRD의 다른 주의 신호(네이버·다음 1분 뒤 열람 2% 미만, 사흘 연속 사람 반응 0)는 재료가 아직 없다 (MEA-1·SEQ-2 뒤). 1판에서는 판정하지 않고 보고에 "재료 없음"도 쓰지 않는다. 수신거부율·스팸 신고(RPL `complaint` 신호) 수는 숫자만 보고에 싣는다(기준 없음).
- 같은 도메인 주소를 합친 숫자(PRD "같은 도메인 주소를 합쳐서")는 보고와 화면에만 보인다. 도메인 단위 조치는 "발신 쪽 실패 폭주" 하나뿐이다.
- 발신 쪽 실패 폭주를 즉시로 둔 까닭 (SND-06): 그 도메인 메일이 거의 다 실패하는데 매일 보고만 하면 다음 날 아침까지 리드와 AI 토큰을 버린다 (PRD 12-2 "몇 주를 모르고 보내는 일을 막는다", 대표 결정 "멈추고 알림"). 반대로 DNS 사고(10/10처럼 여러 도메인을 고치다 깨짐)로 5.7.x 거절이 몰려도 발신 쪽으로 가르므로 **명단이 잘못 보류되지 않고**, 알림이 "명단 쪽 문제"라고 틀리게 진단하지 않는다.
- 문턱 값은 코드 상수다 (`DEFAULT_THRESHOLDS`). 운영하며 고칠 때 순수 함수 시험이 함께 바뀐다.

```ts
export const DEFAULT_THRESHOLDS = {
    windowMs: 7 * 24 * 60 * 60 * 1000,
    slowWindowMs: 30 * 24 * 60 * 60 * 1000,      // 느린 명단 보조 창 (SND-17)
    partitionMinFinal: 200,
    dangerRateBp: 500,
    cautionRateBp: 300,
    pairMinFinal: 50,                             // 칸 확정 최소
    pairMinFailed: 3,                             // 칸 실패 최소
    pairRestMinFinal: 100,                        // 같은 명단 다른 주소 확정 최소 (비교할 재료)
    pairRestFloorBp: 50,                          // 다른 주소 실패율 바닥 0.5% (0으로 비교하지 않게)
    pairMaxPValue: 0.01,                          // 칸이 "우연히" 이만큼 높을 확률 상한 (5-4)
    senderDangerMinPartitions: 2,
    senderCautionMinFinal: 200,
    primarySenderShareBp: 5000,                   // 명단 확정의 50% 이상 = 주된 발신 (SND-07)
    senderSideLookbackMs: 24 * 60 * 60 * 1000,
    authBurstWindowMs: 60 * 60 * 1000,            // 발신 쪽 실패 폭주 창 (SND-06)
    authBurstMinCount: 3,
    authBurstMinRateBp: 2000,
    authBurstHardCount: 10,
    maxUnconfirmedBp: 2000,                       // 대상 미확정 비율이 20%를 넘으면 enforce 대신 알림 (SND-02)
    syncStaleMs: 30 * 60 * 1000,                  // 동기화 마지막 성공이 30분보다 오래되면 enforce 대신 알림
} as const;
```

### 5-4. 주소 위험 — "같은 명단의 다른 주소보다 뚜렷이 높은 칸"만 센다 (결정, SND-03·04)

- PRD 근거: "우리 실패는 대개 명단 탓이라 명단을 먼저 보고, 주소 멈춤은 여러 명단에서 함께 높을 때로 둔다. 묶음 주소가 한꺼번에 멈추면 발송량이 무너지기 때문이다."
- 예전 판은 칸이 "50통·3실패·5%"만 넘으면 셌다. 명단 실제 실패율이 3%면 칸 하나가 우연히 3/50(6%)을 넘을 확률이 18.9%, 4%면 32.3%라, 주소 20개가 명단 4개에 50통씩 보내면 주마다 주소 3~8개가 순전히 우연으로 멈춘다 (SND-03). 그래서 **칸을 같은 명단의 다른 주소와 비교한다.**

**뚜렷이 높은 칸** (`isOutlierCell`, 순수) — 아래를 모두 만족:
1. 칸(주소 s × 명단 p, 두 하한 뒤 발송만): 확정 ≥ `pairMinFinal`(50), 실패 ≥ `pairMinFailed`(3), 실패율 ≥ 5%
2. 같은 명단의 **나머지 주소**(p 전체 − 칸, 같은 하한): 확정 ≥ `pairRestMinFinal`(100). 나머지 실패율 `r0 = max(나머지 실패율, 0.5%)`
3. 칸이 우연히 이만큼 나쁠 확률 `P(X ≥ 칸 실패 | n = 칸 확정, p = r0) < 0.01` (이항 윗꼬리, 순수 `binomUpperTail` — 반복 곱셈, n은 많아야 수천)

**빼는 명단** (그 명단의 칸은 아예 보지 않는다):
- 그 회차에 위험·주의인 명단 (7일·30일 어느 쪽이든)
- 판정 보류지만 실패율이 3% 이상인 명단 (표본이 적어 판정 못 했을 뿐 나쁠 수 있다)
- **풀리지 않은 보류가 있는 명단** — 6-4 "보류 중 다시 판정 안 함"으로 명단 판정에서 빠져도 칸에서는 빠지지 않던 구멍 (SND-04 (1))
- **최근 7일 안에 보류되었거나 풀린 명단** (SND-04 (2))

이렇게 하면:
- 나쁜 명단 두 개를 묶음 주소 20개가 나눠 보내도, 그 명단들은 위험이거나 보류 중이라 칸에서 빠진다 → 주소 20개가 한꺼번에 멈추지 않는다
- 명단을 풀어도 그 명단은 7일 동안 칸에서 빠진다 → 푸는 순간 그 명단을 보낸 주소들이 멈추지 않는다
- 정상 명단(2%)에서 칸이 우연히 6%여도 나머지와 비교해 뚜렷하지 않으면 안 센다 (위 3번. 칸 하나가 잘못 걸릴 확률이 1% 아래라, 2개가 함께 걸릴 확률은 주소당 주 0.1% 아래)
- 템플릿처럼 **주소 하나가 혼자 보내는 명단**은 나머지가 없어 칸이 되지 않는다 → 조직 기본 주소가 템플릿 명단 비율을 그대로 따라 멈추는 일이 없다 (SND-08)
- 남는 경우: 주소 하나가 명단 두 개를 혼자 보내고 그 주소가 고장 난 경우 — 두 명단이 위험이면 보류되어 발송은 멈춘다. 그 주소가 두 위험 명단의 주된 발신이면 "위험 — 주소 (명단과 함께)" 알림을 보낸다 (5-3, SND-07). 알림 글에 "이 명단을 보낸 주소가 사실상 하나 — 주소 문제일 수 있음"
- 알림 글에는 "같은 명단의 다른 주소 실패율"을 함께 보여 사람이 가를 수 있게 한다.

### 5-5. 경계 예시 (순수 함수 시험에 그대로 쓴다)

| 입력 (7일, 확정 기준) | 결과 |
|---|---|
| 명단 확정 199, 실패 20 (10.1%) | 판정 보류 (30일도 199면) |
| 명단 확정 200, 실패 10 (5.00%) | 위험 (경계 포함) |
| 명단 확정 200, 실패 9 (4.50%) | 주의 |
| 명단 확정 200, 실패 6 (3.00%) | 주의 (경계 포함) |
| 명단 확정 200, 실패 5, SST7 40통 | 정상 (SST7은 뺀다) + 발신 도메인 주의 |
| 명단 확정 200, 실패 5, 그 밖에 SST3 `5.7.26 dmarc` 30통 | 명단 정상 (발신 쪽으로 감) + 1시간 안이면 그 도메인 발신 쪽 실패 폭주 |
| 명단 확정 300 중 미확정 100 | 분모 200으로 판정 (단 미확정 33% > 20%라 enforce면 알림만 — 6-1) |
| 명단 SST2 300 + 반송만 20 (`DSN_IN_RATE` off) | 확정 300·실패 0 → 정상, 보고에 `dsn_only 20` |
| 같은 경우 `DSN_IN_RATE` on | 확정 320·실패 20 (6.25%) → 위험 |
| 명단 7일 150통·30일 400통 실패 24 (6%) | 위험 (`eval_window='30d'`) |
| 주소 S: 명단 A 60통 4실패(6.7%), 명단 B 58통 4실패(6.9%), A·B 나머지 주소 240통 0.5%·0.4% | 주소 위험 (두 칸 모두 p < 0.01) |
| 주소 S: 명단 A 60통 4실패, 명단 B 49통 4실패 | 주소 주의 (B는 50통 미만이라 칸 아님) |
| 주소 S: 명단 A 60통 2실패(3.3%)·실패 3 미만 | 셈 안 함 |
| 주소 S: 명단 A·B(정상 2.5%)에서 칸 50통 3실패(6%) | 셈 안 함 (p ≈ 0.13 — 우연) |
| 명단 3.5%(주의)에서 주소 칸이 우연히 6% | 셈 안 함 (주의 명단은 뺀다) |
| 주소 S: 명단 A·B 모두 6%(각 220통, 위험), S가 A·B 확정의 각 60%를 보냄 | A·B 보류, S는 멈추지 않음, **"위험 — 주소 (명단과 함께)" 알림** (PRD 수용 기준 3 문구 — SND-07) |
| 같은 경우 S가 A·B의 각 10%만 보냄 (묶음 주소 중 하나) | A·B 보류, S 알림 없음 |
| 명단 A·B 보류 다음 회차 (두 명단 실패가 7일 창에 그대로) | 주소 멈춤 0 (보류 중 명단은 칸에서 뺌 — SND-04) |
| 명단 A를 14:20에 풀고 바로 다음 회차 | 명단 A 판정 보류, A를 보낸 주소 멈춤 0 (최근 7일 풀린 명단은 칸에서 뺌) |
| 보류를 14:20에 풀었고 그 뒤 확정 150통 | 판정 보류 (**14:20 이후 발송부터** 셈 — SND-05) |
| 기본 주소 D가 위험 — 주소 | D는 멈추지 않고 알림 (`action_note='default_sender'`) |
| 도메인 x.kr: 최근 1시간 확정 20 + 발신 쪽 실패 6 (5.7.26) | 발신 쪽 실패 폭주 → x.kr 주소 멈춤 (enforce) |
| 도메인 y.kr: 최근 1시간 확정 50 + 발신 쪽 실패 2 | 폭주 아님 (3통 미만) → 발신 도메인 주의 |

---

## 6. 조치 (SND-3 2판, 대표 결정 "멈추고 알림")

### 6-0. 집계 문장 (조직마다)

**① 7일 묶음** — 대상별 하한(5-2 재판정 유예)을 넘겨 `sent_at >= 하한`인지를 묶음 열쇠에 넣는다 (SND-05). 하한이 없는 대상은 `-infinity`.

```sql
WITH pf AS (SELECT * FROM unnest($partitionIds::int[], $partitionFloors::timestamptz[]) AS t(pid, floor_at)),
     sf AS (SELECT * FROM unnest($profileIds::int[],   $profileFloors::timestamptz[])   AS t(sid, floor_at))
SELECT l.partition_id, l.sender_profile_id,
       lower(split_part(COALESCE(l.sender_email, ''), '@', 2)) AS sender_domain,
       date_trunc('hour', l.sent_at)                            AS hour_start,
       l.sent_at >= COALESCE(pf.floor_at, '-infinity')          AS after_p,   -- 명단 하한 뒤 (명단·칸 판정에 씀)
       l.sent_at >= COALESCE(sf.floor_at, '-infinity')          AS after_s,   -- 주소 하한 뒤 (주소·칸 판정에 씀)
       count(*) FILTER (WHERE <확정>)       AS final,
       count(*) FILTER (WHERE <실패>)       AS failed,
       count(*) FILTER (WHERE <발신 쪽 실패>) AS sender_side,
       count(*) FILTER (WHERE <NHN 수신거부>) AS nhn_unsub,
       count(*) FILTER (WHERE <미확정>)     AS unknown,
       count(*) FILTER (WHERE <반송만>)     AS dsn_only
FROM email_send_logs l
LEFT JOIN pf ON pf.pid = l.partition_id
LEFT JOIN sf ON sf.sid = l.sender_profile_id
WHERE l.org_id = $org AND l.sent_at >= $now - interval '7 days' AND l.sent_at < $now
  AND COALESCE(l.trigger_type, '') NOT LIKE 'test%'
GROUP BY 1, 2, 3, 4, 5, 6;
```

**② 느린 명단 30일** (SND-17) — 7일 확정이 200 미만인 명단만, 명단 단위로:

```sql
SELECT l.partition_id, (l.sent_at >= COALESCE(pf.floor_at, '-infinity')) AS after_p,
       min(l.sent_at) AS first_sent_at, count(*) FILTER (WHERE <확정>) AS final, count(*) FILTER (WHERE <실패>) AS failed
FROM email_send_logs l LEFT JOIN pf ON pf.pid = l.partition_id
WHERE l.org_id = $org AND l.partition_id = ANY($slowPartitionIds)
  AND l.sent_at >= $now - interval '30 days' AND l.sent_at < $now
  AND COALESCE(l.trigger_type, '') NOT LIKE 'test%'
GROUP BY 1, 2;
```

**③ 발신 쪽 실패 폭주** (SND-06) — 최근 1시간, 도메인·주소별 `final`·`sender_side` (①과 같은 식, 창만 1시간).

- `<…>`는 5-1 표의 조건을 순서대로 옮긴 같은 식이다 (한 곳 `healthBucketSql({ dsnInRate })`에서 만든다). 실패 사유 상위는 실패 기록만 `(partition_id, sender_profile_id, delivery_status_code)`로 묶어 따로 읽는다 (알림 글용).
- 세 문장 모두 `(org_id, sent_at)` 색인(8-3)을 쓴다. 색인이 아직 없으면(부팅 직후 만드는 중) 그 회차는 판정을 건너뛰고 `skipped: 'index_pending'`으로 끝난다 — 큰 표 전체를 훑지 않는다.

### 6-1. 모드와 동기화 건강 관문

`SEND_HEALTH_MODE` (환경 변수, `resolveSendHealthConfig`, 깊이 알림의 `DEEP_ALERT_MODE`와 같은 방식)

| 값 | 판정·기록 | 구글 챗 | 명단 보류·주소 멈춤 |
|---|---|---|---|
| `off` | 안 함 | 안 함 | 안 함 (이미 걸린 보류·멈춤은 그대로 막는다 — 풀기는 된다) |
| `dry_run` (**코드 기본값**, 모르는 값도 이것) | 함. 사건·알림 글을 `dry_run`으로 남긴다 | 안 보냄 | 안 함 — 사건에 "했을 조치"만 적는다 |
| `alert` (PRD 1판) | 함 | 보냄 | 안 함 |
| `enforce` (PRD 2판, 대표 결정) | 함 | 보냄 | **함** (아래 관문을 지날 때만) |

- 권장 순서: 개발 서버에서 `dry_run` 며칠 → 기록을 대표가 본 뒤 운영 `alert` → 1주 뒤 `enforce`. 운영 목표는 `enforce`다 (대표 결정).
- `enforce`에서 `alert`로 내려도 걸린 보류·멈춤은 저절로 풀리지 않는다. 관리자가 푼다.
- `dry_run` 사건은 나중에 `alert`로 바꿔도 보내지 않는다 (밀린 알림이 한꺼번에 나가지 않게 — 깊이 알림과 같은 원칙).

**동기화 건강 관문 (SND-02)** — `planActions`(순수)가 대상마다 본다. 하나라도 걸리면 `enforce`여도 **보류·멈춤 없이 알림만** 하고 사건에 `action_note`로 까닭을 남긴다:

| 관문 | 조건 | `action_note` |
|---|---|---|
| 동기화 정체 | 그 조직 `email_status_sync_state.last_ok_at`이 30분(`syncStaleMs`)보다 오래됨, 또는 `last_error_code='auth'` | `sync_stale` |
| 처음 채우기 중 | `initial_done_at`이 비어 있음 (커서가 아직 8일을 따라잡는 중) | `sync_initial` |
| 미확정이 많음 | 그 대상의 미확정 ÷ (확정 + 미확정) > 20% (`maxUnconfirmedBp`) | `unconfirmed_high` |

- 동기화 정체·401/403은 건강 회차가 운영 스페이스에 **바로** 알린다 (6시간에 한 번, 사건 `kind='sync'`). 다음 날 매일 보고까지 기다리지 않는다.
- 까닭: 분모는 NHN 확정 기록만 쓰므로(5-1) 동기화가 멈추면 판정 재료가 비거나 한쪽으로 치우친다. 그때 자동 조치를 하면 멀쩡한 명단을 막을 수 있다.
- 발신 쪽 실패 폭주(5-3)는 세 관문 중 "미확정이 많음"은 보지 않는다 (동기화 정체·처음 채우기 중은 본다) — 폭주는 NHN이 이미 확정한 SST7·SST8·SST3 5.7.x로만 세므로, 확정된 것만으로도 충분한 재료다.

### 6-2. 명단 보류 — 대량 발송만 (SND-09)

**저장**: 새 표 `email_partition_holds` (8절). 명단 하나에 풀리지 않은 보류는 하나뿐이다 (부분 유일 색인). 풀어도 줄은 남는다 — "언제, 무엇을, 왜, 되돌린 사람" (PRD SND-3 수용 기준 5). 보류 범위 칸 `scope`는 `'bulk'`(기본, 자동 보류는 늘 이것)다. `'all'`은 나중의 손 보류용 자리다.

**무엇을 막나** — 가져온 명단의 실패율이 원인이므로 **대량**(`purpose='bulk'`)만 막는다. 사람이 직접 적은 문의 주소는 가져온 명단의 실패율 원인이 아니고, PRD SND-0b·DESIGN-2 "문의(폼·광고·단건)는 바로 보낸다"를 지킨다:

| 막음 (대량) | 막지 않음 (문의·사람) |
|---|---|
| AI 첫 메일 대량 적재(가져오기·예약 등록, 대기열 `priority=0`), 템플릿 `first_bulk`, 템플릿 반복, AI·템플릿 후속, 수동 발송 중 레코드 2건 이상 | AI 바로 보내는 경로(`automation-dispatch`, 늘 `inbound` — F19)와 대기열 `priority=1` 줄, 템플릿 `first`(폼 제출 등), 수동 발송 레코드 1건 |

- 막지 않는 메일도 **주소 멈춤(`is_paused`)과 반송 막기(RPL 7-4)는 그대로 따른다** — 그 경로들이 원래 보는 장치다.

**거는 법** (`holdPartition`, 한 트랜잭션):

```sql
INSERT INTO email_partition_holds (org_id, workspace_id, partition_id, scope, source, reason_code, reason_text, metrics, event_id)
VALUES (..., 'bulk', 'auto', 'fail_rate', ...)
ON CONFLICT (partition_id) WHERE released_at IS NULL DO NOTHING
RETURNING id;
-- 새로 걸렸을 때만 (last_error는 건드리지 않는다 — SND-14):
UPDATE email_send_queue SET status = 'held', locked_at = NULL, requeue_at = NULL
 WHERE partition_id = $p AND org_id = $org AND status = 'pending' AND priority = 0;            -- 대량 줄만
UPDATE email_followup_queue q SET status = 'held', locked_at = NULL
  FROM email_send_logs l
 WHERE q.parent_log_id = l.id AND l.partition_id = $p AND q.org_id = $org AND q.status = 'pending';
UPDATE email_automation_queue q SET status = 'held', updated_at = now()
  FROM email_template_links t
 WHERE q.template_link_id = t.id AND t.partition_id = $p AND q.org_id = $org AND q.status = 'pending'
   AND q.kind IN ('repeat', 'first_bulk');                                                      -- 문의 첫 메일('first')은 빼고
```

- 세 대기열 모두 `pending`만 집으므로(F11) `held` 줄은 아무 워커도 집지 않는다. 순서(`scheduled_at`·`check_at`·`next_run_at`)와 미룸 사유(`last_error`)는 그대로 남는다 — 대기열 정책의 먼저 들어온 순 하한(`latestDeferredBulkAt`, F20)이 미룬 줄을 계속 찾을 수 있고, 화면의 미룸 사유도 사라지지 않는다 (SND-14). 보류 표시는 `status='held'`와 `email_partition_holds`로 충분하다.
- 그때 처리 중(`processing`)이던 줄은 건드리지 않는다. 그 줄은 아래 경로별 확인에서 걸린다. 다만 이미 확인을 지난 한 배치(AI 대기열 최대 5통)는 나갈 수 있다.
- RPL의 회신 멈춤은 `held` 줄도 닫는다 (RPL 7-2) — 회신한 사람의 보류 줄이 풀린 뒤 나가지 않게.

**경로마다 확인** — 공통 함수 `getActiveHold(orgId, partitionId, purpose)` (`src/lib/partition-hold.ts`, 조직 조건 포함, 색인 한 번 조회. `purpose='inbound'`면 늘 null). 확인은 **AI 호출·발신 자리 잡기보다 먼저** 한다 (토큰·한도를 쓰지 않게).

| 경로 | 자리 | 보류면 |
|---|---|---|
| AI 첫 메일 — 대기열 워커 | `processAutoPersonalizedEmail` 맨 앞 (규칙 조회 뒤, 반복문 전). 대기열 줄의 `priority`로 `purpose`를 넘긴다 | 대량 줄만: `RecordOutcome.held = { holdId }` → `foldOutcome`이 `"hold"` → `planQueueRow`가 `{ status: 'held', attempts: attempts − 1 (0 아래 안 감), stat: 'held' }`. `revivesOnRequeue('held') = false`, `requeue_at`은 비운다. 문의 줄(`priority=1`)은 보류를 보지 않는다 |
| AI 첫 메일 — 바로 보내는 경로 | `automation-dispatch.ts` | **보지 않는다** (늘 `inbound`). 예전 판의 `enqueueHeldSend`는 없앤다 |
| AI 첫 메일 — 대량 적재 | `enqueueSends` (`email-send-queue.ts:187`) | 적재 전에 명단 보류를 한 번 보고, 보류면 `status='held'`로 넣는다 (쓸데없는 한 번 처리를 줄임) |
| 일괄 재처리 스크립트 | `scripts/resend-unsent.ts` | `purpose='bulk'`로 부르므로 `processAutoPersonalizedEmail`이 `held`를 돌려준다. 스크립트는 건수만 센다 |
| AI·템플릿 후속 | `processFollowupItem` (`email-followup.ts:391`) — 원본 기록을 읽은 바로 뒤 | 원본 기록의 `partition_id`가 보류면 그 줄을 `held`로 (`locked_at=NULL`, `check_at` 그대로), `stats.held++` |
| 템플릿 첫 메일 (바로) | `sendEmailSingle` (`email-automation.ts:99`) 수신거부 확인 뒤·자리 잡기 전 | `purpose='bulk'`(가져오기의 `first_bulk`)일 때만: `{ success: false, held: { holdId } }` → `sendTemplateFirst`가 `{ kind: 'held' }` → `processEmailAutoTrigger`가 `enqueueHeldTemplateFirst`로 반복 대기열에 `held` 줄 (`kind='first_bulk'`, 같은 (규칙, 레코드)의 `pending`·`held` 줄이 있으면 넣지 않음). `purpose='inbound'`(폼 제출 `first`)는 보지 않는다 |
| 템플릿 반복·미룬 첫 메일 | `processRepeatItem` (`email-automation.ts:526`) | `repeat`·`first_bulk` 줄만 같은 결과로 `held` (`repeat_count` 그대로). 마지막 update는 `status='pending'`일 때만 (RPL m5) |
| 수동 발송 | `POST /api/email/send` — 레코드를 읽은 뒤 | **레코드마다 `records.partition_id`로** 본다 (SND-16 — 템플릿 연결의 명단이 아니라). 레코드가 2건 이상이고 그중 보류 명단의 레코드가 있으면 409 `"이 명단은 발송 실패가 많아 보류 중입니다 (명단 이름, 사유 한 줄, 언제부터). 관리자가 보류를 풀면 보낼 수 있습니다."` 레코드 1건이면 막지 않는다 (사람이 한 명에게 쓰는 메일 — 문의와 같다). 우회 칸은 두지 않는다 |
| 시험 발송·발신 주소 확인·초대 메일 | `test-send`, `test-followup`, `sender-profiles/verify`, `org/invitations` | 막지 않는다 (직원 주소로 가는 메일, 명단 발송이 아니다) |

- **수동 발송 기록의 명단 (SND-16)**: 기록의 `partition_id`를 템플릿 연결의 파티션이 아니라 **레코드의 파티션**으로 적는다 (`send/route.ts:191`). 그 실패가 실제 명단의 실패율에 쌓이게.
- `foldOutcome` 순서: `noMatchingRules → skip`, **`held → hold`**, 실패 → error, 미룸 → defer, 발송 → ok. 보류는 규칙을 하나도 돌리지 않았으므로 다른 결과와 섞이지 않는다.
- 묶어 미루기(`drainBlockedGroup`)는 `pending` 줄만 `FOR UPDATE SKIP LOCKED`로 잡으므로 `held` 줄을 건드리지 않는다. 미루기는 보내지 않으므로 보류와 부딪히지 않는다.
- `enqueueDeferredSend`의 되살리기 조건(`status IN ('sent','skipped','failed','processing')`)에 `held`가 없다 — 보류 줄은 풀릴 때까지 그대로다. 문의 줄은 보류되지 않으므로 이 조건과 부딪히지 않는다.
- 화면: 대기열 통계(`GET /api/email/send-queue/stats`)는 `held`를 대기량에서 빼고 "보류 N통"으로 따로 준다 (3일치 경고에 섞지 않는다). 후속 대기열 화면의 상태 거르기에 `held`("명단 보류")를 더한다. 후속 취소(`followup-queue/[id]`)는 `pending`과 `held` 둘 다 받는다.

### 6-3. 주소 멈춤

- 원래 있는 정지 칸(`is_paused`)을 쓴다 (F9) — 경로를 새로 고치지 않아도 모든 경로가 따른다.
- 누가 멈췄는지 가르려고 칸을 더한다 (8절): `paused_source`('manual'|'auto'), `paused_reason`, `paused_at`, `health_reset_at`, `health_action`('auto'|'alert').
- 자동 멈춤 (`pauseSenderForHealth`):

```sql
UPDATE email_sender_profiles
   SET is_paused = true, paused_source = 'auto', paused_reason = $reason, paused_at = now(), updated_at = now()
 WHERE id = $id AND org_id = $org AND is_paused = false AND health_action = 'auto' AND is_default = false
RETURNING id;
```

  - 이미 손으로 멈춘 주소는 바꾸지 않는다 (사건만 "이미 멈춤"으로 남긴다).
  - `health_action='alert'`인 주소는 알림만 한다. 11/2 실험 발신 주소처럼 흔들면 안 되는 주소에 관리자가 켠다 (PRD SND-3 "실험과 겹침").
  - **조직 기본 주소(`is_default=true`)는 자동으로 멈추지 않는다** (SND-08). 템플릿 메일은 모두 기본 주소로 나가므로(F17) 멈추면 조직 전체의 템플릿 첫 메일(폼 문의 포함)·반복·템플릿 후속이 관리자가 풀 때까지 멈춘다. 알림만 하고(`action_note='default_sender'`) 글에 "이 주소는 조직 기본 주소입니다 — 멈추면 이 조직의 템플릿 메일(폼 문의 첫 메일 포함)이 모두 멈춥니다. 확인 뒤 발신 주소 설정에서 멈추거나 기본 주소를 바꿔 주세요"를 쓴다. 손으로 멈추는 것은 그대로 된다. 마이그레이션으로 값을 바꾸지 않고 코드에서 막는다 — 기본 주소는 나중에 바뀔 수 있다.
  - 프로필이 없는 예전 기본 주소(`sender_profile_id IS NULL`)는 멈출 칸이 없어 알림만 한다.
- **발신 쪽 실패 폭주 (SND-06)**: 도메인 하나가 5-3 기준을 넘으면 그 도메인의 조직 주소 중 `health_action='auto'`·기본 주소 아님인 것을 모두 위 문장으로 멈춘다 (`paused_reason='발신 쪽 실패 폭주 (5.7.x·SST7/8) — 도메인 인증 확인'`). 하루 상한은 주소 상한과 따로 센다 (6-4).
- 멈춘 뒤 동작은 원래 정지와 같다: AI 묶음은 남은 주소로 계속 보내고(PRD "다음 자리 잡기에서 빠진다"), 그 주소로 이어 가야 하는 후속·템플릿은 다음 보낼 수 있는 날로 미뤄진다.
- 손으로 정지(설정 화면 `isPaused` 꺼짐 → 켜짐)하면 `paused_source='manual'`을 함께 적는다 (`sender-profiles/[id]` PUT).

### 6-4. 안전장치

| 장치 | 값 | 까닭 |
|---|---|---|
| 동기화 건강 관문 | 6-1 | NHN 결과가 늦거나 없을 때 자동 조치를 하지 않게 (SND-02) |
| 하루 자동 멈춤 상한 (주소 위험) | 조직마다 KST 하루 `SEND_HEALTH_MAX_AUTO_PAUSE_PER_DAY`(기본 5)개 | 상한을 넘는 주소는 멈추지 않고 "상한에 걸려 멈추지 않음 — 확인 필요" 알림(사건 `action_note='cap'`). 여러 주소가 한꺼번에 나빠지면 주소보다 NHN·명단 쪽 문제일 가능성이 크다 |
| 하루 도메인 멈춤 상한 (발신 쪽 실패 폭주) | 조직마다 KST 하루 `SEND_HEALTH_MAX_AUTH_PAUSE_DOMAINS_PER_DAY`(기본 10) 도메인 | 주소 상한과 다른 열쇠. 인증 사고는 여러 도메인에 함께 나는 일이 많아(10/10 DNS 작업) 주소 상한 5개로는 막지 못한다. 넘으면 "상한 — 나머지 도메인은 알림만" (`action_note='cap_auth'`) |
| 명단 예외 | `SEND_HEALTH_ALERT_ONLY_PARTITION_IDS` (쉼표 목록) | 실험 명단처럼 멈추면 안 되는 명단은 알림만 |
| 주소 예외 | `email_sender_profiles.health_action = 'alert'`, 조직 기본 주소 | 위 6-3 |
| 보류 중 다시 판정 안 함 | 풀리지 않은 보류가 있는 명단, `paused_source='auto'`인 주소 | 같은 사건이 거듭 생기지 않게. 숫자는 화면에 계속 보인다. **그 명단은 주소 칸에서도 뺀다** (5-4, SND-04) |
| 재판정 유예 | 5-2 (풀린 시각 뒤 발송만, 명단 하한은 칸에도) | 풀자마자 다시 멈추지 않게 |
| 밤 알림 줄이기 | KST 22~08시에는 조치(보류·멈춤)가 있거나 발신 쪽 실패 폭주·동기화 정체일 때만 보낸다 | 나머지는 09시 매일 보고에 싣는다 (7-1, SND-13) |

### 6-5. 풀기 (관리자만)

- **자동 해제는 하지 않는다.** 보류된 명단·멈춘 주소는 새 발송이 없어 나아졌는지 알 수 없다. PRD 표의 "회복 — 담당이 되돌리거나 자동 해제" 중 "담당이 되돌림"만 한다.
- 명단 풀기 `POST /api/email/send-health/holds/[id]/release` (`requireAdmin`, 본문 `{ note?: string }`, 한 트랜잭션):

```sql
UPDATE email_partition_holds SET released_at = now(), released_by = $user, release_note = $note
 WHERE id = $id AND org_id = $org AND released_at IS NULL RETURNING partition_id;
UPDATE email_send_queue SET status = 'pending', locked_at = NULL                 -- last_error는 그대로 (SND-14)
 WHERE partition_id = $p AND org_id = $org AND status = 'held';
UPDATE email_followup_queue q SET status = 'pending', locked_at = NULL, check_at = GREATEST(q.check_at, now())
  FROM email_send_logs l WHERE q.parent_log_id = l.id AND l.partition_id = $p AND q.org_id = $org AND q.status = 'held';
UPDATE email_automation_queue q SET status = 'pending', next_run_at = GREATEST(q.next_run_at, now()), updated_at = now()
  FROM email_template_links t WHERE q.template_link_id = t.id AND t.partition_id = $p AND q.org_id = $org AND q.status = 'held';
INSERT INTO email_health_events (... kind 'release', action 'release', actor_user_id ...);
```

  그 뒤 `wakeSendQueue()`. 풀린 줄은 원래 순서대로, 주소 한도 안에서 나간다. 풀린 시각 뒤 발송은 바로 판정 재료가 된다 (5-2, 하한 = `released_at` 그대로 — SND-05).
- 주소 풀기 `POST /api/email/send-health/senders/[id]/release` (`requireAdmin`): `paused_source='auto'`일 때만 `is_paused=false`, `paused_*` 비움, `health_reset_at=now()`, 사건 남김. 손으로 멈춘 주소면 409 "손으로 멈춘 주소는 발신 주소 설정에서 푸세요".
- **웜업을 멈춘 날만큼 미룬다 (SND-10)**: 자동 멈춤을 풀 때(풀기 API와 설정 화면 PUT 두 길 모두) 웜업이 켜진 주소면 `warmup_started_on`을 멈춘 동안(`paused_at`의 KST 날짜 ~ 풀린 날 전날)의 **보낼 수 있는 날 수만큼 뒤로** 옮긴다 — 순수 함수 `shiftWarmupStart(settings, pausedOn, releasedOn)` (`email-sender-limit-rules.ts`, `warmupDayIndex`와 같은 "보낼 수 있는 날" 셈). 그래서 5일째(35통/일)에 멈춘 주소는 풀린 날 다시 5일째 한도로 시작한다 (예전 판: 평일 10일 뒤 풀면 85통/일). 풀기 대화상자에 "풀린 뒤 오늘 한도 N통 (웜업 M일째)"를 보여 준다. 손 정지·손 풀기는 지금 동작 그대로 둔다 (범위 밖 — `warmupDayIndex` 주석의 "정지 이력이 없어서다"를 자동 멈춤에만 메운다)
- 설정 화면에서 자동 멈춘 주소의 `isPaused`를 끄면(`sender-profiles/[id]` PUT) 같은 풀기 기록·`health_reset_at`·웜업 미루기가 남는다 — 길이 둘이어도 결과는 하나 (`releaseSenderPause` 한 함수).
- 멤버는 403, 다른 조직 id는 404. 풀기마다 구글 챗에 "풀림 (누가, 메모)" 한 통.
- 풀 때 실패한 주소를 명단에서 빼는 일은 SND-2(반송 막기)가 맡는다. 그 전까지는 알림 글에 "실패 주소 N개 — 명단 정리 뒤 푸세요"를 쓴다. 다시 가져와진 죽은 주소에 또 보내는 일은 6-6이 막는다.

### 6-6. 중복 수신자·쿨다운 확인을 "NHN이 접수한 발송"으로 (SND-11)

- 배달 결과(SST3·SST5·SST7·SST8·반송 안내)로 `status`가 `sent → failed`로 바뀌면, `status='sent'`만 보는 중복 확인에서 그 기록이 빠진다 (F16). 그러면 같은 주소가 다시 가져와졌을 때 하드 반송 주소에 AI 메일을 또 쓰고 보내고, `on_update` 쿨다운도 풀린다 — "보류 → 풀기 → 같은 죽은 주소 재발송 → 보류" 고리.
- 고치는 법: 공통 SQL 조각 `acceptedSendCondition()` (`src/lib/email-send-log-status.ts`, 새 파일):

```sql
-- NHN이 받아 간 발송 (배달 결과와 상관없이). 보낼 때 거절(F8: 결과 코드도 반송도 없는 failed)은 빠진다
(status = 'sent'
 OR (status = 'failed' AND request_id IS NOT NULL
     AND (nhn_status_code IS NOT NULL OR delivery_fail_source IS NOT NULL)))
```

  쿨다운은 여기에 `OR status = 'pending'`을 더한다.
- 바꿀 곳 (모두 `status='sent'`/`IN ('sent','pending')` → 위 조각): `checkDuplicateRecipientForAiAuto`(`auto-personalized-email.ts:62`)와 쿨다운(`:40`), `loadDuplicateRecipients`(`email-send-queue.ts:820`)와 쿨다운 묶음 조회(`:800`) — `walkQueueRow`가 이 둘을 읽으므로 미리 판정과 실제 판정이 같게 유지된다, `checkDuplicateRecipient`(`email-automation.ts:73`)와 쿨다운(`:50`)
- `status`를 접수 상태로 남기고 배달 결과를 따로 두는 길도 있었지만, 발송 이력 화면·통계·기존 버튼 동기화가 `failed`를 실패로 보여 주고 있어 바꾸는 범위가 더 크다 — 중복 확인 쪽을 고친다.

---

## 7. 알림

### 7-1. 사건과 알림 줄

- `email_health_events`: 감사 기록. 위험(조치했든 안 했든), 풀기, 매일 보고, 상한 걸림, 동기화 정체. `dedupe_key`가 조직 안에서 유일하다.
- `email_health_alerts`: **한 회차의 새 사건을 조직·받는 곳마다 한 통으로 묶는다** (SND-13 — 예전 판은 위험마다 1통이라 묶음 주소 20개면 40통이 1.1초 간격으로 나갔다). 줄 하나 = (조직, 받는 곳, 묶음 열쇠). 사건 번호들은 `event_ids`에 담는다. 깊이 알림 표와 같은 상태(`pending|processing|sent|failed|skipped|dry_run`)·시도·잠금 칸.

| 사건 | `dedupe_key` |
|---|---|
| 위험 — 명단 | `danger:p:<partitionId>:<mode>:<하한 ms>:<비율 1%p 칸>` |
| 위험 — 주소 | `danger:s:<profileId|0>:<mode>:<하한 ms>:<비율 1%p 칸>` |
| 위험 — 주소 (명단과 함께) | `danger_with:s:<profileId>:<mode>:<위험 명단 id 정렬 목록>` (10개를 넘으면 앞 10개 + `+n`) |
| 발신 쪽 실패 폭주 | `auth_burst:d:<도메인>:<mode>:<KST 날짜>` |
| 동기화 정체·키 오류 | `sync:<원인>:<6시간 칸>` |
| 풀기 | `release:hold:<holdId>` · `release:s:<profileId>:<풀린 ms>` |
| 상한 걸림 | `cap:<KST 날짜>` · `cap_auth:<KST 날짜>` |
| 매일 보고 | `report:<KST 날짜>` |

- **`<하한 ms>`는 그 대상의 재판정 유예 하한(5-2: 명단 `released_at`, 주소 `health_reset_at`)이고, 없으면 `0`이다** (SND-13 — 굴러가는 창 시작 `now − 7일`을 쓰면 10분마다 새 사건·알림이 된다). 순수 함수 `dedupeKey`가 만들고 시험이 이 뜻을 고정한다.
- **`<비율 1%p 칸>`** = `floor(rate_bp / 100)`. 이어지는 위험은 **상태가 바뀌거나(주의 → 위험, 풀린 뒤 다시) 비율이 이전에 알린 칸보다 1%p 이상 나빠질 때만** 새 사건이 된다. 나머지는 09시 매일 보고에 싣는다. 예전 판처럼 날짜를 키에 넣지 않는다 — 알림만 모드(`alert`, 1주 운영 예정)에서 이어지는 위험이 매일 0시 직후 다시 오던 일이 없다.
- 모드가 키에 있어 `dry_run` 사건이 있어도 `enforce`로 바꾸면 새로 조치하고 알린다.
- **밤 시간 (KST 22~08시)**: 그 회차 묶음에 조치(보류·멈춤)·발신 쪽 실패 폭주·동기화 정체가 하나도 없으면 알림 줄을 `skipped`("밤 시간 — 09시 매일 보고에 실음")로 닫는다. 사건은 남고 보고에 실린다.
- 묶음 글: 맨 위에 "발송 건강 · 새 사건 N건", 그 아래 사건마다 7-3 모양을 한 덩어리씩(3,800자에서 자르고 "외 N건 — 화면에서 보기"). 상한에 걸린 주소들도 한 덩어리.

### 7-2. 받는 곳

| 대상 | 웹훅 | 받는 사건 |
|---|---|---|
| 운영(대표) 스페이스 | `SEND_HEALTH_WEBHOOK_URL` | 모든 사건, 조직 전체 매일 보고, 동기화 정체·NHN 키 오류, RPL 회신 읽기 정체(RPL 8절이 같은 웹훅을 기본 받는 곳으로 쓴다) |
| 사업 스페이스 | `SEND_HEALTH_WEBHOOK_URL_<워크스페이스>`, 없으면 `DEEP_ALERT_WEBHOOK_URL_<워크스페이스>` (깊이 알림과 같은 스페이스, PRD RPL-1 5번) | 그 워크스페이스 명단의 위험·풀기, 그 워크스페이스 규칙 묶음에 든 주소의 위험·풀기, 그 워크스페이스만의 매일 보고 |

- 웹훅이 없으면 알림 줄은 `skipped`("웹훅 주소 없음")로 닫고 화면 사건 목록에는 보인다. 주소가 있는데 형식이 틀리면(`https://chat.googleapis.com/v1/spaces/…`가 아님) "웹훅 주소 형식 오류 — …"로 닫아 "없음"과 구별하고, 사업 스페이스 주소가 틀렸다고 다른 스페이스로 조용히 바꾸지 않는다 (구글 챗 QA HR-13). 받는 곳마다 상태를 `chat_webhook_status`에 남겨 운영 알림·매일 보고·화면에 보인다 (7-5)
- 깊이 알림 공통 주소(`DEEP_ALERT_WEBHOOK_URL`)는 쓰지 않는다 — 그 스페이스는 사업 담당용이다.
- 보내기: `postGoogleChatText`(그대로), 웹훅 사이 1.1초(`POST_INTERVAL_MS`), 429·5xx는 10분 뒤 최대 3번, 401·403·404는 설정 오류로 되돌리고 그 회차에 그 웹훅을 더 쓰지 않는다 (`isWebhookConfigError` 재사용). 15분 넘은 `processing`은 회수. 구글 챗 QA로 바뀐 보내기는 7-5.
- 카드에는 **받는 사람 주소·이름·본문을 넣지 않는다.** 명단 이름, 발신 주소(우리 주소), 숫자, 사유 코드 이름만.

### 7-3. 글 (예시, 숫자는 가상)

명단 보류 (`enforce`):

```
[발송 위험 · 명단 보류] 디하 › 수출바우처 10월
최근 7일 확정 212통 중 실패 14통 (6.6%) — 기준 200통 이상에서 5% 이상
실패 사유: 받는 주소 없음(5.1.1) 9 · 도메인 없음(5.1.2) 3 · 기타 2
조치: 이 명단의 대량 발송(가져온 명단 첫 메일·후속·템플릿 반복)을 멈췄습니다. 대기 1,240통은 지우지 않고 남겨 두었습니다. 폼·광고 문의 메일은 그대로 나갑니다.
이 명단을 보낸 주소 3개의 실패율은 6.1~7.0%로 비슷합니다 — 명단 쪽 문제로 보입니다.
반송 안내(참고, 실패율에는 아직 안 넣음): 4통
풀기(관리자): https://sendb.kr/email#send-health
```

주소 멈춤 (`enforce`):

```
[발송 위험 · 주소 멈춤] cs@abc-mail.kr
명단 2개에서 같은 명단의 다른 주소보다 뚜렷이 높음: 수출바우처 10월 6.7% (60통 중 4) · 제조 리스트 B 6.9% (58통 중 4)
같은 명단의 다른 주소는 0.5%·0.4% — 이 주소 쪽 문제(발신 인증·평판)일 수 있습니다.
조치: 이 주소를 멈췄습니다. 규칙 "디하 AI 첫 메일"은 묶음 20개 중 19개로 계속 보냅니다. 웜업 중이면 풀 때 멈춘 날의 한도로 다시 시작합니다.
풀기(관리자): https://sendb.kr/email#send-health
```

주소 위험 — 명단과 함께 (SND-07, 조치 없음):

```
[발송 위험 · 주소] cs@abc-mail.kr — 위험 명단 2개의 주된 발신
수출바우처 10월 6.4% (이 주소가 61%) · 제조 리스트 C 6.1% (이 주소가 72%)
두 명단은 보류되어 발송은 멈췄습니다. 이 명단을 보낸 주소가 사실상 하나 — 주소 문제일 수 있습니다. 확인 뒤 필요하면 발신 주소 설정에서 멈춰 주세요.
```

발신 쪽 실패 폭주 (`enforce`, SND-06):

```
[발송 위험 · 발신 인증] x-mail.kr — 최근 1시간 발신 쪽 실패 6통 (발송 26통 중 23%)
사유: DMARC 거절(5.7.26) 5 · 미인증(SST7) 1 — 도메인 SPF·DKIM·DMARC 설정을 확인해 주세요
조치: 이 도메인 주소 2개를 멈췄습니다 (기본 주소 cs@x-mail.kr은 알림만). 명단 실패율에는 넣지 않았습니다.
```

기본 주소 (SND-08): "조치: 없음 — 이 주소는 조직 기본 주소입니다. 멈추면 이 조직의 템플릿 메일(폼 문의 첫 메일 포함)이 모두 멈춥니다. 확인 뒤 발신 주소 설정에서 멈추거나 기본 주소를 바꿔 주세요."

알림만(`alert`)이면 "조치: 없음 (알림만 모드)". 동기화 관문(6-1)이면 "조치: 없음 — NHN 결과 확인이 {원인}이라 자동 조치를 미뤘습니다". 상한·예외·이미 멈춤이면 그 까닭 한 줄.

### 7-4. 매일 보고

- KST `SEND_HEALTH_REPORT_HOUR`(기본 9) 시 뒤 첫 회차, 조직·받는 곳마다 하루 한 번 (`report:<날짜>`). 주말에도 보낸다(발송이 있을 수 있다).
- 운영 보고 예시:

```
[발송 건강 · 10/12(월) 09:00] 매치스플랜
위험: 명단 1 (보류 중) · 주소 0
주의: 명단 2 · 주소 1 · 발신 인증 실패 도메인 1
 - 제조 리스트 B 3.4% (410통 중 14)
 - cs@x.kr 3.1% (232통 중 7)
 - y.kr 발신 쪽 실패(SST7·8·5.7.x) 3통 — 도메인 인증 확인 필요
이어지는 위험 (알림 안 다시 보냄): 명단 1 — 수출바우처 10월 6.6% → 6.9%
판정 보류(표본 부족): 명단 5 · 주소 12 (30일 창으로 판정된 명단 1)
보류·멈춤 중: 수출바우처 10월 (10/11 14:20부터, 대기 1,240통)
회복: 명단 1 (제조 리스트 A)
반송 안내(실패율에 아직 안 넣음): 명단별 상위 3 — 수출바우처 10월 9통(4.2%) · …  · 짝 없는 반송 0 · 받는 사람 다른 반송 1 · 스팸 신고 0
NHN 결과 확인: 마지막 성공 08:50 · 커서 08:49 · 미확정(2시간 지남) 3통 · 짝 없는 결과 0
회신 읽기: 마지막 성공 08:55 · 모드 on · 어제 회신 4 · 반송 안내 9      ← RPL email_reply_mailbox_state (RPL M7)
NHN 수신거부(SST5) 2통 · 수신거부(링크) 5통
모드: enforce · 반송 안내 실패율 반영: off
```

- 사업 스페이스 보고는 그 워크스페이스 명단과 그 규칙 묶음 주소만 싣는다. 실을 것이 하나도 없으면(위험·주의·보류 0) 보내지 않는다.

### 7-5. 구글 챗 QA로 바뀐 것 (2026-10-11, `CHAT-QA.md`)

7-3·7-4의 예시는 처음 설계 글이다. 지금 글은 아래처럼 바뀌었고, 실제 모양은 `F:/Dev/sendb-testenv/chat-qa/payloads/health_*`에 있다.

**글 공통**
- 조직·사업·명단·규칙 이름, 풀림 메모 같은 사용자 값은 `< >`를 `‹ ›`로, `* _ ~ \``를 전각으로 바꾸고 한 줄로 만든다. `<users/all>` 전체 멘션·가짜 링크·가짜 줄이 끼어들지 못한다 (HB-1·HS-2·HD-01·HR-1·HR-2·WPN-10). 길이는 코드 포인트로 자른다 (HR-10)
- 상태 코드는 풀이를 먼저, 코드는 괄호로: "받는 주소 없음 (5.1.1)" (HB-11·HD-07). 설정값 이름은 운영 보고에만
- 끝에 늘 화면 링크 "자세히: {주소}/email#send-health" (HB-9·HS-7·HD-14)

**회차 묶음 알림**
- 머리 "[발송 건강] {조직} — 알림 N건 (새로 생긴 일 · 더 나빠진 일)". 조치·상한·폭주 같은 급한 블록을 앞에 두고, 3,800자를 넘으면 뒤의 짧은 블록까지 담고 "외 N건" (HB-4)
- 같은 위험 구간에서 1%p 칸이 나빠져 다시 알리면 "— 더 나빠짐 (지난 알림 6%대 → 지금 7.7%)" (HB-8)
- 사업 스페이스 글에는 그 사업 규칙 이름만, 다른 사업 규칙은 수만 (HB-5). "사실상 하나" 대신 실제 비율 (HB-10)
- 발신 쪽 실패 폭주는 그 도메인 주소를 쓰는 사업 스페이스에도 알린다 (HB-13 ①). 밤에 사업 스페이스로 보낼지는 대표 결정 (HB-13 ②)

**NHN 결과 확인 알림 (6-1의 정체·키 오류)**
- 열쇠를 6시간 칸이 아니라 "알린 장애 구간"(`email_status_sync_state.ops_alerted_cause`)으로: 원인이 바뀌면 바로, 같은 원인은 마지막 알림 6시간 뒤, 회복 뒤 다시 막히면 바로 (HS-1·HS-6). 회복 글은 밤이면 아침에
- 마지막 알림을 끝내 못 보냈으면 1시간 뒤 다시 만든다 (HS-5). `NHN_STATUS_SYNC=off`면 남은 키 오류로 알리지 않는다 (HS-9). 한 번도 안 돌던 결과 확인이 돌기 시작하면 한 번 알린다 (HS-8)
- 여러 조직의 같은 원인은 운영 스페이스에 한 통 (HS-11) — 같은 설명·할 일 문장은 한 번, 조직마다 다른 것(마지막 성공·멈춘 시간·이유)만 `• 조직 — …` 목록으로 (N3). 웹훅이 막혔던 동안 쌓인 같은 받는 곳 알림은 가장 새 것만 (HS-10). 시험 모드(dry_run)는 갈래를 나눈다 (HS-4)

**매일 보고**
- 조치(보류·멈춤)를 건 뒤 상태로 보고한다 — 방금 보류한 명단이 "이어지는 위험"으로 다시 나오지 않게 (HD-05)
- 사업 보고에는 그 사업 숫자만 (조직 전체 반송 안내·링크 수신거부는 빼고, 그 사업 주소들의 도메인만, HD-02·HD-13)
- 운영 보고는 `SEND_HEALTH_REPORT_HOUR`에 바로 보내고, 그 시각이 밤(22~08시)이면 사업 스페이스 보고는 08시에 (HD-09). 시험 모드 보고는 열쇠를 따로 둬 dry_run → alert로 바꾼 날에도 보고가 나간다 (HD-11)
- 어제 보고를 보내지 못했으면 맨 위에 그 까닭 (HD-15). NHN 결과 확인의 마지막 오류 한 줄 (키·주소 없이, HD-10)
- 운영 보고에 "알림 전달" 한 줄: 웹훅 문제 받는 곳과 어제 못 보낸 알림 수 (WPN-4·HB-7)
- 다른 알림과 같은 3,800자 상한 (N4): 머리·위험/주의 수·아직 판단 못 함·할 일·알림 전달·설정 줄은 늘 싣고, 목록 줄은 들어가는 만큼 담은 뒤 "외 N건 — 화면에서 보기" + 화면 링크(끝 줄). 목록 줄 안 이름은 60자·주소 80자에서 자른다
- 목록 줄은 7-4 예시의 `" - "`가 아니라 다른 알림과 같은 `• ` (N7). 개발 말 대신 쉬운 말 (N5): "어느 메일의 반송인지 못 찾음"·"보낸 주소와 다른 주소에서 돌아온 반송"·"결과를 받아 온 때 …까지"·"보낸 지 2시간이 지나도 결과가 없는 메일"·"샌드비 발송 기록에 없는 NHN 결과", "회신 읽기 (켜짐)", 끝 줄 "발송 건강 설정: 알림만 — 위험해도 자동으로 멈추지 않음" (설정값 이름 `alert`·`enforce`는 싣지 않음)

**풀림 알림**
- 명단 보류면 어느 사업 명단인지, 발신 주소 설정에서 정지를 끈 것이면 "발신 주소 설정에서 정지를 끔" (사람 메모가 아님), 조직 이름은 머리에 한 번만 (HR-9). 이름 없는 관리자는 "관리자가" (HR-7). 기다리던 메일이 없으면 그 문장을 뺀다 (HR-8)
- 받을 사업 스페이스는 멈춘 때까지 7일 발송으로 정한다 — 주말을 끼고 7일 넘게 지나 풀어도 사업 스페이스에 간다 (HR-5)
- 시험·꺼짐 모드면 보내지 않고 남은 줄을 닫는다 — alert 때 미뤄 둔 줄이 dry_run으로 내린 뒤 나가지 않게 (HR-6)

**보내기 (공통 보내기, 깊이·회신과 같음)**
- 스페이스마다 1.1초 줄을 프로세스 전체에서 함께 쓴다 — 정기 회차·풀림·깊이·회신이 같은 스페이스에 동시에 보내도 초당 1통을 넘지 않는다 (CT-2·HB-12·HS-12·HR-3·HD-04)
- 429는 회차 안에서 2초·4초(+무작위) 두 번 더, 5xx·연결 오류는 1.5초(+무작위) 한 번. 그래도 실패하면 그 받는 곳은 그 회차에 건너뛰고 다른 받는 곳을 먼저 보낸다 (CT-5·HR-12)
- 응답 시간 초과(10초)는 그 회차에 다시 보내지 않는다. `GOOGLE_CHAT_REQUEST_ID=on`이면 줄마다 고정 `requestId`로 다음 회차에 다시 보내고, 꺼져 있으면 두 번째 시간 초과에서 멈춘다 (CT-1·HB-2·HS-3·HD-03·HR-4)
- `sent` 기록이 일시 DB 오류면 짧게 다시 기록, 예외 뒤 보내지 않은 줄은 바로 되돌림, 시도를 다 쓴 `processing` 회수는 다시 보내지 않고 실패로 닫음 (HB-3). 집은 줄은 예약·번호 순으로 (CT-8·HD-16)

**웹훅 문제 알림 (새로, WPN)**
- 받는 곳(환경 변수 이름)마다 마지막 결과를 `chat_webhook_status`에 남긴다 (주소는 저장하지 않음). 401·403·404·형식 오류·웹훅 없음은 바로, 연결 실패는 1시간 넘게 이어질 때 운영 스페이스에 6시간에 한 번 알린다. 운영 웹훅 자체가 고장이면 다음 후보(`REPLY_OPS_WEBHOOK_URL` → `DEEP_ALERT_WEBHOOK_URL`)로 (WPN-1·WPN-2·WPN-3·WPN-8)
- 글에는 받는 곳 이름·문제·기다리는 알림 수·버려지기까지 남은 시간·고칠 환경 변수 이름만 (WPN-1·WPN-2). 시험(개발) 서버가 보내면 첫 줄 이모지 뒤에 `[개발 서버 · 호스트]` (회신 운영 알림과 같은 표시, N6). 고쳐지면 한 번 "다시 보냅니다". 줄의 오류 글도 할 일을 한국어로 먼저, 구글 원문은 괄호로 (WPN-9·CT-11). 24시간 지나 닫을 때 직전 원인을 남긴다 (WPN-6)
- 발송 건강 카드(관리자만)에 "알림 전달 (구글 챗)" 칸: 받는 곳마다 상태·마지막 성공·기다리는 알림, "연결 확인 보내기"(조직마다 10분에 한 번, `POST /api/email/send-health/webhook-check`) (WPN-5·WPN-11). 회신 탭에는 "알림 못 보냄" 표시

---

## 8. 표와 마이그레이션 0075

### 8-1. `drizzle/0075_send_health.sql`

```sql
-- 발송 결과 자동 맞추기(SND-1)·발신 건강 판정과 멈춤(SND-3) — docs/2026-10-11-reply-and-health/DESIGN-SND.md 8절
-- 더하기만 한다. 새 칸은 NULL 허용이거나 상수 기본값이라 PostgreSQL 11 이상에서 표를 다시 쓰지 않는다.
-- 다시 돌려도 같다 (IF NOT EXISTS). 0074(회신 읽기, DESIGN-RPL) 뒤에 나간다. 한 트랜잭션이다.
-- email_send_logs에는 칸만 더하고 색인은 만들지 않는다 — 색인은 부팅 뒤 트랜잭션 밖에서 CONCURRENTLY로 (8-3, SND-15).
-- 잠금을 오래 기다리지 않는다: 큰 표 ALTER가 5초 안에 잠금을 못 얻으면 이 마이그레이션 묶음이 실패하고(서버는 뜬다,
-- migrate.ts catch) 다음 부팅에 다시 한다. 그동안 새 기능은 표가 없어 조용히 쉰다(42P01).
-- [검토 반영 F1·OPS-1] 위 두 줄은 틀렸다: schema.ts가 새 칸을 이미 알아 옛 스키마로 뜨면 발송 기록 insert가 모두 42703으로 실패한다.
-- 지금은 migrate.ts가 55P03이면 3번 다시 해 보고, 그래도 실패하면 instrumentation.ts가 서버를 띄우지 않고 끝낸다.
SET LOCAL lock_timeout = '5s';

-- 1) 발송 기록: NHN 상태 코드와 실패 출처·실패 쪽
ALTER TABLE "email_send_logs" ADD COLUMN IF NOT EXISTS "nhn_status_code" varchar(8);
ALTER TABLE "email_send_logs" ADD COLUMN IF NOT EXISTS "nhn_checked_at" timestamp with time zone;
ALTER TABLE "email_send_logs" ADD COLUMN IF NOT EXISTS "nhn_check_count" smallint DEFAULT 0 NOT NULL;     -- 3-3 보조 질문 횟수
-- 'nhn' = SST3, 'dsn' = 회신 메일함에 온 반송 안내. 먼저 온 쪽이 남는다 (한 기록에 실패는 한 번)
ALTER TABLE "email_send_logs" ADD COLUMN IF NOT EXISTS "delivery_fail_source" varchar(8);
ALTER TABLE "email_send_logs" ADD COLUMN IF NOT EXISTS "delivery_failed_at" timestamp with time zone;
ALTER TABLE "email_send_logs" ADD COLUMN IF NOT EXISTS "delivery_status_code" varchar(16);  -- 5.1.1 같은 상태 (NHN dsnCode 또는 반송 안내 Status)
ALTER TABLE "email_send_logs" ADD COLUMN IF NOT EXISTS "delivery_fail_side" varchar(10);    -- recipient | sender (SST7·8, 5.7.x·SPF·DKIM·DMARC)

-- 2) 명단 보류. 풀어도 줄을 남긴다 (언제·왜·누가 풀었나)
CREATE TABLE IF NOT EXISTS "email_partition_holds" (
    "id" serial PRIMARY KEY,
    "org_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
    "workspace_id" integer NOT NULL,
    "partition_id" integer NOT NULL REFERENCES "partitions"("id") ON DELETE CASCADE,
    "scope" varchar(8) DEFAULT 'bulk' NOT NULL,            -- bulk(대량만, 자동 보류는 늘 이것) | all(나중의 손 보류)
    "source" varchar(10) DEFAULT 'auto' NOT NULL,          -- auto | manual(나중)
    "reason_code" varchar(30) NOT NULL,                    -- fail_rate
    "reason_text" text NOT NULL,                           -- 사람이 읽는 한 줄 (받는 주소 없음)
    "metrics" jsonb,
    "event_id" integer,
    "held_at" timestamp with time zone DEFAULT now() NOT NULL,
    "released_at" timestamp with time zone,
    "released_by" uuid,
    "release_note" text
);
CREATE UNIQUE INDEX IF NOT EXISTS "eph_active_partition_idx" ON "email_partition_holds" ("partition_id") WHERE "released_at" IS NULL;
CREATE INDEX IF NOT EXISTS "eph_org_held_idx" ON "email_partition_holds" ("org_id", "held_at");
CREATE INDEX IF NOT EXISTS "eph_partition_released_idx" ON "email_partition_holds" ("partition_id", "released_at");

-- 3) 발신 주소: 누가 멈췄나, 건강 조치 방식, 재판정 시작
ALTER TABLE "email_sender_profiles" ADD COLUMN IF NOT EXISTS "paused_source" varchar(10);      -- manual | auto
ALTER TABLE "email_sender_profiles" ADD COLUMN IF NOT EXISTS "paused_reason" text;
ALTER TABLE "email_sender_profiles" ADD COLUMN IF NOT EXISTS "paused_at" timestamp with time zone;
ALTER TABLE "email_sender_profiles" ADD COLUMN IF NOT EXISTS "health_action" varchar(10) DEFAULT 'auto' NOT NULL; -- auto | alert (기본 주소는 코드가 늘 알림만)
ALTER TABLE "email_sender_profiles" ADD COLUMN IF NOT EXISTS "health_reset_at" timestamp with time zone;
-- 이미 멈춰 있는 주소는 사람이 멈춘 것이다
UPDATE "email_sender_profiles" SET "paused_source" = 'manual' WHERE "is_paused" = true AND "paused_source" IS NULL;

-- 4) 반송 안내·스팸 신고 신호 (회신 읽기가 넘겨준 것, 4절). send_log_id는 FK 없음 — 큰 표에 잠금을 걸지 않게 (RPL email_replies와 같은 이유)
CREATE TABLE IF NOT EXISTS "email_bounce_signals" (
    "id" serial PRIMARY KEY,
    "org_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
    "send_log_id" integer,
    "record_id" integer,                                   -- 이어진 발송의 레코드 (있을 때, RPL 사건용)
    "recipient_email" varchar(200) NOT NULL,               -- 소문자. Final-Recipient(없으면 Original). complaint는 이어진 발송의 받는 주소
    "original_recipient" varchar(200),
    "sender_email" varchar(200) NOT NULL,                  -- 소문자, 우리 발신 주소
    "dsn_action" varchar(16),
    "dsn_status" varchar(16),
    "diagnostic" text,                                     -- 앞 300자
    "kind" varchar(10) NOT NULL,                           -- hard | expired | soft | unknown | complaint
    "recipient_match" varchar(10),                         -- same | different | NULL(못 이음) — RPL M3
    "fail_side" varchar(10),                               -- recipient | sender
    "gmail_message_id" varchar(64) NOT NULL,
    "received_at" timestamp with time zone NOT NULL,
    "applied_at" timestamp with time zone,                 -- 발송 기록에 적용한 때. RPL dry_run이면 NULL (뒤에 applyPendingBounceSignals)
    "counted" boolean DEFAULT false NOT NULL,              -- 이 신호로 발송 기록이 처음 실패가 됐나
    "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "ebs_message_recipient_idx" ON "email_bounce_signals" ("org_id", "gmail_message_id", "recipient_email");
CREATE INDEX IF NOT EXISTS "ebs_org_received_idx" ON "email_bounce_signals" ("org_id", "received_at");
-- RPL 7-4 보내기 직전 반송 막기 (조직·주소, hard만)
CREATE INDEX IF NOT EXISTS "ebs_org_recipient_idx" ON "email_bounce_signals" ("org_id", "recipient_email") WHERE "kind" = 'hard';

-- 5) 건강 사건 (감사 기록)
CREATE TABLE IF NOT EXISTS "email_health_events" (
    "id" serial PRIMARY KEY,
    "org_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
    "workspace_id" integer,
    "entity_type" varchar(10) NOT NULL,                    -- partition | sender | domain | org
    "entity_id" integer,                                   -- 파티션 id·프로필 id (0 = 프로필 없는 기본 주소)
    "entity_key" varchar(220),                             -- 도메인 사건이면 도메인
    "kind" varchar(12) NOT NULL,                           -- danger | danger_with | auth_burst | release | report | cap | sync
    "level" varchar(8) NOT NULL,                           -- danger | caution | info
    "mode" varchar(8) NOT NULL,                            -- dry_run | alert | enforce
    "action" varchar(8) DEFAULT 'none' NOT NULL,           -- none | hold | pause | release
    "action_note" varchar(20),                             -- mode | opt_out | cap | cap_auth | no_profile | already | default_sender | sync_stale | sync_initial | unconfirmed_high
    "eval_window" varchar(4),                                   -- 7d | 30d
    "dedupe_key" varchar(200) NOT NULL,
    "metrics" jsonb,
    "summary" text NOT NULL,
    "actor_user_id" uuid,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "ehe_org_dedupe_idx" ON "email_health_events" ("org_id", "dedupe_key");
CREATE INDEX IF NOT EXISTS "ehe_org_created_idx" ON "email_health_events" ("org_id", "created_at");

-- 6) 알림 보낼 줄 — 한 회차의 새 사건을 조직·받는 곳마다 한 통으로 묶는다 (SND-13)
CREATE TABLE IF NOT EXISTS "email_health_alerts" (
    "id" serial PRIMARY KEY,
    "org_id" uuid NOT NULL,
    "batch_key" varchar(80) NOT NULL,                      -- run:<회차 시작 ms> | report:<날짜> | release:<…> | sync:<…>
    "event_ids" integer[] NOT NULL,
    "target" varchar(20) NOT NULL,                         -- ops | ws:<워크스페이스 id>
    "workspace_id" integer,
    "message" text NOT NULL,
    "status" varchar(12) DEFAULT 'pending' NOT NULL,       -- pending | processing | sent | failed | skipped | dry_run
    "attempts" integer DEFAULT 0 NOT NULL,
    "last_error" text,
    "scheduled_at" timestamp with time zone DEFAULT now() NOT NULL,
    "locked_at" timestamp with time zone,
    "sent_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "eha_org_batch_target_idx" ON "email_health_alerts" ("org_id", "batch_key", "target");
CREATE INDEX IF NOT EXISTS "eha_pickup_idx" ON "email_health_alerts" ("status", "scheduled_at", "id");

-- 7) 하루 건강 (대상별, 회차마다 오늘 줄을 덮어쓴다 — 날짜별로 남는다)
CREATE TABLE IF NOT EXISTS "email_health_daily" (
    "org_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
    "health_date" varchar(10) NOT NULL,                    -- KST "YYYY-MM-DD"
    "entity_key" varchar(220) NOT NULL,                    -- p:<id> | s:<id> | s:0 | d:<도메인>
    "workspace_id" integer,
    "final_count" integer DEFAULT 0 NOT NULL,
    "failed_count" integer DEFAULT 0 NOT NULL,
    "sender_side_count" integer DEFAULT 0 NOT NULL,
    "nhn_unsub_count" integer DEFAULT 0 NOT NULL,
    "unknown_count" integer DEFAULT 0 NOT NULL,
    "dsn_only_count" integer DEFAULT 0 NOT NULL,
    "rate_bp" integer,
    "state" varchar(12) NOT NULL,                          -- ok | caution | danger | insufficient
    "eval_window" varchar(4) DEFAULT '7d' NOT NULL,             -- 7d | 30d (느린 명단)
    "reasons" jsonb,                                       -- 걸린 기준·주소×명단 칸 상위 10개(칸·나머지·p값)
    "window_start" timestamp with time zone NOT NULL,
    "evaluated_at" timestamp with time zone DEFAULT now() NOT NULL,
    PRIMARY KEY ("org_id", "health_date", "entity_key")
);

-- 8) NHN 결과 동기화 상태 (조직마다 한 줄. 같은 appKey 묶음은 대표 조직 줄의 커서를 따른다)
CREATE TABLE IF NOT EXISTS "email_status_sync_state" (
    "org_id" uuid PRIMARY KEY REFERENCES "organizations"("id") ON DELETE CASCADE,
    "update_cursor" timestamp with time zone,              -- update-mails를 여기까지 다 읽었다 (3-2)
    "initial_from" timestamp with time zone,               -- 처음 커서 (now − 8일)
    "initial_done_at" timestamp with time zone,            -- 커서가 지금을 따라잡은 때. 비면 6-1 관문
    "last_run_at" timestamp with time zone,
    "last_ok_at" timestamp with time zone,
    "last_error" text,
    "last_error_code" varchar(20),                         -- auth | rate_limited | transient | config
    "consecutive_errors" integer DEFAULT 0 NOT NULL,
    "ops_alerted_at" timestamp with time zone,             -- 운영 알림 6시간 간격
    "stats" jsonb,                                         -- 마지막 회차 숫자: calls·windows·updated·unpaired·fallbackCalls·skippedWindows
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
```

`drizzle/meta/_journal.json`에 더한다:

```json
{
  "idx": 75,
  "version": "7",
  "when": 1773800000000,
  "tag": "0075_send_health",
  "breakpoints": true
}
```

(0074는 RPL 문서 몫: `when` 1773700000000. 두 문서를 합칠 때 0074가 먼저 들어가야 한다.)

- 예전 판의 `nhn_next_check_at`(요청 번호마다 다시 묻는 시각)은 커서 방식이라 없앴다 (SND-12). `email_status_sync_state`의 `backfill_*` 칸도 `update_cursor`·`initial_*`로 바꿨다.

### 8-2. `src/lib/db/schema.ts`

- `emailSendLogs`에 칸 7개와 색인 2개(`index("email_send_logs_org_sent_at_idx").on(table.orgId, table.sentAt)`, `index("email_send_logs_request_id_idx").on(table.requestId).where(sql\`request_id IS NOT NULL\`)`) — 지금 세 번째 인자가 없으니 더한다. 이름은 8-3과 같게. 이 저장소는 마이그레이션을 손으로 쓰고(스냅숏은 0000뿐) `db:generate`를 쓰지 않으므로 schema.ts의 색인 선언이 마이그레이션을 만들지 않는다. 시험의 스키마 비교(`schema-sync.ts`)는 8-3이 끝난 뒤 돈다.
- `emailSenderProfiles`에 칸 5개.
- 새 표 6개(`emailPartitionHolds`, `emailBounceSignals`, `emailHealthEvents`, `emailHealthAlerts`, `emailHealthDaily`, `emailStatusSyncState`)와 `$inferSelect` 타입.
- 대기열 세 표의 `status` 주석에 `held`를 더한다 (칸 형은 그대로 varchar(20)).

### 8-3. `email_send_logs` 색인은 부팅 뒤 트랜잭션 밖에서 (SND-15, 두 문서 같은 결론)

- 0075 안에서 색인을 만들면 같은 트랜잭션의 `ALTER TABLE email_send_logs ADD COLUMN`이 쥔 ACCESS EXCLUSIVE 잠금이 커밋까지 남아, 색인 만드는 내내 **읽기까지** 막힌다 — 클릭 추적 이동, 수신거부 토큰 조회, 깊이 알림, 대기열 워커가 모두 멈춘다 (F14). 예전 판의 "쓰기가 기다린다"는 영향을 작게 적었다.
- 그래서 처음부터 색인 두 개를 마이그레이션에서 뺀다. `src/lib/db/send-log-indexes.ts`의 `ensureSendLogIndexes()`가 **마이그레이션이 끝난 뒤, 트랜잭션 밖에서** 만든다:
  1. `instrumentation.ts`의 `register()`에서 `runMigrations()` 뒤에 **기다리지 않고**(`void ensureSendLogIndexes()`) 부른다 — 서버가 뜨는 것을 늦추지 않는다
  2. 전용 연결 하나(`postgres(url, { max: 1 })`)로 `pg_try_advisory_lock(0x5c4edf0a)` — 못 잡으면 다른 인스턴스가 하고 있으니 그만
  3. 색인마다: `pg_index.indisvalid = false`인 같은 이름(지난번 실패해 `INVALID`로 남은 것)이 있으면 `DROP INDEX CONCURRENTLY IF EXISTS` → `CREATE INDEX CONCURRENTLY IF NOT EXISTS "email_send_logs_org_sent_at_idx" ON "email_send_logs" ("org_id", "sent_at")`, `… "email_send_logs_request_id_idx" ON "email_send_logs" ("request_id") WHERE "request_id" IS NOT NULL`. `statement_timeout`은 이 연결에서만 0
  4. 로그 `[indexes] email_send_logs 색인 준비됨 (n초)` / 실패면 `[indexes] … 실패 — 다음 부팅에 다시` (오류 객체를 통째로 찍지 않는다). 실패해도 서버는 그대로다
- `CONCURRENTLY`는 그동안 읽기·쓰기를 막지 않는다 (만드는 시간만 길어진다).
- 색인이 생기기 전에는: 건강 판정이 그 회차를 건너뛰고(6-0), 동기화의 `request_id` 찾기와 RPL 조회는 느리게 돈다. 기능이 틀리게 돌지는 않는다.
- RPL(`DESIGN-RPL.md` 0절·6-2·9절)도 이 두 색인을 쓰고 `email_send_logs`에 다른 색인을 만들지 않는다.

---

## 9. API·cron

| 경로 | 인증 | 하는 일 |
|---|---|---|
| `POST /api/email/status-sync/process` | `CRON_SECRET` | 3절: 커서(`update-mails`) → 보조 질문. `NHN_STATUS_SYNC=off`면 `{ skipped: 'off' }`. 응답 `{ groups, calls, windows, updated, finalized, failedNew, unpaired, fallbackCalls, errors, skippedAsLocked? }` |
| `POST /api/email/send-health/process` | `CRON_SECRET` | 동기화 건강 확인 → 판정 → 조치 → 사건·알림 줄(묶음) → 보내기 → (09시 뒤) 매일 보고. lock `0x5c4edf09`, 예산 4분. 응답 `{ mode, orgs, danger, caution, holds, pauses, authBursts, gated, alertsSent, alertsFailed, report, skipped? }` |
| `GET /api/email/send-health` | 로그인 | 화면용: `{ mode, dsnInRate, sync: {lastOkAt, cursor, initialDone, unconfirmed, lastError}, partitions[], senders[], domains[], holds[], events[](14일) }`. 멤버는 볼 수 있는 명단만 (`partition-access.ts`의 범위 규칙). 주소는 조직 공통이라 모두 |
| `POST /api/email/send-health/holds/[id]/release` | 관리자 | 6-5 |
| `POST /api/email/send-health/senders/[id]/release` | 관리자 | 6-5 |
| `POST /api/email/logs/sync` (있음) | 로그인 | 3-7, 같은 함수 |
| `PUT /api/email/sender-profiles/[id]` (있음) | 한도 칸은 관리자 | `isPaused` 바뀜에 `paused_source` 적기, 자동 멈춤 풀기 기록·웜업 미루기(`releaseSenderPause` 한 함수, 6-5). `healthAction` 칸을 한도 칸처럼 관리자만 바꾼다 (`pickLimitPatch` 옆에 `pickHealthPatch`) |
| `GET /api/email/send-queue/stats` (있음) | 로그인 | 규칙별 `held` 수 더함 |
| `POST /api/email/send` (있음) | 로그인 | 레코드마다 명단 보류 확인(2건 이상이면 409), 기록의 명단 = 레코드의 명단 (6-2, SND-16) |

- PRD 7-3의 `/api/cron/nhn-sync`·`/api/cron/sender-health`는 저장소 관례(`/api/<기능>/…/process`)에 맞춰 위 이름으로 둔다.
- CloudType Scheduler: 동기화 10분(매시 0·10·20…분), 건강 10분(5·15·25…분). 대기열 주기 권장값(1분)과 상관없다.
- 응답은 `{ success: true, data }` / `{ success: false, error: "한국어" }` (CLAUDE.md).

---

## 10. 화면

새 기능 폴더 `src/components/email/send-health/` (CLAUDE.md 구조):

```
ui/SendHealthBanner.tsx      보류·멈춤이 있으면 맨 위 띠: "명단 1개 보류 · 주소 1개 자동 멈춤 — 자세히"
ui/HealthStateBadge.tsx      정상/주의/위험/판정 보류/회복 + 숫자 툴팁 (확정·실패·비율·기준·창 시작)
ui/HoldBadge.tsx             "명단 보류" (빨강) / "자동 멈춤" (주황) + 사유 한 줄·언제부터
ui/ReleaseDialog.tsx         풀기 확인 (메모 칸, 대기 N통이 다시 나간다는 안내, 주소면 "풀린 뒤 오늘 한도 N통 (웜업 M일째)"). 관리자에게만 버튼이 보인다
ui/SendHealthCard.tsx        이메일 첫 화면 카드: 명단 표(7일/30일 창 표시), 주소 표, 도메인 발신 쪽 실패, 최근 사건, 모드·동기화 상태(커서·미확정·관문에 걸렸으면 "자동 조치 미룸 — 사유"), 반송 안내 참고 숫자
hooks/useSendHealth.ts       SWR (GET /api/email/send-health), 풀기 뒤 mutate
api/sendHealthApi.ts         fetch 감싸기 (release 두 개)
types/index.ts
```

| 자리 | 붙일 것 |
|---|---|
| `src/components/email/EmailDashboard.tsx` | `SendHealthCard` (`id="send-health"` — 알림 링크가 여기로 온다) |
| AI 규칙 카드 `AutoPersonalizedEmailConfig.tsx:220` (`RuleQueueBadges` 옆) | 그 규칙 명단이 보류면 `HoldBadge`, 묶음에 자동 멈춘 주소가 있으면 "주소 N개 멈춤", 대기 칸에 "보류 N통" |
| 발신 주소 목록 `SenderProfileManager.tsx` (`SenderLimitBadges` 옆) | `HealthStateBadge` + 자동 멈춤이면 `HoldBadge`와 풀기 버튼(관리자). 기본 주소에는 "자동 멈춤 안 함(기본 주소)" 툴팁. 관리자 판별은 이미 쓰는 `hasMinRole(user.role, "admin")` |
| 발신 주소 설정 `SenderLimitSection.tsx` | "건강 조치: 자동 멈춤 / 알림만" 선택 (관리자만), 정지 스위치 옆에 "자동으로 멈춤 — 사유" 표시 |
| 명단 목록 `src/components/records/PartitionNav.tsx` | 보류된 명단 이름 옆 빨간 점 + 툴팁 |
| 명단 레코드 화면 머리 | 보류면 띠 + 풀기(관리자) |
| 후속 대기열 표 `FollowupQueueTable.tsx` | 상태 `held` = "명단 보류" |

- 문구는 쉬운 한국어로: "발송 실패가 많아 이 명단의 대량 발송을 잠시 멈췄습니다 (폼·광고 문의 메일은 그대로 나갑니다)". "SST" 같은 코드는 툴팁에만.
- 화면에 받는 사람 주소 목록을 보이지 않는다 (숫자와 사유 코드만).

---

## 11. 설정 값

| 환경 변수 | 기본 | 뜻 |
|---|---|---|
| `SEND_HEALTH_MODE` | `dry_run` | `off`·`dry_run`·`alert`·`enforce`. 모르는 값은 `dry_run` |
| `SEND_HEALTH_WEBHOOK_URL` | 없음 | 운영(대표) 구글 챗 스페이스. 비밀값 — 로그·응답에 찍지 않는다 |
| `SEND_HEALTH_WEBHOOK_URL_<워크스페이스 id>` | 없음 | 사업 스페이스. 없으면 `DEEP_ALERT_WEBHOOK_URL_<id>` |
| `SEND_HEALTH_REPORT_HOUR` | `9` | 매일 보고 시각 (KST, 0~23). 운영 보고는 이 시각에 바로, 이 시각이 밤(22~08시)이면 사업 스페이스 보고는 08시에 (7-5) |
| `SEND_HEALTH_MAX_AUTO_PAUSE_PER_DAY` | `5` | 조직마다 하루 자동 멈춤 상한 |
| `SEND_HEALTH_ALERT_ONLY_PARTITION_IDS` | 없음 | 알림만 할 명단 id 목록 (쉼표) |
| `NHN_STATUS_SYNC` | `on` | `off`면 동기화 cron이 아무것도 안 한다 |
| `NHN_STATUS_SYNC_MAX_CALLS` | `300` | 회차마다 NHN 질문 상한 (`update-mails` 쪽 + 보조 질문) |
| `NHN_STATUS_FALLBACK_CALLS` | `30` | 회차마다 보조 요청 번호 질문 상한 (3-3) |
| `NHN_STATUS_BACKFILL_DAYS` | `8` | 처음 커서를 며칠 전에서 시작하나 (0 = 1시간 전) |
| `NHN_STATUS_PAGE_SIZE` | `100` | `update-mails` 쪽 크기 [NHN 최댓값 확인 필요] |
| `SEND_HEALTH_DSN_IN_RATE` | `off` | `on`이면 "반송만"(NHN 성공 뒤 반송 안내)을 실패율에 넣는다. 문턱을 다시 본 뒤 켠다 (5-1, SND-02) |
| `SEND_HEALTH_MAX_AUTH_PAUSE_DOMAINS_PER_DAY` | `10` | 조직마다 하루 발신 쪽 실패 폭주 멈춤 도메인 상한 (주소 상한과 따로, SND-06) |
| `NEXT_PUBLIC_BASE_URL` | 있음 | 알림 링크 앞부분 |
| `GOOGLE_CHAT_REQUEST_ID`·`GOOGLE_CHAT_THREADS` | 꺼짐 | 구글 챗 중복 막기·스레드 (개발 스페이스에서 확인한 뒤 켬, `CHAT-QA.md`) |

문턱 값(200·5%·3%·50·3·100·1%·2·1시간 폭주·20%·30분)은 코드 상수다 (5-3). 밤 시간(22~08시)도 상수다.

---

## 12. 하지 않는 것·이어 받을 자리

| 항목 | 이 문서에서 | 이어 받는 곳 |
|---|---|---|
| SND-2 반송 주소 막기 | 하지 않는다 (자동 메일 경로의 90일 반송 막기는 RPL 7-4가 `email_bounce_signals`로 한다). `nhn_status_code`·`delivery_status_code`·`delivery_fail_side`·`email_bounce_signals.kind`가 재료다 | SND-2 설계 (하드 반송·도메인 없음만, `delivery_fail_side='sender'` 제외) |
| SND-1 2판 웹훅 (NHN 상태 변경 웹훅) | 하지 않는다. 10분 질문으로 대신한다 | 필요해지면 `applyNhnStatuses`를 웹훅에서도 부른다 |
| `queryUpdatedMails` (F4) | **쓴다** — 3-2 커서의 본 장치 (SND-12). 쿼리 이름을 문서대로 고친다 (`startMailStatusUpdateDate`·`endMailStatusUpdateDate`) | — |
| `queryMailsPaged` (F5) 3달치 채우기 | 하지 않는다 | SND-2 |
| SEQ-1 "첫 메일 실패면 후속 멈춤" | 반송 안내 hard(받는 사람 같음)는 RPL 7-4 막기가 `email_bounce_signals`로 이미 막는다. NHN SST3으로 실패한 발송의 후속 멈춤은 하지 않는다 — 이 동기화로 `failed`·`delivery_fail_source='nhn'`이 10분 안팎에 들어오므로 SEQ-1이 바로 쓸 수 있다 | SEQ-1 |
| 열람·사람 클릭·사흘 반응 0 | 판정하지 않는다 | MEA-1·SEQ-2 뒤 `evaluateHealth`에 신호를 더한다 |
| 손으로 명단 보류 | 만들지 않는다 (멈추려면 규칙을 끈다) | 필요하면 `source='manual'`로 같은 표 |
| 도메인 단위 조치·SND-4 | 발신 쪽 실패 폭주 멈춤 하나만 한다 (SND-06). 나머지는 보고만 | SND-4 |
| 회신 읽기 정체 때 후속 미루기 | 하지 않는다 (RPL 대표 결정 항목) | RPL 17절 |
| 알림톡 | 해당 없음 | — |

---

## 13. 파일 목록

**새 파일 (LF)**

| 파일 | 내용 |
|---|---|
| `drizzle/0075_send_health.sql` | 8-1 |
| `src/lib/email-status-sync-rules.ts` (+ `.test.ts`) | 순수: `mapNhnStatus`, `classifyFailSide`(SND-06), `pairUpdatedMails`·`pairNhnRows`, `nextUpdateWindow`(커서 창), `splitBudget`, `formatNhnDateTime`, `dsnLabel`, **`classifyDsn`(RPL도 import — B2)** |
| `src/lib/email-status-sync.ts` | DB: `runStatusSync()`(cron), `syncOrgStatuses(orgId, opts)`(버튼도), `readUpdateWindows`(커서), `fallbackQueries`(3-3), `applyNhnStatuses`(3-8 한 문장) |
| `src/lib/email-bounce-signal.ts` | `recordBounceSignal`, `applyPendingBounceSignals` (RPL이 부른다, 4절) |
| `src/lib/email-send-log-status.ts` | `acceptedSendCondition()`·`acceptedOrPendingCondition()` (6-6, SND-11) |
| `src/lib/db/send-log-indexes.ts` | `ensureSendLogIndexes()` (8-3) — RPL도 이 색인을 쓴다 |
| `src/lib/sender-health-rules.ts` (+ `.test.ts`) | 순수: `resolveSendHealthConfig`, `DEFAULT_THRESHOLDS`, `healthBucketSql`용 갈래 정의, `evaluateHealth`(7일·30일 창, 하한), `isOutlierCell`·`binomUpperTail`(5-4), `primarySenders`(SND-07), `detectAuthBursts`(SND-06), `syncGate`(6-1), `planActions`(기본 주소·상한 둘·관문), 글 만들기(`partitionDangerText`·`senderDangerText`·`senderWithPartitionsText`·`authBurstText`·`releaseText`·`batchAlertText`·`dailyReportText`), `dedupeKey`(하한·1%p 칸), `isQuietHour`, `rateBp`, `resolveHealthWebhooks` |
| `src/lib/sender-health.ts` | DB: `runSendHealth()` — 집계·판정·조치·사건·알림 묶음 보내기·매일 보고 |
| `src/lib/partition-hold.ts` | DB: `getActiveHold(orgId, partitionId, purpose)`, `holdPartition`, `releasePartitionHold`, `pauseSenderForHealth`, `releaseSenderPause`(웜업 미루기 포함) |
| `src/app/api/email/status-sync/process/route.ts` | cron |
| `src/app/api/email/send-health/process/route.ts` | cron |
| `src/app/api/email/send-health/route.ts` | 화면용 GET |
| `src/app/api/email/send-health/holds/[id]/release/route.ts` | 관리자 |
| `src/app/api/email/send-health/senders/[id]/release/route.ts` | 관리자 |
| `src/components/email/send-health/**` | 10절 |

**고칠 파일 (모두 지금 LF)**

| 파일 | 고칠 것 |
|---|---|
| `src/lib/db/schema.ts` | 8-2 |
| `drizzle/meta/_journal.json` | 0075 줄 |
| `src/lib/nhn-email.ts` | `NhnEmailQueryResult`에 `mailSeq?`·`dsnCode?`·`dsnMessage?`·`senderAddress?`·`mailStatusUpdatedDate?` (옛 `resultCode`·`resultCodeName`은 선택 칸으로 남김), `queryUpdatedMails` 쿼리 이름 고침(`startMailStatusUpdateDate`·`endMailStatusUpdateDate`)·쪽 번호·`totalCount` 돌려주기 |
| `src/instrumentation.ts` | `runMigrations()` 뒤 `void ensureSendLogIndexes()` (8-3) |
| `src/app/api/email/logs/sync/route.ts` | 3-7 |
| `src/lib/auto-personalized-email-outcome.ts` | `RecordOutcome.held?`, `QueueOutcome`에 `"hold"`, `foldOutcome` 순서, `describeOutcome` |
| `src/lib/auto-personalized-email.ts` | 규칙 조회 뒤 보류 확인(`purpose='bulk'`일 때만, 6-2), 중복·쿨다운 확인을 `acceptedSendCondition`으로 (`:40`·`:62`, 6-6) |
| `src/lib/automation-dispatch.ts` | 고치지 않는다 (늘 `inbound` — 보류를 보지 않는다, SND-09) |
| `src/lib/email-send-queue.ts` | `enqueueSends` 보류면 `held`로 적재, 워커가 줄의 `priority`로 `purpose`를 넘김, 결과 쓰기에서 `held` 처리, `QueueRunStats.held`, `loadDuplicateRecipients`(`:820`)·쿨다운 묶음(`:800`)을 `acceptedSendCondition`으로 (6-6) |
| `src/lib/email-send-queue-rules.ts` | `planQueueRow`의 `hold` 갈래, `QueueRowPlan["status"]`에 `held`, `revivesOnRequeue` |
| `src/lib/email-followup.ts` | `processFollowupItem` 보류 확인, `FollowupRunStats.held` |
| `src/lib/email-automation.ts` | `sendEmailSingle`·`sendTemplateFirst`·`processRepeatItem`의 `held`(`first_bulk`·`repeat`만), `enqueueHeldTemplateFirst`, `checkDuplicateRecipient`(`:73`)·쿨다운(`:50`)을 `acceptedSendCondition`으로 (6-6), `processRepeatItem` 마지막 update에 `status='pending'` (RPL m5와 같은 수정) |
| `src/app/api/email/send/route.ts` | 레코드마다 `records.partition_id`로 보류 확인 — 2건 이상이고 보류 명단이 있으면 409, 기록의 `partition_id`를 레코드의 명단으로 (`:191`, SND-16) |
| `src/app/api/email/sender-profiles/[id]/route.ts` | 6-3·6-5 (`paused_source`, 풀기 기록·웜업 미루기 — `releaseSenderPause`, `healthAction`) |
| `src/lib/email-sender-limit-rules.ts` (+ `.test.ts`) | 순수 `shiftWarmupStart(settings, pausedOn, releasedOn)` (SND-10) |
| `src/lib/email-sender-resolver.ts` | `senderProfileColumns`에 새 칸은 넣지 않는다 (자리 잡기 판정과 무관). 화면 목록 API만 `pausedSource`·`pausedReason`·`pausedAt`·`healthAction`을 돌려준다 |
| `src/app/api/email/send-queue/stats/route.ts`, `src/lib/email-send-queue-stats.ts` | `held` 따로 |
| `src/app/api/email/followup-queue/[id]/route.ts` | `held`도 취소 가능 |
| 화면 파일 | 10절 표 |

**구현 순서 (작게 나눠 시험하며)**: ① 0075 + schema + 8-3 색인 단계 → ② 동기화 규칙·모듈(커서)·cron·버튼 → ③ 판정 규칙(순수) + 시험 → ④ 보류 모듈 + 경로 연결(대량만) + 6-6 중복 확인 → ⑤ 건강 cron(관문·사건·묶음 알림·보고) → ⑥ API·화면 → ⑦ 반송 안내 함수 (RPL과 합침 — `classifyDsn`은 ②에서 먼저) → ⑧ 15절 검증.

---

## 14. 행동 목록 (H)

시험 종류: **U** = 순수 함수 시험(`tsx --test`), **I** = 로컬 시험 DB + 가짜 NHN 통합, **E** = 실제 경로 E2E.

| ID | 행동 | 시험 |
|---|---|---|
| H1 | SST2 → `sent`, SST3 → `failed` + 실패 출처 `nhn` + `delivery_status_code`, SST5·SST7·SST8 → `failed` + 코드별 사유 글, SST0·1·4 → 그대로. 모든 경우 `nhn_status_code` 기록. SST7·8과 SST3의 5.7.x·SPF·DKIM·DMARC는 `delivery_fail_side='sender'` | U, I |
| H2 | NHN이 받는 주소를 대문자로 줘도 짝지어진다. 요청 번호에 기록·결과가 하나씩이면 주소가 달라도 짝짓는다 | U, I |
| H3 | 커서 방식: 회차마다 `[커서 − 5분, 커서 + 1시간]` 창을 쪽 끝까지 읽은 뒤에만 커서를 옮긴다. 요청 번호로 짝짓는다. 우리 기록 없는 결과는 `unpaired`. 시험 발송도 동기화는 한다 (판정에서만 뺀다) | U(`nextUpdateWindow`·`pairUpdatedMails`), I |
| H4 | 한 회차 NHN 질문 ≤ `NHN_STATUS_SYNC_MAX_CALLS`. 같은 appKey를 쓰는 조직은 한 번만 읽는다. appKey 묶음 둘이면 고르게 나눈다 | U(`splitBudget`), I |
| H5 | 보조 질문: 2~48시간 지났는데 NHN 결과가 없는 기록만, 한 기록 3번까지, 회차 30번까지. 반송 안내로 먼저 실패가 된 기록도 묻는다. 48시간 넘은 늦은 SST3도 커서가 받는다 | I |
| H6 | NHN 5xx·429·`isSuccessful=false`면 커서를 옮기지 않고 다음 회차가 같은 창부터. 연속 5번이면 그 묶음 회차 중단. 401·403은 상태(`auth`)에 남고 **운영 스페이스에 바로 알림**(6시간에 1번), 매일 보고에도 | I |
| H7 | 동기화 두 회차가 겹치면 뒤 회차는 `skippedAsLocked` | I |
| H8 | 반송 안내와 NHN 결과의 세 순서(반송 → SST2, SST2 → 반송, NHN 결과 전 반송) 모두: `failed` 유지, 실패 한 번, 5-1 갈래가 같다("반송만" 또는 미확정). 커서·보조 질문·버튼 어느 길로 SST2가 와도 같다 | U(SQL 조립), I |
| H9 | 처음 커서는 8일 전, 1시간 창씩 예산 안에서 따라잡고 중간에 멈춰도 커서부터 이어 간다. 따라잡으면 `initial_done_at`. NHN이 오래된 창을 거절하면 건너뛰고 센다 | I |
| H10 | 화면 버튼도 같은 함수 — 같은 기록 결과 | I |
| H11 | `recordBounceSignal`: `classifyDsn` — failed+5.x → hard, failed+4.x → expired, delayed·4.x → soft, 그 밖 unknown. hard·expired이고 받는 사람이 같을 때만 발송 기록을 바꾼다. 받는 사람이 다르면 신호만(`different`). `threadLogId`가 있으면 먼저. 같은 Gmail 메시지 두 번 → 한 줄. 이미 SST3인 기록은 `counted=false`. 짝 없으면 `send_log_id NULL`. `apply=false`면 `applied_at` NULL, 뒤에 `applyPendingBounceSignals`가 적용. `complaint`는 발송 기록을 바꾸지 않음 | U(`classifyDsn`), I |
| H12 | 실패율 = 실패 ÷ 확정. 분모는 NHN 확정(SST2·SST3)만. 발신 쪽 실패·SST5·미확정(NHN 결과 없는 반송 포함)·보낼 때 거절·시험 발송은 빠진다. "반송만"은 `SEND_HEALTH_DSN_IN_RATE=on`일 때만 들어가고 아니면 `dsn_only`로 따로 | U |
| H13 | 명단: 199통 → 판정 보류, 200통 10실패 → 위험, 9실패 → 주의, 6실패 → 주의, 7일 150통·30일 400통 6% → 위험(30일 창) (5-5 표 전부) | U |
| H14 | 주소: 뚜렷이 높은 칸(50통·3실패·5% 이상, 나머지 주소 100통 이상, 이항 p < 0.01) 2개 → 위험, 1개 → 주의. 위험·주의·판정 보류 3%↑·보류 중·최근 7일 보류·풀림 명단은 칸에서 뺀다. "명단 3.5%에서 칸이 우연히 6%", "정상 명단에서 칸 3/50" → 셈 안 함. 위험 명단 2개의 주된 발신(50%↑) → "위험 — 주소 (명단과 함께)" 알림만 | U |
| H15 | 최근 24시간 발신 쪽 실패 있는 도메인 → 주의. 최근 1시간 발신 쪽 실패 3통 이상·20% 이상(또는 10통 이상) → 발신 쪽 실패 폭주: 즉시 운영 알림, enforce면 그 도메인 주소 멈춤(기본 주소 제외, 도메인 상한 따로). 그 실패는 명단 실패율에 들어가지 않는다 | U, I |
| H16 | 창은 168시간(느린 명단은 30일). 풀린 뒤에는 **풀린 시각 뒤** 발송만 센다. 명단 하한은 그 명단의 주소 칸에도 걸린다 | U |
| H17 | 모드 해석: 네 값, 모르는 값·빈 값은 `dry_run` | U |
| H18 | `dry_run`: 사건·알림 줄(`dry_run`)·하루 건강만 남고 챗 0통, 보류·멈춤 0 | I |
| H19 | `alert`: 한 회차의 새 위험을 받는 곳마다 챗 1통으로 묶어 (운영 + 해당 워크스페이스), 보류·멈춤 0. 밤(22~08시)에는 조치·폭주·정체가 없으면 보내지 않고 보고로 | U(`isQuietHour`·`batchAlertText`), I |
| H20 | `enforce` + 명단 위험: 보류 1줄(`scope='bulk'`), 대량 줄만 `pending → held`(AI 대기열 `priority=0`, 후속 전부, 템플릿 `repeat`·`first_bulk`), `last_error`는 그대로. 그 뒤 그 명단으로 대량 NHN 발송 0통 (처리 중이던 한 배치 제외). 동기화 관문(정체·처음 채우기 중·미확정 20%↑)에 걸리면 보류 없이 알림만 | I, E |
| H21 | 보류 명단에 새로 들어온 줄: 대량 적재는 `held`로 들어가고, 후속·템플릿 반복·`first_bulk`는 처리 때 `held`. 시도 횟수를 쓰지 않는다. AI·발신 자리 잡기를 부르지 않는다. **폼·광고·단건 문의(바로 보내는 AI, 대기열 `priority=1`, 템플릿 `first`)는 그대로 나간다** — 주소 멈춤·반송 막기는 따른다 | I, E |
| H22 | 수동 발송은 레코드마다 레코드의 명단으로 본다: 2건 이상이고 보류 명단 레코드가 있으면 409 (한국어 사유), 1건이면 나간다. 기록의 `partition_id`는 레코드의 명단. 시험 발송은 막지 않는다 | I |
| H23 | `enforce` + 주소 위험: `is_paused=true`, `paused_source='auto'`. AI 묶음은 남은 주소로 계속 보낸다. 손으로 멈춘 주소·`health_action='alert'`·프로필 없는 주소·**조직 기본 주소**는 알림만 (기본 주소는 "템플릿 메일 전체가 멈춤" 안내) | I, E |
| H24 | 하루 자동 멈춤 상한(5)을 넘는 주소는 멈추지 않고 상한 알림(묶음 안 한 덩어리). 발신 쪽 실패 폭주는 도메인 상한(10)을 따로 센다 | U, I |
| H25 | 명단 풀기: 관리자만(멤버 403, 다른 조직 404), `released_at·by·note`, `held → pending`(순서·미룸 사유 유지), 깨우기, 풀림 알림 1통. 그 뒤 풀린 시각 뒤 발송이 다시 200통 쌓이기 전에는 보류되지 않고, 그 명단을 보낸 주소도 7일 동안 그 명단 때문에 멈추지 않는다 | I, E |
| H26 | 주소 풀기: 자동 멈춤만 (손으로 멈춘 주소는 409). 설정 화면에서 꺼도 같은 기록·`health_reset_at`. 웜업 중이면 `warmup_started_on`이 멈춘 동안의 보낼 수 있는 날만큼 뒤로 — 풀린 날 한도 = 멈춘 날 한도 | U(`shiftWarmupStart`), I |
| H27 | 같은 대상·종류·모드·유예 하한(없으면 0)·비율 1%p 칸이면 사건 한 번 — 날짜가 바뀌어도 다시 오지 않고, 1%p 넘게 나빠지면 새 사건. 보류 중인 명단·자동 멈춘 주소는 다시 판정하지 않는다 | U, I |
| H28 | 알림 받는 곳: 워크스페이스 웹훅(`SEND_HEALTH_…_<id>` → `DEEP_ALERT_…_<id>`) + 운영. 없으면 `skipped`. 429·5xx 10분 뒤 최대 3번, 401·403·404는 되돌림. 카드에 받는 사람 주소가 없다 | U(글·주소 고르기), I |
| H29 | 매일 보고: KST 9시 뒤 첫 회차, 조직·받는 곳마다 하루 1번. 사업 보고는 실을 것이 없으면 안 보냄 | U, I |
| H30 | 하루 건강 표에 대상별 오늘 줄이 회차마다 덮어써지고 어제 줄은 남는다 | I |
| H31 | 화면: 보류·멈춤 배지·띠가 보이고 풀기 버튼은 관리자에게만. 멤버는 권한 있는 명단만 | E |
| H32 | 조직 섞임 없음: 조직 B의 나쁜 명단이 조직 A의 판정·대기열·알림에 영향 없음. 모든 조회·갱신에 `org_id` | I |
| H33 | 시험 중 실제 외부 호출 0 (`mock-log.jsonl`에 `blocked`·`blocked-socket` 0, NHN·챗은 가짜 기록만) | I, E |
| H34 | 중복 수신자·쿨다운 확인은 "NHN이 접수한 발송"(`sent`, 또는 결과 코드·반송이 있는 `failed`)을 본다 — 반송·SST3으로 `failed`가 된 주소를 다시 가져와도 AI 메일을 다시 쓰지 않는다. 보낼 때 거절(F8)은 지금처럼 다시 보낼 수 있다. 대기열 미리 판정과 실제 판정이 같다 | I |
| H35 | 0075는 `email_send_logs`에 칸만 더하고 색인을 만들지 않는다. 부팅 뒤 `ensureSendLogIndexes`가 CONCURRENTLY로 두 색인을 만들고, 실패해 `INVALID`로 남은 색인은 지우고 다시 만든다. 색인이 없는 동안 건강 판정은 건너뛴다 | I |

---

## 15. 로컬 검증 계획

### 15-1. 환경 (실제 서비스·개발 DB를 쓰지 않는다)

- DB: 내장 Postgres `127.0.0.1:54329/salesflow_test` (`node F:/Dev/sendb-testenv/start-db.mjs`, 미리보기 설정 `test-postgres`). **개발 DB·운영 DB·실데이터 사본은 쓰지 않는다.**
- 서버: `node F:/Dev/sendb-testenv/run-server.mjs` (3100, 미리보기 `sendb-test`). 시험 DB가 아니면 뜨지 않고, `.testenv/mock-fetch.mjs`가 NHN·구글 챗·Anthropic을 가짜로 받고 그 밖의 바깥 요청·소켓을 막는다.
- 모드 바꾸기: `F:/Dev/sendb-testenv/.env.test`의 `SEND_HEALTH_MODE`를 바꾸고 서버를 다시 띄운다. 웹훅은 가짜 값 `https://chat.googleapis.com/v1/spaces/TEST-OPS/messages?key=x&token=y`, `…/spaces/TEST-WS<id>/…`, 장애 시험은 `…/spaces/FAIL500/…`. 실제 키·웹훅은 쓰지 않는다.
- 시험 스크립트는 `F:/Dev/salesflow/.testenv/`(커밋 안 됨)에 둔다. `F:/Temp` 아래에는 아무것도 만들지 않는다.
- 단위 시험: `npm test` (`tsx --test "src/**/*.test.ts"`).

### 15-2. 가짜 NHN 넓히기 (`.testenv/mock-fetch.mjs`)

지금은 발송(`/sender/eachMail`)만 흉내 내고 조회는 빈 목록을 준다. 아래를 더한다.

1. **보낸 메일 기억**: `eachMail` 때 `requestId → { to[], from, at }`를 메모리에 둔다. 서버를 다시 띄워도 이어지게, 처음 조회 때 `mock-log.jsonl`의 `kind:"send"` 줄과 `.testenv/nhn-seeded.jsonl`(시드 스크립트가 직접 넣은 기록용)을 읽어 채운다.
2. **결과 규칙 파일** `.testenv/nhn-status-rules.json` — 조회 때마다 다시 읽는다 (서버 재시작 없이 시나리오 바꾸기). 없으면 모두 SST2. 메일마다 "상태가 바뀐 시각" = 보낸 시각 + `updateDelayMin`(기본 1분)이다.

```json
{
  "default": { "status": "SST2" },
  "rules": [
    { "match": "bounce",    "status": "SST3", "dsnCode": "5.1.1", "dsnMessage": "550 5.1.1 user unknown" },
    { "match": "nodomain",  "status": "SST3", "dsnCode": "5.1.2", "dsnMessage": "domain not found" },
    { "match": "dmarc",     "status": "SST3", "dsnCode": "5.7.26", "dsnMessage": "550 5.7.26 unauthenticated email is not accepted due to domain's DMARC policy" },
    { "match": "unauth",    "status": "SST7" },
    { "match": "whitelist", "status": "SST8" },
    { "match": "nhnrefuse", "status": "SST5" },
    { "match": "slow",      "status": "SST2", "updateDelayMin": 90 },
    { "match": "late3",     "status": "SST3", "updateDelayMin": 3000, "dsnCode": "5.2.2", "dsnMessage": "mailbox full" },
    { "match": "upper",     "status": "SST2", "upperCaseAddr": true },
    { "match": "missupd",   "status": "SST2", "missFromUpdates": true },
    { "match": "unknownnhn","status": "NONE" }
  ],
  "fault": { "queryHttpStatus": 0, "querySuccessFalse": false, "failFirstN": 0, "rejectUpdatesBefore": null }
}
```

   - `match`: 받는 주소에 들어 있는 글자(대소문자 무시). `/…/`면 정규식. 위에서부터 첫 규칙.
   - `updateDelayMin`: 상태가 바뀐 시각까지의 분. 그 전에는 요청 번호 조회가 SST1을 주고 `update-mails`에 안 나온다 (`late3` = 50시간 뒤 SST3 — 48시간 넘은 늦은 실패).
   - `missFromUpdates`: `update-mails`에는 안 나오고 요청 번호 조회에만 나온다 (3-3 보조 질문 시험).
   - `"NONE"`: 어디에도 나오지 않는다 (NHN이 모름).
   - `fault.queryHttpStatus`: 500·429·401이면 조회가 그 HTTP 상태로 끝난다. `querySuccessFalse`: 헤더 `isSuccessful:false`. `failFirstN`: 처음 n번만 실패. `rejectUpdatesBefore`: 이 시각보다 오래된 `update-mails` 창은 400 (3-6 오래된 창 거절 흉내).
3. **상태 변경 목록** `GET /sender/update-mails?startMailStatusUpdateDate&endMailStatusUpdateDate&pageNum&pageSize` → 상태가 바뀐 시각(KST 문자열 비교)으로 거르고 쪽 나누기 → `{ header, body: { pageNum, pageSize, totalCount, data: [{ requestId, mailSeq: 0, mailStatusCode, mailStatusName, requestDate, resultDate, mailStatusUpdatedDate, dsnCode, dsnMessage }] } }` (받는 주소 없음 — 실제와 같다). 기록 `{service:"nhn", kind:"query-updates", start, end, pageNum}`.
4. **요청 번호 조회** `GET /sender/mails?requestId=…` → `{ header, body: { pageNum, pageSize, totalCount, data: [{ requestId, mailSeq: 0, requestDate, resultDate, mailStatusCode, mailStatusName, receiveMailAddr, senderAddress, dsnCode, dsnMessage }] } }`. 기록 `{service:"nhn", kind:"query", requestId}`.
5. 그 밖의 NHN 경로는 지금처럼 빈 목록 (`kind:"other"`).

### 15-3. 시드 (`.testenv/snd-seed.ts`, 시험 DB에만)

DB 주소가 `127.0.0.1:54329/salesflow_test`가 아니면 멈춘다 (run-server.mjs와 같은 안전장치). 가짜 주소는 모두 `@example.test`.

| 대상 | 만들 것 | 기대 |
|---|---|---|
| 조직 A / 워크스페이스 W1 | 명단 P1: 220통, `bounce` 14 → 6.4% | 위험 — 명단 |
| | 명단 P2: 220통, `bounce` 4 → 1.8% | 정상 |
| | 명단 P3: 150통, `bounce` 15 → 10% | 판정 보류 (200 미만, 30일도 150) |
| | 명단 P7: 210통, `bounce` 7 → 3.3% | 주의 — 명단 |
| | 명단 P10 (느린 명단): 최근 7일 150통 + 8~29일 전 250통, 모두 합쳐 `bounce` 24 → 6% | 위험 — 명단 (`30d`) |
| 조직 A / 워크스페이스 W2 | 명단 P4·P5: 각 300통, 주소 S1·S2·S3가 나눠 보냄. S2 몫 60통 중 4통 `bounce`(6.7%), 나머지 주소 0.5% | P4·P5 정상, **S2 위험 — 주소** (칸 p < 0.01) |
| | 명단 P11·P12: 각 300통 2.5%, 주소 S8이 각 50통 중 3통 `bounce`(6%) | S8 셈 안 함 (우연 — SND-03) |
| | 명단 P8·P9: 각 220통 6%, 주소 S7이 각 60%를 보냄, 나머지는 묶음 주소 | P8·P9 위험, **S7 "위험 — 주소 (명단과 함께)" 알림, 멈춤 없음** (PRD 수용 기준 3 — SND-07) |
| | 주소 S3로 `unauth` 3통 | 발신 도메인 주의 (SST7) |
| | 도메인 `dmarc-x.example.test`의 주소 S9·S10: 최근 1시간 확정 20통 + `dmarc` 6통 | 발신 쪽 실패 폭주 — enforce면 S9·S10 멈춤, 명단 실패율에 안 들어감 (SND-06) |
| | 조직 A 기본 주소 D: 템플릿 명단 T1·T2(각 220통 4%, D 혼자 보냄) | T1·T2 주의, D는 칸이 없어 주소 위험 아님 (SND-08) |
| | `nhnrefuse` 2통, `slow` 5통, `late3` 3통, `upper` 2통, `missupd` 2통, `unknownnhn` 2통 | H1·H2·H3·H5 |
| 조직 B | 명단 Q1: 220통, `bounce` 22 (10%) | 조직 B만 위험 (H32) |
| 시험 후속 | `trigger_type='test_followup'` 30통 `bounce` | 판정에 안 섞임 |

기록은 `request_id='seed-<n>'`, `status='sent'`, `sent_at`은 지금부터 1~70시간 전에 흩는다(P10은 29일 전까지). 같은 내용을 `nhn-seeded.jsonl`에 쓴다. 대기열: P1에 AI 대기 50줄(대량 `priority=0`) + 문의 2줄(`priority=1`)·후속 대기 20줄·템플릿 반복 5줄·템플릿 `first` 1줄, W2 규칙 묶음 [S1,S2,S3]. S2는 웜업 켬(첫날 10·하루 +5, 시작 5일 전).

### 15-4. 시나리오

모든 cron 호출은 `x-secret: <.env.test의 CRON_SECRET>`. 시간 흐름은 `qp-fakeclock.mjs` 가짜 시계로 당긴다 (커서 창·밤 시간·09시 보고).

| # | 단계 | 확인 | H |
|---|---|---|---|
| V1 | `npm test` | 새 순수 시험 전부 통과(5-5 표 전부, `binomUpperTail`, `classifyDsn`, `classifyFailSide`, `shiftWarmupStart`, `dedupeKey`, `isQuietHour`), 예전 시험 그대로 | H2·4·11~17·24·26·27~29 |
| V2 | 동기화 cron 1번 (`MAX_CALLS=300`) | `mock-log`의 `query-updates`가 8일 전부터 1시간 창으로 이어지고 쪽 끝까지 읽은 창만큼 커서 이동, 질문 ≤ 300. 48시간 안 기록에 코드가 들어감, SST3은 `delivery_fail_source='nhn'`·`delivery_status_code`, `dmarc`는 `delivery_fail_side='sender'`, `upper`도 짝지어짐, `slow`는 아직 없음 | H1·2·3·4·9 |
| V3 | 시계를 2시간·50시간 당기며 몇 번 더 | `slow` → SST2(커서), `missupd` → 보조 질문(`query`)으로 SST2, `late3` → 50시간 뒤 SST3(커서). 커서가 지금을 따라잡으면 `initial_done_at` | H3·H5·H9 |
| V4 | `fault.queryHttpStatus=500` 뒤 1번 / `401` 뒤 1번 / `rejectUpdatesBefore` | 커서 그대로, 5번째 오류에서 그 묶음 중단 / 상태 `auth` + TEST-OPS로 운영 알림 1통(6시간 안 다시 0) / 오래된 창 건너뜀(`skippedWindows`) | H6·H9 |
| V5 | 동기화 cron 두 개를 동시에 | 하나는 `skippedAsLocked` | H7 |
| V6 | 화면 버튼 경로 (로그인 후 `POST /api/email/logs/sync`) | V2와 같은 기록 규칙 | H10 |
| V7 | **RPL 경로로 들어온 반송** (RPL 시나리오 RS5c와 같은 픽스처, 가짜 Gmail): P2의 기록 셋에 반송 5.1.1을 (가) NHN SST2 전에 (나) SST2 뒤에 (다) 처음 커서가 그 기록을 SST2로 채우기 전에 넣고 각각 동기화 | 셋 다 `status='failed'`·`delivery_fail_source='dsn'`·실패 한 번. (가)(나)는 5-1 "반송만", (다)는 SST2가 오기 전 미확정 → 온 뒤 "반송만". 동기화가 SST2를 다시 줘도 `failed` 유지 | H8·H11 |
| V7b | `recordBounceSignal` 직접: 같은 메시지 다시, SST3 기록에 한 번, failed+4.4.7, delayed 4.2.2, 모르는 주소, Final-Recipient가 다른 주소(`different`), `apply=false` 뒤 `applyPendingBounceSignals`, `complaint` | 중복 없음 · `counted=false` · expired(실패로 셈, 막기 없음) · soft(기록만) · `send_log_id NULL` · 발송 그대로 · 처음엔 `applied_at` NULL 뒤에 적용 · 발송 그대로 | H11 |
| V8 | `SEND_HEALTH_MODE=dry_run`, 건강 cron | P1 위험·P7 주의·P3 판정 보류·P10 위험(30d)·S2 위험·S8 정상·P8·P9 위험·S7 명단과 함께·`dmarc-x` 폭주·S3 도메인 주의·D 정상·조직 B Q1 위험. 사건·알림 줄 `dry_run`, `chat` 기록 0, 보류 0, `is_paused` 변화 0, 하루 건강 줄 생김, 보고의 `dsn_only`에 V7 반송이 따로 | H12~16·18·30·32 |
| V9 | `alert`로 다시 띄우고 cron | 챗: TEST-OPS 1통·TEST-WS1 1통·TEST-WS2 1통(회차 묶음), 조직 B는 조직 B 쪽만. 같은 날 cron 다시 → 추가 0. **가짜 시계로 다음 날 00:05 → 추가 0** (날짜가 키에 없다). P1 실패를 더 넣어 6.4% → 7.6%로 → 새 사건 1. 밤 23시에 새 주의만 생기면 `skipped`(밤 시간). 카드 글에 `@example.test` 없음 | H19·27·28·32 |
| V10 | `enforce`로 다시 띄우고 cron | P1·P8·P9·P10 보류, P1의 AI 대량 50·후속 20·반복 5 → `held`, **문의 2줄·`first` 1줄은 `pending` 그대로**, `last_error` 변화 없음. S2 `is_paused=true`·`auto`, S7 멈추지 않음("명단과 함께" 알림), D는 위험 아님(혼자 보내는 템플릿 명단은 칸이 없다), S9·S10 멈춤(폭주), P4·P5는 보류 안 됨 | H20·21·23 |
| V10b | 동기화 관문: 상태 표 `last_ok_at`을 1시간 전으로 / `initial_done_at` NULL / P1 미확정 30%로 → cron | 셋 다 보류·멈춤 0, 사건 `action_note` `sync_stale`·`sync_initial`·`unconfirmed_high`, 정체는 운영 알림 | H20 |
| V11 | 대기열 워커 cron, 후속·반복 cron | P1로 대량 NHN `send` 0 (`mock-log`), 문의 2줄과 `first`는 나감. W2 규칙은 S1·S3로만 보냄 | H20·21·23 |
| V12 | P1에 가져오기 30건 + 폼 단건 레코드 1건 (AI 규칙 on_create) | 30줄은 `held`로 적재, 단건은 바로 나감(`automation-dispatch`). 30줄에 Anthropic 호출 0, 자리 잡기 사용량 변화 0 | H21 |
| V13 | P1 레코드 2건으로 수동 발송 / 1건 / P2 템플릿 연결로 P1 레코드 2건 | 409 한국어 / 나감, 기록 `partition_id`=P1 / 409 (레코드의 명단으로 봄). 시험 발송(`test-send`)은 나감 | H22 |
| V14 | S2에 `health_action='alert'` 두고, 새 주소 S4를 같은 조건으로 시드 → cron. 기본 주소 D도 S2와 같은 조건(다른 주소와 섞인 명단 두 개에서 뚜렷이 높음)으로 시드 → cron | S4는 멈추지 않고 알림만(`action_note='opt_out'`). D도 멈추지 않고 알림만(`default_sender`, "템플릿 메일 전체가 멈춤" 문구) | H23 |
| V15 | 주소 6개를 위험으로 시드 → cron / 도메인 11개를 폭주로 시드 → cron | 5개만 멈춤·상한 덩어리 1 / 10개 도메인만 멈춤·`cap_auth` | H24 |
| V16 | 풀기: 멤버 → 403, 다른 조직 hold id → 404, 관리자 → 200 | `released_*` 기록, `held → pending`(순서·`last_error` 그대로), 깨우기 뒤 P1 발송 재개(`send` 기록), 풀림 알림 1통. 바로 cron → 다시 보류 안 됨, **P1을 보낸 주소 멈춤 0** (SND-04). 풀린 뒤 10분 안에 나간 메일이 다음 판정 재료에 들어 있음 (SND-05) | H25 |
| V16b | P8·P9 보류 다음 회차 (두 명단 실패 그대로) | 묶음 주소 멈춤 0 (SND-04) | H14 |
| V17 | S2 풀기 API(웜업 5일째에 멈춤, 평일 10일 뒤로 시계), 손으로 멈춘 S5 풀기 API, 설정 화면 PUT으로 자동 멈춘 S6 끄기 | S2 풀림·`warmup_started_on`이 10 보낼 수 있는 날만큼 뒤로·오늘 한도 35, S5 409, S6 풀림 기록·`health_reset_at` | H26 |
| V18 | 웹훅 TEST-OPS를 FAIL500으로 → cron 두 번 (재시도 시각 당김) | 3번까지 다시, 그 뒤 `failed`. 401 흉내(`…/spaces/FAIL401/…`, 가짜에 한 줄 더함)는 되돌림 | H28 |
| V19 | 가짜 시계로 KST 08:59 → 09:01 | 09:01 회차에 매일 보고 1번(운영·W1·W2), 다시 돌려도 0. 운영 보고에 "회신 읽기" 줄(RPL 상태 표)과 "반송 안내(실패율에 아직 안 넣음)" 줄 | H29 |
| V20 | 화면 (Playwright, `F:/Dev/sendb-testenv/ux`) 관리자·멤버로 이메일 첫 화면·규칙 카드·발신 주소·명단 목록 | 배지·띠·풀기 버튼(관리자만), 기본 주소 툴팁, 풀기 대화상자의 웜업 한도 문구, 멤버는 W1 권한만이면 W2 명단이 안 보임. 화면 찍기 | H31 |
| V21 | 끝에 `mock-log.jsonl` 훑기 | `blocked`·`blocked-socket` 0, 실제 호스트 호출 0 | H33 |
| V22 | 마이그레이션 두 번 (`.testenv/run-migrate.ts`) → 서버 부팅 → `[indexes]` 로그 → 스키마 비교 (`schema-sync.ts`) | 두 번째는 아무것도 안 바뀜, 0075에 `CREATE INDEX`가 없음, 부팅 뒤 두 색인 `indisvalid=true`, schema.ts와 DB 차이 0 | H35 |
| V23 | 색인 관문 측정 (SND-15): 시험 DB에 가짜 기록 50만 줄 → 다른 연결에서 `SELECT … FROM email_send_logs WHERE id = …`를 0.1초마다 → 0074·0075 적용 | **0075 전체 동안 그 SELECT가 막힌 가장 긴 시간**을 남긴다 (색인을 빼서 1초 안이어야 한다). 이어서 `ensureSendLogIndexes` 동안 SELECT·INSERT가 막히지 않음 | H35 |
| V24 | 중복 확인 (SND-11): P2의 `bounce` 주소 하나를 같은 명단에 다시 가져오기 (중복 막기 켠 AI 규칙) / F8 흉내(보낼 때 거절된 `failed`) 주소 다시 가져오기 | Anthropic·NHN 0 (중복으로 건너뜀) / 지금처럼 다시 보냄. 대기열 미리 판정과 같은 결과 | H34 |

### 15-5. 실제 경로 E2E (짧게)

V12·V16 대신 실제 흐름 한 번: P6에 레코드 220건 가져오기(14건 `bounce`) + 폼 단건 1건 → 대기열 워커가 가짜 AI·가짜 NHN으로 보냄 → 동기화(커서) → 건강(`enforce`) → 보류 → 레코드 50건 더 가져와도 `send` 0, 폼 단건은 나감 → 풀기 → 다시 나감. 결과를 `.testenv/snd-e2e-result.json`에 남긴다.

---

## 16. 위험·확인할 것

| 항목 | 내용 | 대응 |
|---|---|---|
| 0075 잠금 (관문) | 0075는 `email_send_logs`에 칸만 더한다 (메타데이터만, 표를 다시 쓰지 않음). 그래도 ACCESS EXCLUSIVE를 얻을 때 앞선 긴 조회 뒤에서 기다리며 그동안 새 조회를 줄 세운다 | `SET LOCAL lock_timeout = '5s'` — 못 얻으면 마이그레이션이 되돌려진다. migrate.ts가 3번(3·10·20초 뒤) 다시 해 보고, 그래도 실패하면 서버를 띄우지 않고 끝낸다 (옛 스키마로 뜨면 발송 기록 insert가 모두 42703 — 검토 F1·OPS-1). V23으로 "0075 전체 동안 SELECT가 막힌 시간"을 잰다 (SND-15) |
| 색인 만들기 | 8-3이 부팅 뒤 CONCURRENTLY로 만든다. 표가 크면 몇 분 걸릴 수 있다. 실패하면 `INVALID` 색인이 남는다 | 다음 부팅에 지우고 다시. 그동안 건강 판정은 건너뛰고, 동기화·RPL 조회는 느리게 돈다 |
| NHN `update-mails` 쪽 크기·기간 제한 | 문서에 최댓값·조회 가능 기간이 없다 | 기본 100, 창 1시간. 개발 서버에서 대표 승인 뒤 한 번 확인하고 올린다. 오래된 창을 거절하면 건너뛴다 (3-6) |
| NHN 질문 한도 | 문서에서 찾지 못했다 | 커서 방식이라 평소 회차당 1~2번. 429가 나오면 3-5대로 물러난다 |
| SST2 시각 기준 | 문서: SST2는 "수신 완료 시간" 기준으로 `update-mails`에 잡힌다 | 5분 겹침 창 + 3-3 보조 질문으로 놓친 것을 메운다. `unpaired`·미확정 건수를 매일 보고에서 본다 |
| 반송 안내 짝짓기 | 받는 서버가 Final-Recipient를 바꿔 적으면 대체 짝짓기로 못 잇는다 | 원본 Message-ID 짝(RPL `threadLogId`)이 먼저다. 받는 사람이 다르면 신호만(`different`). 짝 없는·다른 수를 매일 보고 |
| 반송 안내를 실패율에 넣는 때 | 기준선이 SST3만으로 정해졌다 (SND-02) | `SEND_HEALTH_DSN_IN_RATE=off`로 시작. dry_run·alert 기간 `dsn_only`를 보고 대표가 문턱을 다시 본 뒤 켠다 — **대표 확인 필요** |
| PRD SND-3 수용 기준 3과 다름 | PRD: "명단 2개에서 함께 6%면 위험 — 주소 알림, 2판이면 그 주소가 다음 자리 잡기에서 빠진다". 이 설계: 알림은 보내고(5-3 "명단과 함께"), 멈추지는 않는다 — 두 명단이 이미 보류되어 발송이 멈추고, 묶음 주소를 함께 멈추면 다른 명단 발송량이 무너진다 (SND-07) | **대표 확인 필요**: 이 차이를 받아들이면 PRD 수용 기준 3의 둘째 문장을 "2판이면 명단이 보류되고 주소는 알림"으로 고친다. 아니면 `danger_with`에도 멈춤을 거는 한 줄(상한 안)로 바꾼다 |
| 기본 주소 자동 멈춤 안 함 | 기본 주소가 진짜 나빠져도 사람이 멈출 때까지 나간다 (SND-08) | 알림 글이 "템플릿 메일 전체가 멈춤"을 알려 사람이 고른다. 발신 쪽 실패 폭주에서도 기본 주소는 알림만 |
| 문의는 보류하지 않음 | 보류 명단에 폼·광고 문의가 오면 그 회신 메일은 나간다 (SND-09) | 문의 주소는 가져온 명단의 실패율 원인이 아니다. 주소 멈춤·반송 막기는 그대로 따른다 |
| 발신 쪽 실패 분류 | 받는 서버가 받는 사람 사정으로 5.7.1을 쓰는 일도 있다 (예: 그룹이 외부 메일 거절) | 폭주 기준(1시간 3통·20%)이라 드문 5.7.1은 주의에만 남는다. 보고에 사유 상위를 보인다 |
| 묶음 주소 한꺼번에 멈춤 | 5-4(뚜렷이 높은 칸만, 보류·최근 풀림 명단 제외)·6-4(상한)로 막았다 | 상한 알림이 오면 사람이 본다 |
| 진행 중 한 배치 | 보류 직전에 확인을 지난 최대 5통은 나갈 수 있다 | 문서화 (H20) |
| 11/2 실험 | `enforce`면 실험 명단·주소도 멈출 수 있다 | 실험 명단 id를 `SEND_HEALTH_ALERT_ONLY_PARTITION_IDS`에, 실험 주소는 `health_action='alert'`로 — 켜기 전에 실험 담당과 맞춘다 |
| 0074와 순서 | RPL의 0074가 먼저 커밋되어야 한다 | 두 설계를 합칠 때 journal 순서 확인. RPL이 0074를 쓰지 않으면 이 문서를 0074로 당긴다 |
| lock 키 | RPL `0x5c4edf07`, SND 동기화 `08`·건강 `09`·부팅 뒤 색인 `0a` | 두 문서 같은 표 (RPL 0절) |

---

## 17. 검토 반영 (2026-10-11 1차 검토)

| ID | 등급 | 문제 (한 줄) | 반영 | 자리 |
|---|---|---|---|---|
| SND-01 | 막힘 | 반송 안내 계약이 RPL과 정반대 — 두 모듈이 `email_send_logs`를 서로 다르게 쓰고, 순서에 따라 반송이 실패율에서 빠지거나 성공으로 세짐 | `email_send_logs` 배달 결과 칸은 이 문서의 `applyNhnStatuses`·`recordBounceSignal` 둘만 쓴다. RPL은 알아보기·풀기·Message-ID 짝(`threadLogId`)만 넘긴다. `classifyDsn` 하나(hard·expired·soft·unknown), 짝짓기 7일 하나, 판정은 `delivery_fail_source`(`result_code LIKE 'DSN:%'` 안 씀). 보조 질문이 `dsn` 기록도 묻고, "보낼 때 거절"에 `delivery_fail_source IS NULL`, 모든 쓰기가 같은 `CASE`. RPL 멈춤은 `held`도 닫는다. V7을 RPL 경로 세 순서로 | 2절, 3-3, 3-6, 3-8, 4절 전부, 5-1, 6-2, H8·H11, V7·V7b |
| SND-02 | 큼 | NHN 동기화가 늦으면 반송 안내만 실패로 들어가 실패율이 부풂, 반송 기준선 없음 | 분모는 NHN 확정만, NHN 결과 없는 반송은 미확정. "반송만"은 `SEND_HEALTH_DSN_IN_RATE`(기본 off)로 — 보고에 `dsn_only`. 동기화 정체(30분)·처음 채우기 중·미확정 20%↑이면 enforce여도 알림만. 정체·401/403은 운영 스페이스에 바로 | 3-5, 5-1, 5-3 상수, 6-1 관문, 7-4, 11절, 16절, V4·V10b |
| SND-03 | 큼 | 주소×명단 칸이 우연으로 쉽게 걸려 주마다 주소 여러 개가 멈춤 | 칸은 같은 명단의 나머지 주소(100통↑)와 비교해 이항 윗꼬리 p < 0.01일 때만. 주의·판정 보류 3%↑ 명단은 칸에서 뺌. "명단 3.5%에서 칸 6%"·"정상 명단 칸 3/50" 행 | 5-3 상수, 5-4, 5-5, H14, 시드 P11·P12 |
| SND-04 | 큼 | 보류된 명단·방금 풀린 명단의 실패가 주소 칸에 남아 묶음 주소가 멈춤 | 풀리지 않은 보류·최근 7일 보류/풀림 명단은 칸에서 뺌. 명단 하한을 그 명단 칸에도 | 5-2, 5-4, 5-5, 6-4, V16·V16b |
| SND-05 | 큼 | 유예가 "다음 정시부터"라 풀린 시각~정시 발송이 판정 밖 | 하한 = 풀린 시각 그대로. 집계가 대상별 하한으로 `after_p`·`after_s`를 가름. 예시를 "14:20 이후 발송부터"로 | 5-2, 5-5, 6-0, 6-5, H16, V16 |
| SND-06 | 큼 | DNS·인증 사고(5.7.x)가 명단 실패로 잘못 가고, 진짜 SST7 폭주는 다음 날까지 모름 | `delivery_fail_side`(SST7·8, 5.7.x·SPF·DKIM·DMARC·policy → `sender`)를 명단 실패율에서 빼고 주소·도메인으로. 최근 1시간 폭주(3통·20% 또는 10통) → 즉시 운영 알림, enforce면 그 도메인 주소 멈춤(기본 주소 제외, 도메인 상한 따로). 가짜 NHN에 `5.7.26 dmarc` 규칙 | 3-1, 3-8, 4-5, 5-1, 5-3, 5-5, 6-3, 6-4, 7-3, 8-1, 15-2·15-3, H1·H15, V2·V8·V10·V15 |
| SND-07 | 큼 | PRD SND-3 수용 기준 3(명단 2개 함께 6% → 주소 알림)과 설계가 어긋남 | 위험 명단 2개 이상의 주된 발신(50%↑)이면 "위험 — 주소 (명단과 함께)" 알림(멈춤 없음). PRD 문구 그대로의 시나리오(P8·P9·S7). 멈춤까지 할지는 **대표 확인 필요** (16절) | 5-3, 5-4, 5-5, 7-1, 7-3, 16절, H14, 시드 |
| SND-08 | 큼 | 기본 주소가 멈추면 조직 전체 템플릿 메일(폼 문의 포함)이 멈춤 | 기본 주소(`is_default`)는 코드에서 자동 멈춤 안 함, 알림에 "템플릿 메일 전체가 멈춤" 안내. 혼자 보내는 명단은 칸이 안 되어 기본 주소가 템플릿 명단 비율을 따라 위험이 되지 않음 | 1절 F17, 5-4, 6-3, 7-3, 10절, H23, V14 |
| SND-09 | 큼 | 보류가 폼·광고 문의 메일까지 막음 | 보류는 대량만(`scope='bulk'`): AI 대량 적재·`first_bulk`·반복·후속·수동 2건↑. 바로 보내는 AI·대기열 `priority=1`·템플릿 `first`·수동 1건은 보류를 보지 않고 주소 멈춤·반송 막기만 따른다 | 1절 F19, 6-2, 8-1, 13절, H21, V10·V11·V12 |
| SND-10 | 큼 | 멈춘 동안에도 웜업 일차가 올라 풀자마자 큰 양으로 나감 | 자동 멈춤을 풀 때(두 길 모두) `warmup_started_on`을 멈춘 동안의 보낼 수 있는 날만큼 뒤로 (`shiftWarmupStart`). 풀기 대화상자에 풀린 뒤 한도 | 1절 F18, 6-5, 10절, 13절, H26, V17 |
| SND-11 | 큼 | `sent → failed`로 바꾸면 중복·쿨다운 확인에서 빠져 죽은 주소에 또 보냄 | 중복·쿨다운 확인을 "NHN이 접수한 발송"(`acceptedSendCondition`)으로 — AI·대기열(미리 판정 포함)·템플릿 셋 다 | 1절 F16, 4-5, 6-6, 13절, H34, V24 |
| SND-12 | 큼 | 요청 번호마다 묻는 방식이 질문 수십~수백 배, 발송 한도 잠식, 48시간 뒤 늦은 SST3·긴 장애 뒤 기록을 놓침 | S1을 `update-mails` 커서로(장애 뒤에도 커서부터). 요청 번호 조회는 늦은 기록 보조(30번)와 짝이 여럿인 예외만. 처음 채우기도 같은 커서(8일 전 시작). 가짜 NHN에 `update-mails` | 1절 F4, 3-2~3-7, 8-1, 9절, 11절, 12절, 13절, H3~H6·H9, 15-2, V2~V4 |
| SND-13 | 작음 | 알림 중복(매일 0시 재알림, 위험마다 1통), 재판정 시작 ms 정의 없음 | 하한(없으면 0)으로 못 박음, 날짜 대신 1%p 칸 — 상태 변화·1%p 악화 때만 새 사건, 회차 묶음을 조직·받는 곳마다 1통, 밤(22~08시)은 조치·폭주·정체만 | 6-4, 7-1, 7-3, 8-1(`email_health_alerts` 묶음), H19·H27, V9 |
| SND-14 | 작음 | 보류가 `last_error`를 덮어 대기열 FIFO 하한·미룸 사유가 깨짐 | 보류·풀기 모두 `last_error`를 건드리지 않음 | 1절 F20, 6-2, 6-5, H20·H25, V10·V16 |
| SND-15 | 작음 | 0075 색인 동안 읽기까지 막히는데 "쓰기 대기"로만 적음 | 색인 두 개를 0075에서 빼고 부팅 뒤 CONCURRENTLY 단계(`ensureSendLogIndexes`)로. 0075는 `lock_timeout 5s`. 관문 측정을 "0075 전체 동안 SELECT가 막힌 시간"으로. RPL과 같은 결론 | 1절 F14, 6-0, 8-1, 8-2, 8-3, 13절, 16절, H35, V22·V23 |
| SND-16 | 작음 | 수동 발송이 템플릿 연결 명단으로만 보류를 보고 기록함 | 레코드마다 `records.partition_id`로 보류 확인, 기록의 명단도 레코드의 명단 | 1절 F21, 5-1, 6-2, 9절, 13절, H22, V13 |
| SND-17 | 작음 | 7일 200통이 안 되는 느린 명단은 끝내 판정 안 됨 | 7일 200 미만이면 30일 보조 창으로 판정(`eval_window='30d'`), "7일 150통·30일 400통 6%" 행 | 5-2, 5-3, 5-5, 6-0, 8-1, H13, 시드 P10 |

**대표 확인이 필요한 것 (구현 전)**
1. PRD SND-3 수용 기준 3의 둘째 문장 — 위험 명단 두 개의 주된 발신 주소를 멈출지, 알림만 할지 (권장: 알림만, 16절)
2. 반송 안내를 실패율에 넣는 때 — `SEND_HEALTH_DSN_IN_RATE`는 off로 시작하고 dry_run·alert 기간 숫자를 본 뒤 켠다 (권장)
