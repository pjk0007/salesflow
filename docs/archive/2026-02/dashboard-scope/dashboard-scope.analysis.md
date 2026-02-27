# dashboard-scope Analysis Report

> **Analysis Type**: Gap Analysis (Design vs Implementation)
>
> **Project**: Sales Manager
> **Analyst**: gap-detector
> **Date**: 2026-02-25
> **Design Doc**: [dashboard-scope.design.md](../02-design/features/dashboard-scope.design.md)

---

## 1. Analysis Overview

### 1.1 Analysis Purpose

Design 문서(`dashboard-scope.design.md`)에 정의된 대시보드 데이터 범위 설정 기능의 모든 설계 항목을 실제 구현 코드와 1:1 비교하여 Gap을 식별한다.

### 1.2 Analysis Scope

- **Design Document**: `docs/02-design/features/dashboard-scope.design.md`
- **Implementation Files**:
  - `src/lib/db/schema.ts` (L652-670)
  - `drizzle/0006_dashboard_partition_ids.sql`
  - `src/pages/api/dashboards/index.ts`
  - `src/pages/api/dashboards/[id].ts`
  - `src/pages/api/dashboards/[id]/data.ts`
  - `src/pages/dashboards.tsx`
- **Analysis Date**: 2026-02-25

---

## 2. Gap Analysis (Design vs Implementation)

### 2.1 Data Model (Section 1.1)

| # | Design Item | Design Location | Implementation Location | Status | Notes |
|---|-------------|-----------------|------------------------|--------|-------|
| 1 | `partitionIds` column in dashboards table | design L13 | `src/lib/db/schema.ts:663` | Match | `jsonb("partition_ids").$type<number[]>()` |
| 2 | Type: jsonb, nullable | design L16 | `src/lib/db/schema.ts:663` | Match | No `.notNull()` = nullable |
| 3 | null = all workspace partitions | design L17 | `src/pages/api/dashboards/[id]/data.ts:47-55` | Match | Fallback to full workspace query when null |
| 4 | number[] = specific partition IDs only | design L18 | `src/pages/api/dashboards/[id]/data.ts:47-48` | Match | `dashboard.partitionIds` used directly |
| 5 | Column position: after description, before globalFilters | design L12 | `src/lib/db/schema.ts:663` | Match | Line 663 between description(662) and globalFilters(664) |

### 2.2 Migration (Section 1.2)

| # | Design Item | Design Location | Implementation Location | Status | Notes |
|---|-------------|-----------------|------------------------|--------|-------|
| 6 | File: `drizzle/0006_dashboard_partition_ids.sql` | design L23 | `drizzle/0006_dashboard_partition_ids.sql` | Match | Exact filename |
| 7 | SQL: `ALTER TABLE "dashboards" ADD COLUMN IF NOT EXISTS "partition_ids" jsonb;` | design L26 | `drizzle/0006_dashboard_partition_ids.sql:1` | Match | Exact SQL statement |
| 8 | `IF NOT EXISTS` for idempotency | design L29 | migration file L1 | Match | Present |
| 9 | Existing rows remain null (full scope) | design L30 | migration file | Match | No DEFAULT clause = null for existing rows |

### 2.3 API: POST /api/dashboards (Section 2.1)

| # | Design Item | Design Location | Implementation Location | Status | Notes |
|---|-------------|-----------------|------------------------|--------|-------|
| 10 | Destructure `partitionIds` from `req.body` | design L40 | `src/pages/api/dashboards/index.ts:46` | Match | `const { name, workspaceId, description, partitionIds } = req.body;` |
| 11 | Insert: `Array.isArray(partitionIds) ? partitionIds : null` | design L45 | `src/pages/api/dashboards/index.ts:62` | Match | Exact expression |

### 2.4 API: PUT /api/dashboards/[id] (Section 2.2)

| # | Design Item | Design Location | Implementation Location | Status | Notes |
|---|-------------|-----------------|------------------------|--------|-------|
| 12 | Destructure `partitionIds` from `req.body` | design L54 | `src/pages/api/dashboards/[id].ts:61` | Match | `const { name, description, globalFilters, refreshInterval, isPublic, partitionIds } = req.body;` |
| 13 | Update: `...(partitionIds !== undefined && { partitionIds: Array.isArray(partitionIds) ? partitionIds : null })` | design L59 | `src/pages/api/dashboards/[id].ts:83` | Match | Exact spread pattern |
| 14 | `undefined` check: only update when explicitly passed | design L62 | `src/pages/api/dashboards/[id].ts:83` | Match | `partitionIds !== undefined` guard |
| 15 | Empty array not converted to null (UI handles) | design L63 | `src/pages/api/dashboards/[id].ts:83` | Match | No empty array -> null conversion at API level |

### 2.5 API: GET /api/dashboards/[id]/data (Section 2.3)

