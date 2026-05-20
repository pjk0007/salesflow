# Completion Report: field-history-tracking (필드 변경 이력 추적)

> Date: 2026-05-20 | Match Rate: 100% | Status: Completed

## PDCA Cycle Summary

```
[Plan] ✅ → [Design] ✅ → [Do] ✅ → [Check] ✅ (100%) → [Report] ✅
```

## 1. Feature Overview

sendb UI에서 사용자가 record의 필드를 직접 변경할 때, 그 변경을 record_events에 자동으로 이력으로 남기는 기능.
필드 정의에 "변경 이력 추적" 토글(track_history)을 추가해 사용자가 의미 있는 필드만 선택해서 추적한다.
기존에는 외부(디하) 이벤트만 record_events에 쌓였으나, 이번 기능으로 sendb UI 직접 변경도 통합되어
"고객 여정 인텔리전스"의 데이터 소스가 완성됐다.

## 2. Deliverables

### 2.1 DB Layer

| File | Change |
|------|--------|
| `drizzle/0049_field_track_history.sql` | `field_definitions`에 `track_history integer DEFAULT 0 NOT NULL` 추가 |
| `drizzle/meta/_journal.json` | idx 49 (`0049_field_track_history`) 등록 |
| `src/lib/db/schema.ts` | `fieldDefinitions`에 `trackHistory: integer("track_history").default(0).notNull()` 추가 |

### 2.2 Types

| File | Change |
|------|--------|
| `src/types/index.ts` | `FieldDefinition.trackHistory: boolean` |
| `src/types/index.ts` | `CreateFieldInput.trackHistory?: boolean` |
| `src/types/index.ts` | `UpdateFieldInput.trackHistory?: boolean` |

### 2.3 API Layer

| File | Method | Change |
|------|--------|--------|
| `src/app/api/field-types/[id]/fields/route.ts` | POST | `trackHistory` 파라미터 수신, 커스텀 select 필드만 1 저장 (시스템 필드 0) |
| `src/app/api/fields/[id]/route.ts` | PATCH | `trackHistory` 값 갱신 (`typeof === "boolean"` 조건) |
| `src/app/api/records/[id]/route.ts` | PATCH | 추적 필드 diff 감지 → `insertRecordEvent` 트랜잭션 내 호출 |

**records PATCH 핵심 로직:**
1. partition 조회 → `resolvedTypeId = partition.fieldTypeId ?? ws.defaultFieldTypeId` (D-Q2 폴백)
2. `field_definitions WHERE track_history=1` 로 추적 필드 목록
3. before/after diff: `key in sanitized`, `toVal !== fromVal`, `toVal !== undefined` 조건
4. 이벤트 형태: `{ type: field.key, label: String(toVal), meta: { field, from, to, by: user.userId } }`
5. `db.transaction`으로 record UPDATE + 이벤트 INSERT 원자적 처리 (D-Q1)

### 2.4 UI

| File | Change |
|------|--------|
| `src/components/settings/CreateFieldDialog.tsx` | `fieldType === "select"`일 때만 "변경 이력 추적" 체크박스 노출 (옵션 블록 하단), resetForm에 `setTrackHistory(false)` |
| `src/components/settings/EditFieldDialog.tsx` | `field.fieldType === "select"`일 때만 Switch 노출, `useEffect`에서 `!!field.trackHistory` 초기화 |

## 3. Design 의도 (Gap 아님)

| 항목 | 근거 |
|------|------|
| 토글을 select 타입에만 노출 | Design §4 D-UI: status/단계 등 추적 대상이 select 타입이므로 의도적 제한 |
| bulk 수정 미지원 | Plan §7.2: 단건 PATCH만, bulk는 향후 |
| 트랜잭션 처리 | Design §8 D-Q1: 원자적 처리 확정 사항 |

## 4. Gap 분석 결과

| 항목 | 결과 |
|------|------|
| Match Rate | 100% (17/17) |
| Gap | 없음 |
| Design 범위 초과 구현 | 없음 |

## 5. Quality Metrics

| Metric | Value |
|--------|-------|
| Match Rate | 100% (17/17) |
| TypeScript Errors | 0 (`tsc --noEmit` 통과) |
| Files Created | 2 (SQL, analysis) |
| Files Modified | 7 (journal, schema, types, API×3, UI×2) |
| Iteration Count | 0 (first pass 100%) |
| E2E 검증 | 완료 (record #159755 실 운영 복원본) |

## 6. E2E 검증 결과

- status 변경 → `record_events`에 `{type:'status', from:'신규', to:'연락중', by:userId}` 기록 확인
- 추적 안 켠 필드 변경 → 이력 없음 확인
- 같은 값 저장 → 이력 미생성 확인
- 트랜잭션 원자성 확인 (record UPDATE + event INSERT 동시 실패/성공)
- 백오피스랩 리드관리에서 record #159755에 consult + status 이벤트 시간순 통합 확인

## 7. Next Steps

- **여정 시각화**: record_events 데이터가 모이면 타임라인 UI (`RecordEventTimeline`) 구현
- **고객 여정 인텔리전스**: record_events + tracker_events + email_logs 통합 분석 별도 Plan
- **추적 필드 확장**: 현재 select 타입만. 향후 user_select(담당자) 등 타입 확장 검토
