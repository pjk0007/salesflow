# PROGRESS — docs/2026-10-21-send-log-search/

- 2026-10-21 plan: PLAN.md + behaviors.json(7) 작성, 승인 대기. 동료 요청(오피오 88곳 대조 중 검색 20~30초). 사용자 지시 "먼저 끝날 것 먼저" — 대시보드 사이클(design 진행 중)보다 먼저 한다
- 2026-10-21 plan 승인("응 진행해 codex 기존탭으로"). do 시작, Codex 기존 탭에 위임
- 2026-10-21 Codex 질문: 0120 테스트의 "journal 최후" 조건이 새 0121과 충돌 → 0120은 유일성·고정 when·이전 항목보다 늦음으로 바꾸고 최후 검증은 S2가 맡게 답함(PLAN 범위 안, 설계 변경 없음)
- 2026-10-21 설계 변경: 리뷰 중 기존 패턴 발견 — email_send_logs 색인은 마이그레이션이 아니라 src/lib/db/send-log-indexes.ts(부팅 뒤 CONCURRENTLY·advisory 잠금)로 만든다. 0121 마이그레이션·journal·0120 테스트 변경을 되돌리고 SEND_LOG_INDEXES에 더한다. 운영 수동 색인 생성(승인 필요)도 필요 없어짐. 대시보드 사이클 번호는 다시 0121
- 2026-10-21 do 완료: Codex 구현(9파일) + 테스트 고정값 1건 수정 지시. 로컬 빈 DB(30만 행)로 S2~S6 실측, behaviors 7/7 증거 기록. 전체 테스트 실패 1건은 channel-source-export 시간 제한(무관)
- 2026-10-21 check: GAP 1차 unproven 1(S2 부팅 증거)·ref 경로 → boot-index.txt 저장·ref 정리, 2차 unproven 0. REVIEW 🔴0 🟡1(placeholder, Codex 반영) 🟢3. 통계 없는 계획 우려는 로컬 재현에서 나타나지 않음
