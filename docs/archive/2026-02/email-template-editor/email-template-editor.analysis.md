# email-template-editor Analysis Report

> **Analysis Type**: Gap Analysis (Design vs Implementation)
>
> **Project**: sales
> **Analyst**: gap-detector
> **Date**: 2026-02-24
> **Design Doc**: [email-template-editor.design.md](../02-design/features/email-template-editor.design.md)

---

## 1. Analysis Overview

### 1.1 Analysis Purpose

Verify that the EmailTemplateDialog full-screen editor implementation matches the design specification across all 15 comparison items defined in the design document.

### 1.2 Analysis Scope

- **Design Document**: `docs/02-design/features/email-template-editor.design.md`
- **Implementation File**: `src/components/email/EmailTemplateDialog.tsx`
- **Analysis Date**: 2026-02-24

---

## 2. Gap Analysis (Design vs Implementation)

### 2.1 Props Interface (Item 1)

| Design | Implementation | Status |
|--------|----------------|--------|
| `open: boolean` | `open: boolean` (L15) | Match |
| `onOpenChange: (open: boolean) => void` | `onOpenChange: (open: boolean) => void` (L16) | Match |
| `template: EmailTemplate \| null` | `template: EmailTemplate \| null` (L17) | Match |
| `onSave: (data: {...}) => Promise<void>` | `onSave: (data: {...}) => Promise<void>` (L18) | Match |

### 2.2 State Management (Item 2)

| State Variable | Design | Implementation | Status |
|----------------|--------|----------------|--------|
| `name` | useState("") | L22: useState("") | Match |
| `subject` | useState("") | L23: useState("") | Match |
| `htmlBody` | useState("") | L24: useState("") | Match |
| `templateType` | useState("") | L25: useState("") | Match |
| `saving` | useState(false) | L26: useState(false) | Match |
| `showAiPanel` | useState(false) | L27: useState(false) | Match |
| `editMode` | useState<"visual" \| "code">("visual") | L28: useState<"visual" \| "code">("visual") | Match |
| `editorRef` | useRef<HTMLDivElement>(null) | L29: useRef<HTMLDivElement>(null) | Match |

### 2.3 Full-Screen DialogContent Layout (Item 3)

| Design Class | Implementation (L111) | Status |
|--------------|----------------------|--------|
| `max-w-[95vw]` | Present | Match |
| `w-full` | Present | Match |
| `h-[90vh]` | Present | Match |
| `flex flex-col` | Present | Match |
| `p-0` | Present | Match |
| (not specified) | `gap-0` added | Minor addition |

### 2.4 Header Layout (Item 4)

| Design Element | Implementation | Status |
|----------------|----------------|--------|
| Fixed h-14 header | L113: `h-14 border-b shrink-0` | Match |
| Title: conditional text | L114-116: ternary on `template` | Match |
| AI toggle button | L118-127: Sparkles icon, variant toggle | Match |
| Cancel button | L128-130: `variant="outline"` | Match |
| Save button with spinner | L131-138: Loader2, disabled logic | Match |

### 2.5 Left Panel Structure (Item 5)

| Design Element | Implementation | Status |
|----------------|----------------|--------|
| `w-1/2, flex flex-col, border-r` | L145: `w-1/2 flex flex-col border-r min-h-0` | Match |
| Meta info: name + type grid-cols-2 | L148: `grid grid-cols-2 gap-3` | Match |
| Meta info: subject full width | L170-179: subject Input | Match |
| AI panel collapsible | L183-187: conditional on `showAiPanel` | Match |
| Edit mode tabs | L190-215: visual/code buttons | Match |
| Edit area flex-1 overflow-auto | L218: `flex-1 overflow-auto min-h-0` | Match |

### 2.6 Right Panel Structure (Item 6)

| Design Element | Implementation | Status |
|----------------|----------------|--------|
| `w-1/2, flex flex-col` | L239: `w-1/2 flex flex-col min-h-0` | Match |
| Preview label header | L241-243: "미리보기" text | Match |
| iframe with srcDoc + sandbox | L247-252: srcDoc={previewHtml}, sandbox="" | Match |
| Variable badges | L256-267: Badge with extractEmailVariables | Match |

