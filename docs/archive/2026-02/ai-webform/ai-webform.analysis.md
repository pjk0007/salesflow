# ai-webform Analysis Report

> **Analysis Type**: Gap Analysis (Design vs Implementation)
>
> **Project**: Sales Manager
> **Analyst**: gap-detector
> **Date**: 2026-02-25
> **Design Doc**: [ai-webform.design.md](../02-design/features/ai-webform.design.md)

---

## 1. Analysis Overview

### 1.1 Analysis Purpose

Verify that the "ai-webform" feature (AI-powered web form field auto-generation) was implemented correctly according to the design document.

### 1.2 Analysis Scope

- **Design Document**: `docs/02-design/features/ai-webform.design.md`
- **Implementation Files**:
  - `src/lib/ai.ts` -- `generateWebForm()` + `buildWebFormSystemPrompt()` added
  - `src/pages/api/ai/generate-webform.ts` -- new API endpoint
  - `src/pages/web-forms/[id].tsx` -- AI generation UI (Popover + handleAiGenerate)

---

## 2. Gap Analysis (Design vs Implementation)

### 2.1 `src/lib/ai.ts` -- Types

| # | Design | Implementation | Status |
|---|--------|---------------|--------|
| 1 | `interface GenerateWebFormInput { prompt: string; workspaceFields?: Array<{ key: string; label: string }> }` | Lines 602-605: identical interface | Match |
| 2 | `interface GenerateWebFormResult { title, description, fields: Array<{label, description, placeholder, fieldType, linkedFieldKey, isRequired, options}>, usage }` | Lines 617-622: identical structure with `GenerateWebFormField[]` for fields | Match |
| 3 | Field type: `label: string` | `GenerateWebFormField` line 608 | Match |
| 4 | Field type: `description: string` | `GenerateWebFormField` line 609 | Match |
| 5 | Field type: `placeholder: string` | `GenerateWebFormField` line 610 | Match |
| 6 | Field type: `fieldType: string` | `GenerateWebFormField` line 611 | Match |
| 7 | Field type: `linkedFieldKey: string` | `GenerateWebFormField` line 612 | Match |
| 8 | Field type: `isRequired: boolean` | `GenerateWebFormField` line 613 | Match |
| 9 | Field type: `options: string[]` | `GenerateWebFormField` line 614 | Match |
| 10 | `usage: { promptTokens: number; completionTokens: number }` | Line 621 | Match |
| 11 | (Design does not define separate `GenerateWebFormField` interface) | Implementation adds `GenerateWebFormField` at lines 607-615 | Added |

### 2.2 `src/lib/ai.ts` -- `buildWebFormSystemPrompt()`

| # | Design | Implementation | Status |
|---|--------|---------------|--------|
| 12 | Function signature: `buildWebFormSystemPrompt(workspaceFields?)` | Line 624: `function buildWebFormSystemPrompt(workspaceFields?: Array<{ key: string; label: string }>): string` | Match |
| 13 | Opening line: "당신은 웹폼 필드 설계 전문가입니다." | Line 625 | Match |
| 14 | "사용자의 요청에 맞는 웹 폼을 설계하세요." | Line 626 | Match |
| 15 | "반드시 다음 JSON 형식으로 응답하세요:" | Line 628 | Match |
| 16 | JSON format with title, description, fields array | Lines 629-643 | Match |
| 17 | Rule: fieldType options (text, email, phone, textarea, select, checkbox, date) | Line 646 | Match |
| 18 | Rule: email field type for email collection | Line 647 | Match |
| 19 | Rule: phone field type for phone number | Line 648 | Match |
| 20 | Rule: select type requires options, others use empty array | Line 649 | Match |
| 21 | Rule: write in Korean | Line 650 | Match |
| 22 | Rule: generate 5-10 appropriate fields | Line 651 | Match |
| 23 | (Design does not include "JSON만 반환하세요" rule) | Line 652: adds "- JSON만 반환하세요" | Added |
| 24 | Design example field description: `"필드 설명 (선택)"` | Implementation example: `""` (empty string) | Changed |
| 25 | Workspace fields section: conditional append when `workspaceFields.length > 0` | Lines 654-659 | Match |
| 26 | Workspace fields header text: "[워크스페이스 필드 목록]" + mapping instruction | Line 655 | Match |
| 27 | Workspace fields list: `- ${f.key} (${f.label})` format | Line 657 | Match |

