# dashboard-ux Analysis Report

> **Analysis Type**: Gap Analysis (Design vs Implementation)
>
> **Project**: sales
> **Analyst**: gap-detector
> **Date**: 2026-02-25
> **Design Doc**: [dashboard-ux.design.md](../02-design/features/dashboard-ux.design.md)

---

## 1. Analysis Overview

### 1.1 Analysis Purpose

Verify that the "dashboard-ux" feature implementation matches the design document. This feature replaces the dashboard creation Dialog with an inline creation area and adds AI-powered dashboard generation (name + widgets).

### 1.2 Analysis Scope

- **Design Document**: `docs/02-design/features/dashboard-ux.design.md`
- **Implementation Files**:
  - `src/lib/ai.ts` (lines 750-891)
  - `src/pages/api/ai/generate-dashboard.ts` (57 lines)
  - `src/pages/dashboards.tsx` (476 lines)
- **Unchanged Files Verified**: 6 files
- **Analysis Date**: 2026-02-25

---

## 2. Gap Analysis (Design vs Implementation)

### 2.1 `src/lib/ai.ts` -- Types and Functions (29 items)

#### 2.1.1 GenerateDashboardInput Interface

| # | Design Item | Implementation | Status |
|---|-------------|---------------|--------|
| 1 | `prompt: string` field | `prompt: string` (line 753) | MATCH |
| 2 | `workspaceFields: Array<{ key: string; label: string; fieldType: string }>` | Identical (line 754) | MATCH |

#### 2.1.2 GenerateDashboardWidget Interface

| # | Design Item | Implementation | Status |
|---|-------------|---------------|--------|
| 3 | `title: string` | `title: string` (line 758) | MATCH |
| 4 | `widgetType: string` | `widgetType: string` (line 759) | MATCH |
| 5 | `dataColumn: string` | `dataColumn: string` (line 760) | MATCH |
| 6 | `aggregation: string` | `aggregation: string` (line 761) | MATCH |
| 7 | `groupByColumn: string` | `groupByColumn: string` (line 762) | MATCH |
| 8 | `stackByColumn: string` | `stackByColumn: string` (line 763) | MATCH |

#### 2.1.3 GenerateDashboardResult Interface

| # | Design Item | Implementation | Status |
|---|-------------|---------------|--------|
| 9 | `name: string` | `name: string` (line 767) | MATCH |
| 10 | `widgets: GenerateDashboardWidget[]` | `widgets: GenerateDashboardWidget[]` (line 768) | MATCH |
| 11 | `usage: { promptTokens: number; completionTokens: number }` | Identical (line 769) | MATCH |

#### 2.1.4 buildDashboardSystemPrompt()

| # | Design Item | Implementation | Status |
|---|-------------|---------------|--------|
| 12 | Opening line: "data dashboard design expert" | "데이터 대시보드 설계 전문가입니다" (line 773) | MATCH |
| 13 | JSON format specification with name + widgets | Lines 776-789 | MATCH |
| 14 | widgetType options: scorecard, bar, bar_horizontal, bar_stacked, line, donut | Line 792 | MATCH |
| 15 | scorecard groupByColumn = empty string rule | Line 793 | MATCH |
| 16 | bar_stacked stackByColumn rule | Line 794 | MATCH |
| 17 | dataColumn/groupByColumn must use workspace field keys | Line 795 | MATCH |
| 18 | aggregation: count, sum, avg | Line 796 | MATCH |
| 19 | 3-8 widgets | Line 797 | MATCH |
| 20 | First widget = scorecard recommendation | Line 798 | MATCH |
| 21 | Korean output | Line 799 | MATCH |
| 22 | Field listing format: `- key (label) [fieldType]` | Lines 803-806 | MATCH |

#### 2.1.5 generateDashboard() Function

