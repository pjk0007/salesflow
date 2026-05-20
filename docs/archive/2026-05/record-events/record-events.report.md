# Completion Report: record-events (레코드 비즈니스 이벤트 시스템)

> Date: 2026-05-20 | Match Rate: 96% | Status: Completed

## PDCA Cycle Summary

```
[Plan] ✅ → [Design] ✅ → [Do] ✅ → [Check] ✅ (96%) → [Report] ✅
```

## 1. Feature Overview

레코드(리드/고객)에 일어난 비즈니스 이벤트(단계 변경 등)를 시간순으로 쌓는 범용 append-only 이벤트 시스템.
디하 서버의 매칭 단계 변화(신청완료/테스트/구독중/종료/역행)를 이력으로 기록하고, sendb UI에서 조회 가능.
"고객 여정 인텔리전스" 후속 Plan의 데이터 기반.

## 2. Deliverables

### 2.1 DB Layer (sendb)

| File | Change |
|------|--------|
| `drizzle/0046_record_events.sql` | record_events 테이블 생성 + 인덱스 2개 |
| `drizzle/meta/_journal.json` | idx 46 (`0046_record_events`) 등록 |
| `src/lib/db/schema.ts` | `recordEvents` pgTable + `RecordEvent` / `NewRecordEvent` 타입 |

**테이블 구조**: `id, org_id, record_id(FK→records CASCADE), type(50), label(100), occurred_at, meta(jsonb), created_at`
**인덱스**: `(record_id, occurred_at)` 시간순 조회, `(org_id, type)` 조직별 집계

### 2.2 API Layer (sendb)

| File | Method | 인증 | 용도 |
|------|--------|------|------|
| `src/app/api/v1/records/[id]/events/route.ts` | POST | 외부 API 토큰 + orgId 격리 | 이벤트 기록 (CORS) |
| `src/app/api/records/[id]/events/route.ts` | GET | 내부 세션 + orgId 격리 | UI 타임라인 조회 |

POST 검증: type(필수, ≤50자), label(필수, ≤100자), occurredAt(선택 ISO, 없으면 now()), meta(선택 object)

### 2.3 디하 Server 연동

| File | Change |
|------|--------|
| `src/util/sendb.ts` | `MATCH_STAGE_LABELS` 상수 + `appendRecordEvent` 헬퍼 추가 |
| `src/trigger/createProposal.ts` | `seek` 상태 → `match_stage / 신청완료` 이벤트 기록 |
| `src/trigger/createMatch.ts` | `test/proceed` 상태 → `match_stage / 테스트·구독중` 이벤트 기록 |
| `src/trigger/updateMatch.ts` | 상태 전이 → 이벤트 기록 (`meta.from`, `meta.to` 포함) |

기존 `updateSendbRecord`(현재값 갱신) 호출 유지 + `appendRecordEvent` 병행 → 현재 상태·이력 공존.

## 3. Gap 분석 결과

| 항목 | 결과 |
|------|------|
| Match Rate | 96% (22/23) |
| Gap G-1 | CORS Allow-Methods: `"POST, OPTIONS"` (Design: `"POST, GET, OPTIONS"`) — 실질 영향 없음 |
| Gap G-2 | UI 타임라인 컴포넌트 미구현 — Design §5에서 "우선순위 낮음" 명시, deployment phase 이후 |

## 4. Additional Improvements (Design 범위 초과)

| 항목 | 내용 | 효과 |
|------|------|------|
| `createProposal` meta.trigger | `meta: { trigger: 'createProposal' }` 추가 | 이벤트 출처 추적 가능 |
| GET API orgId 격리 쿼리 개선 | record 별도 조회 후 비교 → 쿼리 조건에 직접 포함 | DB 왕복 1회 절감 |

## 5. Quality Metrics

| Metric | Value |
|--------|-------|
| Match Rate | 96% (22/23) |
| TypeScript Errors (sendb) | 0 (`tsc --noEmit` 통과) |
| TypeScript Errors (디하 server) | 0 (`npm run build` 통과) |
| Files Created (sendb) | 4 (SQL, route×2, analysis) |
| Files Modified (sendb) | 2 (schema.ts, _journal.json) |
| Files Modified (디하 server) | 4 (sendb.ts, trigger×3) |
| Iteration Count | 0 (first pass 96%) |
| 운영 배포 | 미완료 (사용자 의도 — sendb 먼저, 디하 후속) |

## 6. Remaining / Next Steps

- **운영 배포**: sendb 배포 → 마이그레이션 자동 적용 → 디하 server 배포 순서 준수
- **UI 타임라인**: 운영 데이터 쌓인 후 `RecordEventTimeline` + `useRecordEvents` 구현 (Phase C)
- **백오피스랩 연동**: 디하 검증 후 `createLead`에 `type='consult'` 이벤트 추가
- **고객 여정 인텔리전스**: record_events + tracker_events + email_logs 통합 별도 Plan