### 2.3 `src/lib/ai.ts` -- `generateWebForm()`

| # | Design | Implementation | Status |
|---|--------|---------------|--------|
| 28 | Exported function: `export async function generateWebForm(client: AiClient, input: GenerateWebFormInput): Promise<GenerateWebFormResult>` | Line 664-667 | Match |
| 29 | Build system prompt: `buildWebFormSystemPrompt(input.workspaceFields)` | Line 668 | Match |
| 30 | JSON extraction pattern: `/\{[\s\S]*"title"[\s\S]*"fields"[\s\S]*\}/` | Line 669 | Match |
| 31 | OpenAI branch: `client.provider === "openai"` | Line 674 | Match |
| 32 | OpenAI: fetch to `https://api.openai.com/v1/chat/completions` | Line 675 | Match |
| 33 | OpenAI: `Authorization: Bearer ${client.apiKey}` header | Line 678 | Match |
| 34 | OpenAI: `response_format: { type: "json_object" }` | Line 687 | Match |
| 35 | OpenAI: system + user message structure | Lines 683-686 | Match |
| 36 | OpenAI: model from `client.model` | Line 682 | Match |
| 37 | OpenAI: error handling on `!response.ok` | Lines 690-693 | Match |
| 38 | OpenAI: extract content from `data.choices[0]?.message?.content` | Line 695 | Match |
| 39 | OpenAI: usage from `prompt_tokens` / `completion_tokens` | Lines 696-699 | Match |
| 40 | Anthropic branch: else clause | Line 700 | Match |
| 41 | Anthropic: fetch to `https://api.anthropic.com/v1/messages` | Line 701 | Match |
| 42 | Anthropic: `x-api-key` + `anthropic-version` headers | Lines 704-706 | Match |
| 43 | Anthropic: `max_tokens: 4096` | Line 710 | Match |
| 44 | Anthropic: system prompt as `system` field | Line 711 | Match |
| 45 | Anthropic: user message structure | Line 712 | Match |
| 46 | Anthropic: error handling on `!response.ok` | Lines 715-718 | Match |
| 47 | Anthropic: find text block from content | Line 720 | Match |
| 48 | Anthropic: usage from `input_tokens` / `output_tokens` | Lines 722-725 | Match |
| 49 | Parse with `extractJson(content, pattern)` | Line 728 | Match |
| 50 | Map fields with defaults: `label \|\| ""`, `description \|\| ""`, `placeholder \|\| ""`, `fieldType \|\| "text"`, `linkedFieldKey \|\| ""`, `!!isRequired`, `Array.isArray(options) ? options : []` | Lines 729-737 | Match |
| 51 | Return `{ title, description, fields, usage }` | Lines 739-744 | Match |
| 52 | Design: function position after `generateCompanyResearch()`, before `logAiUsage()` | `generateCompanyResearch` ends L598, `generateWebForm` at L664, `logAiUsage` at L749 | Match |
| 53 | Design: no web search (uses direct fetch, not `callOpenAIWithSearch`/`callAnthropicWithSearch`) | Implementation uses direct fetch calls | Match |

### 2.4 `src/pages/api/ai/generate-webform.ts` -- API Endpoint

| # | Design | Implementation | Status |
|---|--------|---------------|--------|
| 54 | Import: `NextApiRequest, NextApiResponse` from "next" | Line 1 | Match |
| 55 | Import: `getUserFromRequest` from "@/lib/auth" | Line 2 | Match |
| 56 | Import: `getAiClient, generateWebForm, logAiUsage` from "@/lib/ai" | Line 3 | Match |
| 57 | POST only check | Lines 6-8: returns 405 with error message | Match |
| 58 | `getUserFromRequest(req)` -> 401 on null | Lines 10-12 | Match |
| 59 | `getAiClient(user.orgId)` -> 400 "AI 설정이 필요합니다" | Lines 15-20: message expanded with guidance text | Match |
| 60 | `req.body.prompt` required validation | Lines 23-26: validates type and trim | Match |
| 61 | `req.body.workspaceFields` (optional, destructured) | Line 23 | Match |
| 62 | `generateWebForm(client, { prompt: prompt.trim(), workspaceFields })` | Lines 29-32 | Match |
| 63 | `logAiUsage` with `orgId, userId, provider, model, promptTokens, completionTokens` | Lines 34-42 | Match |
| 64 | `purpose: "webform_generation"` | Line 42 | Match |
| 65 | Response: `{ success: true, data: { title, description, fields } }` | Lines 44-51 | Match |
| 66 | Design mentions "generate-product.ts와 동일 구조" (pattern reference) | Implementation follows same pattern with try-catch + 500 error | Match |
| 67 | (Design does not show explicit try-catch) | Implementation adds try-catch with 500 error response (lines 52-56) | Added |

