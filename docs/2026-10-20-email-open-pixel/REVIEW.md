# REVIEW — docs/2026-10-20-email-open-pixel/ · 2026-10-21 (1회차)

범위: `git diff` 중 src·drizzle 28개 파일과 새 파일 22개(src·drizzle). `tsc --noEmit`은 통과했고, 새 테스트 38개도 모두 통과했습니다(`tsx --test`).
판정: 🔴 0 · 🟡 2 · 🟢 6

**결론:** 막아야 할 결함은 없습니다. 보안, 0089 마이그레이션, 발송 7경로, 클릭 수치 보존, `db.execute` 결과 형태 모두 문제없음을 코드로 확인했습니다. 고칠 만한 것은 오픈 기록이 조용히 버려지는 두 곳입니다.

## 🔴 버그 (0)
이상 없음.

## 🔴 보안 (0)
지적한 항목별로 직접 확인한 결과입니다.
- **서명 검증**(`email-open-pixel.ts:12-25`): id 형식, HMAC 서명 16자 형식, 고정 시간 비교를 차례로 거칩니다. 비교 전에 길이가 같다는 것도 보장됩니다. 서명이 맞은 요청만 레이트 칸을 씁니다(`route.ts:17`).
- **입력 검증**: id는 양의 int4 범위만 받습니다. UA는 512자에서 자르고, IP는 모양을 검사합니다.
- **조직 격리**: `recordOpen`은 조직을 요청에서 받지 않고 발송 행의 `org_id`를 씁니다. 조회 쪽 `openSignalsForSendLogs`는 `s.org_id = orgId`로 거르고 join에도 `o.org_id = s.org_id`가 있습니다.
- **정보 노출**: 성공이든 실패든 늘 200과 같은 GIF를 돌려주고, 쿠키도 붙이지 않습니다. id가 있는지 없는지 밖에서 알 수 없습니다.

## 🟡 버그·운영 위험 (2)
- **`src/lib/email-open-tracking.ts:33`** — 동시 기록이 4개를 넘으면 그냥 `return`하고 로그도 숫자도 남기지 않습니다.
  - 풀 연결은 20개인데, 정기 작업들이 연결을 하나씩 회차 내내 쥐고 있습니다. 풀이 바닥나면 기록 4건이 연결을 기다리며 멈춰 있고, 그동안 들어오는 오픈은 사람 오픈까지 전부 버려집니다.
  - 버리는 판단은 UA로 사람·기계를 가르기 전에 일어납니다. 그래서 검사기 요청도 사람 오픈과 똑같이 자리를 차지합니다.
  - 결국 오픈율이 조용히 낮게 나와도 원인을 알 수 없습니다.
  - 제안: 버린 건수를 세고 일정 간격마다 한 줄 로그를 남겨 보이게 합니다. 운영 분포를 본 뒤 상한을 조정하는 설계 O4의 근거로도 필요합니다.
- **`src/app/api/track/open/route.ts:21-23`** — 빈 `catch {}`입니다. GIF를 늘 돌려주는 것은 맞지만, `after()`나 `requestIp`가 던지면 기록이 아무 흔적 없이 사라집니다. 에러를 삼키지 않는다는 팀 규칙에도 어긋납니다.
  - 제안: 응답은 그대로 두고 `console.error`로 한 줄 남깁니다.

## 🟡 컨벤션 (0)
화면 `.tsx`에는 로직이 없습니다. 오픈 칸 판정은 `openCell.ts`, 비율 계산과 표기는 `openRate.ts`에 있고, 화면은 불러다 쓰기만 합니다. `any`와 남은 `console.log`도 없습니다.

