# Design: dashboard-scope (대시보드 데이터 범위 설정)

> Plan 참조: `docs/01-plan/features/dashboard-scope.plan.md`

## 1. 데이터 모델

### 1.1 dashboards 테이블 변경

**파일**: `src/lib/db/schema.ts` (L652-670)

```typescript
// 기존 컬럼들 사이에 추가 (description 뒤, globalFilters 앞)
partitionIds: jsonb("partition_ids").$type<number[]>(),
```

- **타입**: `jsonb`, nullable
- **null**: 전체 워크스페이스 파티션 (기존 동작 유지)
- **number[]**: 지정된 파티션 ID만 집계
- 폴더 ID는 별도 저장하지 않음 — 폴더 선택 시 하위 파티션 ID 배열로 변환 저장

### 1.2 마이그레이션

**파일**: `drizzle/0006_dashboard_partition_ids.sql`

```sql
ALTER TABLE "dashboards" ADD COLUMN IF NOT EXISTS "partition_ids" jsonb;
```

- `IF NOT EXISTS`로 멱등성 보장
- 기존 행은 null (전체 범위) 유지

## 2. API 설계

### 2.1 POST /api/dashboards (생성)

**파일**: `src/pages/api/dashboards/index.ts`

**Request body 변경**:
```typescript
const { name, workspaceId, description, partitionIds } = req.body;
```

**Insert values 변경**:
```typescript
partitionIds: Array.isArray(partitionIds) ? partitionIds : null,
```

### 2.2 PUT /api/dashboards/[id] (수정)

**파일**: `src/pages/api/dashboards/[id].ts` (L61, L83)

**Request body 변경**:
```typescript
const { name, description, globalFilters, refreshInterval, isPublic, partitionIds } = req.body;
```

**Update set 변경**:
```typescript
...(partitionIds !== undefined && { partitionIds: Array.isArray(partitionIds) ? partitionIds : null }),
```

- `undefined` 체크로 명시적 전달 시만 업데이트
- 빈 배열 → null로 변환하지 않음 (UI에서 처리)

### 2.3 GET /api/dashboards/[id]/data (데이터 집계)

**파일**: `src/pages/api/dashboards/[id]/data.ts` (L45-55)

**기존 로직** (전체 파티션):
```typescript
const partitionRows = await db
    .select({ id: partitions.id })
    .from(partitions)
    .where(eq(partitions.workspaceId, dashboard.workspaceId));
partitionIds = partitionRows.map((p) => p.id);
```

**변경 로직** (조건부 범위):
```typescript
let partitionIds: number[];
if (dashboard.partitionIds && Array.isArray(dashboard.partitionIds) && dashboard.partitionIds.length > 0) {
    partitionIds = dashboard.partitionIds;
} else {
    // 기존 동작: 전체 워크스페이스 파티션
    const partitionRows = await db
        .select({ id: partitions.id })
        .from(partitions)
        .where(eq(partitions.workspaceId, dashboard.workspaceId));
    partitionIds = partitionRows.map((p) => p.id);
}
```

- `Array.isArray` 방어 체크 (jsonb 파싱 안전성)
- 빈 배열도 전체로 폴백

## 3. UI 설계

### 3.1 데이터 범위 Popover

**파일**: `src/pages/dashboards.tsx`

**위치**: 대시보드 Toolbar (편집/공개/링크 버튼 옆)

**구조**:
```
[Filter 아이콘] 데이터 범위: {scopeLabel}
  └─ Popover (w-64, max-h-80, overflow-y-auto)
     ├─ [x] 전체
     ├─ [ ] 폴더A (indeterminate 지원)
     │   ├─ [ ] 파티션1
     │   └─ [ ] 파티션2
     ├─ [ ] 폴더B
     │   └─ [ ] 파티션3
     └─ 미분류 파티션
         └─ [ ] 파티션4
```

**scopeLabel 로직**:
```typescript
const scopeIds = selectedDashboard?.partitionIds as number[] | null;
const scopeLabel = !scopeIds || scopeIds.length === 0
    ? "전체"
    : `${scopeIds.length}개 파티션`;
```

### 3.2 체크박스 동작

#### 전체 체크 (`handleScopeAll`)
```typescript
await updateDashboard(id, { partitionIds: null });
mutateData();
```

#### 개별 파티션 체크/해제 (`handleScopeChange`)
```typescript
const current = (dashboard.partitionIds as number[] | null) || [];
let next: number[];
if (checked) {
    next = [...current, partitionId];
} else {
    next = current.filter((id) => id !== partitionId);
}
await updateDashboard(id, { partitionIds: next.length > 0 ? next : null });
mutateData();
```
- 빈 배열 → null (전체로 복귀)

#### 폴더 체크/해제 (`handleScopeFolder`)
```typescript
const current = (dashboard.partitionIds as number[] | null) || [];
let next: number[];
if (checked) {
    next = [...new Set([...current, ...folderPartitionIds])];
} else {
    const removeSet = new Set(folderPartitionIds);
    next = current.filter((id) => !removeSet.has(id));
}
await updateDashboard(id, { partitionIds: next.length > 0 ? next : null });
mutateData();
```
- `Set`으로 중복 방지
- 폴더 해제 시 하위 파티션 일괄 제거

#### 폴더 indeterminate 상태
```typescript
const folderPIds = folder.partitions.map((p) => p.id);
const allChecked = scopeIds ? folderPIds.every((id) => scopeIds.includes(id)) : false;
const someChecked = scopeIds ? folderPIds.some((id) => scopeIds.includes(id)) : false;
// checked={allChecked ? true : someChecked ? "indeterminate" : false}
```

### 3.3 데이터 갱신

범위 변경 후 `mutateData()` 호출로 SWR 캐시 무효화 → 위젯 데이터 자동 재조회

### 3.4 추가 Import

```typescript
import { usePartitions } from "@/hooks/usePartitions";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { Filter } from "lucide-react";
```

### 3.5 Hook 사용

```typescript
const { partitionTree } = usePartitions(workspaceId);
```

- `partitionTree.folders`: `(Folder & { partitions: Partition[] })[]`
- `partitionTree.ungrouped`: `Partition[]`

## 4. 구현 순서

| # | 파일 | 검증 |
|---|------|------|
| 1 | `src/lib/db/schema.ts` — partitionIds 컬럼 | 타입 체크 |
| 2 | `drizzle/0006_dashboard_partition_ids.sql` | drizzle-kit push |
| 3 | `src/pages/api/dashboards/index.ts` — POST partitionIds | 타입 체크 |
| 4 | `src/pages/api/dashboards/[id].ts` — PUT partitionIds | 타입 체크 |
| 5 | `src/pages/api/dashboards/[id]/data.ts` — 범위 필터링 | 타입 체크 |
| 6 | `src/pages/dashboards.tsx` — Popover UI + handlers | pnpm build |
