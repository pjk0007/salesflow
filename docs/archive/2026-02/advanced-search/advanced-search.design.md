# Design: advanced-search — 검색/필터링 강화

> **Plan 문서**: [advanced-search.plan.md](../../01-plan/features/advanced-search.plan.md)

## 1. 개요

필드별 필터 조건 빌더(FilterBuilder) + 컬럼 정렬 UI + API 필터 파라미터 확장.
기존 `sortField`/`sortOrder`는 API + 훅에 이미 구현 완료 → UI 연결만 필요.

## 2. 구현 순서

```
1. src/types/index.ts (수정) — FilterCondition 타입 추가
2. src/hooks/useRecords.ts (수정) — filters 파라미터 추가
3. src/pages/api/partitions/[id]/records.ts (수정) — filters 파싱 + JSONB SQL
4. src/components/records/FilterBuilder.tsx (신규) — 필터 조건 빌더 Popover
5. src/components/records/RecordToolbar.tsx (수정) — 필터 버튼 + FilterBuilder 통합
6. src/components/records/RecordTable.tsx (수정) — 헤더 정렬 클릭/아이콘
7. src/pages/records.tsx (수정) — filters/sort 상태 통합
```

## 3. 컴포넌트 설계

### 3.1 src/types/index.ts (수정)

**추가 위치**: `FieldDefinition` 인터페이스 아래 (line ~80 부근)

```typescript
// 필터 연산자
export type FilterOperator =
    | "contains" | "equals" | "not_equals"
    | "gt" | "gte" | "lt" | "lte"
    | "before" | "after" | "between"
    | "is_empty" | "is_not_empty"
    | "is_true" | "is_false";

// 필터 조건
export interface FilterCondition {
    field: string;
    operator: FilterOperator;
    value: string | number | boolean | null;
    valueTo?: string | number;  // between용
}
```

---

### 3.2 src/hooks/useRecords.ts (수정)

**변경 1**: `UseRecordsParams`에 `filters` 추가

```typescript
import type { FilterCondition } from "@/types";

interface UseRecordsParams {
    partitionId: number | null;
    page?: number;
    pageSize?: number;
    search?: string;
    distributionOrder?: number;
    sortField?: string;
    sortOrder?: "asc" | "desc";
    filters?: FilterCondition[];  // 추가
}
```

**변경 2**: `buildQueryString`에 filters 직렬화

```typescript
if (params.filters && params.filters.length > 0)
    qs.set("filters", JSON.stringify(params.filters));
```

**변경 범위**: import 1줄 + 인터페이스 1줄 + buildQueryString 2줄

---

### 3.3 src/pages/api/partitions/[id]/records.ts (수정)

**변경 1**: `handleGet`에서 filters 파라미터 파싱 (sortOrder 파싱 아래에)

```typescript
// filters 파싱
let filters: Array<{ field: string; operator: string; value: unknown; valueTo?: unknown }> = [];
if (req.query.filters) {
    try {
        filters = JSON.parse(req.query.filters as string);
    } catch { /* 무시 */ }
}
```

**변경 2**: WHERE 조건에 필터 추가 (distributionOrder 조건 아래에)

