# PROGRESS — docs/2026-10-20-email-open-pixel/

- 2026-10-20 plan: PLAN.md + behaviors.json(33) 작성, 승인 대기. 질문 3건(Q1 도입 전 발송 구분, Q2 서명 키, Q3 실제 메일함). pdca-state는 이전 사이클(template-link-sender)을 닫은 뒤 이 사이클로 옮긴다
- 2026-10-21 plan 승인: Q1=A(open_tracked 칸), Q2=A(JWT_SECRET 파생), Q3=ghty6323@gmail.com Gmail. 마커 3건 답으로 교체. track Full → design 진행
- 2026-10-21 design: DESIGN.md 작성(architect). PLAN과 다른 점: 저장 상한 사람20·기계10 분리, templates는 기존 LEFT JOIN 유지+FILTER, 오픈율 분모에 status='sent', 픽셀은 본문 맨 앞. O1~O4 기본안. 승인 대기
- 2026-10-21 design 승인(사용자 "네"), O1~O4 기본안. do: 기존 Codex 탭에 C1~C9 위임
- 2026-10-21 do: Codex C1~C9 완료(test 1098, tsc 0, 변경 46파일 eslint 0). C8 보고 전송이 승인 검토에서 13분 멈춰 Claude가 끊고 C9 지시. Claude 로컬 검증: 빈 DB salesflow_open 부팅(0089 적용), 17-1 filenode 그대로, 17-2 curl R1~R21 통과(서버 막 뜬 직후 연속 요청 2건이 동시 상한 4로 버려짐 관찰 — 데워진 뒤 6건 모두 기록), 17-3 summary·trends·templates·email-daily 기대값 일치(50%, 3/6), 17-5 행 API 일치, 17-6 ego-browser 대시보드·발송 이력·/logs·홈 확인. 시험 DB·서버·브라우저 정리. 33/33
- 2026-10-21 gap 1차: unproven 4(B7 문구·B17 부팅 증거·B26 격리/페이지·B27 실행 흔적), 성능 관문 9-9 미측정. review 1회차: 🔴0 🟡2(동시 상한 초과 무로그 버림, route 빈 catch) 🟢6. GAP.md·REVIEW.md
- 2026-10-21 9-9 성능 관문: 30만 발송 fixture(evidence/9-9-*) EXISTS 방식 trends +382ms로 기준 초과, summary +292ms. DESIGN 9-2를 F1B(조직·기간 IN 하위 질의)로 바꾸고 0089에 색인 2개((org_id, opened_at), email_click_logs (org_id, clicked_at)) 추가 — summary 50ms·trends 147ms·templates 70ms(변경 전보다 빠름). 운영 읽기 조회: 클릭 35,881행, 최대 조직 90일 발송 157,670
- 2026-10-21 Codex 질문: Drizzle이 같은 매개변수를 $1·$2로 재사용하지 않음 → DESIGN 9-2를 params 4개([orgId, since, orgId, since])로 고치고 답함
- 2026-10-21 보완: Codex 리뷰 🟡2 반영(동시 상한 버림 60초 누계 경고, route catch 로그)+🟢 정리, F1B 쿼리·색인 2개. Claude 2차 검증: 빈 DB 부팅·재부팅(0089 1행), R1~R6 데운 서버 재측정(org_id·opened_at 포함), 집계 4종 F1B로 같은 값, 행 API 페이지·조직 격리, MCP 직접 호출, email-daily F1B 1853ms(전 3923). 화면 재캡처는 ego-browser 스크립트가 시작 단계에서 멈춰 건너뜀(화면 변경은 import·들여쓰기뿐, tsc·eslint 통과). test 1103, tsc 0, eslint 0. 시험 DB 2개 삭제
- 2026-10-21 gap 2차: unproven 0 통과(33/33). 보완 권장 정리(cmd 실제 명령, B32 문구). F1B EXPLAIN 원문은 미보관. 다음: 커밋 확인 → 배포(사용자) → 17-7 운영 Gmail 확인 → REPORT
- 2026-10-21 커밋·푸시(사용자 "커밋 푸쉬 하고 배포하자"). 증거의 픽셀 서명 값은 가림. 다음: 사용자 배포 → 17-7 운영 Gmail 확인 → REPORT
- 2026-10-21 푸시 전 리베이스: 원격 main에 dev 병합(마이그레이션 0088~0119)이 먼저 올라와 0089가 겹침 → 0120_email_open_tracking(when 1792605600000, idx 121)으로 이름·시각 변경, 마이그레이션 테스트를 '가장 늦은 시각' 계약으로 수정. 운영은 0119(1792519200000)까지 적용 상태(읽기 조회). 빈 DB 전체 마이그레이션 2회 통과(122행, 색인 3개). 오픈 테스트 43/43, tsc 0. 전체 1525 중 19 실패는 원격에서 온 channel-source-export 테스트의 macOS /private/var 경로 문제(이 변경과 무관)
- 2026-10-21 17-7 운영 확인(배포 뒤): 0120 적용(122행), /api/track/open 200 GIF. CTO 계정으로 테스트 DB 워크스페이스에 시험 파티션 99·템플릿 2966·연결 26·레코드 410223 → 수동 발송 398273(open_tracked t, DB 본문 픽셀 0) → Gmail 원본 맨 앞 픽셀 1개 확인 → 36초 뒤 열람은 early(기계, GoogleImageProxy), 66·69초 뒤 재열람은 사람 2행 → unified API openCount 2 machine 1. 11:13:50 이후 AI 자동 56통 모두 open_tracked. 시험 데이터는 ego-browser DELETE가 멈춰 운영 DB에서 id 지정 삭제(트랜잭션). 남은 일: REPORT, 대시보드 느림(별건)
- 2026-10-21 report: REPORT.md 작성. 사이클 종료 → docs/archive/로 이동
