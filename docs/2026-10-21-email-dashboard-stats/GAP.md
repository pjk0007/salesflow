# GAP — docs/2026-10-21-email-dashboard-stats/

- 2026-10-21 · 판정: **unproven 0** (2차) · 통과 30/31 · B19는 운영 반영 뒤 측정이라 passes:false(의도)

## 1차 (gap-detector) — unproven 2
- B16: evidence 이미지에 30분 경고가 없었다(콘솔에서만 확인). "집계 준비 중" 안내는 테스트·화면 모두 없었다.
- B31: member 403이 어디서도 실행되지 않았다.
- 부분: B15(교차 조직 400 자동 테스트 없음), B17(블록 상한 논증으로 대신, pg_stat_statements 요청별 측정 아님), U10 fixture 미저장.
- 설계 편차: 워터마크 0 시드(records 색인 미준비 첫 회차), 수동 갱신이 state를 먼저 만들 수 있음, 비교표 "이름" 머리글·추세 라벨 겹침.
- target 정정: B3(attribution.ts), B15(route.ts).
- DESIGN 결정 D1~D15, 7-2(15분), 7-8(수동 갱신), 9-2(단계 0·records 계약 1~4), 15절 단위는 모두 코드에 반영.

## 보완 (Codex 수정 묶음 + Claude 재검증)
- DESIGN 9-2 계약 5: 워터마크는 state 생성 때 늘 max(id). `read.db.test.ts` RED(0 대 21, 0 대 7) → GREEN. 수동 갱신도 ensureState 경유.
- `routes.db.test.ts`: refresh POST 401·member 403, email-stats GET 다른 조직 workspaceId 400.
- `models.test.ts`: coverage 부분 안내 경계.
- 화면: `ui-stale-partial.png`("집계가 멈춰 있습니다(마지막 15:50)", "2026-09-01 이전 날짜는 집계 준비 중입니다…"), `ui-trend-fixed.png`(준비 안 된 날 띠), `ui-compare-fixed.png`(이름 왼쪽).
- 재실행: QA 74/74, 전체 1584 중 실패 1(channel-source-export 시간 제한, 단독 12/12), tsc 0, eslint 84파일 0.

## 2차 — verify-evidence
- unresolved 0 · uncited 0 · no-cmd-match 0 · no-receipt 0 · dead-branch 0

## 남은 것
- B19: 2차 반영 뒤 ego-browser로 운영 /email 첫 KPI 2초 확인.
- B17: 요청별 블록 실측 대신 "집계 표 전체 50블록" 상한 논증(b17-blocks.txt). 운영 표 크기로 반영 뒤 재확인.
- 30만 건 성능 fixture는 send-log-search 사이클의 fixture(30만 행, 단일 조직·캠페인 없음)를 재사용했다. 설계 14절의 40만·3조직 fixture는 만들지 않았다.
- B6·B27 desc의 "5분" 문구는 분모 고정 원칙상 그대로 둔다(실제 15분).
