# Completion Report: visitor-record-rematch (방문자-레코드 양방향 자동 연결)

> Date: 2026-05-22 | Match Rate: 100% | Status: Completed

## PDCA Cycle Summary

```
[Plan] -> [Design] -> [Do] -> [Check] (100%) -> [Report]
```

## 1. Feature Overview

트래커 visitor가 `identify` 시점에 record가 없어 영구 익명으로 남는 근본 원인을 해결.
매칭을 **단방향(identify 시점 일회성)**에서 **양방향(record 생성/갱신 시 역매칭)**으로 전환.
- visitor가 식별자(`match_value`)를 보존 → record가 뒤늦게 생겨도 자동 연결
- 제품/필드명 하드코딩 없이 `site.matchField` 메커니즘으로 범용 적용

## 2. Deliverables

### 2.1 DB Layer
| File | Change |
|------|--------|
| `drizzle/0051_tracker_visitor_match_value.sql` | `match_value varchar(200)` 컬럼 + `(site_id, match_value)` 인덱스 |
| `drizzle/meta/_journal.json` | idx 51 등록 |
| `src/lib/db/schema.ts` | `trackerVisitors.matchValue` 컬럼 + 인덱스 추가 |

### 2.2 Identify Layer
| File | Change |
|------|--------|
| `src/app/api/tracker/identify/route.ts` | visitor update 시 `matchValue: user_id ?? visitor.matchValue` 저장 — 식별자 보존 |

### 2.3 Matching Layer
| File | Change |
|------|--------|
| `src/lib/tracker/match-record.ts` | `rematchVisitorsByRecord` 신규 추가 (visitorId 비의존, matchField→email, workspace 격리, phone 제외, 멱등) |

### 2.4 API Layer (fire-after-commit 호출 3곳)
| File | Trigger |
|------|---------|
| `src/app/api/v1/records/route.ts` | POST 신규 생성 후 / merge 후 |
| `src/app/api/v1/records/[id]/route.ts` | PUT 갱신 후 |
| `src/app/api/v1/records/[id]/events/route.ts` | 이벤트(signup 등) 수신 후 |

## 3. Matching Logic

```
rematchVisitorsByRecord({ orgId, workspaceId, recordId, data })
  1. workspace의 활성 tracker_sites 조회
  2. site별:
     - matchField 있고 data[matchField] 있음 → match_value 일치 + record_id IS NULL visitor 연결 (충돌 없음)
     - matchField 없거나 값 없음 → email 매칭, 단 workspace 내 그 email record가 1건일 때만 (2건 이상 스킵)
  3. tracker_visitors.record_id 갱신 + visitor_record_links 누적 (source: "record_rematch", onConflictDoNothing)
```

## 4. Edge Cases Verified (로컬 e2e)

| 케이스 | 결과 |
|--------|------|
| uuid 역매칭 (identify 41초 전, record 늦게 생성) | 자동 연결 |
| email 1:1 사이트 (matchField 없음) | 자동 연결 |
| email 중복 record (2건 이상) | 스킵 (오연결 방지) |
| 이미 record_id 있는 visitor | 비건드림 (isNull 조건) |
| 다른 workspace | workspace_id 조건으로 격리 |

## 5. Production Backfill

운영 적용 전 dry-run 결과: **미연결 visitor 중 email 매칭 record 0건** — 별도 backfill 불필요.
(기존 미연결 visitor들은 email을 보유한 record와 1:1 매칭되는 케이스 없음)

## 6. Quality Metrics

| Metric | Value |
|--------|-------|
| Match Rate | 100% (10/10) |
| TypeScript Errors | 0 |
| Files Changed | 7 |
| Iteration Count | 0 (first pass 100%) |
| External API Breaking Changes | 0 |
| Product-specific Hardcoding | 0 |
