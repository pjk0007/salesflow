# REVIEW — docs/2026-10-21-email-dashboard-stats/ · 2026-10-21

- 1회차 판정: 🔴 1 · 🟡 4 · 🟢 6 → 반영 뒤 🔴 0(배포 절차로 해소) · 🟡 0 · 🟢 2 보류

## 🔴 반영 순서 (운영)
- 홈 3라우트가 반영 즉시 집계 표만 읽어, 백필 전에는 홈 숫자가 작게 나온다. DESIGN 16절의 2회 반영과 어긋난다.
- 조치: 커밋을 둘로 나눈다. 1차 = 0121·journal·db·email-stats lib·워커·instrumentation·API(화면 미연결). 2차 = 홈 3라우트·useAnalytics·대시보드 화면·옛 파일 삭제·static.test. 1차만 담은 작업트리에서 tsc 0, 테스트는 static.test 2건(화면 파일 검사) 외 이번 변경 관련 실패 없음 확인.

## 🟡 반영
- 워터마크 0 시드 → 늘 max(id) 시드(DESIGN 9-2 계약 5), 수동 갱신도 ensureState 경유.
- 스케줄러 onError가 원인을 버림 → `(error: unknown)` 전달, `describeReplyError` 한 줄 로그.
- records 색인 준비 SQL 중복 → `RECORDS_INDEX_READY_SQL` 공유, 로그 문구 "email_send_logs·records 색인".
- 서식(수백 자 한 줄) → 저장소 서식으로 풀고 200줄 이하 유지(최대 147줄).

## 🟢
- (반영) 안 쓰는 `_now` 제거, db-fixture → `db-fixture.test-helper.ts` + current_database 확인, useAnalytics import 순서.
- (반영) summary `email.pending`에 uncertain 포함을 DESIGN "바뀌는 숫자"에 추가.
- (보류) worker.ts `budgetMs === 0` 시험 분기.
- (보류) 확인 필요: 이벤트 하한만 있는 CTE(오래된 백필 조각), `uns` CTE 기간 조건 없음, 최근 8일 루프 예산 없음 → 운영 반영 뒤 `[email-stats] … ms=` 로그로 본다.

## 보안
- 이상 없음: 모든 읽기·쓰기 org_id 조건, workspaceId 소속 검증 400, 수동 갱신 member 403·자기 조직만, CRON_SECRET 라우트, 매개변수 바인딩.