```typescript
for (const f of filters) {
    const key = f.field;
    const val = f.value;
    switch (f.operator) {
        case "contains":
            conditions.push(sql`${records.data}->>${key} ILIKE ${"%" + val + "%"}`);
            break;
        case "equals":
            conditions.push(sql`${records.data}->>${key} = ${String(val)}`);
            break;
        case "not_equals":
            conditions.push(sql`${records.data}->>${key} != ${String(val)}`);
            break;
        case "gt":
            conditions.push(sql`(${records.data}->>${key})::numeric > ${Number(val)}`);
            break;
        case "gte":
            conditions.push(sql`(${records.data}->>${key})::numeric >= ${Number(val)}`);
            break;
        case "lt":
            conditions.push(sql`(${records.data}->>${key})::numeric < ${Number(val)}`);
            break;
        case "lte":
            conditions.push(sql`(${records.data}->>${key})::numeric <= ${Number(val)}`);
            break;
        case "before":
            conditions.push(sql`(${records.data}->>${key})::date < ${String(val)}::date`);
            break;
        case "after":
            conditions.push(sql`(${records.data}->>${key})::date > ${String(val)}::date`);
            break;
        case "between":
            conditions.push(sql`(${records.data}->>${key})::date >= ${String(val)}::date`);
            conditions.push(sql`(${records.data}->>${key})::date <= ${String(f.valueTo)}::date`);
            break;
        case "is_empty":
            conditions.push(sql`(${records.data}->>${key} IS NULL OR ${records.data}->>${key} = '')`);
            break;
        case "is_not_empty":
            conditions.push(sql`(${records.data}->>${key} IS NOT NULL AND ${records.data}->>${key} != '')`);
            break;
        case "is_true":
            conditions.push(sql`(${records.data}->>${key})::boolean = true`);
            break;
        case "is_false":
            conditions.push(sql`(${records.data}->>${key} IS NULL OR (${records.data}->>${key})::boolean = false)`);
            break;
    }
}
```

**변경 범위**: filters 파싱 ~5줄 + switch 케이스 ~40줄

---

### 3.4 FilterBuilder.tsx (신규)

**파일**: `src/components/records/FilterBuilder.tsx`

**Props**:
```typescript
interface FilterBuilderProps {
    fields: FieldDefinition[];
    filters: FilterCondition[];
    onFiltersChange: (filters: FilterCondition[]) => void;
}
```

**import**:
```typescript
import { useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Filter, Plus, X } from "lucide-react";
import type { FieldDefinition, FilterCondition, FilterOperator } from "@/types";
```

**필드 타입별 연산자 맵** (컴포넌트 외부 상수):
```typescript
const OPERATORS_BY_TYPE: Record<string, { value: FilterOperator; label: string }[]> = {
    text: [
        { value: "contains", label: "포함" },
        { value: "equals", label: "같음" },
        { value: "not_equals", label: "같지 않음" },
        { value: "is_empty", label: "비어있음" },
        { value: "is_not_empty", label: "비어있지 않음" },
    ],
    number: [
        { value: "equals", label: "같음" },
        { value: "not_equals", label: "같지 않음" },
        { value: "gt", label: ">" },
        { value: "gte", label: ">=" },
        { value: "lt", label: "<" },
        { value: "lte", label: "<=" },
        { value: "is_empty", label: "비어있음" },
        { value: "is_not_empty", label: "비어있지 않음" },
    ],
    date: [
        { value: "equals", label: "같음" },
        { value: "before", label: "이전" },
        { value: "after", label: "이후" },
        { value: "between", label: "사이" },
        { value: "is_empty", label: "비어있음" },
        { value: "is_not_empty", label: "비어있지 않음" },
    ],
    select: [
        { value: "equals", label: "같음" },
        { value: "not_equals", label: "같지 않음" },
        { value: "is_empty", label: "비어있음" },
        { value: "is_not_empty", label: "비어있지 않음" },
    ],
    checkbox: [
        { value: "is_true", label: "체크됨" },
        { value: "is_false", label: "체크 안됨" },
    ],
};
```

**타입 그룹 매핑** (컴포넌트 외부 헬퍼):
```typescript
function getOperatorGroup(fieldType: string): string {
    if (["text", "textarea", "phone", "email"].includes(fieldType)) return "text";
    if (["number", "currency"].includes(fieldType)) return "number";
    if (["date", "datetime"].includes(fieldType)) return "date";
    if (["select", "user_select"].includes(fieldType)) return "select";
    if (fieldType === "checkbox") return "checkbox";
    return "text"; // fallback
}
```

**값 입력 불필요 연산자** (컴포넌트 외부 상수):
```typescript
const NO_VALUE_OPERATORS: FilterOperator[] = ["is_empty", "is_not_empty", "is_true", "is_false"];
```