### 2.5 `src/pages/web-forms/[id].tsx` -- New States

| # | Design | Implementation | Status |
|---|--------|---------------|--------|
| 68 | `const [aiOpen, setAiOpen] = useState(false)` | Line 43 | Match |
| 69 | `const [aiPrompt, setAiPrompt] = useState("")` | Line 44 | Match |
| 70 | `const [aiGenerating, setAiGenerating] = useState(false)` | Line 45 | Match |

### 2.6 `src/pages/web-forms/[id].tsx` -- New Imports

| # | Design | Implementation | Status |
|---|--------|---------------|--------|
| 71 | `Sparkles` from "lucide-react" | Line 17: `import { ArrowLeft, Link2, Sparkles } from "lucide-react"` | Match |
| 72 | `Textarea` from "@/components/ui/textarea" | Line 10 | Match |
| 73 | `Popover, PopoverContent, PopoverTrigger` from "@/components/ui/popover" | Lines 11-15 | Match |

### 2.7 `src/pages/web-forms/[id].tsx` -- Popover UI

| # | Design | Implementation | Status |
|---|--------|---------------|--------|
| 74 | Popover wrapping div: `<div className="flex items-center gap-2">` | Line 197 | Match |
| 75 | `<Popover open={aiOpen} onOpenChange={setAiOpen}>` | Line 198 | Match |
| 76 | `<PopoverTrigger asChild>` | Line 199 | Match |
| 77 | `<Button variant="outline" size="sm">` | Line 200 | Match |
| 78 | `<Sparkles className="h-4 w-4 mr-1" /> AI 생성` | Line 201 | Match |
| 79 | `<PopoverContent align="end" className="w-80">` | Line 204 | Match |
| 80 | `<div className="space-y-3">` | Line 205 | Match |
| 81 | `<p className="text-sm font-medium">AI로 폼 필드 생성</p>` | Line 206 | Match |
| 82 | Textarea: `value={aiPrompt}` | Line 208 | Match |
| 83 | Textarea: `onChange={(e) => setAiPrompt(e.target.value)}` | Line 209 | Match |
| 84 | Textarea: `placeholder="예: B2B SaaS 무료 체험 신청 폼"` | Line 210 | Match |
| 85 | Textarea: `rows={3}` | Line 211 | Match |
| 86 | Generate Button: `className="w-full"` | Line 213 | Match |
| 87 | Generate Button: `onClick={handleAiGenerate}` | Line 215 | Match |
| 88 | Generate Button: `disabled={!aiPrompt.trim() \|\| aiGenerating}` | Line 216 | Match |
| 89 | Button text: `{aiGenerating ? "생성 중..." : "생성"}` | Line 218 | Match |
| 90 | Position: before embed button ("임베드 버튼 왼쪽에") | Lines 198-222 (Popover) before lines 223-231 (embed button) | Match |

### 2.8 `src/pages/web-forms/[id].tsx` -- `handleAiGenerate`

