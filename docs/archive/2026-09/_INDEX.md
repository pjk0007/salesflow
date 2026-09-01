# Archive Index - 2026-09

| Feature | Behaviors | Archived | Documents |
|---------|:---------:|----------|-----------|
| partition-member-permissions | 22/22 | 2026-09-01 | [Plan](partition-member-permissions/PLAN.md), [Design](partition-member-permissions/DESIGN.md), [Gap](partition-member-permissions/GAP.md), [Review](partition-member-permissions/REVIEW.md), [Report](partition-member-permissions/REPORT.md), [Progress](partition-member-permissions/PROGRESS.md) |
| token-version-revocation | 13/13 | 2026-09-01 | [Plan](token-version-revocation/PLAN.md), [Design](token-version-revocation/DESIGN.md), [Gap](token-version-revocation/GAP.md), [Review](token-version-revocation/REVIEW.md), [Report](token-version-revocation/REPORT.md), [Progress](token-version-revocation/PROGRESS.md) |
| mcp-tracker-tools | 15/15 | 2026-09-01 | [Plan](mcp-tracker-tools/PLAN.md), [Design](mcp-tracker-tools/DESIGN.md), [Gap](mcp-tracker-tools/GAP.md), [Review](mcp-tracker-tools/REVIEW.md), [Report](mcp-tracker-tools/REPORT.md), [Progress](mcp-tracker-tools/PROGRESS.md) |

## 비고

**partition-member-permissions** — 조직 member에게 워크스페이스/폴더/파티션 단위 권한을 부여한다. allow 기본(권한 행이 없으면 기존대로 전체 허용), 구조 변경만 예외.

Gap 2회차가 커밋 직전에 결함 2건을 잡아 수정했다 — (1) 구조 변경에 allow 기본이 번져 권한 0건 상태에서 member가 파티션을 삭제할 수 있었다 (2) folderId 무검증으로 자기 권한 상승이 가능했다.

**후속 대상**(REPORT 참조): 우회 경로 5건(bulk-delete, records/[id] 형제 경로, email·alimtalk send의 org 미검증, sse, auto-enrich), role 변경의 즉시 반영(JWT 30일 문제 — tokenVersion 방식으로 처리 예정).

**token-version-revocation** — role이 JWT에 구워져 있고 토큰 수명이 30일이라 admin→member 강등 후에도 최대 30일간 옛 권한이 유지되던 문제. organization_members.token_version으로 관리자 경로에서 즉시 무효화한다.

Gap이 커밋 직전에 결함 2건을 잡았다 — (1) users/[id]가 role을 바꾸면서 tokenVersion을 올리지 않아 그 경로로는 무효화가 안 됐다 (2) `role !== "owner" && role !== "admin"` 표기의 게이트 7곳이 조사에서 빠졌고, 그중 api-tokens는 강등된 admin이 조직 전체 스코프 토큰을 발급해 무효화를 영구 우회할 수 있는 경로였다.

**후속**: 데이터 축(파티션 17파일 + 일반 관리 27파일)은 여전히 지연 반영된다. requirePartitionAccess가 이미 async이므로 거기서 DB role을 읽는 것이 diff 대비 효과 1순위.

**mcp-tracker-tools** — MCP에 트래커 툴 7개 추가(퍼널 전환·이탈, 방문 분석, 리드 여정). 집계는 웹 route에서 추출해 공유하고, 권한은 토큰 스코프를 워크스페이스로 해석한다.

발단 질문("구독신청 과정 어디서 이탈해?")의 답: 방문 3,405명 중 3,365명(98.8%)이 첫 단계에서 이탈. 일단 시작하면 90%씩 진행되므로 병목은 진입이다.

Gap·Review가 결함 3건을 잡았다 — (1) previousRange를 "추출"이라 적었지만 실은 새로 작성한 것이라 웹과 직전 기간이 하루 달랐다 (2) DESIGN이 지시한 값 기반 grep을 실행하지 않아 overview:52의 인라인 날짜 계산을 놓쳤다 (3) get_record_journey가 merge 기본값 때문에 파티션 경계를 넘었다.

**후속**: leads 정의 불일치(funnel은 visitor_record_links까지, overview는 record_id만) 통일이 1순위.
