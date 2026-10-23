# PROGRESS — docs/2026-10-22-journey-email-index/

- 2026-10-22 plan: PLAN.md + behaviors.json 작성, 승인 대기
- 2026-10-22 plan: planner 확인 질문("'email' 밖 메일 키 빈도")을 운영 읽기 전용 조회로 해결 — text형 메일 힌트 칸은 email(같은 키)·adName·emailConf뿐, 고객 여정 대상 워크스페이스는 8·9. (b)만으로 충분하다고 판단
- 2026-10-22 plan: 승인(P2 깊이 알림 포함), design 시작
- 2026-10-22 design: DESIGN.md 작성(D1~D8, U0~U8), 승인 대기
- 2026-10-22 design: 승인, do 시작(Codex 새 탭)
- 2026-10-22 do: U0 운영 전 증거(evidence/stage0-prod.txt) — PG 16.15·UTF8, 고객 여정·grec 모두 records Seq Scan → U5 이번에 포함
- 2026-10-22 do: Codex 질문 답 — T5 오류 판정에 SQLSTATE 54000 허용, T8a는 인덱스 이름이 아니라 Index Cond의 표현식으로 판정(복합 인덱스 선두 열만 쓰는 경우 구분), executedFullScans에 workspace_id·org_id만 Index Cond인 스캔 포함
- 2026-10-22 do: U4 설계 수정 — related 바깥 JOIN own을 스칼라 InitPlan 조건(workspace_id·org_id = (SELECT … FROM own))으로 교체(own이 바깥 루프를 몰아 ws 인덱스로 훑는 계획 차단, own 최대 1행이라 결과 동일). T8 fixture에 ws 8 filler 2,000행 + ANALYZE 허용
- 2026-10-22 do: U1~U4 완료 확인(테스트 16/16 재현, diff 설계 일치). U5a~U7 지시
- 2026-10-22 do: U5a·U5b·U6 GREEN 보고(전체 1608 tests, 0 fail). U7 QA DB TRUNCATE·fixture 입력 승인(시험 전용 DB, 기존 잔여 3/3/60행)
- 2026-10-22 gap: unproven 0, unresolved 0 (B12 pending — 배포 뒤)
- 2026-10-22 review: 🔴 0 · 🟡 2
- 2026-10-23 review(2회차): 🟡 2건 수정(Claude 직접, 사용자 요청) → 🔴 0 · 🟡 0, 테스트 재확인
