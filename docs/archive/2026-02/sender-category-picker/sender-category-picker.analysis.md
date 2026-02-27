# sender-category-picker Analysis Report

> **Analysis Type**: Gap Analysis (Design vs Implementation)
>
> **Project**: sales
> **Analyst**: gap-detector
> **Date**: 2026-02-19
> **Design Doc**: [sender-category-picker.design.md](../02-design/features/sender-category-picker.design.md)

---

## 1. Analysis Overview

### 1.1 Analysis Purpose

Verify that the "sender-category-picker" feature implementation matches the design document exactly. This feature replaces the manual category code Input with two cascading Select dropdowns (main + sub category) in the SenderProfileRegisterDialog, powered by a new SWR hook.

### 1.2 Analysis Scope

- **Design Document**: `docs/02-design/features/sender-category-picker.design.md`
- **Implementation Files**:
  - `src/hooks/useAlimtalkCategories.ts` (new file)
  - `src/components/alimtalk/SenderProfileRegisterDialog.tsx` (modified)
- **Non-change Files Verified**:
  - `src/pages/api/alimtalk/sender-categories.ts`
  - `src/lib/nhn-alimtalk.ts`
  - `src/hooks/useAlimtalkSenders.ts`
  - `src/lib/db/schema.ts`
- **Analysis Date**: 2026-02-19

---

## 2. Gap Analysis (Design vs Implementation)

### 2.1 SWR Hook: useAlimtalkCategories (Section 2.1)

| # | Design Item | Design Spec | Implementation | Status |
|---|-------------|-------------|----------------|--------|
| 1 | File path | `src/hooks/useAlimtalkCategories.ts` | `src/hooks/useAlimtalkCategories.ts` | MATCH |
| 2 | Import: useSWR | `import useSWR from "swr"` | `import useSWR from "swr"` (L1) | MATCH |
| 3 | Import: useAlimtalkConfig | `import { useAlimtalkConfig } from "./useAlimtalkConfig"` | `import { useAlimtalkConfig } from "./useAlimtalkConfig"` (L2) | MATCH |
| 4 | Import: NhnSenderCategory type | `import type { NhnSenderCategory } from "@/lib/nhn-alimtalk"` | `import type { NhnSenderCategory } from "@/lib/nhn-alimtalk"` (L3) | MATCH |
| 5 | CategoriesResponse interface | `{ success: boolean; data?: NhnSenderCategory[]; error?: string }` | `{ success: boolean; data?: NhnSenderCategory[]; error?: string }` (L5-9) | MATCH |
| 6 | fetcher function | `(url: string) => fetch(url).then((r) => r.json())` | `(url: string) => fetch(url).then((r) => r.json())` (L11) | MATCH |
| 7 | Export: named function | `export function useAlimtalkCategories()` | `export function useAlimtalkCategories()` (L13) | MATCH |
| 8 | isConfigured from useAlimtalkConfig | `const { isConfigured } = useAlimtalkConfig()` | `const { isConfigured } = useAlimtalkConfig()` (L14) | MATCH |
| 9 | SWR generic type | `useSWR<CategoriesResponse>` | `useSWR<CategoriesResponse>` (L16) | MATCH |
| 10 | SWR key: conditional on isConfigured | `isConfigured ? "/api/alimtalk/sender-categories" : null` | `isConfigured ? "/api/alimtalk/sender-categories" : null` (L17) | MATCH |
| 11 | SWR option: revalidateOnFocus false | `{ revalidateOnFocus: false }` | `{ revalidateOnFocus: false }` (L19) | MATCH |
| 12 | Return: categories | `data?.success ? (data.data ?? []) : []` | `data?.success ? (data.data ?? []) : []` (L23) | MATCH |
| 13 | Return: isLoading | `isLoading` | `isLoading` (L24) | MATCH |
| 14 | Return: error | `error \|\| (data && !data.success ? data.error : null)` | `error \|\| (data && !data.success ? data.error : null)` (L25) | MATCH |

**Section 2.1 Result: 14/14 MATCH**

### 2.2 Dialog Modifications: SenderProfileRegisterDialog (Section 2.2)

