# dev → main 합치기 요청 (2026-10)

- **받는 분**: 정재훈 님 (개발)
- **요청한 사람**: 김이삭 (대표). 문서 정리는 Claude
- **작성일**: 2026-10-11
- **대상**: `origin/dev` `630058a` ← `origin/main` `41c8307` 기준 커밋 4개 (127개 파일, +21,531 / −1,061), 마이그레이션 4개(0070~0073, 모두 추가만)
- **운영**: CloudType 서비스 `sendb` (https://sendb.kr). 개발 서버 `sendb-dev`에는 `630058a`까지 이미 배포되어 돌고 있다

## 0. 부탁드리는 일 (요약)

1. dev를 main에 합쳐 운영에 배포해 주세요. 커밋 4개는 서로 이어져 있으니 **한꺼번에** 합쳐 주세요. 특히 `9290217`만 따로 올리면 안 됩니다 (10절 2번)
2. **충돌 1곳**: `src/components/email/SenderProfileManager.tsx`. main에만 있는 `41c8307`(발신자 목록 검색·페이지 이동, 재훈 님 커밋)과 dev 쪽 화면 개편이 같은 파일을 고쳤습니다. 풀이 제안은 2절에 있습니다
3. 배포 **전에** 운영 환경 변수를 넣어 주세요 (4절). 배포 **뒤에** CloudType Scheduler 주기를 바꾸고 작업 하나를 더해 주세요 (5절)
4. 순서는 6절, 배포 뒤 확인은 7절, 기능별 끄는 법은 9절에 있습니다
5. **회신 받기·발송 상태 자동 멈춤**은 dev 작업 트리에서 로컬 검증과 검토 반영까지 끝났고, 대표 승인 뒤 커밋합니다. 환경 변수·정기 작업·마이그레이션(0074·0075)은 8절에 채웠습니다. 이번 4개와는 따로 합쳐도 됩니다

## 1. 기능별 한 줄 요약

| 커밋 | 기능 | 한 줄 요약 | 배포 직후 상태 |
|---|---|---|---|
| `a863e50` (10/04) | 깊이 들어온 사람 알림 | 메일 링크로 들어와 사이트를 깊이 보고도 가입·신청 없이 떠난 사람을 5분마다 찾고, 그 사람의 CRM 근거를 카드 한 장으로 만들어 사업별 구글 챗 스페이스에 보냅니다 | **아무것도 보내지 않음.** `DEEP_ALERT_MODE` 기본값이 `dry_run`이고, `DEEP_ALERT_WORKSPACE_IDS`에 적은 워크스페이스만 처리합니다 |
| `ed2eee8` (10/04) | 발신 웜업·하루 한도·발신 묶음 | 발신 프로필마다 하루 최대, 웜업, 시간대, 평일만, 고르게 나눠 보내기, 일시 정지를 설정합니다. AI 규칙 하나에 발신 주소 여러 개를 묶을 수 있고, 한도에 걸린 메일은 버리지 않고 미룹니다 | **예전과 같음.** 한도 칸은 모두 기본 "꺼짐"이고, 주소가 하나인 규칙은 예전처럼 바로 나갑니다 |
| 〃 | 같이 고친 보안 문제 (기존 운영 코드에도 있음) | 수동 발송·템플릿 자동·템플릿 후속이 템플릿을 조직 조건 없이 읽던 문제(다른 조직 템플릿을 볼 수 있었음), AI 테스트 발송 500 응답에 SQL이 드러나던 문제, 규칙 API의 발신 주소 소유 확인 | 바로 적용 |
| `9290217` (10/04) | 발송 대기열 정책 | 묶음 주소를 한 통씩 돌아가며 고르게 씁니다. 문의(한 건씩 생긴 레코드)는 바로 보내고(주소마다 그날 한도의 10%를 15:00 KST까지 남김), 대량 명단은 먼저 들어온 순서로 줄을 세웁니다. 대기량이 하루 용량의 3일치를 넘으면 화면에 경고합니다. 발송 이력에 실제로 보낸 주소를 저장합니다 | 한도가 꺼져 있으면 미뤄지는 메일이 없어 순서도 예전과 같음. "보낸 주소" 저장은 바로 시작 |
| `630058a` (10/05) | Reply-To 걷어냄 | NHN이 `Reply-To`를 금지 헤더로 거절해서(개발 서버 실제 발송에서 확인) 모든 발송 경로에서 뺐습니다. NHN에 보내기 직전 한 곳에서 금지 헤더와 형식 오류를 걸러 냅니다. 규칙 화면에는 MX가 없는 발신 도메인을 안내합니다 | 바로 적용. 발송 헤더는 `ed2eee8` 전과 같습니다 (수신거부 두 줄만) |
| (커밋 전, dev 작업 트리) | 회신 받기·발송 상태 자동 멈춤 | 회신 메일함에서 샌드비 발신 주소로 온 메일만 읽어, 사람 회신이면 그 사람에게 가는 자동 메일을 멈추고 사업 스페이스에 알립니다. NHN 발송 결과를 10분마다 맞추고, 실패율이 높은 명단은 대량 발송 보류·주소는 자동 멈춤 + 알림 (8절) | **기록만.** 회신 읽기·발신 건강 모두 기본 `dry_run` |

새로 생긴 API

| 경로 | 권한 | 하는 일 |
|---|---|---|
| `POST /api/tracker/deep-alerts/process` | `CRON_SECRET` | 깊이 알림 정기 작업 |
| `GET /api/tracker/deep-alerts?limit=50` | 관리자 | 자기 조직의 최근 알림 기록 |
| `GET /api/tracker/deep-alerts/preview?workspaceId=8` | 관리자, 읽기만 | 지금 판정하면 나갈 카드. 브라우저로 열면 HTML |
| `GET /api/email/sender-profiles/usage` | 로그인 | 발신 주소별 오늘 사용량 |
| `GET /api/email/send-queue/stats` | 로그인, 조직 범위 | 규칙별 대기량·예상 소진일·3일치 경고 |
| `GET /api/email/reply-to` | 로그인 | 발신 묶음 중 MX 없는 도메인 안내용 |

## 2. 검증 결과와 충돌

### 2-1. 이미 한 검증

| 무엇 | 결과 |
|---|---|
| dev 단위 시험 `tsx --test "src/**/*.test.ts"` | 687개 통과 |
| `tsc --noEmit`, eslint, `next build` | 0 / 0 / 성공 |
| 로컬 시험 환경 (가짜 NHN·구글 챗, 시험 DB) | 깊이 알림 E2E 15개, 웜업 E2E 26개, 대기열 시나리오 10개, Reply-To 걷어낸 뒤 발송 경로 11가지 28통·화면 8개 (57/57) |
| 개발 서버 실제 발송 (10/04, 직원·대표 주소 14곳) | 12통 성공. 발신 주소 3개에 4·4·4통씩 돌아가며 나갔고, 2통은 한도로 다음 날 대기. 이력의 보낸 주소 = 실제 From |
| **합치기 모의** (10/11, `git merge-tree`, 작업 트리·브랜치는 건드리지 않음) | 충돌 1곳(`SenderProfileManager.tsx`). 이 파일을 dev 판으로 맞춘 합친 결과에서 `tsc` 0, 단위 시험 **691개 통과** (dev 687 + main의 `sender-profile-list.test.ts` 4) |

### 2-2. 충돌 풀이 제안 — `src/components/email/SenderProfileManager.tsx`

- **main `41c8307`**: 목록을 `ui/sender-profile-list.tsx`(검색·8개씩 페이지·기본 발신자 먼저)로 빼고, 대화상자 상태를 `hooks/use-sender-profile-manager.ts`로 옮김
- **dev `ed2eee8`**: 목록 줄마다 한도 배지(`SenderLimitBadges`, 오늘 사용량), 한도·웜업 설정이 들어간 새 대화상자(`sender-profiles/ui/SenderProfileDialog.tsx`), 삭제 확인 대화상자(`SenderProfileDeleteDialog.tsx`), 관리자만 한도 칸을 고치게 하는 권한 처리
- **제안**: dev 판을 바탕으로 하고, main의 검색·페이지 이동을 얹어 주세요
  - dev 판을 그대로 쓰면 지금도 빌드·시험은 통과합니다(2-1). 다만 main의 검색·페이지 이동이 화면에서 빠집니다. 발신 도메인이 160곳으로 늘어 프로필이 많아질 것이라 검색·페이지는 꼭 살려야 합니다
  - main 판을 그대로 쓰면 한도 설정 창·한도 배지·삭제 확인이 화면에서 사라집니다. 서버의 관리자 확인은 남지만 웜업 기능을 화면에서 쓸 수 없습니다
  - 합치는 방법 예: `SenderProfileList`에 줄마다 배지를 그리는 칸(예: `renderBadges(profile)`)을 더하고, `onDelete`가 id 대신 프로필을 넘겨 dev의 삭제 확인 대화상자를 열게 합니다. 대화상자는 dev의 `SenderProfileDialog`를 쓰고, main의 `use-sender-profile-manager.ts`는 쓰이지 않게 되면 지웁니다
  - 폴더가 두 갈래입니다(main은 `src/components/email/{ui,hooks,types,utils}/sender-profile*`, dev는 `src/components/email/sender-profiles/…`). CLAUDE.md의 "중복 코드를 만들지 않는다"에 맞게 한쪽으로 모으면 좋겠습니다. 어느 쪽으로 모을지는 재훈 님이 정해 주세요
- 원하시면 우리 쪽에서 풀이 판을 따로 만들어 드릴 수 있습니다. 다만 저희는 main을 건드리지 않고, dev에 main을 받아 합치는 작업도 대표 승인 뒤에만 합니다

## 3. 마이그레이션과 안전성

앱이 켜질 때 `src/instrumentation.ts` → `src/lib/db/migrate.ts`가 돌립니다. main의 마지막은 `0069`이고, 이번에 `0070`~`0073`이 한 트랜잭션으로 함께 들어갑니다. 실패하면 넷 다 되돌아가고, **서버는 그대로 켜지지만 새 칸을 읽는 요청이 500을 냅니다.** 그래서 배포 뒤 로그의 `[migrate] 마이그레이션 완료!`를 꼭 봐 주세요. (회신 받기·발신 건강 커밋부터는 마이그레이션이 실패하면 **서버가 뜨지 않고 끝납니다** — 옛 스키마로 뜨면 발송 기록 insert가 모두 실패하기 때문입니다. 8-2절)

| 파일 (`when`) | 하는 일 | 바뀌는 표 | 표 다시 쓰기 | 다시 돌려도 같은가 |
|---|---|---|---|---|
| `0070_deep_visitor_alerts.sql` (1773300000000) | 새 표 `deep_visitor_alerts` + 인덱스 3개 (`(record_id, level)` 유니크 등) | 새 표만 | 없음 | `IF NOT EXISTS` |
| `0071_email_sender_limits.sql` (1773400000000) | 발신 프로필 한도 칸 10개(기본 꺼짐), 새 표 `email_sender_daily_usage`, `email_auto_personalized_links.sender_profile_ids`, `email_followup_queue.locked_at`, `email_automation_queue.kind`(기본 `'repeat'`), `email_send_queue.exhausted_link_ids`·`requeue_at` | 칸 추가만 | 없음 (상수 기본값·NULL 허용, PostgreSQL 11 이상) | `ADD COLUMN IF NOT EXISTS` |
| `0072_send_queue_priority.sql` (1773500000000) | `email_send_queue.priority smallint DEFAULT 0`, 기다리던 `on_update` 줄(pending·processing)을 1로 올림, 줄 집기 인덱스 교체(`esq_pickup_idx` 지움 → `esq_pickup_priority_idx`) | 칸 추가 + 일부 줄 UPDATE + 인덱스 | 없음. 인덱스는 `CONCURRENTLY`가 아니라 만드는 동안 그 표 쓰기가 잠깐 막힘 | UPDATE는 `priority = 0`인 줄만, 인덱스는 `IF [NOT] EXISTS` |
| `0073_reply_to_sender_email.sql` (1773600000000) | `workspaces.reply_to_email`(지금은 쓰지 않음), `email_send_logs.sender_email` | NULL 허용 칸 추가만 | 없음 (`email_send_logs`가 커도 바로 끝남) | `IF NOT EXISTS` |

- 지우거나 이름을 바꾸는 것은 없습니다. 0072의 옛 인덱스 하나만 새 인덱스로 바뀝니다
- `ALTER TABLE`은 아주 잠깐 표 잠금을 잡습니다. 트랜잭션이 넷을 함께 묶으니 커밋할 때까지 이어집니다. 발송이 적은 때(저녁) 배포를 권합니다
- 배포 전에 운영 DB에서 읽기만 하는 쿼리로 봐 주세요
  - `SELECT version();` — 11 이상이면 위 표대로 다시 쓰기가 없습니다
  - `SELECT status, count(*) FROM email_send_queue GROUP BY 1;` — 0072 인덱스 크기 가늠
  - `SELECT count(*) FROM email_send_queue WHERE trigger_type = 'on_update' AND status IN ('pending','processing');` — 0072가 고칠 줄 수
- 되돌리는(down) 마이그레이션은 없습니다. 코드를 되돌려도 칸·표는 남겨 두면 됩니다. 옛 코드는 새 칸을 읽지 않습니다 (9절)

## 4. 새 환경 변수

웹훅 주소는 비밀값입니다. 이 문서·저장소·채팅에 적지 않고, 대표나 스페이스 관리자가 CloudType 환경 변수에 직접 넣거나 재훈 님께 따로 전합니다.

| 이름 | 값이 없을 때 | 운영 권장값 | 비고 |
|---|---|---|---|
| `DEEP_ALERT_MODE` | `dry_run` (모르는 값도 `dry_run`) | 처음엔 **`dry_run`**, 하루 기록을 본 뒤 대표 확인을 받고 `live` | `off` / `dry_run` / `live`. `dry_run`은 카드를 만들어 표에 남기기만 하고 보내지 않음. 나중에 `live`로 바꿔도 `dry_run` 줄은 보내지 않음 |
| `DEEP_ALERT_WORKSPACE_IDS` | 없음 → 아무것도 처리하지 않음 | `8,9,14` (디하·백오피스랩·오피오) | 샌드비는 여러 조직이 쓰므로 여기 적은 워크스페이스만 봅니다. 넣기 전에 운영 DB에서 `SELECT id, name, org_id FROM workspaces WHERE id IN (8,9,14);`로 우리 조직 것인지 확인해 주세요 |
| `DEEP_ALERT_WEBHOOK_URL_<워크스페이스번호>` | 없음 → 공통 주소. 공통도 없으면 `live`에서 카드를 버리지 않고 기다림(`pending`, '웹훅 주소가 없어 넣을 때까지 기다림') — 24시간 안에 넣으면 나가고, 넘으면 닫힘. 운영 스페이스에 6시간에 한 번 알림 (구글 챗 QA) | `_8`, `_9`, `_14`에 사업별 구글 챗 스페이스 웹훅 | 대표 결정(10/02): 사업마다 각자 스페이스. 스페이스 관리자가 "앱 및 통합 → 웹훅 관리"에서 발급. `https://chat.googleapis.com/v1/spaces/…` 꼴이 아니면(오타·http·다른 호스트) 받지 않습니다 |
| `DEEP_ALERT_WEBHOOK_URL` | 없음 | **비워 둠** | 공통 주소. 비워야 한 사업의 카드가 다른 사업 스페이스로 가지 않습니다 |
| `EMAIL_MX_LOOKUP` | 없음 → MX 조회함 | **비워 둠** | `off`면 조회하지 않고 "확인 못 함"으로 둡니다 (바깥 DNS가 막힌 서버·시험 서버용). 규칙 화면의 "답장을 받을 수 없는 도메인" 안내에만 쓰고 발송은 막지 않습니다 |
| `CRON_SECRET` (기존) | — | 그대로 | 새 정기 작업도 같은 값 |
| `NEXT_PUBLIC_BASE_URL` (기존) | `https://sendb.kr` | 그대로 | 깊이 알림 카드의 레코드 링크 |
| 회신 받기·발신 건강 (`REPLY_*`·`SEND_HEALTH_*`·`NHN_STATUS_*`·`DATABASE_POOL_MAX`·`MIGRATION_FAILURE_MODE`) | — | — | 8-3절 |

## 5. CloudType Scheduler

모든 작업은 `POST`, 머리글 `X-Secret: <CRON_SECRET>`입니다. cron은 초를 포함한 6자리입니다(기존 작업과 같은 형식).

| 작업 | 주소 | 지금 (운영, 저희가 알고 있는 값) | 바꿀 값 | 까닭 |
|---|---|---|---|---|
| 발송 대기열 | `/api/email/queue/process` | 10분 | **1분** `0 * * * * *` | 잠금(`0x5c4edf02`)이 있어 겹쳐도 뒤 회차는 건너뜁니다. 고르게 나눠 보내기의 실제 간격 하한이 이 주기입니다 |
| 이메일 후속 | `/api/email/automation/process-followups` | 하루 1번 (09:00) | **10분** `0 */10 * * * *` | 이번에 잠금(`0x5c4edf05`)과 `processing` 상태를 넣었습니다. 하루 1번이면 시간대가 09시보다 늦게 시작하는 주소의 후속이 다음 날로 밀립니다. **10절 4번 주의** |
| 이메일 반복 | `/api/email/automation/process-repeats` | 10분 | **10분** `0 */10 * * * *` (이미 10분이면 그대로) | 잠금(`0x5c4edf06`)과 8분 예산을 넣었습니다. 미룬 템플릿 첫 메일(`kind='first'`·`'first_bulk'`)도 이 작업이 보냅니다 |
| 깊이 들어온 사람 알림 | `/api/tracker/deep-alerts/process` | 없음 | **새로 추가, 5분** `0 */5 * * * *` | 잠금 `0x5c4edf03`, 회차 예산 4분. `dry_run`이면 기록만 남깁니다 |
| 회신 메일함 읽기 | `/api/email/replies/sync` | 없음 | **새로 추가, 5분(30초 어긋나게)** `30 */5 * * * *` | 회신 받기 커밋을 합친 뒤. 8-4절. 깊이 알림과 같은 사업 스페이스를 쓰므로 같은 초에 겹치지 않게 (구글 챗 QA RC-5) |
| 발송 결과 맞추기 | `/api/email/status-sync/process` | 없음 | **새로 추가, 10분** `0 */10 * * * *` | 〃 |
| 발신 건강 판정·알림·매일 보고 | `/api/email/send-health/process` | 없음 | **새로 추가, 10분(5분 어긋나게)** `0 5-59/10 * * * *` | 〃 |

- 발송 대기열·후속·반복은 한 회차가 최대 8분까지 돕니다. Scheduler의 요청 시간 제한이 8분보다 짧으면 회차가 중간에 끊깁니다(남은 줄은 다음 회차가 이어받지만 응답은 실패로 보입니다). 가능하면 9분 이상으로 맞춰 주세요
- 알림톡 후속·반복, 예약 등록, 결제 갱신 작업은 바뀌지 않았습니다

## 6. 배포 순서

1. **(재훈 님) 충돌 풀기**: 2-2절대로 `SenderProfileManager.tsx`를 풀고 `tsc`·`pnpm test`·`next build`
2. **(재훈 님) 운영 DB 확인·백업**: 3절의 읽기 쿼리, 평소 쓰시는 방법으로 백업
3. **(재훈 님 또는 대표) 운영 환경 변수 넣기** — 배포 전에
   - `DEEP_ALERT_MODE=dry_run` (기본값과 같지만 일부러 적어 둡니다), `DEEP_ALERT_WORKSPACE_IDS=8,9,14`
   - 웹훅 `DEEP_ALERT_WEBHOOK_URL_8`·`_9`·`_14`는 발급되는 대로. 없어도 `dry_run`에서는 상관없습니다
   - `EMAIL_MX_LOOKUP`은 넣지 않습니다
4. **(재훈 님) main에 합치고 `sendb` 배포** — 발송이 적은 때. 로그에서 `[migrate] 마이그레이션 완료!` 확인. `[migrate] 마이그레이션 에러`가 보이면 Scheduler를 바꾸지 말고 바로 알려 주세요
5. **(재훈 님) Scheduler 바꾸기** (5절): 발송 대기열 1분 → 반복 10분 확인 → 깊이 알림 5분 추가 → 후속 10분 (후속은 10절 4번을 대표와 맞춘 뒤)
6. **(재훈 님) 7절 확인 목록**
7. **(대표) 하루 뒤**: 깊이 알림 `dry_run` 기록을 보고 `live`로 바꿀지 정합니다. 바꾸면 재시작(재배포) 뒤 반영
8. **(대표·담당) 발신 한도 켜기**: 운영 DB는 개발 DB와 따로라 개발 서버에서 해 둔 한도·묶음 설정은 넘어가지 않습니다. 운영 발신 프로필 화면에서 관리자가 주소마다 켭니다. 켜기 전까지는 예전과 똑같이 나갑니다

## 7. 배포 뒤 확인 목록

**서버·DB** (읽기만)
- [ ] 로그에 `[migrate] 마이그레이션 완료!`
- [ ] `SELECT created_at FROM drizzle.__drizzle_migrations ORDER BY created_at DESC LIMIT 4;` → `1773600000000`, `1773500000000`, `1773400000000`, `1773300000000`
- [ ] `SELECT to_regclass('public.deep_visitor_alerts'), to_regclass('public.email_sender_daily_usage'), to_regclass('public.esq_pickup_priority_idx');` → 셋 다 NULL이 아님
- [ ] `SELECT count(*) FROM information_schema.columns WHERE table_name = 'email_send_logs' AND column_name = 'sender_email';` → 1

**정기 작업**
- [ ] 비밀값 없이 `POST /api/tracker/deep-alerts/process` → 401
- [ ] Scheduler 회차 응답이 200, `{ success: true, data: … }`. 깊이 알림은 `data.mode`가 `dry_run`
- [ ] 발송 대기열(1분) 응답 시간이 짧고 오류가 없음. 회차가 겹치면 건너뛰는 것이 정상
- [ ] 후속(10분)·반복(10분) 응답 200

**화면** (관리자 계정)
- [ ] 메일 → 발신 프로필: 목록 검색·페이지 이동(main)과 줄마다 한도 배지·설정 창·삭제 확인(dev)이 함께 보임
- [ ] AI 규칙 수정 화면: 발신 묶음 칸, 요약의 "답장 — 보낸 주소로 갑니다". MX를 연결한 160개 도메인은 "답장을 받을 수 없습니다" 안내가 뜨지 않아야 함 (10절 3번)
- [ ] 메일 대시보드의 대기열 카드, 규칙 목록 카드의 대기 배지 (`/api/email/send-queue/stats` 200)
- [ ] 발송 이력의 "보낸 주소" 칸. 배포 뒤 로그는 실제 주소, 옛 로그는 "(현재 프로필)"
- [ ] 워크스페이스 설정에 "답장 받을 주소" 칸이 **없음**
- [ ] 브라우저로 `/api/tracker/deep-alerts/preview?workspaceId=8` → 카드 HTML (읽기만, 보내지 않음)
- [ ] 하루 뒤 `GET /api/tracker/deep-alerts?limit=50` → `status = 'dry_run'` 줄

**실제 발송** (대표 승인 뒤, 내부 주소로만 1~2통)
- [ ] 수동 발송 성공, 받은 메일에 `Reply-To` 없음, `List-Unsubscribe` 있음
- [ ] `email_send_logs.sender_email`이 실제 From과 같음

## 8. 회신 받기·발송 상태 자동 멈춤 (dev 작업 트리에 있음, 커밋 전)

> 코드는 dev 작업 트리에 있고 로컬 시험 환경 검증과 검토 반영(`docs/2026-10-11-reply-and-health/REVIEW.md`)까지 끝났습니다. **아직 커밋하지 않았습니다** — 대표 승인 뒤 메인 세션이 dev에 커밋하면 커밋 해시를 여기에 적습니다. 앞의 커밋 4개와 따로 합쳐도 됩니다.

**근거**: 마케팅 마스터 `dev-handoff/09-cold-email-system-prd.md` RPL-1·RPL-2, SEQ-1, SND-1~SND-3, 12절 질문 2개. 설계 `docs/2026-10-11-reply-and-health/DESIGN-RPL.md`·`DESIGN-SND.md`, 검토 `REVIEW.md`

**대표 결정 (2026-10-11)**: ① 샌드비가 회신 메일함을 자동으로 읽어도 된다 ② 실패율이 높으면 **멈추고 알린다**

### 8-1. 무엇을 하나

| 기능 | 하는 일 | 배포 직후 (기본값) |
|---|---|---|
| 회신 읽기 (RPL) | 5분마다 회신 메일함(Gmail, 읽기 전용)에서 **샌드비 발신 주소 앞으로 온 메일만** 골라 발송 기록에 잇습니다. 사람 회신이면 그 사업의 그 사람에게 가는 후속·AI·템플릿 자동 메일을 멈추고 사업 스페이스에 카드를 보냅니다. 자동응답·내부 메일은 기록만. 반송 안내(DSN)는 아래 SND 신호로 넘깁니다 | `dry_run` — 줄만 남기고 아무것도 멈추거나 보내지 않음 |
| 개인정보 울타리 | 1단계는 받는 사람·스레드 머리글 7개만(`format=metadata`) 읽고, 우리 주소 앞이 아니면 본문을 읽지 않고 저장도 하지 않습니다. 메일함 주소·메일함 쪽 도메인(`REPLY_PRIVATE_DOMAINS`) 위 주소는 우리 주소에서 늘 뺍니다. **운영 서버에서 `REPLY_PRIVATE_DOMAINS`가 비어 있으면 메일함을 읽지 않습니다** (검토 RH-SEC-2) | — |
| 발송 결과 맞추기 (SND-1) | 10분마다 NHN "상태가 바뀐 메일 목록"을 커서로 읽어 SST 코드를 발송 기록에 적습니다 (SST3 실패, SST7·8 발신 쪽, SST5 NHN 수신거부) | 바로 동작 (`NHN_STATUS_SYNC` 기본 on) — 기록만 고침 |
| 반송 막기 (SND-2 일부) | 회신 메일함의 반송 안내로 주소 없음(5.1.x 등)이 확인된 주소는 조직 전체에서 90일 자동 메일을 막습니다. 메일함 가득 같은 일시 문제는 3번 쌓일 때만, **우리 발신 쪽 실패(5.7.x·인증·정책)는 막지 않습니다** (검토 F2) | 회신 읽기가 `on`일 때만 막음 |
| 발신 건강 (SND-3) | 10분마다 명단·발신 주소·도메인의 실패율을 판정합니다. 위험 명단은 **대량 발송만 보류**(문의는 그대로), 위험 주소는 **자동 멈춤**, 그리고 알림·매일 보고(09시) | `dry_run` — 판정·기록만, 챗 0통, 보류·멈춤 0 |
| 화면 | 이메일 → **회신** 탭(회신 읽기 대상 조직에만 보임), 발송 이력·후속 큐·레코드 상세의 회신·반송 배지, 이메일 첫 화면 **발송 건강** 카드(판정 대상 조직에만), 명단 화면의 보류 띠·풀기(관리자) | 바로 보임 |

판정 기준 (대표 결정·PRD SND-3)

| 상태 | 기준 | `enforce`에서 |
|---|---|---|
| 위험 — 명단 | 그 명단 확정 200통 이상(느리면 30일)에서 실패율 5% 이상 | 그 명단의 대량 발송 보류 + 알림 (폼·광고 문의는 그대로 나감) |
| 위험 — 주소 | ① 같은 명단의 다른 주소보다 뚜렷이 높은 칸이 명단 2개 이상, 또는 ② 명단 2개 이상에서 함께 5% 이상(칸 합 200통 이상)이고 주소 전체도 5% 이상 (검토 F3) | 그 주소 자동 멈춤(하루 5개 상한) + 알림 |
| 주의 | 3% 이상 | 매일 보고만 |

- 실패율 = NHN SST3 ÷ (SST2 + SST3). **SST7·SST8(발신 쪽)은 빼고** 도메인 인증 경고로 따로 셉니다
- 판정은 `SEND_HEALTH_ORG_IDS`의 조직만 합니다 — **기본은 우리 조직**(`REPLY_WORKSPACE_IDS`·`DEEP_ALERT_WORKSPACE_IDS` 워크스페이스의 조직). 샌드비를 쓰는 다른 고객사 명단을 보류하거나 그 명단 이름을 우리 스페이스로 보내지 않게 했습니다 (검토 OPS-2)

### 8-2. 마이그레이션

| 파일 (`when`) | 하는 일 | 바뀌는 표 |
|---|---|---|
| `0074_email_replies.sql` (1773700000000) | 새 표 `email_replies`(회신 장부), `email_reply_mailbox_state`(메일함 커서·상태), `email_followup_queue.stop_reason`·`email_automation_queue.stop_reason` 칸 | 새 표 + NULL 허용 칸 |
| `0075_send_health.sql` (1773800000000) | `email_send_logs`에 NHN 결과·배달 실패 칸 7개(NULL 허용·상수 기본값), `email_sender_profiles`에 멈춤 출처·건강 조치 칸, 새 표 `email_partition_holds`·`email_bounce_signals`·`email_health_events`·`email_health_alerts`·`email_health_daily`·`email_status_sync_state` | 칸 추가 + 새 표 |
| `0076_chat_alert_delivery.sql` (1773900000000) | 새 표 `chat_webhook_status`(받는 곳 = 환경 변수 이름마다 웹훅 상태·운영 알림 시각. **주소는 저장하지 않고** 고장 난 주소의 지문(sha256 앞 16자)만 — 주소를 바꿔 배포하면 예전 고장 표시를 믿지 않게), `email_reply_mailbox_state`에 `ops_alerted_code`·`ops_recovery_code`·`ops_recovered_at`, `email_status_sync_state`에 `ops_alerted_cause` (구글 챗 QA) | 새 표 + NULL 허용 칸 |

- 모두 더하기만, `IF NOT EXISTS`, 다시 돌려도 같습니다. 지우거나 바꾸는 것 없음
- `email_send_logs` 색인 두 개는 마이그레이션 안에서 만들지 않고, 부팅 뒤 `CREATE INDEX CONCURRENTLY`로 만듭니다(`src/lib/db/send-log-indexes.ts`). 로그 `[indexes] email_send_logs 색인 준비됨`. 색인이 다 될 때까지 발신 건강은 판정을 건너뜁니다(`skipped: index_pending`)
- 0075는 `SET LOCAL lock_timeout = '5s'`로 시작합니다. 배포 순간 긴 조회와 겹쳐 잠금을 못 얻으면 `migrate.ts`가 3·10·20초 뒤 세 번 다시 해 봅니다
- **이번부터 마이그레이션이 실패하면 서버가 뜨지 않고 끝납니다** (`src/instrumentation.ts`, 검토 F1·OPS-1). 예전처럼 실패를 삼키고 옛 스키마로 뜨면, 코드가 아는 새 칸이 DB에 없어 **모든 발송 기록 insert가 42703으로 실패**(= 발송 전부 멈춤)하기 때문입니다. CloudType이 다시 띄우면서 다시 시도합니다. 급할 때만 `MIGRATION_FAILURE_MODE=continue`로 예전처럼 띄웁니다 (새 칸을 쓰는 경로는 실패할 수 있음)
- 배포 뒤 확인: `SELECT created_at FROM drizzle.__drizzle_migrations ORDER BY created_at DESC LIMIT 3;` → `1773900000000`, `1773800000000`, `1773700000000`

### 8-3. 환경 변수

비밀값(구글 클라이언트 보안 비밀·갱신 토큰·웹훅 주소)은 문서·저장소·채팅에 적지 않고 CloudType 환경 변수 칸에만 넣습니다.

**회신 읽기**

| 이름 | 없을 때 | 운영 권장값 | 비고 |
|---|---|---|---|
| `REPLY_SYNC_MODE` | `dry_run` | 처음 `dry_run` → 이틀 확인 뒤 **`on`** | `off`·`dry_run`·`on`. `on`으로 바꾸면 14일 안 dry_run 줄의 효과(멈춤)를 한 번에 적용, 카드는 보내지 않음 |
| `REPLY_ALERT_MODE` | `dry_run` | `dry_run` → `on` 하루 뒤 **`live`** | `off`·`dry_run`·`live` |
| `REPLY_MAILBOX` | `ceo@matchesplan.com` | 회신 전용 메일함을 만들면 `reply@matchesplan.com` (DESIGN-RPL 13-0) | 구글이 돌려주는 **기본 주소**와 같아야 함 (별칭을 넣으면 멈춤) |
| `REPLY_GOOGLE_CLIENT_ID`·`REPLY_GOOGLE_CLIENT_SECRET`·`REPLY_GOOGLE_REFRESH_TOKEN` | 없으면 `{configured:false}`, 구글을 부르지 않음 | 대표가 DESIGN-RPL 13-1~13-2로 발급 (`gmail.readonly` 하나) | **비밀값.** 갱신 토큰은 메일함 전체를 읽을 수 있는 열쇠 — 회신 전용 메일함 권장 |
| `REPLY_PRIVATE_DOMAINS` | **운영 서버에서 비면 메일함을 읽지 않음** (회신 탭 띠에 경고) | `matchesplan.cloud,matchesplan.me,designer-hire.com,offio.kr,pixl.kr` — 관리 콘솔 "사용자 별칭 도메인" 전부 | 메일함 주인 계정의 별칭 도메인처럼 회사 사람 메일이 오는 도메인. 정말 없으면 `none` |
| `REPLY_SHARED_DOMAIN_ADDRESSES` | 없음 | `cs@matchesplan.cloud,cs@matchesplan.me` (+ `cs@matchesplan.com`을 발신에 쓰면 그것) | 위 도메인 위에 있지만 샌드비 발신 주소인 것 |
| `REPLY_WORKSPACE_IDS` | `DEEP_ALERT_WORKSPACE_IDS` | `8,9,14` (비워 두면 깊이 알림 값) | 이 워크스페이스의 **조직**만 회신을 읽고, 이 조직에만 회신 탭이 보입니다 |
| `REPLY_OPS_WEBHOOK_URL` | `SEND_HEALTH_WEBHOOK_URL` → `DEEP_ALERT_WEBHOOK_URL` | 비워 둠 (운영 스페이스 하나로) | 메일함 연결 끊김·정체 알림 |
| `REPLY_BACKFILL_DAYS` | 운영 14 | 그대로 | 처음 한 번 거슬러 읽을 날 |
| `REPLY_SENDER_EMAILS`·`REPLY_ALLOWED_FROM` | 없음 | **운영에는 넣지 않음** | 개발 서버 시험용 (시험 서버는 이 둘이 없으면 on·live가 켜지지 않음) |

**발송 결과 맞추기·발신 건강**

| 이름 | 없을 때 | 운영 권장값 | 비고 |
|---|---|---|---|
| `SEND_HEALTH_MODE` | `dry_run` | `dry_run` 하루 → **`alert` 1주** → 대표 확인 뒤 **`enforce`** | `off`·`dry_run`·`alert`(알림만)·`enforce`(보류·멈춤 + 알림). 모르는 값은 `dry_run` |
| `SEND_HEALTH_ORG_IDS` | 우리 조직만 (`REPLY_WORKSPACE_IDS`·`DEEP_ALERT_WORKSPACE_IDS`의 조직) | 비워 둠 | `*`면 이메일 설정이 켜진 모든 조직, 조직 id 쉼표면 그 조직만 (검토 OPS-2) |
| `SEND_HEALTH_WEBHOOK_URL` | 운영 알림 `skipped` | 대표 운영 스페이스 웹훅 | 위험·보류·멈춤·풀림·동기화 정체·매일 보고 전부 |
| `SEND_HEALTH_WEBHOOK_URL_<워크스페이스>` | `DEEP_ALERT_WEBHOOK_URL_<워크스페이스>` | 비워 둠 (깊이 알림 사업 스페이스로) | 사업 스페이스에는 그 사업 명단 이야기만 갑니다 (다른 사업 명단은 숫자만 — 검토 RH-SEC-4) |
| `SEND_HEALTH_REPORT_HOUR` | `9` | 그대로 | 매일 보고 (KST). 발송·문제가 없는 조직은 보내지 않음 |
| `SEND_HEALTH_MAX_AUTO_PAUSE_PER_DAY` | `5` | 그대로 | 조직마다 하루 자동 멈춤 상한 |
| `SEND_HEALTH_MAX_AUTH_PAUSE_DOMAINS_PER_DAY` | `10` | 그대로 | 발신 쪽 실패 폭주 멈춤 도메인 상한 |
| `SEND_HEALTH_ALERT_ONLY_PARTITION_IDS` | 없음 | 11/2 실험 명단 id가 있으면 그것 | 이 명단은 위험이어도 알림만 |
| `SEND_HEALTH_DSN_IN_RATE` | `off` | `off` | `on`이면 "NHN 성공 뒤 반송 안내"도 실패율에 넣음 (기준을 다시 본 뒤) |
| `NHN_STATUS_SYNC` | `on` | `on` | `off`면 결과 맞추기 작업이 아무것도 안 함 (그러면 발신 건강도 판정할 재료가 없음) |
| `NHN_STATUS_SYNC_MAX_CALLS`·`NHN_STATUS_FALLBACK_CALLS`·`NHN_STATUS_BACKFILL_DAYS`·`NHN_STATUS_PAGE_SIZE` | `300`·`30`·`8`·`100` | 그대로 | `NHN_STATUS_PAGE_SIZE`는 NHN 최댓값 확인 전에는 올리지 않음 (최근 기간에서 NHN이 400을 주면 이제 오류로 드러납니다 — 검토 OPS-7) |

**구글 챗 알림 공통 (구글 챗 QA, `docs/2026-10-11-reply-and-health/CHAT-QA.md`)**

| 이름 | 없을 때 | 운영 권장값 | 비고 |
|---|---|---|---|
| `GOOGLE_CHAT_REQUEST_ID` | 꺼짐 | 개발 스페이스에서 확인한 뒤 **`on`** | 보낼 때 줄마다 고정 `requestId`를 붙여, 응답이 10초를 넘겨 다시 보내도 같은 글이 두 번 올라가지 않게 합니다. 꺼져 있으면 시간 초과는 그 회차에 다시 보내지 않고 두 번째 시간 초과에서 멈춥니다(같은 카드 최대 2통). 웹훅이 이 값을 받는지는 공식 문서에 없어 **개발 스페이스에서 먼저 확인** (CHAT-QA 4절) |
| `GOOGLE_CHAT_THREADS` | 꺼짐 | 대표가 스페이스 모양을 본 뒤 정함 | 같은 레코드의 깊이 카드·같은 고객 회신·같은 운영 문제를 한 스레드로 모읍니다 (`thread.threadKey` + `messageReplyOption=REPLY_MESSAGE_FALLBACK_TO_NEW_THREAD`). 이것도 개발 스페이스에서 먼저 확인 |
| `DEEP_ALERT_TEST_SERVER_LIVE` | 꺼짐 | **운영·개발 서버 모두 넣지 않음** | `NEXT_PUBLIC_BASE_URL`이 `https://sendb.kr`가 아닌 서버(개발·시험)에서는 `DEEP_ALERT_MODE=live`여도 `dry_run`으로 돕니다 (개발 DB의 실제 고객 카드가 사업 스페이스로 나가지 않게, 검토 DV-4). 시험 스페이스로 일부러 보낼 때만 `1` |

**공통**

| 이름 | 없을 때 | 운영 권장값 | 비고 |
|---|---|---|---|
| `DATABASE_POOL_MAX` | `20` (예전 10) | 그대로. DB 연결 한도(`SHOW max_connections;`)가 작으면 맞춰 낮춤 | 정기 작업들이 잠금용 연결을 하나씩 쥐어 10이면 겹칠 때 바닥날 수 있었음 (검토 F5). 5~200 |
| `MIGRATION_FAILURE_MODE` | 실패하면 서버를 끝냄 | 넣지 않음 | 급할 때만 `continue` (8-2) |
| `CRON_SECRET`·`NEXT_PUBLIC_BASE_URL` (기존) | — | 그대로 | `NEXT_PUBLIC_BASE_URL`의 origin이 `https://sendb.kr`가 아니면 회신 읽기는 "시험 서버"로 돕니다 |

### 8-4. CloudType Scheduler (모두 `POST`, 머리글 `X-Secret: <CRON_SECRET>`)

| 작업 | 주소 | 주기 (cron 6자리) | 잠금·예산 |
|---|---|---|---|
| 회신 메일함 읽기 | `/api/email/replies/sync` | 5분 `0 */5 * * * *` | `0x5c4edf07`, 4분 |
| 발송 결과 맞추기 | `/api/email/status-sync/process` | 10분, 0·10·20…분 `0 */10 * * * *` | `0x5c4edf08`, 4분 |
| 발신 건강 판정·알림·매일 보고 | `/api/email/send-health/process` | 10분, 5·15·25…분 `0 5-59/10 * * * *` | `0x5c4edf09`, 4분 |

- **결과 맞추기 작업을 빠뜨리면** 발신 건강은 판정할 실패 기록이 없어 아무것도 하지 않습니다. 이제는 1시간 넘은 발송이 있는데 결과 맞추기가 한 번도 돌지 않았으면 운영 스페이스에 6시간마다 알리고 매일 보고에도 "한 번도 돌지 않음"을 싣습니다 (검토 OPS-8)
- 바깥 연결: 운영 서버가 `oauth2.googleapis.com`, `gmail.googleapis.com`(회신 읽기), NHN API(기존)에 나갈 수 있어야 합니다

### 8-5. 새 API

| 경로 | 권한 | 하는 일 |
|---|---|---|
| `POST /api/email/replies/sync` | `CRON_SECRET` | 회신 읽기 회차 |
| `GET /api/email/replies` | 로그인 (볼 수 있는 명단만, 미분류·애매함은 관리자) | 회신 목록. 회신 읽기 대상 조직이 아니면 메일함 상태(`meta.sync`)를 주지 않음 (검토 RH-SEC-5) |
| `GET /api/email/replies/status` | 로그인 | 이 조직에 회신 탭을 보일지 |
| `PATCH /api/email/replies/{id}` | 로그인 (자기 조직) | 처리함·분류 고치기·자동 메일 다시 허용 |
| `GET /api/email/replies/stats` | 로그인 | 규칙별 28일 회신 수 |
| `POST /api/email/status-sync/process` | `CRON_SECRET` | 발송 결과 맞추기 회차 |
| `POST /api/email/send-health/process` | `CRON_SECRET` | 발신 건강 회차 |
| `GET /api/email/send-health` | 로그인 | 발송 건강 카드 |
| `POST /api/email/send-health/holds/{id}/release` | 관리자 | 명단 보류 풀기 (메모 남김) |
| `POST /api/email/send-health/senders/{id}/release` | 관리자 | 주소 자동 멈춤 풀기 |
| `POST /api/email/sender-profiles` (기존, 바뀜) | 로그인 | 회신 읽기 대상 조직에서 **처음 쓰는 발신 도메인**은 관리자만 (검토 RH-SEC-2) |

### 8-6. 운영 반영 순서 (제안)

1. 대표: DESIGN-RPL 13-0(회신 전용 메일함, 권장)·13-1~13-2(구글 클라이언트·갱신 토큰). 개발 서버 시험은 13-3·14절 (시험 서버는 직원 주소가 보낸 메일만 다룸)
2. 재훈 님: 합치고 배포 → 로그 `[migrate] 마이그레이션 완료!`·`[indexes] email_send_logs 색인 준비됨` → 8-2 확인 쿼리
3. 환경 변수: `REPLY_SYNC_MODE=dry_run`, `REPLY_ALERT_MODE=dry_run`, `REPLY_PRIVATE_DOMAINS`(운영값), `REPLY_SHARED_DOMAIN_ADDRESSES`, 구글 비밀값 셋, `SEND_HEALTH_MODE=dry_run`, `SEND_HEALTH_WEBHOOK_URL`
4. Scheduler 세 작업 추가 (8-4)
5. 이틀: 회신 탭(이어짐·미분류·뺀 주소), 발송 건강 카드(결과 맞추기 "마지막 성공", 판정 숫자) 확인
6. `REPLY_SYNC_MODE=on` → 하루 뒤 `REPLY_ALERT_MODE=live`. `SEND_HEALTH_MODE=alert` 1주 → 대표 확인 뒤 `enforce`
7. 개발 서버 `sendb-dev`는 회신 읽기 `off` (한 메일함은 한 환경만 `on`)
8. 구글 챗 (CHAT-QA 4절): 개발 서버 환경 변수에 `DEEP_ALERT_MODE=live`가 있어도 이제 `dry_run`으로 도는지 로그(`[deep-alert] mode=dry_run …`과 경고 `[deep-alert] 시험 서버 — 운영 주소(NEXT_PUBLIC_BASE_URL)가 아니라 live를 dry_run으로 돌립니다 …`)로 확인. 개발 스페이스 하나에 `GOOGLE_CHAT_REQUEST_ID=on`·`GOOGLE_CHAT_THREADS=on`으로 같은 글을 두 번 보내 1통만 남는지·답글로 달리는지 본 뒤 운영에 켬
9. 발송 건강 카드의 "알림 전달 (구글 챗)" 칸(관리자만)에서 "연결 확인 보내기"를 눌러 모든 받는 곳이 "정상"인지 확인 (점검 글이 각 스페이스에 한 통씩 갑니다)

### 8-7. 끄는 법 (9절 표에 더함)

| 기능 | 끄는 법 | 끈 뒤 |
|---|---|---|
| 회신 읽기 | `REPLY_SYNC_MODE=off` (재시작) 또는 Scheduler 작업 멈춤 | 보내기 직전 막기도 꺼집니다 (`on`일 때만 막음). 저장된 회신·장부는 남음 |
| 회신 카드 | `REPLY_ALERT_MODE=off` 또는 `dry_run` | 카드만 멈춤 |
| 발신 건강 조치 | `SEND_HEALTH_MODE=alert`(알림만) 또는 `dry_run`·`off` | 이미 건 보류·멈춤은 그대로 — 화면에서 관리자가 풉니다 (풀면 held 줄이 원래 순서대로 다시 나감) |
| 발송 결과 맞추기 | `NHN_STATUS_SYNC=off` 또는 Scheduler 멈춤 | 발신 건강이 판정할 재료가 없어짐 |
| 마이그레이션 실패 시 띄우기 | `MIGRATION_FAILURE_MODE=continue` | 새 칸을 쓰는 경로가 실패할 수 있음 — 원인 해결 뒤 지움 |

### 8-8. 검증 (로컬 시험 환경, 가짜 Gmail·NHN·구글 챗·Anthropic, 시험 DB)

| 무엇 | 결과 |
|---|---|
| 단위 시험 `tsx --test "src/**/*.test.ts"` | 895개 통과 (dev 687 + 이 기능 163 + 구글 챗 QA 45) |
| `tsc --noEmit`, `next build` | 0 / 성공. eslint는 이 기능이 바꾼 파일에서 새 오류 0 (`src/app/records/page.tsx`의 예전 오류 2개는 HEAD와 같음) |
| 회신 함수 시나리오 RS1~RS29 | 100/100 |
| 발신 건강 함수·HTTP 시나리오 V2~V24 | 105/105 |
| 빈칸 메우기 (검토 반영 G10~G13 포함) | 26/26 |
| 실제 서버 경로 E2E ① dry · ② 회신 on·live/건강 alert · ③ 건강 enforce | 20/20 · 62/62 · 39/39 — 섞인 메일함(사람·대체 짝·자동응답·반송·내부·다른 조직·민감 메일), 대량 1,190통 → 결과 맞추기 → 판정, 가짜 시계로 며칠 뒤 워커, 명단 보류·주소 멈춤·풀기, 화면 |
| 개인정보 | 채용·연봉 문구와 카나리아를 넣은 민감 메일은 받는 사람 머리글만 읽혔고, 저장·알림·본문 요청 0. 카나리아는 DB 문장 기록·가짜 외부 요청 기록·서버 로그 어디에도 없음 |
| 회귀 | 대기열 시나리오 10/10, Reply-To 걷어낸 뒤 발송 경로 27/27 |
| 마이그레이션 잠금 관문 | 0075 앞 8초 잠금 → 다시 해 성공, 70초 잠금 → 서버를 띄우지 않을 값(false) (3/3) |
| 구글 챗 알림 QA (10/11, 가짜 구글 챗) | 공통 보내기·깊이·회신 카드·회신 운영·발송 건강(묶음·매일·풀림·결과 맞추기)·웹훅 문제 알림 9묶음. 찾은 것과 고친 것: `docs/2026-10-11-reply-and-health/CHAT-QA.md`, 원자료 `F:/Dev/sendb-testenv/chat-qa/payloads/` |
| 실제 Gmail·NHN | **아직 안 함** — 대표 설정(DESIGN-RPL 13절) 뒤 개발 서버에서 (REVIEW.md 5절) |

자세한 표: `docs/2026-10-11-reply-and-health/REVIEW.md`, 원자료 `F:/Dev/sendb-testenv/ux/reply-health-results.md` (로컬 시험 환경)

### 8-9. 대표 확인이 남은 것

1. **명단 보류 중 문의 메일**: 지금은 대량만 막고 폼·단건 문의와 수동 1건은 나갑니다 (PRD·설계). "모든 경로를 막는다"로 하려면 `getActiveHold`의 문의 예외를 없애면 됩니다
2. **주소 위험 규칙 (검토 F3)**: PRD "명단 2개 이상에서 함께 5%"를 넣되, 주소 전체 실패율도 5% 이상일 때만 멈춥니다 — 혼자 보내는 나쁜 명단 몇 개 때문에 다른 명단에서 멀쩡한 주소까지 멈추지 않게 (그 명단들은 명단 보류로 막힘). 문구 그대로(주소 전체 상관없이)로 하려면 조건 하나를 빼면 됩니다
3. **발신 건강 판정 범위 (검토 OPS-2)**: 기본은 우리 조직만. 샌드비를 쓰는 다른 고객사에도 켤지(`SEND_HEALTH_ORG_IDS=*`)는 그 고객사 알림을 어디로 보낼지와 함께 정해야 합니다 (지금은 운영 알림이 우리 스페이스 하나로 감)
4. **새 발신 도메인은 관리자만 (검토 RH-SEC-2)**: 회신 읽기 대상 조직(우리 조직)에서 멤버가 처음 쓰는 도메인으로 발신 프로필을 만들거나 바꾸면 403입니다. 이미 쓰는 도메인의 다른 주소는 예전처럼 누구나
5. **후속 메일 시각** (10절 4번과 같음)

## 9. 되돌리기 — 기능별 끄는 법

먼저 기능을 끄고, 코드 되돌리기는 마지막 수단으로 해 주세요. 회신 받기·발신 건강은 8-7절에 있습니다.

| 기능 | 끄는 법 | 끈 뒤 |
|---|---|---|
| 깊이 들어온 사람 알림 | 가장 빠름: Scheduler의 깊이 알림 작업 멈춤 (재시작 필요 없음). 또는 `DEEP_ALERT_MODE=off`나 `DEEP_ALERT_WORKSPACE_IDS` 비우기 (재시작 뒤 반영) | 다시 켜도 예약 시각이 24시간 넘게 지난 대기 카드는 보내지 않고 닫습니다 (묵은 카드가 몰려 나가지 않음). 표는 남겨 둬도 무해 |
| 발신 한도·웜업 | 발신 프로필 화면(관리자)에서 하루 최대·웜업·시간대·평일만·고르게를 끄고, 일시 정지는 풉니다 | 한도가 없는 주소는 예전처럼 바로 나갑니다. 이미 미뤄 둔 메일은 예정 시각에 나갑니다 |
| 발신 묶음 | 규칙의 발신 주소를 하나로 줄입니다 | 예전과 같은 한 주소 발송 |
| 대기열 정책 (문의 우선·몫·3일치 경고) | 따로 스위치가 없습니다. 한도를 끄면 미뤄지는 메일이 없어 몫·순서가 작동할 일이 없습니다 | 경고는 화면 표시만이라 발송에 영향 없음 |
| Reply-To 걷어냄·금지 헤더 거르기 | 끄지 않습니다 | 이 커밋을 되돌리면 Reply-To가 다시 붙을 수 있고, 그러면 **답장 주소가 있는 사업의 메일이 전부 NHN에서 거절됩니다** |

**코드를 되돌려야 할 때** (main의 합치기 커밋 revert 후 재배포)
- 칸·표·인덱스는 그대로 두세요. 옛 코드는 새 칸을 읽지 않습니다. 0072가 옛 인덱스 `esq_pickup_idx`를 지웠지만 새 인덱스가 같은 `status` 앞머리를 쓰므로, 대기열 표가 작으면 성능 차이는 거의 없습니다
- 되돌리기 **전에** 아래 두 가지를 확인해 주세요. 옛 코드가 새 상태를 모릅니다
  1. `SELECT kind, count(*) FROM email_automation_queue WHERE status = 'pending' GROUP BY kind;` — `first`·`first_bulk` 줄(한도로 미룬 템플릿 첫 메일)이 남아 있으면, 옛 반복 워커가 이것을 **반복 메일로 다룹니다** (반복 설정이 없는 템플릿이면 `cancelled`로 닫혀 첫 메일이 안 나가고, 있으면 반복으로 보내고 다음 반복을 잡습니다). 먼저 다 나가게 두거나, 어떻게 처리할지 대표와 정해 주세요
  2. Scheduler를 멈추고 8분쯤 기다린 뒤 `SELECT count(*) FROM email_followup_queue WHERE status = 'processing';`가 0인지 — 옛 코드는 `processing` 줄을 다시 집지 않습니다
- `email_send_queue`의 미룬 줄(`scheduled_at`이 미래)은 옛 코드도 그 시각에 꺼내 보냅니다. 다만 한도 없이 나갑니다

## 10. 알아 둘 것

1. **개발 DB는 실제 고객 데이터입니다** (2026-10-01 운영 덤프). 개발 서버에서 보내도 실제 고객에게 나갑니다. 지금까지 실제 발송 시험은 대표 승인을 받고 직원·대표 주소로만 했습니다. 운영 확인도 같은 방식으로 부탁드립니다. 개발 서버의 시험 자료(파티션 83 "발송 시험(삭제 예정)", 규칙 66)는 개발 DB에만 있고 운영과 무관합니다
2. **NHN은 Reply-To를 받지 않습니다.** 사용자 지정 헤더 금지 목록 18개에 `Reply-To`가 있고(`From`, `To`, `Message-ID`, `In-Reply-To`, `References` 등), `sender/eachMail` 본문에도 회신 칸이 없습니다. `9290217`만 단독으로 올리면 답장 주소 값이 있는 사업의 메일이 전부 실패합니다. 반드시 `630058a`와 함께 올려 주세요. `workspaces.reply_to_email` 칸과 설정 API의 저장 경로는 남아 있지만 발송에는 쓰지 않습니다 (지울지는 나중에 정함)
3. **답장 받기는 헤더가 아니라 MX로 합니다.** 발신 도메인 약 160곳에 MX(Google)를 연결해 `cs@<도메인>`으로 온 답장이 `ceo@matchesplan.com`에 모입니다 (8절). 공개 DNS 재점검(10/10)에서 MX·Google TXT 160/160, 기존 SPF·DKIM·DMARC 156/156 유지를 확인했습니다. 보조 도메인 쪽으로 실제 답장이 도착하는지는 10/10 기준 아직 시험하지 않았습니다. 규칙 화면의 MX 안내는 운영 서버에서 공개 DNS를 조회하므로(결과 캐시: 있음 하루, 없음·확인 못 함 10분) 배포 직후 160곳은 안내가 뜨지 않아야 정상입니다
4. **후속 메일이 나가는 시각이 바뀝니다.** 후속 작업을 하루 1번(09:00)에서 10분으로 바꾸면, 후속이 "기한 다음 날 09:00에 일괄"이 아니라 "첫 메일을 보낸 시각 + N일"에 나갑니다. 첫 메일이 밤에 나갔다면 후속도 밤에 나갈 수 있습니다. 발신 프로필에 시간대(예: 9~18시)를 켜 두면 그 안에서만 나갑니다. 시간대를 켜기 전까지 후속 주기를 그대로 둘지는 대표와 맞춰 주세요
5. **가져오기 명단의 템플릿 첫 메일은 "대량"으로 다룹니다** (`first_bulk`, DESIGN-2 2절). 대표가 "경로와 상관없이 문의"로 정하면 `src/lib/record-import.ts`의 `purpose: "bulk"` 한 줄을 빼면 됩니다. 대표 확인이 남은 항목입니다
6. **고르게 나눠 보내기의 간격 기록은 프로세스 메모리에 있습니다.** 인스턴스가 여럿이거나 재시작하면 덜 펼쳐질 뿐 한도를 넘지는 않습니다. 한도 자체는 DB 조건부 upsert라 동시에 보내도 넘지 않습니다
7. **`email_send_logs.record_id` 인덱스가 없습니다.** 깊이 알림 미리보기가 표를 훑으므로 서비스 전체에서 한 번에 하나만 돌게 잠금을 걸었습니다(겹치면 409). 인덱스는 운영 표가 커서 마이그레이션 안에서 만들지 않았습니다. 필요하면 `CREATE INDEX CONCURRENTLY`로 따로 정해 주세요
8. **샌드비는 여러 조직이 씁니다.** 깊이 알림은 `DEEP_ALERT_WORKSPACE_IDS`에 적은 워크스페이스만 처리합니다. 번호를 잘못 적으면 다른 조직 고객 정보가 우리 챗으로 갈 수 있으니 4절의 확인 쿼리를 꼭 돌려 주세요
9. **main이 dev보다 앞선 커밋이 하나 있습니다** (`41c8307`). 2-2절 충돌 말고는 자동으로 합쳐집니다

## 11. 참고 문서

| 기능 | 설계 | 리뷰·검증 |
|---|---|---|
| 깊이 들어온 사람 알림 | `docs/2026-10-02-deep-visitor-alert/DESIGN.md` (2절 설정, 7절 워커, 9절 배포) | `docs/2026-10-02-deep-visitor-alert/REVIEW.md` |
| 발신 웜업·한도·묶음 | `docs/2026-10-02-sender-warmup/DESIGN.md` (4절 마이그레이션, 9절 운영) | `docs/2026-10-02-sender-warmup/REVIEW.md` |
| 대기열 정책 | `docs/2026-10-02-sender-warmup/DESIGN-2-queue-policy.md` | `docs/2026-10-02-sender-warmup/REVIEW-2.md` |
| 답장 주소 → 걷어냄 | `docs/2026-10-02-sender-warmup/DESIGN-3-reply-to.md` (6절 실제 발송 결과와 바뀐 결정) | `docs/2026-10-02-sender-warmup/REVIEW-3.md`, `REVIEW-4.md` |
| 회신 받기·발송 상태 | `docs/2026-10-11-reply-and-health/DESIGN-RPL.md`(13절 대표 설정 안내, 14절 배포), `DESIGN-SND.md`(9절 cron, 11절 설정). 근거 PRD: 마케팅 마스터 `dev-handoff/09-cold-email-system-prd.md` | `docs/2026-10-11-reply-and-health/REVIEW.md` |