| # | Design Item | Design Location | Implementation Location | Status | Notes |
|---|-------------|-----------------|------------------------|--------|-------|
| 16 | `let partitionIds: number[];` declaration | design L80 | `src/pages/api/dashboards/[id]/data.ts:46` | Match | `let partitionIds: number[];` |
| 17 | Condition: `dashboard.partitionIds && Array.isArray(dashboard.partitionIds) && dashboard.partitionIds.length > 0` | design L81 | `src/pages/api/dashboards/[id]/data.ts:47` | Match | Exact triple condition |
| 18 | True branch: use `dashboard.partitionIds` directly | design L82 | `src/pages/api/dashboards/[id]/data.ts:48` | Match | `partitionIds = dashboard.partitionIds;` |
| 19 | False branch: full workspace partition query | design L84-89 | `src/pages/api/dashboards/[id]/data.ts:50-54` | Match | `db.select({id}).from(partitions).where(eq(workspaceId))` |
| 20 | `Array.isArray` defensive check for jsonb safety | design L93 | `src/pages/api/dashboards/[id]/data.ts:47` | Match | Present |
| 21 | Empty array falls back to full scope | design L94 | `src/pages/api/dashboards/[id]/data.ts:47` | Match | `.length > 0` check ensures empty array goes to else branch |

### 2.6 UI: Popover Structure (Section 3.1)

| # | Design Item | Design Location | Implementation Location | Status | Notes |
|---|-------------|-----------------|------------------------|--------|-------|
| 22 | Location: Dashboard Toolbar | design L102 | `src/pages/dashboards.tsx:482-548` | Match | Inside toolbar `<div>` after public/link buttons |
| 23 | Filter icon + "데이터 범위: {scopeLabel}" trigger | design L106 | `src/pages/dashboards.tsx:484-487` | Match | `<Filter className="h-3 w-3 mr-1" /> 데이터 범위: {scopeLabel}` |
| 24 | Popover: w-64, max-h-80, overflow-y-auto | design L107 | `src/pages/dashboards.tsx:489` | Match | `className="w-64 max-h-80 overflow-y-auto"` |
| 25 | "전체" checkbox at top | design L108 | `src/pages/dashboards.tsx:492-498` | Match | `id="scope-all"` checkbox with "전체" label |
| 26 | Folder with indeterminate support | design L109 | `src/pages/dashboards.tsx:501-528` | Match | Folder checkbox with indeterminate logic |
| 27 | Nested partitions under folder (indented) | design L110-111 | `src/pages/dashboards.tsx:515-525` | Match | `className="ml-6 space-y-1 mt-1"` |
| 28 | Ungrouped partitions section | design L113-115 | `src/pages/dashboards.tsx:530-543` | Match | `partitionTree.ungrouped` rendering |

### 2.7 UI: scopeLabel Logic (Section 3.1)

| # | Design Item | Design Location | Implementation Location | Status | Notes |
|---|-------------|-----------------|------------------------|--------|-------|
| 29 | `scopeIds` cast from `selectedDashboard?.partitionIds` | design L120 | `src/pages/dashboards.tsx:95` | Match | `const scopeIds = selectedDashboard?.partitionIds as number[] \| null;` |
| 30 | Label: "전체" when null or empty, "{N}개 파티션" otherwise | design L121-123 | `src/pages/dashboards.tsx:96-98` | Match | Exact ternary logic |

### 2.8 UI: Checkbox Handlers (Section 3.2)

| # | Design Item | Design Location | Implementation Location | Status | Notes |
|---|-------------|-----------------|------------------------|--------|-------|
| 31 | `handleScopeAll`: set `partitionIds: null`, call `mutateData()` | design L130-131 | `src/pages/dashboards.tsx:119-123` | Match | Exact implementation |
| 32 | `handleScopeChange`: add/remove single partition ID | design L136-142 | `src/pages/dashboards.tsx:100-117` | Match | Exact add/filter logic |
| 33 | `handleScopeChange`: empty array -> null conversion | design L143,146 | `src/pages/dashboards.tsx:112` | Match | `next.length > 0 ? next : null` |
| 34 | `handleScopeChange`: call `mutateData()` after update | design L144 | `src/pages/dashboards.tsx:114` | Match | `mutateData()` called |
| 35 | `handleScopeFolder`: Set for dedup on add | design L153 | `src/pages/dashboards.tsx:131` | Match | `[...new Set([...current, ...folderPartitionIds])]` |
| 36 | `handleScopeFolder`: Set-based removal on uncheck | design L155-156 | `src/pages/dashboards.tsx:133-134` | Match | `const removeSet = new Set(folderPartitionIds)` + filter |
| 37 | `handleScopeFolder`: empty array -> null | design L158 | `src/pages/dashboards.tsx:137` | Match | `next.length > 0 ? next : null` |
| 38 | `handleScopeFolder`: call `mutateData()` | design L159 | `src/pages/dashboards.tsx:139` | Match | Present |

### 2.9 UI: Folder Indeterminate State (Section 3.2)

