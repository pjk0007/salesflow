# PROGRESS — docs/2026-10-16-template-link-sender/

- 2026-10-16 plan: PLAN.md + behaviors.json 작성, 승인 대기
- 2026-10-16 plan 승인: Q1=(a) 수동 연결은 안내만, Q2=(a) 반복 회차마다 묶음에서 선택. 마커 2건 답으로 교체. track Full → design 진행
- 2026-10-16 design: DESIGN.md 작성(D1 연결 단위 막힘, D2 showBulkScheduleNotice, D3 effect 없는 훅+template-links 조각, D4 templateClaimOptions 순수 함수). 승인 대기
- 2026-10-16 design 승인(사용자 "일단 이거 한 다음에"), O1~O3 기본안. do: 기존 Codex 탭(term_33f3f7b4)에 위임. Codex가 0.163.0으로 업데이트됨(건너뛰기 입력이 업데이트로 처리된 실수)
- 2026-10-16 do: Codex C1~C6 완료(test 1050, tsc 0, eslint 0). Claude가 로컬 DB + 실제 NHN으로 사용자 본인 주소(+별칭) 7통 발송 시험 — B11·B13·B14·B16·B17·B18 통과, Gmail INBOX 수신 확인. 시험 데이터 삭제, 프로필 6 정지 해제. 27/27
