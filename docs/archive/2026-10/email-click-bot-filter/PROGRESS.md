# PROGRESS — docs/2026-10-13-email-click-bot-filter/

- 2026-10-13 plan: PLAN.md + behaviors.json 작성, 승인 대기
- 2026-10-13 plan: (b) 정의 확인 질문은 운영 분석 SQL 기준(각 클릭 ±10초, 정각 포함, 다른 클릭 2건 이상)으로 해소
- 2026-10-13 plan: 사용자 승인 (정확도 추정 ~99% 설명 후). design 시작
- 2026-10-13 design: DESIGN.md 작성, 승인 대기. architect가 남긴 Q1(dev 브랜치)·Q2(운영 확인 금지)는 사용자 지시(main 작업, 운영 읽기 허용)로 해소해 16절에 반영
- 2026-10-13 design: 6-2 클릭 신호 SQL을 원문 SQL로 수정 — drizzle 단일 표 select가 칼럼을 표 이름 없이 찍어 서브쿼리 참조가 늘 참이 되는 문제(pg-core/dialect.js buildSelection isSingleTable 확인). 중복 실행된 첫 architect 결과에서 발견
- 2026-10-13 design: 사용자 승인. do 시작 — 구현은 Codex(Orca 새 탭)에 위임
- 2026-10-13 do: Codex 구현 완료 보고(24파일). 직접 재검증 — pnpm test 978/0, tsc 0, 변경 파일 eslint 0. 0080 백필 fixture 26행 일치(로컬 DB 트랜잭션 ROLLBACK). 임시 DB salesflow_botcheck에서 recordClick·hasClicked·clickSignals 17건 PASS
- 2026-10-13 do: 미검증 — B16~B23(API 라우트 실제 호출), B20 정렬·총건수 비교, B27 화면. 로컬 DB가 0079 이전이라 서버 부팅 시 밀린 마이그레이션 전부가 돌고 예약 작업 위험이 있어 보류
- 2026-10-13 do: 로컬 앱(:3100) 검증 — 0080 로컬 적용·재부팅 무재적용, API 8종 SQL 대조 일치(B16~B23), 화면 3종 캡처(B27). 로컬 DB는 0080까지 올라감(백업: scratchpad/local-salesflow-before-0080.dump). 임시 DB 삭제, 서버 종료. ego-browser 작업 공간 121 finish가 응답 없이 멈춤 — 열린 채 남음. behaviors 28/28
- 2026-10-13 review: REVIEW.md — 버그·보안 0, 확인 필요 2(공개 경로 잠금 대기 수용·감시, 배포 후 백필 재실행 체크리스트). 커밋 진행
- 2026-10-13 commit 6cdb0ac (main, 푸시 안 함). 남은 것: 운영 배포(사용자 요청 시) + 배포 후 0080 UPDATE 재실행, /gap·REPORT
- 2026-10-13 push: 6cdb0ac → origin/main. 배포는 사용자가 실행
- 2026-10-13 운영 확인(읽기 전용): 0080 적용(1행), 판정 ua 15150·human 8922·burst 8797·early 2501. 배포 틈 미판정 0건(ua·early·burst 조건 모두 0) → UPDATE 재실행 불필요. 추적 도메인 봇 비율 59.6% = 분석치. 배포 후 신규 클릭은 아직 없음(최신 05:39 UTC)
- 2026-10-13 운영 실측(ego-browser·curl, 본인 테스트 발송 61013·59155): 브라우저 방문+메뉴 클릭 → 사람·CLICK 이벤트·hasSiteAction 아이콘, curl → ua, 0.3초 안 3연속 → burst. 운영 화면 캡처로 확인
- 2026-10-13 gap: 1회차 unproven 27(전부 evidence 서식) → evidence/ 이전·러너 줄 인용으로 보완, verify-evidence unresolved 0·uncited 0. GAP.md 작성
- 2026-10-13 report: REPORT.md 작성, docs/archive/2026-10/로 이동
