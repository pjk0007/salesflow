# PROGRESS — docs/2026-10-16-template-link-sender/

- 2026-10-16 plan: PLAN.md + behaviors.json 작성, 승인 대기
- 2026-10-16 plan 승인: Q1=(a) 수동 연결은 안내만, Q2=(a) 반복 회차마다 묶음에서 선택. 마커 2건 답으로 교체. track Full → design 진행
- 2026-10-16 design: DESIGN.md 작성(D1 연결 단위 막힘, D2 showBulkScheduleNotice, D3 effect 없는 훅+template-links 조각, D4 templateClaimOptions 순수 함수). 승인 대기
- 2026-10-16 design 승인(사용자 "일단 이거 한 다음에"), O1~O3 기본안. do: 기존 Codex 탭(term_33f3f7b4)에 위임. Codex가 0.163.0으로 업데이트됨(건너뛰기 입력이 업데이트로 처리된 실수)
- 2026-10-16 do: Codex C1~C6 완료(test 1050, tsc 0, eslint 0). Claude가 로컬 DB + 실제 NHN으로 사용자 본인 주소(+별칭) 7통 발송 시험 — B11·B13·B14·B16·B17·B18 통과, Gmail INBOX 수신 확인. 시험 데이터 삭제, 프로필 6 정지 해제. 27/27
- 2026-10-16 추가 요청: 발신 프로필 158개 — SenderPoolField에 검색+높이 고정(max-h-96 스크롤). 고른 항목은 늘 위, 검색 중 전체 선택은 검색 결과만. filterSenderProfiles 순수 함수(utils/senderPool.ts)+테스트, 검색 상태는 hooks/useSenderPoolSearch.ts. Codex 위임
- 2026-10-16 검색·높이 고정: Codex 구현, Claude 브라우저 확인(빈 DB salesflow_ui + 프로필 20개)에서 결과 전부 선택 시 "결과 없음" 오표시 발견→수정. test 1060, tsc·eslint 0. 시험 서버·DB 정리
- 2026-10-17 운영 확인: 배포 후 운영에서 시험 파티션 88·연결 19(묶음 [6]) → 레코드 등록 → cs@dihi.kr 발송·Gmail 수신, 편집 화면 복원 확인. 시험 데이터 삭제
- 2026-10-20 gap 1차: unproven 6(B11·13·14·16·17·18 evidence ref가 scratchpad라 unresolved) → 시험 스크립트를 evidence/sender-test.ts로 옮기고 ref 수정. O2 힌트는 페이지가 아니라 TemplateLinkSenderCard 수동 안내 두 번째 줄로 구현됨(브라우저 확인). 검색 기능(0931152)을 B28~B31로 소급 추가(분모 27→31). ui-fixture.ts의 하드코딩 비밀번호를 FIXTURE_PASSWORD 환경 변수로 바꿈
- 2026-10-20 review 1회차: 🔴0 🟡2(자동 멈춤·알림이 템플릿 연결 묶음을 모름 / 검색 중 고른 줄 미필터) 🟢4. REVIEW.md
- 2026-10-20 gap 2차: unproven 0 통과(31: ✅28 ⚠️3). ⚠️3은 evidence 문구 정리로 처리. GAP.md