### 2.7 contenteditable Visual Mode (Item 7)

| Design Spec | Implementation | Status |
|-------------|----------------|--------|
| `contentEditable` attribute | L222: `contentEditable` | Match |
| `onInput={handleVisualInput}` | L224: `onInput={handleVisualInput}` | Match |
| `dangerouslySetInnerHTML={{ __html: htmlBody }}` | Not used | Changed |
| `prose max-w-none` class | Custom `[&_h1]:text-2xl...` selectors | Changed |
| `p-4 min-h-full outline-none` | L225: `p-4 min-h-full outline-none` | Match |
| (not specified) | `suppressContentEditableWarning` added | Minor addition |

**Notes on changes**:
- The design proposed `dangerouslySetInnerHTML` for initial render. The implementation instead relies on the contenteditable initial load useEffect (L52-57) to set `innerHTML` imperatively. This is functionally equivalent and avoids React's warning about mixing controlled/uncontrolled content in contentEditable elements.
- The `prose max-w-none` class (from Tailwind Typography plugin) is replaced with explicit element-level selectors (e.g. `[&_h1]:text-2xl [&_h1]:font-bold`). This removes a plugin dependency while achieving similar styling. Functionally equivalent approach.

### 2.8 Code Mode Textarea (Item 8)

| Design Spec | Implementation (L228-233) | Status |
|-------------|---------------------------|--------|
| `value={htmlBody}` | Present | Match |
| `onChange={e => setHtmlBody(e.target.value)}` | Present | Match |
| `w-full h-full font-mono text-sm p-4 resize-none` | `w-full h-full font-mono text-sm p-4 resize-none border-0 outline-none bg-transparent` | Match + extras |

### 2.9 Mode Switching Logic (Item 9)

| Design Spec | Implementation (L69-76) | Status |
|-------------|-------------------------|--------|
| Function signature: `(mode: "visual" \| "code")` | Matches | Match |
| visual mode: `editorRef.current.innerHTML = htmlBody` | L71: Present | Match |
| code mode: `setHtmlBody(editorRef.current.innerHTML)` | L73: Present | Match |
| `setEditMode(mode)` | L75: Present | Match |
| Dependency: `[htmlBody]` | L76: `[htmlBody]` | Match |

### 2.10 AI Generation Handler (Item 10)

| Design Spec | Implementation (L79-86) | Status |
|-------------|-------------------------|--------|
| `setSubject(result.subject)` | L80: Present | Match |
| `setHtmlBody(result.htmlBody)` | L81: Present | Match |
| Conditional editorRef sync on visual mode | L82-84: Present | Match |
| `toast.success("AI 결과가 적용되었습니다.")` | L85: Present | Match |
| Dependency: `[editMode]` | L86: `[editMode]` | Match |

### 2.11 Preview HTML with useMemo (Item 11)

| Design Spec | Implementation (L89-100) | Status |
|-------------|--------------------------|--------|
| `useMemo` wrapper | Present | Match |
| Regex: `/##(\w+)##/g` | L91: Present | Match |
| Highlight span with `background:#fef3c7` etc. | L92: Present | Match |
| DOCTYPE html wrapper | L94: Present | Match |
| meta charset + viewport | L96-97: Present | Match |
| body style: `font-family:-apple-system,sans-serif;padding:16px;margin:0` | L98: Expanded with `BlinkMacSystemFont,'Segoe UI',sans-serif;...color:#333;line-height:1.6` | Minor enhancement |
| Dependency: `[htmlBody]` | L100: `[htmlBody]` | Match |

### 2.12 Initialization useEffect (Item 12)

| Design Spec | Implementation (L33-49) | Status |
|-------------|-------------------------|--------|
| Condition: `if (open)` | L34: Present | Match |
| Template branch: set name, subject, htmlBody, templateType | L35-39: Present | Match |
| Null branch: reset all to "" | L41-44: Present | Match |
| Reset editMode to "visual" | L46: Present | Match |
| Reset showAiPanel to false | L47: Present | Match |
| Dependencies: `[template, open]` | L49: `[template, open]` | Match |