#### Change 1: Imports Added

| # | Design Item | Design Spec | Implementation | Status |
|---|-------------|-------------|----------------|--------|
| 15 | Import useAlimtalkCategories | `import { useAlimtalkCategories } from "@/hooks/useAlimtalkCategories"` | L3 | MATCH |
| 16 | Import Select | `import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"` | L4-17 | MATCH |

#### Change 2: State + Hook

| # | Design Item | Design Spec | Implementation | Status |
|---|-------------|-------------|----------------|--------|
| 17 | Hook destructure | `const { categories, isLoading: categoriesLoading } = useAlimtalkCategories()` | L34 | MATCH |
| 18 | mainCategoryCode state | `const [mainCategoryCode, setMainCategoryCode] = useState("")` | L41 | MATCH |

#### Change 3: Derived Data

| # | Design Item | Design Spec | Implementation | Status |
|---|-------------|-------------|----------------|--------|
| 19 | subCategories computed | `categories.find((c) => c.code === mainCategoryCode)?.subCategories ?? []` | L44-46 | MATCH |

#### Change 4: handleMainCategoryChange Handler

| # | Design Item | Design Spec | Implementation | Status |
|---|-------------|-------------|----------------|--------|
| 20 | Handler function name | `handleMainCategoryChange` | `handleMainCategoryChange` (L48) | MATCH |
| 21 | Sets mainCategoryCode | `setMainCategoryCode(code)` | `setMainCategoryCode(code)` (L49) | MATCH |
| 22 | Resets categoryCode | `setCategoryCode("")` | `setCategoryCode("")` (L50) | MATCH |

#### Change 5: handleClose Resets mainCategoryCode

| # | Design Item | Design Spec | Implementation | Status |
|---|-------------|-------------|----------------|--------|
| 23 | handleClose includes setStep(1) | `setStep(1)` | L91 | MATCH |
| 24 | handleClose includes setPlusFriendId("") | `setPlusFriendId("")` | L92 | MATCH |
| 25 | handleClose includes setPhoneNo("") | `setPhoneNo("")` | L93 | MATCH |
| 26 | handleClose includes setMainCategoryCode("") | `setMainCategoryCode("")` | L94 | MATCH |
| 27 | handleClose includes setCategoryCode("") | `setCategoryCode("")` | L95 | MATCH |
| 28 | handleClose includes setToken("") | `setToken("")` | L96 | MATCH |
| 29 | handleClose includes onOpenChange(false) | `onOpenChange(false)` | L97 | MATCH |

#### Change 6: UI - Main Category Select

| # | Design Item | Design Spec | Implementation | Status |
|---|-------------|-------------|----------------|--------|
| 30 | Old Input removed | No `<Input id="categoryCode" ...>` | Not present in implementation | MATCH |
| 31 | Old helper text removed | No `NHN Cloud 콘솔에서...` | Not present in implementation | MATCH |
| 32 | Label text | `<Label>카테고리</Label>` | L135 | MATCH |
| 33 | Main Select value | `value={mainCategoryCode}` | L137 | MATCH |
| 34 | Main Select onValueChange | `onValueChange={handleMainCategoryChange}` | L138 | MATCH |
| 35 | Main Select disabled | `disabled={categoriesLoading}` | L139 | MATCH |
| 36 | Main SelectValue placeholder (loading) | `"로딩 중..."` when categoriesLoading | L142 | MATCH |
| 37 | Main SelectValue placeholder (ready) | `"메인 카테고리 선택"` | L142 | MATCH |
| 38 | Main SelectItem key | `key={cat.code}` | L145 | MATCH |
| 39 | Main SelectItem value | `value={cat.code}` | L145 | MATCH |
| 40 | Main SelectItem content | `{cat.name}` | L146 | MATCH |

#### Change 6: UI - Sub Category Select