| # | Design Item | Implementation | Status |
|---|-------------|---------------|--------|
| 23 | OpenAI: `response_format: { type: "json_object" }` | Line 835 | MATCH |
| 24 | Anthropic: `max_tokens: 4096` | Line 858 | MATCH |
| 25 | extractJson pattern: `/\{[\s\S]*"name"[\s\S]*"widgets"[\s\S]*\}/` | Line 817 | MATCH |
| 26 | Widget mapping with `title` fallback `""` | Line 878 | MATCH |
| 27 | Widget mapping with `widgetType` fallback `"scorecard"` | Line 879 | MATCH |
| 28 | Widget mapping with `dataColumn` fallback `""`, `aggregation` fallback `"count"` | Lines 880-881 | MATCH |
| 29 | Widget mapping with `groupByColumn` fallback `""`, `stackByColumn` fallback `""` | Lines 882-883 | MATCH |

### 2.2 `src/pages/api/ai/generate-dashboard.ts` -- API Endpoint (12 items)

| # | Design Item | Implementation | Status |
|---|-------------|---------------|--------|
| 30 | POST-only check | `req.method !== "POST"` -> 405 (line 6) | MATCH |
| 31 | getUserFromRequest -> 401 | Lines 10-12 | MATCH |
| 32 | getAiClient -> 400 "AI 설정이 필요합니다" | Lines 15-20, message matches | MATCH |
| 33 | prompt validation (required, string, trimmed) | Lines 23-25 | MATCH |
| 34 | workspaceFields from req.body | Line 23 destructuring + line 31 `workspaceFields \|\| []` | MATCH |
| 35 | generateDashboard call with prompt.trim() | Line 29-32 | MATCH |
| 36 | logAiUsage with purpose "dashboard_generation" | Lines 34-42 | MATCH |
| 37 | logAiUsage fields: orgId, userId, provider, model, promptTokens, completionTokens | Lines 35-41 | MATCH |
| 38 | Response: `{ success: true, data: { name, widgets } }` | Lines 44-50 | MATCH |
| 39 | catch: console.error("AI dashboard generation error:") | Line 52 | MATCH |
| 40 | Error message fallback: "AI 대시보드 생성에 실패했습니다." | Line 53 | MATCH |
| 41 | Error response: `{ success: false, error: message }` with 500 | Line 54 | MATCH |

### 2.3 `src/pages/dashboards.tsx` -- UI Changes (39 items)

#### 2.3.1 Removals

| # | Design Item | Implementation | Status |
|---|-------------|---------------|--------|
| 42 | Dialog/DialogContent/DialogHeader/DialogTitle imports REMOVED | Not present in imports (lines 1-24) | MATCH |
| 43 | createOpen/setCreateOpen state REMOVED | Not present (grep confirms 0 matches) | MATCH |
| 44 | Dialog JSX REMOVED | No Dialog component in JSX (only WidgetConfigDialog remains) | MATCH |

#### 2.3.2 New Imports

| # | Design Item | Implementation | Status |
|---|-------------|---------------|--------|
| 45 | `Textarea` from `@/components/ui/textarea` | Line 12 | MATCH |
| 46 | `Sparkles` from `lucide-react` | Line 23 | MATCH |

#### 2.3.3 New State

| # | Design Item | Implementation | Status |
|---|-------------|---------------|--------|
| 47 | `showCreate` / `setShowCreate` state (boolean) | Line 42: `useState(false)` | MATCH |
| 48 | `aiPrompt` / `setAiPrompt` state (string) | Line 44: `useState("")` | MATCH |
| 49 | `creating` / `setCreating` state (boolean) | Line 45: `useState(false)` | MATCH |

#### 2.3.4 Derived Values

| # | Design Item | Implementation | Status |
|---|-------------|---------------|--------|
| 50 | `hasAi` = `!!aiPrompt.trim()` | Line 88: `const hasAi = !!aiPrompt.trim()` | MATCH |

#### 2.3.5 "New Dashboard" Button