| # | Design Item | Design Location | Implementation Location | Status | Notes |
|---|-------------|-----------------|------------------------|--------|-------|
| 39 | `folderPIds = folder.partitions.map(p => p.id)` | design L166 | `src/pages/dashboards.tsx:502` | Match | Exact expression |
| 40 | `allChecked`: every partition in scopeIds | design L167 | `src/pages/dashboards.tsx:503` | Match | `folderPIds.every(id => scopeIds.includes(id))` |
| 41 | `someChecked`: some partition in scopeIds | design L168 | `src/pages/dashboards.tsx:504` | Match | `folderPIds.some(id => scopeIds.includes(id))` |
| 42 | `checked={allChecked ? true : someChecked ? "indeterminate" : false}` | design L169 | `src/pages/dashboards.tsx:510` | Match | Exact ternary expression |

### 2.10 UI: Data Refresh (Section 3.3)

| # | Design Item | Design Location | Implementation Location | Status | Notes |
|---|-------------|-----------------|------------------------|--------|-------|
| 43 | `mutateData()` called after scope change for SWR cache invalidation | design L174 | `src/pages/dashboards.tsx:114,122,139` | Match | Called in all three handlers |

### 2.11 UI: Imports (Section 3.4)

| # | Design Item | Design Location | Implementation Location | Status | Notes |
|---|-------------|-----------------|------------------------|--------|-------|
| 44 | `import { usePartitions } from "@/hooks/usePartitions"` | design L179 | `src/pages/dashboards.tsx:6` | Match | Present |
| 45 | `import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"` | design L180 | `src/pages/dashboards.tsx:23` | Match | Present |
| 46 | `import { Checkbox } from "@/components/ui/checkbox"` | design L181 | `src/pages/dashboards.tsx:24` | Match | Present |
| 47 | `import { Filter } from "lucide-react"` | design L182 | `src/pages/dashboards.tsx:26` | Match | Present in the combined import |

### 2.12 UI: Hook Usage (Section 3.5)

| # | Design Item | Design Location | Implementation Location | Status | Notes |
|---|-------------|-----------------|------------------------|--------|-------|
| 48 | `const { partitionTree } = usePartitions(workspaceId)` | design L188 | `src/pages/dashboards.tsx:39` | Match | Exact destructuring |
| 49 | `partitionTree.folders` usage (folders with nested partitions) | design L191 | `src/pages/dashboards.tsx:501` | Match | `partitionTree.folders.map(folder => ...)` |
| 50 | `partitionTree.ungrouped` usage | design L192 | `src/pages/dashboards.tsx:530` | Match | `partitionTree.ungrouped.length > 0` |

---

## 3. Match Rate Summary

```
+-----------------------------------------------+
|  Overall Match Rate: 100% (50/50)              |
+-----------------------------------------------+
|  Match:           50 items (100%)              |
|  Changed:          0 items (0%)                |
|  Missing:          0 items (0%)                |
+-----------------------------------------------+
```

| Category | Items | Match | Changed | Missing | Rate |
|----------|:-----:|:-----:|:-------:|:-------:|:----:|
| Data Model (1.1) | 5 | 5 | 0 | 0 | 100% |
| Migration (1.2) | 4 | 4 | 0 | 0 | 100% |
| API POST (2.1) | 2 | 2 | 0 | 0 | 100% |
| API PUT (2.2) | 4 | 4 | 0 | 0 | 100% |
| API GET data (2.3) | 6 | 6 | 0 | 0 | 100% |
| UI Popover (3.1) | 7 | 7 | 0 | 0 | 100% |
| UI scopeLabel (3.1) | 2 | 2 | 0 | 0 | 100% |
| UI Handlers (3.2) | 8 | 8 | 0 | 0 | 100% |
| UI Indeterminate (3.2) | 4 | 4 | 0 | 0 | 100% |
| UI Data Refresh (3.3) | 1 | 1 | 0 | 0 | 100% |
| UI Imports (3.4) | 4 | 4 | 0 | 0 | 100% |
| UI Hooks (3.5) | 3 | 3 | 0 | 0 | 100% |
| **Total** | **50** | **50** | **0** | **0** | **100%** |

---

## 4. Overall Scores

| Category | Score | Status |
|----------|:-----:|:------:|
| Design Match | 100% | PASS |
| Architecture Compliance | 100% | PASS |
| Convention Compliance | 100% | PASS |
| **Overall** | **100%** | **PASS** |

---

## 5. Findings

### Missing Features (Design O, Implementation X)

None.

### Added Features (Design X, Implementation O)

None.

### Changed Features (Design != Implementation)

None.

---

## 6. Conclusion

Design and implementation match perfectly. All 50 design items are implemented exactly as specified across 6 files:

- **Schema**: `partitionIds` jsonb column positioned correctly with nullable type
- **Migration**: Idempotent ALTER TABLE with IF NOT EXISTS
- **POST API**: Destructures and validates partitionIds with Array.isArray guard
- **PUT API**: Conditional update with undefined check, Array.isArray guard
- **Data API**: Triple condition (exists, isArray, length > 0) with full-workspace fallback
- **UI**: Complete Popover with folder indeterminate states, three scope handlers, SWR cache invalidation

No action required. Feature is ready for completion report.

---

## Version History

| Version | Date | Changes | Author |
|---------|------|---------|--------|
| 1.0 | 2026-02-25 | Initial analysis | gap-detector |
