# PLAN — 발송 기록 정확 주소 검색 + 수신자 색인

- **track**: Quick
- **사이클 ID**: `2026-10-21-send-log-search`

## 목표

발송 기록 검색(`/logs?search=`, `/email` 발송 이력)이 건당 20~30초 걸린다. 운영 담당자는 주로 **이메일 주소 하나**로 찾는다(오피오 명단 대조). 검색어가 이메일 주소 모양이면 정확 일치로 찾고, 그 조건을 받치는 색인을 더해 1초 안에 답하게 한다. 다음 주부터 발송량이 늘어나므로 대시보드 개편(2026-10-21-email-dashboard-stats)보다 먼저 한다.

## 원인 (코드)

- `src/app/api/logs/unified/route.ts:54-57`: `recipient_email ILIKE '%검색어%' OR subject ILIKE '%검색어%'`. 앞에 `%`가 붙어 색인을 못 쓴다. 전체 채널이면 알림톡 표도 함께 훑는다.
- `src/app/api/email/logs/route.ts:25-31`: 같은 ILIKE.
- `email_send_logs`의 색인은 `(org_id, sent_at)`과 수신거부 토큰뿐이다. 수신자 색인이 없어서 조직의 발송 전체(heap 748MB)를 읽는다.
- count와 목록을 따로 돌려 같은 전체 읽기를 두 번 한다.

## 단계별 작업

1. 순수 함수 `isExactEmailSearch(search)`를 만든다. 앞뒤 공백을 지운 값이 `로컬@도메인.최상위` 모양이고 공백·`%`가 없으면 true다. TDD로 한다.
2. 색인은 마이그레이션이 아니라 기존 부팅 뒤 경로로 만든다 (2026-10-21 구현 중 변경 — PROGRESS 참고)
   - `src/lib/db/send-log-indexes.ts`의 `SEND_LOG_INDEXES`에 `CREATE INDEX CONCURRENTLY IF NOT EXISTS "email_send_logs_org_recipient_lower_idx" ON "email_send_logs" ("org_id", lower("recipient_email"))`를 더한다. 이 경로는 instrumentation이 부팅 뒤 트랜잭션 밖에서 advisory 잠금으로 돌린다. 발송 쓰기를 막지 않고, 운영에 손으로 미리 만들 필요가 없다.
   - `SEND_LOG_INDEXES_READY_SQL`(건강 판정용 두 색인)은 바꾸지 않는다.
   - `src/lib/db/schema.ts`의 `emailSendLogs` 색인 목록에 같은 색인을 적는다.
   - 마이그레이션·journal은 건드리지 않는다.
3. 두 라우트: 정확 주소 모양이면 `lower(recipient_email) = lower(trim(검색어))`로 바꾼다. 제목 ILIKE는 쓰지 않는다. 통합 라우트는 이 경우 알림톡 쪽을 건너뛴다(전화번호·템플릿 이름에 이메일 주소가 들어갈 일이 없다). 주소 모양이 아니면 지금처럼 ILIKE로 둔다.
4. 화면: 검색창 placeholder에 "이메일 주소 전체를 넣으면 빠르게 찾습니다"를 적는다(`/logs`, `/email` 발송 이력).

## 건드릴 파일

- `src/lib/send-log-search.ts` (새, 순수 함수) + `src/lib/send-log-search.test.ts`
- `src/lib/db/send-log-indexes.ts` (색인 1개 추가) + 정적 테스트
- `src/lib/db/schema.ts` (색인 1줄)
- `src/app/api/logs/unified/route.ts`, `src/app/api/email/logs/route.ts`
- 검색창 placeholder 2곳 (`/logs` 표, `/email` 발송 이력 표)
- 새 의존성은 없다.

## behavior 목록

- S1 — `isExactEmailSearch`: `info@inzent.com`, ` Info@Inzent.com `는 true이고, `inzent`, `@inzent.com`, `info@`, `a b@c.com`, `a%@c.com`, 빈 값은 false다 (P1)
- S2 — `SEND_LOG_INDEXES`에 `(org_id, lower(recipient_email))` 색인이 CONCURRENTLY·IF NOT EXISTS로 들어 있고 schema.ts 선언과 이름이 같다. 이번 변경으로 drizzle 마이그레이션·journal은 바뀌지 않는다. 빈 DB 부팅 뒤 색인이 valid로 생긴다 (P1)
- S3 — `/api/email/logs?search=<주소>`는 대소문자·앞뒤 공백과 무관하게 그 주소로 간 발송만 준다. 같은 도메인의 다른 주소나 제목에 그 주소가 들어간 발송은 나오지 않는다 (P1)
- S4 — `/api/logs/unified?search=<주소>`도 S3과 같고, 알림톡 줄은 나오지 않는다. 주소 모양이 아닌 검색어(회사명·제목 일부)는 지금과 같은 결과다 (P1)
- S5 — 운영 규모 fixture(또는 운영 EXPLAIN, 읽기 전용)에서 정확 주소 검색이 새 색인을 쓰고(Index/Bitmap Scan), 응답이 1초 안이다 (P1)
- S6 — 다른 조직의 발송은 나오지 않는다(조직 격리) (P1)
- S7 — `pnpm test`, `tsc --noEmit`, 바꾼 파일 eslint가 통과한다 (P1)

## 리스크/불확실성

- 색인 생성: 부팅 뒤 CONCURRENTLY라 쓰기를 막지 않는다. 배포 직후 몇 분은 색인이 없어 예전처럼 느릴 수 있다. 크기는 수십 MB로 추정한다.
- 저장된 주소에 앞뒤 공백이 있으면 정확 검색에서 빠진다. 드물다고 보지만 운영에서 확인하지 않았다.

## 검증 방법

- S1·S2: node:test(TDD, 정적 검사) + 빈 DB 부팅 로그·pg_index 확인
- S3·S4·S6: 빈 시험 DB에 fixture를 넣고 로컬 서버로 호출한다(실제 NHN 키가 있는 로컬 `salesflow` DB는 쓰지 않는다).
- S5: 로컬 fixture로 `EXPLAIN (ANALYZE, BUFFERS)`를 돌린다. 운영은 색인을 만든 뒤 읽기 전용 EXPLAIN으로 확인한다.

## 범위 밖

- 도메인 검색(`@inzent.com`)과 부분 검색을 빠르게 하는 것(trigram 등)
- 제목 검색 속도
- count와 목록을 한 번에 세는 구조 변경
- 알림톡 전화번호 검색 색인