**내부 상태**:
```typescript
const [draft, setDraft] = useState<FilterCondition[]>(filters);
const [open, setOpen] = useState(false);
```

**UI 구조**:
```
Popover (open, onOpenChange)
├── PopoverTrigger → Button (variant="outline", size="sm")
│   ├── Filter 아이콘 (h-4 w-4)
│   ├── "필터"
│   └── {filters.length > 0 && Badge (variant="secondary"): filters.length}
└── PopoverContent (className="w-[520px] p-4", align="start")
    ├── 헤더: "필터 조건" (text-sm font-medium)
    ├── 조건 목록 (space-y-2, max-h-[300px] overflow-y-auto)
    │   └── draft.map((condition, index) =>
    │       <div className="flex items-center gap-2">
    │           ├── 필드 Select (w-[140px])
    │           │   └── fields.map → SelectItem: field.label
    │           ├── 연산자 Select (w-[100px])
    │           │   └── operators.map → SelectItem: op.label
    │           ├── [값 입력] (조건부, flex-1)
    │           │   ├── text/number: <Input />
    │           │   ├── date: <Input type="date" />
    │           │   ├── select: <Select> field.options </Select>
    │           │   ├── between: <Input type="date" /> ~ <Input type="date" />
    │           │   └── is_empty/is_not_empty/is_true/is_false: (없음)
    │           └── 삭제 버튼 (X 아이콘, variant="ghost", size="icon")
    │       </div>
    ├── "조건 추가" 버튼 (variant="ghost", size="sm", Plus 아이콘)
    │   └── disabled: draft.length >= 10
    └── 하단 액션 (flex justify-between pt-3 border-t)
        ├── "초기화" 버튼 (variant="ghost", size="sm")
        └── "적용" 버튼 (size="sm")
```

**조건 추가 로직**:
```typescript
const addCondition = () => {
    if (draft.length >= 10) return;
    setDraft([...draft, { field: "", operator: "contains", value: null }]);
};
```

**조건 삭제 로직**:
```typescript
const removeCondition = (index: number) => {
    setDraft(draft.filter((_, i) => i !== index));
};
```

**조건 업데이트 로직**:
```typescript
const updateCondition = (index: number, patch: Partial<FilterCondition>) => {
    setDraft(draft.map((c, i) => i === index ? { ...c, ...patch } : c));
};
```

**필드 변경 시 연산자/값 리셋**:
```typescript
// 필드 Select onChange에서
const field = fields.find(f => f.key === value);
const group = field ? getOperatorGroup(field.fieldType) : "text";
const defaultOp = OPERATORS_BY_TYPE[group][0].value;
updateCondition(index, { field: value, operator: defaultOp, value: null, valueTo: undefined });
```

**적용 로직**:
```typescript
const handleApply = () => {
    // field가 비어있는 조건 제외
    const valid = draft.filter(c => c.field !== "");
    onFiltersChange(valid);
    setOpen(false);
};
```

**초기화 로직**:
```typescript
const handleReset = () => {
    setDraft([]);
    onFiltersChange([]);
    setOpen(false);
};
```

**Popover 열릴 때 draft 동기화**:
```typescript
// open 상태 변경 시
const handleOpenChange = (isOpen: boolean) => {
    if (isOpen) setDraft(filters.length > 0 ? [...filters] : [{ field: "", operator: "contains", value: null }]);
    setOpen(isOpen);
};
```

---

### 3.5 RecordToolbar.tsx (수정)

**변경 내용**: FilterBuilder 통합

**import 추가**:
```typescript
import FilterBuilder from "./FilterBuilder";
import type { FieldDefinition, FilterCondition } from "@/types";
```

**Props 추가**:
```typescript
interface RecordToolbarProps {
    // ... 기존 props 유지
    fields: FieldDefinition[];          // 추가
    filters: FilterCondition[];          // 추가
    onFiltersChange: (filters: FilterCondition[]) => void;  // 추가
}
```