| # | Design | Implementation | Status |
|---|--------|---------------|--------|
| 91 | `if (!aiPrompt.trim()) return` | Line 127 | Match |
| 92 | Confirm dialog when `formFields.length > 0`: `confirm("기존 필드가 AI 생성 결과로 대체됩니다. 계속하시겠습니까?")` | Lines 128-130 | Match |
| 93 | `setAiGenerating(true)` | Line 131 | Match |
| 94 | fetch URL: `/api/ai/generate-webform` | Line 133 | Match |
| 95 | fetch method: `POST` | Line 134 | Match |
| 96 | fetch headers: `{ "Content-Type": "application/json" }` | Line 135 | Match |
| 97 | body: `JSON.stringify({ prompt: aiPrompt.trim(), workspaceFields: ... })` | Lines 136-139 | Match |
| 98 | workspaceFields mapping: `.map(f => ({ key: f.key, label: f.label }))` | Line 138 | Match |
| 99 | `const json = await res.json()` | Line 141 | Match |
| 100 | `if (json.success)` check | Line 142 | Match |
| 101 | `const data = json.data` | Line 143 | Match |
| 102 | `setFormTitle(data.title)` | Line 144 | Match |
| 103 | `setFormDescription(data.description)` | Line 145 | Match |
| 104 | `setFormFields(data.fields.map(...))` | Lines 146-157 | Match |
| 105 | Field mapping: `tempId: crypto.randomUUID()` | Line 148 | Match |
| 106 | Field mapping: `label: f.label` | Line 149 | Match |
| 107 | Field mapping: `description: f.description \|\| ""` | Line 150 | Match |
| 108 | Field mapping: `placeholder: f.placeholder \|\| ""` | Line 151 | Match |
| 109 | Field mapping: `fieldType: f.fieldType` | Line 152 | Match |
| 110 | Field mapping: `linkedFieldKey: f.linkedFieldKey \|\| ""` | Line 153 | Match |
| 111 | Field mapping: `isRequired: !!f.isRequired` | Line 154 | Match |
| 112 | Field mapping: `options: f.options \|\| []` | Line 155 | Match |
| 113 | `toast.success(\`${data.fields.length}개 필드가 생성되었습니다.\`)` | Line 158 | Match |
| 114 | `setAiOpen(false)` | Line 159 | Match |
| 115 | `setAiPrompt("")` | Line 160 | Match |
| 116 | Error: `toast.error(json.error \|\| "AI 생성에 실패했습니다.")` | Line 162 | Match |
| 117 | Catch: `toast.error("AI 생성 중 오류가 발생했습니다.")` | Line 165 | Match |
| 118 | `setAiGenerating(false)` at end | Line 167 | Match |
| 119 | Design: plain `async` function | Implementation: `useCallback` with dependency array `[aiPrompt, formFields.length, workspaceFields]` | Changed |

### 2.9 Unchanged Files Verification

| # | Design: Unchanged File | Status |
|---|----------------------|--------|
| 120 | `src/components/web-forms/FormBuilder.tsx` -- no interface change | Match (per design) |
| 121 | `src/components/web-forms/FormPreview.tsx` -- no props change | Match (per design) |
| 122 | `src/pages/web-forms/new.tsx` -- AI not needed | Match (per design) |
| 123 | `src/pages/web-forms/index.tsx` -- list page unchanged | Match (per design) |
| 124 | `src/hooks/useWebForms.ts` -- unchanged | Match (per design) |

### 2.10 Implementation Order

| # | Design Step | Implementation | Status |
|---|------------|---------------|--------|
| 125 | Step 1: `src/lib/ai.ts` -- add `generateWebForm()` + `buildWebFormSystemPrompt()` | Both functions present at lines 624-745 | Match |
| 126 | Step 2: `src/pages/api/ai/generate-webform.ts` -- new API endpoint | File exists with 57 lines | Match |
| 127 | Step 3: `src/pages/web-forms/[id].tsx` -- AI button + Popover + handleAiGenerate | All three elements present | Match |

---

## 3. Match Rate Summary

```
Total Items Checked:    127
Matched:                123  (96.9%)
Changed (minor):          2  (1.6%)
Added (beneficial):       2  (1.6%)
Missing:                  0  (0.0%)
```

### Matched Items (123)

All 123 items listed in sections 2.1-2.10 with "Match" status are fully consistent between design and implementation.

### Changed Items Detail

| # | Item | Design | Implementation | Severity |
|---|------|--------|---------------|----------|
| 24 | System prompt example field description | `"필드 설명 (선택)"` | `""` (empty string) | Low -- example value only, does not affect runtime behavior |
| 119 | handleAiGenerate wrapper | Plain `async` function | `useCallback` with `[aiPrompt, formFields.length, workspaceFields]` deps | Low -- render optimization improvement |

### Added Items Detail (Design X, Implementation O)