| # | Design Item | Implementation | Status |
|---|-------------|---------------|--------|
| 51 | Button onClick toggles showCreate | Line 305: `onClick={() => setShowCreate(!showCreate)}` | MATCH |
| 52 | Plus icon + "새 대시보드" text | Line 306 | MATCH |

#### 2.3.6 Inline Creation Area

| # | Design Item | Implementation | Status |
|---|-------------|---------------|--------|
| 53 | Conditional render: `{showCreate && (...)}` | Line 312 | MATCH |
| 54 | Wrapper: `border rounded-lg p-4 space-y-3` | Line 313 | MATCH |
| 55 | Label: "대시보드 이름" | Line 315 | MATCH |
| 56 | Input with newName binding + placeholder "대시보드 이름" | Lines 316-319 | MATCH |
| 57 | Sparkles icon in AI label | Line 324: `<Sparkles className="h-4 w-4" />` | MATCH |
| 58 | AI label text: "AI 위젯 자동 생성" + "(선택)" span | Lines 324-325 | MATCH |
| 59 | Textarea with aiPrompt binding | Lines 327-331 | MATCH |
| 60 | Textarea placeholder: "예: 영업 현황 대시보드, 월별 매출 분석" | Line 330 | MATCH |
| 61 | Textarea rows={2} | Line 331 | MATCH |
| 62 | Helper text: "입력하면 대시보드 이름과 위젯을 AI가 자동으로 구성합니다." | Lines 333-335 | MATCH |
| 63 | Create button disabled condition: `creating \|\| (!newName && !hasAi)` | Line 340 | MATCH |
| 64 | Button text: AI mode "AI 생성 중..." / "AI로 생성" vs normal "생성 중..." / "생성" | Line 342 | MATCH |
| 65 | Cancel button resets showCreate, newName, aiPrompt | Line 344 | MATCH |

#### 2.3.7 handleCreate Logic

| # | Design Item | Implementation | Status |
|---|-------------|---------------|--------|
| 66 | Guard: `!workspaceId` return | Line 91 | MATCH |
| 67 | Guard: `!hasAi && !newName` return | Line 92 | MATCH |
| 68 | setCreating(true) | Line 93 | MATCH |
| 69 | createDashboard with name fallback: `newName \|\| aiPrompt.trim().slice(0, 30)` | Line 97 | MATCH |
| 70 | Error toast + setCreating(false) on failure | Lines 100-103 | MATCH |
| 71 | AI fetch to `/api/ai/generate-dashboard` with POST | Lines 111-122 | MATCH |
| 72 | Request body: prompt + workspaceFields mapped from fields | Lines 114-121 | MATCH |
| 73 | On AI success: updateDashboard name if data.name exists | Lines 127-129 | MATCH |
| 74 | Sequential widget POST via for-of loop | Lines 131-137 | MATCH |
| 75 | Success toast: `${data.widgets.length}개 위젯이 AI로 생성되었습니다.` | Line 138 | MATCH |
| 76 | AI failure toast: `aiJson.error \|\| "AI 생성에 실패했습니다."` | Line 140 | MATCH |
| 77 | Catch block toast: "AI 생성 중 오류가 발생했습니다." | Line 143 | MATCH |
| 78 | Non-AI success toast: "대시보드가 생성되었습니다." | Line 146 | MATCH |
| 79 | Cleanup: setShowCreate(false), setNewName(""), setAiPrompt(""), setCreating(false) | Lines 150-153 | MATCH |
| 80 | setSelectedDashboardId(dashboardId) | Line 154 | MATCH |

#### 2.3.8 useCallback Dependencies

| # | Design Item | Implementation | Status | Notes |
|---|-------------|---------------|--------|-------|
| 81 | Dependencies: newName, aiPrompt, workspaceId, fields, createDashboard, updateDashboard, mutateDashboards | Line 156: adds `hasAi` to deps | CHANGED | Implementation adds `hasAi` to dependency array -- correct React best practice since `hasAi` is used inside the callback. Design omitted it but implementation is more correct. |