**컴포넌트 매개변수에 추가**:
```typescript
fields, filters, onFiltersChange,
```

**UI 추가** (검색 Input div 아래, 분배순서 필터 앞에):
```tsx
<FilterBuilder
    fields={fields}
    filters={filters}
    onFiltersChange={onFiltersChange}
/>
```

**변경 범위**: import 2줄 + Props 3줄 + 매개변수 3개 + JSX 4줄

---

### 3.6 RecordTable.tsx (수정)

**변경 내용**: 정렬 가능 헤더 + 아이콘

**import 추가**:
```typescript
import { ChevronLeft, ChevronRight, ArrowUp, ArrowDown, ArrowUpDown } from "lucide-react";
```
(기존 `ChevronLeft, ChevronRight`에 `ArrowUp, ArrowDown, ArrowUpDown` 추가)

**Props 추가**:
```typescript
interface RecordTableProps {
    // ... 기존 props 유지
    sortField?: string;                          // 추가
    sortOrder?: "asc" | "desc";                  // 추가
    onSortChange?: (field: string | undefined, order: "asc" | "desc" | undefined) => void;  // 추가
}
```

**컴포넌트 매개변수에 추가**:
```typescript
sortField, sortOrder, onSortChange,
```

**정렬 토글 핸들러** (toggleAll 함수 위에):
```typescript
const handleSort = (field: string) => {
    if (!onSortChange) return;
    if (sortField !== field) {
        onSortChange(field, "asc");
    } else if (sortOrder === "asc") {
        onSortChange(field, "desc");
    } else {
        onSortChange(undefined, undefined);
    }
};
```

**정렬 아이콘 렌더러** (handleSort 아래):
```typescript
const renderSortIcon = (field: string) => {
    if (sortField !== field) return <ArrowUpDown className="h-3 w-3 ml-1 text-muted-foreground/50" />;
    if (sortOrder === "asc") return <ArrowUp className="h-3 w-3 ml-1" />;
    return <ArrowDown className="h-3 w-3 ml-1" />;
};
```

**통합코드 헤더 변경** (기존 line 117):
```tsx
// Before:
<TableHead className="w-[120px]">통합코드</TableHead>

// After:
<TableHead
    className="w-[120px] cursor-pointer select-none hover:bg-muted/50"
    onClick={() => handleSort("integratedCode")}
>
    <span className="flex items-center">
        통합코드
        {renderSortIcon("integratedCode")}
    </span>
</TableHead>
```

**등록일 헤더 추가**: 현재 등록일 헤더가 없으므로, 추가하지 않음.
등록일은 기본 정렬로만 사용 (API 기본값 = registeredAt desc).
**정렬 가능 컬럼: integratedCode만.**

**변경 범위**: import 수정 1줄 + Props 3줄 + 매개변수 3개 + handleSort/renderSortIcon ~12줄 + 통합코드 헤더 변경 ~6줄

---

### 3.7 records.tsx (수정)

**변경 내용**: filters + sort 상태 관리

**import 추가**:
```typescript
import type { FilterCondition } from "@/types";
```

**상태 추가** (distributionOrder 아래에):
```typescript
const [filters, setFilters] = useState<FilterCondition[]>([]);
const [sortField, setSortField] = useState<string | undefined>();
const [sortOrder, setSortOrder] = useState<"asc" | "desc" | undefined>();
```

**useRecords 호출 수정**:
```typescript
} = useRecords({
    partitionId,
    page,
    search: search || undefined,
    distributionOrder,
    filters: filters.length > 0 ? filters : undefined,  // 추가
    sortField,   // 추가
    sortOrder,   // 추가
});
```

**핸들러 추가** (handleDistributionOrderChange 아래에):
```typescript
const handleFiltersChange = useCallback((newFilters: FilterCondition[]) => {
    setFilters(newFilters);
    setPage(1);
}, []);

const handleSortChange = useCallback((field: string | undefined, order: "asc" | "desc" | undefined) => {
    setSortField(field);
    setSortOrder(order);
    setPage(1);
}, []);
```

