# ai-widget-config Analysis Report

> **Analysis Type**: Gap Analysis (Design vs Implementation)
>
> **Project**: Sales Manager
> **Analyst**: gap-detector
> **Date**: 2026-02-26
> **Design Doc**: [ai-widget-config.design.md](../02-design/features/ai-widget-config.design.md)
> **Plan Doc**: [ai-widget-config.plan.md](../01-plan/features/ai-widget-config.plan.md)

---

## 1. Analysis Overview

### 1.1 Analysis Purpose

Verify that the ai-widget-config feature implementation matches its design specification across API, AI function, and UI layers.

### 1.2 Analysis Scope

- **Design Document**: `docs/02-design/features/ai-widget-config.design.md`
- **Implementation Files**:
  - `src/lib/ai.ts` (lines 893-1023: `generateWidget()` + `buildWidgetSystemPrompt()`)
  - `src/pages/api/ai/generate-widget.ts` (new API endpoint)
  - `src/components/dashboard/WidgetConfigDialog.tsx` (AI helper UI)
- **Analysis Date**: 2026-02-26

---

## 2. Gap Analysis (Design vs Implementation)

### 2.1 API Endpoint: POST /api/ai/generate-widget

| # | Design Item | Design Location | Implementation Location | Status |
|---|-------------|-----------------|------------------------|--------|
| 1 | Endpoint URL: POST /api/ai/generate-widget | design.md:9 | generate-widget.ts:6 | ✅ Match |
| 2 | Method check: POST only | design.md:9 | generate-widget.ts:6-8 (405 response) | ✅ Match |
| 3 | Request body: `{ prompt, workspaceFields }` | design.md:13-21 | generate-widget.ts:23 | ✅ Match |
| 4 | Response: `{ success: true, data: { title, widgetType, dataColumn, aggregation, groupByColumn, stackByColumn } }` | design.md:24-36 | generate-widget.ts:44-54 | ✅ Match |
| 5 | Error 401: auth required | design.md:40 | generate-widget.ts:11-12 | ✅ Match |
| 6 | Error 400: AI not configured | design.md:41 | generate-widget.ts:16-20 | ✅ Match |
| 7 | Error 400: prompt missing | design.md:41 | generate-widget.ts:24-26 | ✅ Match |
| 8 | Error 500: AI call failure | design.md:42 | generate-widget.ts:55-58 | ✅ Match |
| 9 | Error 405: method not allowed | not in design | generate-widget.ts:7 | ✅ Positive addition |

### 2.2 Auth Flow

| # | Design Item | Design Location | Implementation Location | Status |
|---|-------------|-----------------|------------------------|--------|
| 10 | Step 1: getUserFromRequest(req) | design.md:47 | generate-widget.ts:10 | ✅ Match |
| 11 | Step 2: getAiClient(user.orgId) | design.md:48 | generate-widget.ts:15 | ✅ Match |
| 12 | Step 3: generateWidget(client, { prompt, workspaceFields }) | design.md:49 | generate-widget.ts:29-32 | ✅ Match |
| 13 | Step 4: logAiUsage(..., purpose: "widget_generation") | design.md:50 | generate-widget.ts:34-42 | ✅ Match |
| 14 | Step 5: return single widget config JSON | design.md:51 | generate-widget.ts:44-54 | ✅ Match |

### 2.3 AI Function: generateWidget() in src/lib/ai.ts

| # | Design Item | Design Location | Implementation Location | Status |
|---|-------------|-----------------|------------------------|--------|
| 15 | Interface: GenerateWidgetInput { prompt, workspaceFields } | design.md:62-65 | ai.ts:895-898 | ✅ Match |
| 16 | Interface: GenerateWidgetResult { title, widgetType, dataColumn, aggregation, groupByColumn, stackByColumn, usage } | design.md:67-75 | ai.ts:900-908 | ✅ Match |
| 17 | workspaceFields type: Array<{ key, label, fieldType }> | design.md:64 | ai.ts:897 | ✅ Match |
| 18 | usage type: { promptTokens, completionTokens } | design.md:74 | ai.ts:907 | ✅ Match |
| 19 | OpenAI branch: fetch + response_format json_object | design.md:116 | ai.ts:958-983 | ✅ Match |
| 20 | Anthropic branch: fetch + max_tokens 2048 | design.md:116 (single widget) | ai.ts:984-1010 (line 994: max_tokens 2048) | ✅ Match |
| 21 | JSON extraction pattern: `/\{[\s\S]*"title"[\s\S]*"widgetType"[\s\S]*\}/` | design.md:119 | ai.ts:953 | ✅ Match |
| 22 | extractJson() reuse | design.md:120 | ai.ts:1012 | ✅ Match |
| 23 | Result field mapping with fallbacks | design.md:67-75 | ai.ts:1014-1022 | ✅ Match |
| 24 | Function exported | design.md:198 | ai.ts:948 (`export async function`) | ✅ Match |