| # | Item | Location | Description | Impact |
|---|------|----------|-------------|--------|
| 11 | Separate `GenerateWebFormField` interface | `src/lib/ai.ts:607-615` | Extracted field type into its own interface instead of inline | Positive -- cleaner type separation |
| 23 | "JSON만 반환하세요" rule in system prompt | `src/lib/ai.ts:652` | Additional instruction to AI to return only JSON | Positive -- reduces extraneous text in AI response |
| 67 | Try-catch with 500 error response | `generate-webform.ts:52-56` | Wraps generateWebForm + logAiUsage in try-catch, returns 500 with error message | Positive -- production error resilience |

---

## 4. Architecture Compliance

| Check | Status |
|-------|--------|
| AI function in `src/lib/ai.ts` (infrastructure layer) | Match |
| API endpoint in `src/pages/api/ai/` (API routes pattern) | Match |
| UI in `src/pages/web-forms/[id].tsx` (presentation layer) | Match |
| Dependency direction: Page -> fetch -> API -> lib/ai | Match |
| Auth pattern: `getUserFromRequest(req)` | Match |
| AI client pattern: `getAiClient(orgId)` + provider branching | Match |
| Usage logging: `logAiUsage()` with standard params | Match |
| No direct lib import from page (uses fetch API call) | Match |

---

## 5. Convention Compliance

### 5.1 Naming

| Category | Convention | Compliance |
|----------|-----------|:----------:|
| Functions | camelCase (generateWebForm, buildWebFormSystemPrompt, handleAiGenerate) | 100% |
| Interfaces | PascalCase (GenerateWebFormInput, GenerateWebFormResult, GenerateWebFormField) | 100% |
| State variables | camelCase (aiOpen, aiPrompt, aiGenerating) | 100% |
| API file | kebab-case (generate-webform.ts) | 100% |
| Constants | camelCase for local patterns (acceptable) | 100% |

### 5.2 Import Order

| File | Status |
|------|--------|
| `src/lib/ai.ts` | Compliant (db imports -> drizzle -> types) |
| `src/pages/api/ai/generate-webform.ts` | Compliant (next types -> internal @/ imports) |
| `src/pages/web-forms/[id].tsx` | Compliant (react -> next -> internal @/ -> ui -> external) |

---

## 6. Overall Scores

| Category | Score | Status |
|----------|:-----:|:------:|
| Design Match | 96.9% | Pass |
| Architecture Compliance | 100% | Pass |
| Convention Compliance | 100% | Pass |
| **Overall** | **98.9%** | **Pass** |

---

## 7. Verification Checklist

- [x] `GenerateWebFormInput` interface matches design spec
- [x] `GenerateWebFormResult` interface matches design spec
- [x] `buildWebFormSystemPrompt()` content matches (all rules, JSON format, workspace fields)
- [x] `generateWebForm()` uses direct fetch (not web search), `extractJson`, field mapping
- [x] API endpoint: POST only, auth check, AI client check, prompt validation
- [x] API endpoint: `logAiUsage` with `purpose: "webform_generation"`
- [x] API endpoint: response format `{ success, data: { title, description, fields } }`
- [x] UI: `aiOpen`, `aiPrompt`, `aiGenerating` states
- [x] UI: Sparkles, Textarea, Popover imports
- [x] UI: Popover structure with align="end", w-80, space-y-3
- [x] UI: Generate button disabled condition and text states
- [x] UI: handleAiGenerate confirm dialog, fetch, field mapping, toast messages
- [x] Unchanged files: FormBuilder, FormPreview, new.tsx, index.tsx, useWebForms

---

## 8. Recommended Actions

No immediate actions required. The implementation matches the design at 96.9% with only minor beneficial deviations.

### Optional Design Document Updates

- [ ] Document the separate `GenerateWebFormField` interface (cleaner type separation)
- [ ] Add "JSON만 반환하세요" rule to the system prompt specification
- [ ] Document the try-catch error handling pattern on the API endpoint
- [ ] Note `useCallback` usage for `handleAiGenerate`

---

## 9. Conclusion

Design and implementation match well. The 2 "changed" items are both trivial (example value in system prompt, useCallback wrapper for render optimization). The 3 "added" items are all positive improvements: cleaner type separation, better AI instruction, and production error resilience. No missing features detected.

**Match Rate: 96.9% -- PASS**

---

## Version History

| Version | Date | Changes | Author |
|---------|------|---------|--------|
| 1.0 | 2026-02-25 | Initial analysis | gap-detector |