## 🟢 nit (6)
- `src/components/email/DailyEmailTable.tsx:3-5`, `src/components/email/EmailDashboard.tsx:3-7` — `"use client"` 아래에 새 import가 따로 붙어 있고 빈 줄이 두 개입니다. 같은 폴더를 `@/`와 `./`로 섞어 부릅니다. 기존 import 묶음에 합치면 됩니다.
- `src/app/api/email/send/route.ts:204`, `src/components/email/EmailSendLogTable.tsx:441`, `src/components/logs/UnifiedLogTable.tsx:211` — 들여쓰기가 주변 줄과 다릅니다. `src/lib/db/schema.ts:748-749`에는 빈 줄이 두 개 있습니다.
- `src/app/api/analytics/summary/route.ts:2`, `src/app/api/analytics/templates/route.ts:2` — 서버 라우트가 `@/components/.../openRate`를 import합니다. 동작에는 문제없지만 의존 방향이 거꾸로입니다. `openRatePercent`는 `src/lib`로 옮기는 편이 맞습니다.
- 오픈율을 계산하는 자리가 둘로 갈립니다. summary·templates는 서버에서 계산하는데, `DailyEmailTable.tsx:107,126`은 화면에서 `openRatePercent`를 부릅니다. 결과는 같으므로 한쪽으로 맞추면 됩니다.
- `src/app/api/email/logs/route.ts:113-114`, `src/lib/mcp/tools.ts:306-307`, `src/app/api/logs/unified/route.ts:86` — 클릭 신호와 오픈 신호 조회를 차례로 기다립니다. 둘은 서로 의존하지 않으니 `Promise.all`로 묶을 수 있습니다.
- `src/lib/request-ip.ts:5` — `x-forwarded-for` 첫 값은 클라이언트가 마음대로 넣을 수 있습니다. 저장만 하고 판정에는 쓰지 않으므로 영향은 없습니다. 클릭 라우트와 같은 수준입니다.

## 따로 확인한 항목 (이상 없음)
- **0089 마이그레이션**
  - drizzle은 밀린 마이그레이션을 한 트랜잭션으로 돌리므로 `SET LOCAL lock_timeout`이 그 안에서 적용됩니다. 55P03이 나면 `migrate.ts`가 3번 더 해 보고, 그래도 실패하면 서버를 띄우지 않습니다(`migrate.ts:113-150`). 0075·0088과 같은 방식입니다.
  - 상수 기본값에 NOT NULL인 칸 추가는 PG 11 이상에서 표를 다시 쓰지 않습니다. 0080의 `RANGE ... interval PRECEDING`이 운영에서 돌았으니 PG 11 이상이라는 근거는 맞습니다.
  - FK가 요구하는 잠금은 이미 쥔 ACCESS EXCLUSIVE 안에 포함되어 잠금을 올리는 일이 없습니다. 발송 행을 지울 때의 cascade는 `(send_log_id, is_machine)` 색인이 받습니다.
  - 남는 위험: 잠금을 기다리는 최대 5초 × 4회 동안 `email_send_logs` 조회와 쓰기가 그 뒤에 줄을 섭니다. 트래픽이 적은 시간에 배포하기를 권합니다.
- **발송 7경로**: send 라우트, test-followup, AI 자동, 템플릿 자동, 후속 템플릿, 후속 AI, 방문 감사입니다.
  - 모두 DB `body`에는 추적을 입히기 전 본문을 적고, NHN에는 `applyEmailTracking`을 거친 본문을 보냅니다.
  - `openTracked: true`도 빠진 곳이 없습니다. 방문 감사는 원문 SQL에 `true`로 직접 넣고, 준비된 발송 경로는 `logValues`를 그대로 넘깁니다.
  - 기록을 남기지 않는 test-send 두 곳은 픽셀도 넣지 않습니다.
- **기존 클릭 수치**: 네 집계 모두 select에 칸만 더했습니다. `GROUP BY 1,2,3,4`, `DISTINCT ON`, `NOT IN`, join은 바뀌지 않았습니다. email-daily의 재귀 단계는 `lo.open_tracked`, `lo.status`를 이어 받아 원래 발송의 값을 유지합니다.
- **`db.execute` 결과 형태**: 드라이버가 postgres-js라 배열이 바로 옵니다. 클릭 신호 조회와 같은 가정입니다.
  - drizzle이 timestamptz를 문자열로 돌려주게 해 두었는데, `"2026-10-21 01:00:00.123456+00"` 같은 값을 `new Date()`가 정확히 읽는 것을 직접 돌려 확인했습니다.
  - 개수는 `::int`라 숫자로 옵니다.

## 확인 필요
- **오픈율이 위조될 수 있음**: `openedSendSql`은 사람 클릭도 오픈으로 셉니다. 그런데 기존 `/api/track/click`은 서명이 없어 id만 바꾸면 누구나 사람 클릭을 남길 수 있습니다. 그 결과 오픈율도 위조됩니다. 같은 라우트에 `url` 인자를 그대로 리다이렉트하는 open redirect도 있습니다. 이번 변경 범위 밖이지만, 이제 오픈율에도 영향이 갑니다.
- **테스트 발송이 분모에 들어감**: `test_followup` 테스트 발송도 `open_tracked=true`, `status='sent'`라 오픈율 분모에 들어가고, 운영자가 열어 보면 사람 오픈으로 잡힙니다. 지금도 발송 수에는 포함되므로 일관성은 있습니다. 오픈율에서도 그대로 둘지 결정이 필요합니다.
