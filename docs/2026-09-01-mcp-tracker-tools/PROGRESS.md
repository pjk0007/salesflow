# PROGRESS — docs/2026-09-01-mcp-tracker-tools/

- 2026-09-01 plan: PLAN.md + behaviors.json 작성, 승인 대기
- 2026-09-01 plan: 발단은 사용자 질문 — MCP에 회사·도메인별 행동 지표가 있는지. 확인 결과 MCP 툴 10개는 전부 레코드·발송로그·기본 집계뿐이고 트래커 축이 통째로 빠져 있었다. 실제 DB에는 "구독신청 과정"·"구독 전환"·"구독 전환 흐름" 퍼널이 있고 이벤트 4만건 이상
- 2026-09-01 plan: 범위는 사용자 결정으로 **퍼널 + 방문 분석 7개 툴**. 퍼널만으로는 "어디서 이탈"까지만 알고 "왜"를 못 본다는 판단
- 2026-09-01 plan: 퍼널·도메인이 추가돼도 코드 수정이 필요 없는 구조(목록 조회형 툴)로 간다는 것을 제약으로 명시
- 2026-09-01 plan: 집계 로직은 이미 src/lib/tracker/에 일부 분리돼 있으나 route 안에 남은 부분이 상당하다(funnel 162줄, overview 588줄, journey 335줄). **이번 작업의 실제 비용은 MCP 툴이 아니라 route에서 로직 추출**이고, 웹 route와 공유하므로 회귀가 최대 리스크
- 2026-09-01 plan: 권한 축 결정 — 트래커는 도메인 단위라 파티션과 축이 안 맞지만 tracker_sites.workspaceId가 있어 **워크스페이스 기준으로 매핑**한다. folder/partition 스코프는 상위 워크스페이스로 타고 올라간다(사용자 결정). 파티션은 워크스페이스 안에서 데이터를 세부 관리하는 단위이고 트래커 데이터는 그 리드들이 만든 것이라 일관된다. 실사용은 대부분 org 스코프. B13 추가
- 2026-09-01 design: PLAN 승인됨. DESIGN 단계 착수
- 2026-09-01 design: DESIGN.md 작성. 핵심 결정 — (1) overview 588줄 중 aggregateRange만 추출(13갈래 Promise.all은 검증 불가라 기각) (2) 커밋을 추출/스코프/MCP 3개로 물리 분리해 회귀 원인을 분리 (3) 추출은 mechanical move — 본문 한 글자도 안 고친다
- 2026-09-01 design: 실측 검증 — tracker_sites가 워크스페이스당 1개(unique 제약), rangeBounds 4곳 중복, leads 정의가 funnel/overview에서 불일치(funnel은 visitor_record_links까지 셈)
- 2026-09-01 design: DESIGN 승인됨. 커밋 1(추출) 착수
- 2026-09-01 do(커밋1): 로직 추출 완료 — date-range/sql-filters/funnel-context/analytics-queries/journey 5개 신설. route 크기 funnel 162→55, overview 589→473, pages 56→34, journey 335→43
- 2026-09-01 do(커밋1): **B10 완전 통과** — 추출 전후 웹 API 응답 14건 전부 바이트 단위 동일(jq -S 대조). 기간은 2026-05-18~06-29 고정 구간을 써서 새 이벤트 유입 위양성을 배제, journey의 daysSince는 Date.now() 의존이라 제외
- 2026-09-01 do(커밋1): notExcludedExpr은 funnel/overview에서 표현이 달라(인라인 정규식 vs PATH_EXPR) 합치지 않았다 — mechanical move 범위를 벗어난다. engagement/ad-performance의 rangeBounds 중복 2건도 손대지 않음
- 2026-09-01 do(커밋2): 스코프→워크스페이스 해석기 TDD. site-access-rules.ts 21케이스 RED 확인 후 구현. "전체"를 null이 아니라 판별 유니온으로 표현해 빈 목록과 falsy로 뭉개지지 않게 함
- 2026-09-01 do(커밋3): MCP 툴 7개 + tracker-format(순수 17케이스) + types.ts 분리. tools.ts는 import 1줄 + 전개 2곳만 수정
- 2026-09-01 do: **behaviors 13/13 통과.** 테스트 169개 GREEN, tsc 클린, next build ✓
- 2026-09-01 do: 실증 하이라이트 — "구독신청 과정" 퍼널에서 방문 3405명 중 3365명(98.8%)이 첫 단계에서 이탈. 일단 시작하면 92%씩 진행되므로 문제는 진입이다. 이게 PLAN의 발단 질문에 대한 답