### 2.13 contenteditable Initial Load useEffect (Item 13)

| Design Spec | Implementation (L52-57) | Status |
|-------------|-------------------------|--------|
| Condition: `open && editMode === "visual" && editorRef.current && htmlBody` | L53: `open && editMode === "visual" && editorRef.current` (no `&& htmlBody`) | Minor difference |
| Body: `editorRef.current.innerHTML = htmlBody` | L54: Present | Match |
| Dependency: `[open]` | L57: `[open]` | Match |

**Note**: The implementation omits the `&& htmlBody` guard. When `htmlBody` is empty string (falsy), the design would skip the assignment; the implementation would still run `editorRef.current.innerHTML = ""`. This is harmless because setting innerHTML to empty string on an empty editor is a no-op. Functionally equivalent.

### 2.14 Import Changes (Item 14)

| Design Spec | Implementation | Status |
|-------------|----------------|--------|
| `useState, useEffect, useCallback, useMemo, useRef` from react | L1: All five present | Match |
| `Dialog, DialogContent` from dialog (no Header/Title/Footer) | L2: Only Dialog, DialogContent | Match |
| `Code, Eye` from lucide-react | L7: Code, Eye (plus existing Loader2, Sparkles) | Match |

### 2.15 No DialogHeader/DialogTitle/DialogFooter (Item 15)

| Design Spec | Implementation | Status |
|-------------|----------------|--------|
| Remove DialogHeader import | L2: Not imported | Match |
| Remove DialogTitle import | L2: Not imported | Match |
| Remove DialogFooter import | L2: Not imported | Match |
| Custom layout with h2 + flex header | L113-140: Custom header div | Match |

---

## 3. Match Rate Summary

### Item-Level Results

| # | Check Item | Sub-items | Matched | Changed | Added | Status |
|---|-----------|:---------:|:-------:|:-------:|:-----:|:------:|
| 1 | Props interface | 4 | 4 | 0 | 0 | Match |
| 2 | State management | 8 | 8 | 0 | 0 | Match |
| 3 | Full-screen layout | 6 | 5 | 0 | 1 | Match |
| 4 | Header | 5 | 5 | 0 | 0 | Match |
| 5 | Left panel | 6 | 6 | 0 | 0 | Match |
| 6 | Right panel | 4 | 4 | 0 | 0 | Match |
| 7 | contenteditable visual | 6 | 3 | 2 | 1 | Changed |
| 8 | Code mode textarea | 3 | 3 | 0 | 0 | Match |
| 9 | Mode switching logic | 5 | 5 | 0 | 0 | Match |
| 10 | AI generation handler | 5 | 5 | 0 | 0 | Match |
| 11 | Preview HTML useMemo | 6 | 5 | 1 | 0 | Match |
| 12 | Initialization useEffect | 6 | 6 | 0 | 0 | Match |
| 13 | contenteditable load useEffect | 3 | 2 | 1 | 0 | Match |
| 14 | Import changes | 3 | 3 | 0 | 0 | Match |
| 15 | No DialogHeader/Title/Footer | 4 | 4 | 0 | 0 | Match |
| **Total** | | **74** | **68** | **4** | **2** | |

### Difference Classification

#### Changed Items (Design != Implementation, functionally equivalent)

| # | Item | Design | Implementation | Impact |
|---|------|--------|----------------|--------|
| 1 | contenteditable initial render | `dangerouslySetInnerHTML={{ __html: htmlBody }}` | useEffect sets `innerHTML` imperatively | None (equivalent) |
| 2 | contenteditable styling | `prose max-w-none` (Typography plugin) | Custom `[&_h1]:text-2xl...` selectors | None (removes plugin dep) |
| 3 | Preview body style | `-apple-system,sans-serif;padding:16px;margin:0` | Expanded with additional font stack + `color:#333;line-height:1.6` | None (enhancement) |
| 4 | Initial load useEffect guard | `&& htmlBody` included | `&& htmlBody` omitted | None (empty string is no-op) |

#### Added Items (Design X, Implementation O)

