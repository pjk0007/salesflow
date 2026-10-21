# PROGRESS — docs/2026-10-21-email-dashboard-stats/

- 2026-10-21 plan: PLAN.md + behaviors.json(30) 작성, 승인 대기. 질문 4건(Q1 KPI·회신율 기준, Q2 기간·5분 지연, Q3 워크스페이스 선택, Q4 비용). 운영 실측: trends 28.6s·summary 27.6s·email-daily 15.9s, 원인은 email_send_logs heap 748MB 콜드 읽기(오픈율 무관)
- 2026-10-21 plan 승인: 사용자 "추천대로" — Q1 KPI 8개·회신율 첫 메일 기준, Q2 7·30·90일(기본 30)·최대 5분 지연 수용, Q3 워크스페이스 선택 추가(기본 전체), Q4 CPL 제외. 마커 4건을 결정으로 교체. 운영 기준선 측정(단계 0)은 발송 창 밖(18시 이후)에 읽기 전용으로 한다
- 2026-10-21 일시 정지: 사용자 지시로 검색 개선 사이클(2026-10-21-send-log-search)을 먼저 한다. 그 사이클이 0121을 쓰므로 (이후 정정: 검색 사이클은 마이그레이션을 쓰지 않으므로 이 사이클은 그대로 0121). DESIGN 작성은 계속 진행
- 2026-10-21 design: DESIGN.md 작성(architect, 1,331줄). 결정 D1~D15, 새 표 4개·0121·5분 워커·섹션별 GET API, Codex 단위 U0~U11. 열린 질문 3건(단계 0 측정, 2회 반영, sendb-dev 워커). 승인 대기
- 2026-10-21 design 수정(사용자): 자동 주기 5분→15분(최근 8일, 야간 9~35일 그대로), "지금 갱신" 버튼 추가(DESIGN 7-8, B31 추가 — 분모 31). 실행 위치는 instrumentation 서버 안 스케줄러(D8) 확인. 사용자 "그걸로 해" = DESIGN 승인
- 2026-10-21 do 시작: Codex 기존 탭에 U0~U2 위임(run_479aa4c085e2). U3 전 운영 단계 0 측정은 18시 이후
- 2026-10-21 Codex 질문 2건 → DESIGN 수정: dashboard/types는 U1에서 먼저 생성, 런타임 키는 metrics.ts / parseStatsQuery는 {ok:true,…}|{ok:false,error} union
- 2026-10-21 U0~U2 완료(Codex): 12파일, T1~T4 RED→GREEN, email-stats 테스트 pass 27 재확인. U3은 단계 0 운영 측정(18시 이후) 뒤
- 2026-10-21 단계 0 운영 측정(사용자 "바로 해", 읽기 전용): 알림톡 3질의 ≤200ms → 분기 A, 신규 레코드 5.7s → 분기 B(records만: (org_id, created_at) 색인 + home_stats_daily source=records). DESIGN 9-2에 결과·결정 기록
- 2026-10-21 Codex에 U3~U6 위임. DB 시험은 localhost sendb_email_stats_qa만(DESIGN 14절 정정)
- 2026-10-21 Codex 질문 3건(records 집계) → DESIGN 9-2: 조직 목록=organizations, first_send_date=첫 데이터 날짜(발송·record 중 이른 것), records 색인 미준비면 records만 건너뜀
- 2026-10-21 U3 완료(Codex: 0121·journal·schema·records 색인·T5 GREEN, QA 빈 DB 2회 부팅 재적용 0). 질문 → records 색인 준비 전에는 이메일 최근 8일만, 커서·야간·백필 보류(DESIGN 9-2 계약 4)
- 2026-10-21 U4~U6 완료(Codex): 32 새 파일, QA DB 테스트 13/13을 Claude가 직접 재실행 통과(evidence/u5-u6-qa.txt). 워커는 instrumentation에서 시작, 기본 production에서만(EMAIL_STATS_WORKER on/off), 15분. 메모: 일부 새 파일이 공백 없는 압축 서식 — U11에서 저장소 서식으로 정리 요청
- 2026-10-21 Codex 질문(수동 갱신 색인 준비) → 세 색인 모두 준비 전이면 503, 쿨다운 미기록(DESIGN 7-8)
- 2026-10-21 U7~U9 완료(Codex) + Claude 검증: QA 66/66, 전체 1580 실패 0, tsc·eslint(82) 0. 데모 DB(4.4만 건) 집계=원본 일치, curl 표, ego-browser 화면(KPI·추세·비교·연동 안 됨·멈춤 경고·지금 갱신 200/429), 30만 건 성능(백필 46s, 최근 회차 ≤0.3s, 야간 ≤0.8s). behaviors 30/31 증거(B19는 운영 반영 뒤)
- 2026-10-21 GAP 1차(unproven 2: B16 경고 화면 근거 불일치, B31 403 미실행)·REVIEW 1차(🔴1 반영 순서, 🟡4, 🟢6). DESIGN 9-2 계약 5(워터마크 늘 max(id) 시드)와 바뀌는 숫자(pending+uncertain) 추가. Codex에 수정 묶음 위임. 🔴 반영 순서는 커밋을 1차(표·워커)/2차(홈·화면)로 나눠 해결
- 2026-10-21 check 완료: 수정 묶음 재검증(QA 74/74, 전체 실패 1 무관, tsc·eslint 0, 화면 3장), GAP 2차 unproven 0, REVIEW 🔴는 커밋 2분할로 해소(1차 단독 작업트리 tsc 0 확인)
- 2026-10-21 1차 커밋 5d9ef67 푸시(표·워커·API 53파일, 화면 미연결). 사용자 배포 예정. 2차(홈·화면·static.test·옛 파일 삭제·docs)는 백필 확인 뒤