### 2.4 Unchanged Files Verification (6 items)

| # | Design Item | Implementation | Status |
|---|-------------|---------------|--------|
| 82 | DashboardGrid.tsx: no changes | File exists, no dashboard-ux related changes | MATCH |
| 83 | WidgetConfigDialog.tsx: no changes | File exists, widget config dialog unchanged | MATCH |
| 84 | useDashboards.ts: no changes | File exists, hook unchanged | MATCH |
| 85 | useDashboardData.ts: no changes | File exists, hook unchanged | MATCH |
| 86 | API routes (dashboards/**): no changes | 4 API files exist, no dashboard-ux changes | MATCH |
| 87 | dashboard/[slug].tsx: no changes | File exists at `src/pages/dashboard/[slug].tsx` | MATCH |

---

## 3. Summary

### 3.1 Items by Category

| Category | Items | Matched | Changed | Added | Missing |
|----------|:-----:|:-------:|:-------:|:-----:|:-------:|
| ai.ts Types (3 interfaces) | 11 | 11 | 0 | 0 | 0 |
| ai.ts buildDashboardSystemPrompt | 11 | 11 | 0 | 0 | 0 |
| ai.ts generateDashboard | 7 | 7 | 0 | 0 | 0 |
| generate-dashboard.ts API | 12 | 12 | 0 | 0 | 0 |
| dashboards.tsx Removals | 3 | 3 | 0 | 0 | 0 |
| dashboards.tsx New imports | 2 | 2 | 0 | 0 | 0 |
| dashboards.tsx New state | 4 | 4 | 0 | 0 | 0 |
| dashboards.tsx Button/UI | 13 | 13 | 0 | 0 | 0 |
| dashboards.tsx handleCreate | 15 | 15 | 0 | 0 | 0 |
| dashboards.tsx useCallback deps | 1 | 0 | 1 | 0 | 0 |
| Unchanged files | 6 | 6 | 0 | 0 | 0 |
| **Total** | **87** | **86** | **1** | **0** | **0** |

### 3.2 Changed Items Detail

| # | Item | Design | Implementation | Impact |
|---|------|--------|---------------|--------|
| 81 | useCallback dependency array | `[newName, aiPrompt, workspaceId, fields, createDashboard, updateDashboard, mutateDashboards]` | `[newName, aiPrompt, hasAi, workspaceId, fields, createDashboard, updateDashboard, mutateDashboards]` | Low -- `hasAi` added to deps is correct React practice since it is used inside the callback. No behavioral difference since `hasAi` is derived from `aiPrompt`. |

### 3.3 Match Rate

```
Total Design Items:     87
Matched:                86  (98.9%)
Changed (acceptable):    1  ( 1.1%)
Added (extra):           0  ( 0.0%)
Missing (not impl):     0  ( 0.0%)

Match Rate: 98.9%
```

---

## 4. Overall Scores

| Category | Score | Status |
|----------|:-----:|:------:|
| Design Match | 98.9% | PASS |
| Architecture Compliance | 100% | PASS |
| Convention Compliance | 100% | PASS |
| **Overall** | **98.9%** | **PASS** |

---

## 5. Recommended Actions

### Design and implementation match well (>= 90%).

The single changed item (useCallback dependency addition of `hasAi`) is a React best-practice improvement and does not affect behavior. No action required.

### Optional Documentation Update

- [ ] Update design document Section 3.3.8 to include `hasAi` in the useCallback dependency list for accuracy

---

## 6. Synchronization Decision

**Option 4 selected**: Record the difference as intentional. The `hasAi` dependency addition is a correct React lint compliance improvement that the design document omitted. No functional impact.

---

## Version History

| Version | Date | Changes | Author |
|---------|------|---------|--------|
| 1.0 | 2026-02-25 | Initial analysis -- 87 items, 98.9% match | gap-detector |