| # | Item | Implementation Location | Description | Impact |
|---|------|------------------------|-------------|--------|
| 1 | `gap-0` on DialogContent | L111 | Prevents default gap in flex column | None (layout fix) |
| 2 | `suppressContentEditableWarning` | L223 | Suppresses React console warning | None (DX improvement) |

#### Missing Items (Design O, Implementation X)

None.

### Overall Match Rate

```
Total Comparison Items:          74
Exact Matches:                   68 (91.9%)
Functionally Equivalent Changes:  4 ( 5.4%)
Minor Additions:                   2 ( 2.7%)
Missing (Not Implemented):         0 ( 0.0%)
```

**Effective Match Rate: 100%** (all 74 items implemented; 4 changes are functionally equivalent improvements, 2 additions are non-breaking enhancements)

**Strict Match Rate: 91.9%** (counting only exact text matches)

---

## 4. Overall Scores

| Category | Score | Status |
|----------|:-----:|:------:|
| Design Match | 100% | Pass |
| Architecture Compliance | 100% | Pass |
| Convention Compliance | 100% | Pass |
| **Overall** | **100%** | **Pass** |

---

## 5. Convention Compliance

### 5.1 Naming Convention

| Category | Convention | Result | Status |
|----------|-----------|--------|--------|
| Component | PascalCase | `EmailTemplateDialog` | Pass |
| Functions | camelCase | `handleVisualInput`, `handleModeChange`, `handleAiGenerated`, `handleSave` | Pass |
| State vars | camelCase | `editMode`, `htmlBody`, `showAiPanel`, etc. | Pass |
| File | PascalCase.tsx | `EmailTemplateDialog.tsx` | Pass |

### 5.2 Import Order

| Order | Expected | Actual (L1-12) | Status |
|-------|----------|-----------------|--------|
| 1 | External libraries | react (L1), lucide-react (L7), sonner (L11) | Pass |
| 2 | Internal absolute (@/) | L2-6, L8-10 | Pass |
| 3 | Relative imports | None needed | Pass |
| 4 | Type imports | `import type { EmailTemplate }` (L12) | Pass |

### 5.3 Architecture

| Check | Result | Status |
|-------|--------|--------|
| Component in `src/components/` | `src/components/email/EmailTemplateDialog.tsx` | Pass |
| Type import from domain | `import type { EmailTemplate } from "@/lib/db"` | Pass |
| Hook usage | `useAiConfig` hook for AI config | Pass |
| No direct API calls | Component uses onSave callback | Pass |

---

## 6. Design Changes Assessment

All 4 changes from the design are **intentional improvements**:

1. **No `dangerouslySetInnerHTML`**: Avoids the React anti-pattern of mixing `dangerouslySetInnerHTML` with `contentEditable`. The imperative `innerHTML` set via useEffect is the correct React pattern for this use case.

2. **Custom selectors instead of `prose`**: Removes dependency on `@tailwindcss/typography` plugin. The custom selectors provide equivalent styling with explicit control over each element type.

3. **Enhanced preview font stack**: Adding `BlinkMacSystemFont`, `Segoe UI`, `color:#333`, and `line-height:1.6` improves cross-browser rendering fidelity of the email preview.

4. **Removed `htmlBody` guard in useEffect**: When htmlBody is empty, `innerHTML = ""` is harmless. The guard was unnecessary and its removal simplifies the code.

---

## 7. Recommended Actions

No action required. The implementation faithfully realizes the design with minor, justified improvements.

### Optional Design Document Updates

If strict design-implementation parity is desired, consider updating the design document to reflect:

- [ ] Replace `dangerouslySetInnerHTML` reference with useEffect-based innerHTML approach
- [ ] Replace `prose max-w-none` with explicit Tailwind selector classes
- [ ] Document expanded preview CSS (font-family additions, color, line-height)
- [ ] Remove `&& htmlBody` guard from contenteditable load useEffect spec

These are documentation-only updates and do not require any code changes.

---

## Version History

| Version | Date | Changes | Author |
|---------|------|---------|--------|
| 1.0 | 2026-02-24 | Initial gap analysis | gap-detector |