**파티션 변경 시 초기화에 filters/sort 추가**:
```typescript
// handlePartitionSelect
const handlePartitionSelect = useCallback((id: number) => {
    setPartitionId(id);
    setPage(1);
    setSearch("");
    setSelectedIds(new Set());
    setFilters([]);            // 추가
    setSortField(undefined);   // 추가
    setSortOrder(undefined);   // 추가
}, []);
```

**RecordToolbar에 props 추가**:
```tsx
<RecordToolbar
    // ... 기존 props
    fields={fields}
    filters={filters}
    onFiltersChange={handleFiltersChange}
/>
```

**RecordTable에 props 추가**:
```tsx
<RecordTable
    // ... 기존 props
    sortField={sortField}
    sortOrder={sortOrder}
    onSortChange={handleSortChange}
/>
```

**변경 범위**: import 1줄 + 상태 3줄 + useRecords 3줄 + 핸들러 10줄 + handlePartitionSelect 3줄 + JSX props 6줄

## 4. 변경 파일 요약

| # | 파일 | 변경 | 주요 내용 |
|---|------|------|-----------|
| 1 | `src/types/index.ts` | 수정 ~15줄 | FilterOperator, FilterCondition 타입 |
| 2 | `src/hooks/useRecords.ts` | 수정 ~4줄 | filters 파라미터 + 직렬화 |
| 3 | `src/pages/api/partitions/[id]/records.ts` | 수정 ~50줄 | filters 파싱 + JSONB SQL switch |
| 4 | `src/components/records/FilterBuilder.tsx` | 신규 ~200줄 | Popover 필터 빌더 |
| 5 | `src/components/records/RecordToolbar.tsx` | 수정 ~10줄 | FilterBuilder 통합 |
| 6 | `src/components/records/RecordTable.tsx` | 수정 ~25줄 | 헤더 정렬 클릭 + 아이콘 |
| 7 | `src/pages/records.tsx` | 수정 ~26줄 | filters/sort 상태 + 핸들러 + props |

## 5. 사용하지 않는 것

- 새 API 엔드포인트: 없음 (기존 records API 확장만)
- 새 DB 테이블/컬럼: 없음
- 새 SWR 훅: 없음
- 새 외부 라이브러리: 없음
- OR 필터 조합: 없음 (AND만)
- 필터 프리셋 저장: 없음

## 6. 검증 기준

| # | 항목 | 방법 |
|---|------|------|
| 1 | `npx next build` 성공 | 빌드 실행 |
| 2 | 필터 버튼 클릭 → Popover 열림 | UI 확인 |
| 3 | 필드 선택 → 해당 타입 연산자 표시 | 텍스트/숫자/날짜/select 각각 |
| 4 | 텍스트 "포함" 필터 → 해당 레코드만 | API 호출 확인 |
| 5 | 숫자 ">" 필터 → 올바른 결과 | API 호출 확인 |
| 6 | 날짜 "이전"/"이후" 필터 | API 호출 확인 |
| 7 | select "같음" 필터 | API 호출 확인 |
| 8 | 다중 필터 AND 결합 | 2개 이상 조건 동시 |
| 9 | "초기화" → 필터 해제, 전체 복원 | UI + API 확인 |
| 10 | 활성 필터 Badge 표시 | 필터 적용 후 버튼 확인 |
| 11 | 통합코드 헤더 클릭 → 정렬 토글 | asc → desc → none |
| 12 | 정렬 아이콘 표시 | ArrowUp/ArrowDown/ArrowUpDown |
| 13 | 정렬 + 필터 동시 사용 | 둘 다 적용 후 결과 확인 |
| 14 | 키워드 검색 + 필터 동시 | 기존 검색과 필터 AND |
| 15 | 파티션 변경 시 필터/정렬 초기화 | 파티션 전환 |
