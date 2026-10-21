# REVIEW — docs/2026-10-21-send-log-search/ · 2026-10-21

- 판정: 🔴 0 · 🟡 1(반영) · 🟢 3(1 반영)

## 🔴 버그·보안 — 없음
- 검색어는 두 라우트 모두 파라미터 바인딩. `sql.raw`에는 고정 표·칸 이름만.
- 정확 검색 경로에도 조직 조건이 그대로 붙는다. unified의 alimtalk 조기 반환은 조회하지 않는다.
- status·triggerType·기간·recordId 등 다른 필터와 AND로 함께 붙는다.
- count·목록 모두 새 색인을 쓴다. sender-health의 `SEND_LOG_INDEXES_READY_SQL`(두 색인 이름 지정, `< 2`)과 묶이지 않는다.

## 🟡 반영
- placeholder가 좁은 칸에서 잘려 안내가 안 보였다 → "수신자/제목 또는 이메일 주소 전체", "수신자 이메일 주소 전체 또는 제목"으로 줄였다.

## 🟢
- (반영) send-log-indexes.test.ts가 cwd 기준 상대경로였다 → import.meta.url 기준.
- (보류) EmailSendLogTable 문구의 "... —" 겹침 → 위 축약으로 해소.
- (보류) 알림톡 필터 + 이메일 주소 검색이면 빈 화면 문구가 일반 문구다. 틀린 동작은 아니라 둔다.

## 확인 필요 → 로컬 재현
- "색인 직후 통계가 없으면 목록 쿼리(ORDER BY sent_at LIMIT 50)가 (org_id, sent_at) 색인을 거꾸로 훑을 수 있다"
- 재현: autovacuum 끄고 색인 다시 만든 뒤 ANALYZE 전 EXPLAIN → 새 색인 Index Scan 0.04ms (evidence/explain-nostats.txt). 로컬에서는 나타나지 않았다. 운영 배포 뒤 읽기 전용 EXPLAIN으로 한 번 더 본다.