| # | Design Item | Design Spec | Implementation | Status |
|---|-------------|-------------|----------------|--------|
| 41 | Conditional render | `{mainCategoryCode && subCategories.length > 0 && (...)}` | L153 | MATCH |
| 42 | Sub Label text | `<Label>서브 카테고리</Label>` | L155 | MATCH |
| 43 | Sub Select value | `value={categoryCode}` | L157 | MATCH |
| 44 | Sub Select onValueChange | `onValueChange={setCategoryCode}` | L158 | MATCH |
| 45 | Sub SelectValue placeholder | `"서브 카테고리 선택"` | L161 | MATCH |
| 46 | Sub SelectItem key | `key={sub.code}` | L164 | MATCH |
| 47 | Sub SelectItem value | `value={sub.code}` | L164 | MATCH |
| 48 | Sub SelectItem content | `{sub.name}` | L165 | MATCH |

**Section 2.2 Result: 34/34 MATCH**

### 2.3 Edge Cases (Section 4)

| # | Edge Case | Design Handling | Implementation | Status |
|---|-----------|-----------------|----------------|--------|
| 49 | Alimtalk not configured | SWR key null, Select disabled | `isConfigured ? ... : null` (hook L17), `disabled={categoriesLoading}` (dialog L139) | MATCH |
| 50 | Categories loading | Select disabled + "로딩 중..." placeholder | `disabled={categoriesLoading}`, placeholder ternary (dialog L139, L142) | MATCH |
| 51 | No sub-categories for main | Sub Select not rendered | `mainCategoryCode && subCategories.length > 0` guard (L153) | MATCH |
| 52 | Main category change | Sub selection reset | `setCategoryCode("")` in handleMainCategoryChange (L50) | MATCH |
| 53 | API error | categories=[], Select has no items | `data?.success ? (data.data ?? []) : []` returns empty array (hook L23) | MATCH |

**Section 4 Result: 5/5 MATCH**

### 2.4 Non-Change Files (Section 5)

| # | File | Design: Should NOT Change | Verification | Status |
|---|------|---------------------------|--------------|--------|
| 54 | `src/pages/api/alimtalk/sender-categories.ts` | Already implemented, no change needed | File exists, standard GET handler, no alimtalk-category-picker modifications | MATCH |
| 55 | `src/lib/nhn-alimtalk.ts` | NhnSenderCategory type + getSenderCategories() already exist | Type at L30-36, method at L237-242 confirmed present | MATCH |
| 56 | `src/hooks/useAlimtalkSenders.ts` | registerSender only needs categoryCode string | registerSender param `categoryCode: string` (L26), no category-related imports added | MATCH |
| 57 | DB schema | No category storage needed | No alimtalk sender category table in schema.ts | MATCH |

**Section 5 Result: 4/4 MATCH**

---

## 3. Match Rate Summary

```
Total Items Checked:  57
Matches:              57
Gaps:                  0
Match Rate:          100%
```

| Category | Items | Matches | Rate | Status |
|----------|:-----:|:-------:|:----:|:------:|
| Section 2.1 - SWR Hook | 14 | 14 | 100% | PASS |
| Section 2.2 - Dialog Changes | 34 | 34 | 100% | PASS |
| Section 4 - Edge Cases | 5 | 5 | 100% | PASS |
| Section 5 - Non-Change Files | 4 | 4 | 100% | PASS |
| **Overall** | **57** | **57** | **100%** | **PASS** |

---

## 4. Gaps Found

No gaps found. Design and implementation match exactly at 100%.

---

## 5. Positive Non-Gap Observations

The implementation is a precise, line-for-line match of the design document. Notable quality attributes:

1. **Hook pattern consistency**: `useAlimtalkCategories` mirrors the established `useAlimtalkSenders` pattern (same fetcher, same conditional SWR key, same response shape).
2. **State colocation**: `mainCategoryCode` state is declared adjacent to existing `categoryCode` state for readability.
3. **Clean reset logic**: `handleClose` resets all 6 state variables including the new `mainCategoryCode`, preventing stale data on dialog reopen.

---

## 6. Recommended Actions

No actions required. Match rate is 100%.

---

## Version History

| Version | Date | Changes | Author |
|---------|------|---------|--------|
| 1.0 | 2026-02-19 | Initial analysis - 57/57 items match (100%) | gap-detector |