### 2.4 AI System Prompt: buildWidgetSystemPrompt()

| # | Design Item | Design Location | Implementation Location | Status |
|---|-------------|-----------------|------------------------|--------|
| 25 | Role: "데이터 대시보드 위젯 설정 전문가" | design.md:81 | ai.ts:911 | ✅ Match |
| 26 | Instruction: "위젯 1개를 설계하세요" | design.md:82 | ai.ts:912 | ✅ Match |
| 27 | JSON format spec with 6 fields | design.md:84-92 | ai.ts:914-922 | ✅ Match |
| 28 | Rule: widgetType enum list | design.md:95 | ai.ts:925 | ✅ Match |
| 29 | Rule: scorecard groupByColumn empty | design.md:96 | ai.ts:926 | ✅ Match |
| 30 | Rule: bar_stacked stackByColumn | design.md:97 | ai.ts:927 | ✅ Match |
| 31 | Rule: dataColumn/groupByColumn from field keys | design.md:98 | ai.ts:928 | ✅ Match |
| 32 | Rule: aggregation count/sum/avg | design.md:99 | ai.ts:929 | ✅ Match |
| 33 | Rule: Korean title | design.md:100 | ai.ts:930 | ✅ Match |
| 34 | Rule: JSON only response | design.md:101 | ai.ts:931 | ✅ Match |
| 35 | System field: _sys:registeredAt (등록일시) | design.md:104 | ai.ts:934 | ✅ Match |
| 36 | System field: _sys:createdAt (생성일시) | design.md:105 | ai.ts:935 | ✅ Match |
| 37 | System field: _sys:updatedAt (수정일시) | design.md:106 | ai.ts:936 | ✅ Match |
| 38 | Workspace fields loop with key/label/fieldType | design.md:108-111 | ai.ts:938-943 | ✅ Match |

### 2.5 UI: WidgetConfigDialog AI Helper

