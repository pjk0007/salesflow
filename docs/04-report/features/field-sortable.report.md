# Completion Report: field-sortable (속성별 정렬 가능 스위치)

> Date: 2026-03-26 | Match Rate: 100% | Status: Completed

## PDCA Cycle Summary

```
[Plan] ✅ → [Design] ✅ → [Do] ✅ → [Check] ✅ (100%) → [Report] ✅
```

## 1. Feature Overview

워크스페이스 속성 관리 다이얼로그에 "정렬 가능" 스위치를 추가하여, 해당 스위치가 켜진 필드만 레코드 테이블에서 컬럼 헤더 클릭으로 소팅이 가능하도록 구현.

## 2. Deliverables

### 2.1 DB Layer
| File | Change |
|------|--------|
| `src/lib/db/schema.ts` | `isSortable` integer 컬럼 추가 |
| `drizzle/0028_field_sortable.sql` | idempotent 마이그레이션 |

### 2.2 Type Layer
| File | Change |
|------|--------|
| `src/types/index.ts` | `FieldDefinition.isSortable`, `UpdateFieldInput.isSortable` 추가 |

### 2.3 API Layer
| File | Change |
|------|--------|
| `src/app/api/fields/[id]/route.ts` | PATCH에서 isSortable 업데이트 지원 |
| `src/app/api/partitions/[id]/records/route.ts` | JSONB 필드타입별 캐스팅 정렬 |
| `src/app/api/partitions/[id]/records/export/route.ts` | 동일 캐스팅 정렬 |
| `src/app/api/v1/records/route.ts` | 외부 API 동일 캐스팅 정렬 |

### 2.4 UI Layer
| File | Change |
|------|--------|
| `src/components/settings/EditFieldDialog.tsx` | Switch 컴포넌트로 "정렬 가능" 토글 추가 |
| `src/components/records/RecordTable.tsx` | 조건부 정렬 아이콘/클릭 + displayFields 순서 로직 개선 |
| `src/components/settings/FieldManagementTab.tsx` | "정렬" 컬럼 표시 + @dnd-kit 드래그앤드롭 순서 변경 |

## 3. Additional Improvements (Design 범위 초과)

| Feature | Description | Impact |
|---------|-------------|--------|
| JSONB 타입별 캐스팅 | number/currency→`::numeric`, date/datetime→`::timestamptz` | 정렬 정확도 향상 |
| DnD 필드 순서 변경 | ChevronUp/Down → GripVertical 드래그 핸들 | UX 대폭 개선 |
| displayFields 순서 | visibleFieldKeys 배열순 → fields sortOrder 순 | 설정 변경 즉시 반영 |

## 4. Bug Fixes During Implementation

| Issue | Cause | Fix |
|-------|-------|-----|
| 헤더에 "0" 표시 | `{0 && jsx}` → React가 0 렌더링 | `!!field.isSortable` 으로 boolean 변환 |
| 날짜 정렬 부정확 | JSONB 값을 문자열로 비교 | fieldType 조회 후 `::timestamptz` 캐스팅 |
| 드래그 순서 미반영 | displayFields가 visibleFieldKeys 배열순 | fields(sortOrder 기준) 필터링으로 변경 |

## 5. Quality Metrics

| Metric | Value |
|--------|-------|
| Match Rate | 100% (24/24) |
| TypeScript Errors | 0 |
| Files Changed | 11 |
| Files Created | 2 (migration, analysis) |
| Iteration Count | 0 (first pass 100%) |
