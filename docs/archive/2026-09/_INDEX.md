# Archive Index - 2026-09

| Feature | Behaviors | Archived | Documents |
|---------|:---------:|----------|-----------|
| partition-member-permissions | 22/22 | 2026-09-01 | [Plan](partition-member-permissions/PLAN.md), [Design](partition-member-permissions/DESIGN.md), [Gap](partition-member-permissions/GAP.md), [Review](partition-member-permissions/REVIEW.md), [Report](partition-member-permissions/REPORT.md), [Progress](partition-member-permissions/PROGRESS.md) |

## 비고

**partition-member-permissions** — 조직 member에게 워크스페이스/폴더/파티션 단위 권한을 부여한다. allow 기본(권한 행이 없으면 기존대로 전체 허용), 구조 변경만 예외.

Gap 2회차가 커밋 직전에 결함 2건을 잡아 수정했다 — (1) 구조 변경에 allow 기본이 번져 권한 0건 상태에서 member가 파티션을 삭제할 수 있었다 (2) folderId 무검증으로 자기 권한 상승이 가능했다.

**후속 대상**(REPORT 참조): 우회 경로 5건(bulk-delete, records/[id] 형제 경로, email·alimtalk send의 org 미검증, sse, auto-enrich), role 변경의 즉시 반영(JWT 30일 문제 — tokenVersion 방식으로 처리 예정).