| # | Design Item | Design Location | Implementation Location | Status |
|---|-------------|-----------------|------------------------|--------|
| 39 | AI helper area at dialog top | design.md:126-147 (layout diagram) | WidgetConfigDialog.tsx:157 (first child in space-y-4) | ✅ Match |
| 40 | Dashed border styling | design.md:127 | WidgetConfigDialog.tsx:157 (`border border-dashed p-3 bg-muted/30`) | ✅ Match |
| 41 | Sparkles icon + "AI 도우미" label | design.md:133 | WidgetConfigDialog.tsx:158-160 | ✅ Match |
| 42 | State: aiPrompt (useState("")) | design.md:152 | WidgetConfigDialog.tsx:81 | ✅ Match |
| 43 | State: aiLoading (useState(false)) | design.md:153 | WidgetConfigDialog.tsx:82 | ✅ Match |
| 44 | Input field with placeholder | design.md:135 | WidgetConfigDialog.tsx:162-170 | ✅ Match |
| 45 | "추천" button text | design.md:135 | WidgetConfigDialog.tsx:182 | ✅ Match |
| 46 | Enter key support: onKeyDown handler | design.md (implied by UX) | WidgetConfigDialog.tsx:166-168 | ✅ Match |
| 47 | Loader2 spinner during loading | design.md (FR-04 in plan) | WidgetConfigDialog.tsx:179 (`Loader2 animate-spin`) | ✅ Match |
| 48 | Button disabled during loading | design.md (FR-04 in plan) | WidgetConfigDialog.tsx:175 (`disabled={aiLoading \|\| !aiPrompt.trim()}`) | ✅ Match |
| 49 | Input disabled during loading | not in design | WidgetConfigDialog.tsx:169 (`disabled={aiLoading}`) | ✅ Positive addition |
| 50 | Fetch POST /api/ai/generate-widget | design.md:161 | WidgetConfigDialog.tsx:103-113 | ✅ Match |
| 51 | Request: prompt + workspaceFields mapped from fields | design.md:164-168 | WidgetConfigDialog.tsx:106-113 | ✅ Match |
| 52 | Auto-fill: setTitle(d.title) | design.md:174 | WidgetConfigDialog.tsx:118 | ✅ Match |
| 53 | Auto-fill: setWidgetType(d.widgetType) | design.md:175 | WidgetConfigDialog.tsx:119 | ✅ Match |
| 54 | Auto-fill: setDataColumn(d.dataColumn) | design.md:176 | WidgetConfigDialog.tsx:120 | ✅ Match |
| 55 | Auto-fill: setAggregation(d.aggregation) | design.md:177 | WidgetConfigDialog.tsx:121 | ✅ Match |
| 56 | Auto-fill: setGroupByColumn(d.groupByColumn \|\| "") | design.md:178 | WidgetConfigDialog.tsx:122 | ✅ Match |
| 57 | Auto-fill: setStackByColumn(d.stackByColumn \|\| "") | design.md:179 | WidgetConfigDialog.tsx:123 | ✅ Match |
| 58 | toast.error on failure: json.error fallback | design.md:181 | WidgetConfigDialog.tsx:126 | ✅ Match |
| 59 | toast.success on AI response | not in design | WidgetConfigDialog.tsx:124 (`toast.success("AI가 위젯 설정을 추천했습니다.")`) | ✅ Positive addition |
| 60 | toast.error on network/catch error | not in design | WidgetConfigDialog.tsx:129 | ✅ Positive addition |
| 61 | No hasAi prop -- AI area always visible | design.md:192 ("항상 표시하되 호출 실패 시 에러 토스트로 안내") | WidgetConfigDialog.tsx:44-64 (no hasAi in props) | ✅ Match |
| 62 | aiPrompt reset on dialog open | not in design | WidgetConfigDialog.tsx:93 (`setAiPrompt("")`) | ✅ Positive addition |
| 63 | Empty prompt guard in handler | not in design | WidgetConfigDialog.tsx:100 (`if (!aiPrompt.trim()) return`) | ✅ Positive addition |

### 2.6 logAiUsage Integration

| # | Design Item | Design Location | Implementation Location | Status |
|---|-------------|-----------------|------------------------|--------|
| 64 | purpose: "widget_generation" | design.md:50 | generate-widget.ts:41 | ✅ Match |
| 65 | Token usage passed from result | design.md:50 | generate-widget.ts:39-40 | ✅ Match |
| 66 | Provider/model from client | design.md:50 | generate-widget.ts:37-38 | ✅ Match |

### 2.7 Convention Compliance

| # | Item | Convention | Implementation | Status |
|---|------|-----------|----------------|--------|
| 67 | File name: generate-widget.ts | kebab-case | generate-widget.ts | ✅ Match |
| 68 | Component name: WidgetConfigDialog | PascalCase | WidgetConfigDialog.tsx | ✅ Match |
| 69 | Function names: camelCase | camelCase | generateWidget, buildWidgetSystemPrompt, handleAiSuggest | ✅ Match |
| 70 | Constants: UPPER_SNAKE_CASE | UPPER_SNAKE_CASE | WIDGET_TYPES, AGGREGATIONS, SYSTEM_FIELDS | ✅ Match |
| 71 | Import order: external -> internal -> relative -> type | correct | generate-widget.ts (type first, then @/ imports) | ✅ Match |
| 72 | Import order: WidgetConfigDialog.tsx | correct | react -> @/components -> sonner -> lucide -> @/types | ✅ Match |

---

## 3. Plan vs Design Discrepancy

| # | Plan Item | Design Decision | Implementation | Notes |
|---|-----------|----------------|----------------|-------|
| P1 | FR-05: AI 미설정 시 AI 도우미 영역 숨김 | Section 4: "항상 표시, 에러 토스트로 안내" | Always visible, toast on error | Design explicitly overrides plan. Implementation follows design correctly. |

---

## 4. Match Rate Summary

```
Total comparison items: 72

  ✅ Match:             66 items  (91.7%)
  ✅ Positive addition:  6 items  ( 8.3%)
  ❌ Not implemented:    0 items  ( 0.0%)
  ❌ Design gap:         0 items  ( 0.0%)
```

### Positive Additions (Design X, Implementation O)

These are defensive improvements added in implementation beyond the design spec:

| # | Item | Location | Description |
|---|------|----------|-------------|
| 9 | 405 method guard | generate-widget.ts:7 | Rejects non-POST methods |
| 49 | Input disabled during loading | WidgetConfigDialog.tsx:169 | Prevents typing during AI call |
| 59 | toast.success on AI success | WidgetConfigDialog.tsx:124 | User feedback on successful recommendation |
| 60 | toast.error on network error | WidgetConfigDialog.tsx:129 | Catches fetch/network-level errors |
| 62 | aiPrompt reset on dialog open | WidgetConfigDialog.tsx:93 | Clean state on dialog reopen |
| 63 | Empty prompt guard | WidgetConfigDialog.tsx:100 | Prevents empty API calls client-side |

All additions follow existing project patterns (defensive input handling, UX feedback) and are beneficial.

---

## 5. Architecture Compliance

| Layer | File | Expected Layer | Actual Layer | Status |
|-------|------|---------------|--------------|--------|
| Infrastructure | src/lib/ai.ts | Infrastructure | Infrastructure (src/lib/) | ✅ |
| API Route | src/pages/api/ai/generate-widget.ts | Presentation/API | Presentation (src/pages/api/) | ✅ |
| Component | src/components/dashboard/WidgetConfigDialog.tsx | Presentation | Presentation (src/components/) | ✅ |

Import direction compliance:
- API route imports from Infrastructure (`@/lib/auth`, `@/lib/ai`) -- correct
- Component imports from UI lib (`@/components/ui/*`) and types (`@/types`) -- correct
- No forbidden cross-layer imports detected

Architecture Score: **100%**

---

## 6. Convention Compliance

| Category | Convention | Checked | Compliant | Score |
|----------|-----------|:-------:|:---------:|:-----:|
| Component naming | PascalCase | 1 | 1 | 100% |
| Function naming | camelCase | 5 | 5 | 100% |
| Constant naming | UPPER_SNAKE_CASE | 3 | 3 | 100% |
| File naming | kebab-case / PascalCase | 3 | 3 | 100% |
| Import order | external -> internal -> types | 3 | 3 | 100% |
| Folder structure | components/dashboard, pages/api/ai, lib | 3 | 3 | 100% |

Convention Score: **100%**

---

## 7. Overall Scores

| Category | Score | Status |
|----------|:-----:|:------:|
| Design Match | 100% | ✅ |
| Architecture Compliance | 100% | ✅ |
| Convention Compliance | 100% | ✅ |
| **Overall** | **100%** | ✅ |

---

## 8. Conclusion

The ai-widget-config feature implementation is a **100% match** with its design document across all 66 design specification items. An additional 6 defensive improvements were found in the implementation that go beyond the design spec, all following established project patterns.

Key highlights:
- API endpoint implements all designed request/response formats and error codes
- Auth flow follows the exact 5-step sequence from design
- `generateWidget()` and `buildWidgetSystemPrompt()` match design interfaces and prompt structure precisely
- All 3 system fields (`_sys:registeredAt`, `_sys:createdAt`, `_sys:updatedAt`) are included in the system prompt
- JSON extraction pattern is character-for-character identical
- Anthropic max_tokens correctly set to 2048 (vs 4096 for dashboard generation)
- UI layout, states, handlers, and form auto-fill match the design wireframe
- AI area is always visible (no hasAi prop), matching the design decision to override the plan's FR-05
- All naming conventions, import orders, and architecture layers are compliant

No recommended actions required. Design and implementation are fully synchronized.

---

## Version History

| Version | Date | Changes | Author |
|---------|------|---------|--------|
| 1.0 | 2026-02-26 | Initial gap analysis | gap-detector |
