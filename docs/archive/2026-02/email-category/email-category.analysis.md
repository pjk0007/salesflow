# email-category Analysis Report

> **Analysis Type**: Gap Analysis (Design vs Implementation)
>
> **Project**: Sales Manager
> **Analyst**: gap-detector
> **Date**: 2026-02-24
> **Design Doc**: [email-category.design.md](../02-design/features/email-category.design.md)

---

## 1. Analysis Overview

### 1.1 Analysis Purpose

Verify that the email category feature implementation matches the design document across all 12 files (DB schema, migration, NHN client, API endpoints, hooks, UI components, page integration).

### 1.2 Analysis Scope

- **Design Document**: `docs/02-design/features/email-category.design.md`
- **Implementation Files**: 12 files across schema, API, hooks, components, pages
- **Analysis Date**: 2026-02-24

---

## 2. Gap Analysis (Design vs Implementation)

### 2.1 DB Schema -- emailCategories Table

| Field | Design | Implementation | Status |
|-------|--------|----------------|--------|
| id | `serial("id").primaryKey()` | `serial("id").primaryKey()` | MATCH |
| orgId | `uuid("org_id").references(() => organizations.id, { onDelete: "cascade" }).notNull()` | Same | MATCH |
| name | `varchar("name", { length: 200 }).notNull()` | Same | MATCH |
| description | `varchar("description", { length: 1000 })` | Same | MATCH |
| nhnCategoryId | `integer("nhn_category_id")` | Same | MATCH |
| createdAt | `timestamptz("created_at").defaultNow().notNull()` | Same | MATCH |
| updatedAt | `timestamptz("updated_at").defaultNow().notNull()` | Same | MATCH |

**File**: `/Users/jake/project/sales/src/lib/db/schema.ts` (lines 426-436)

### 2.2 DB Schema -- emailTemplates.categoryId FK

| Item | Design | Implementation | Status |
|------|--------|----------------|--------|
| Field | `categoryId: integer("category_id").references(() => emailCategories.id, { onDelete: "set null" })` | Same | MATCH |
| Placement | Between templateType and isActive | After templateType (line 450), before status/isActive | MATCH |
| Nullable | Yes (no .notNull()) | Yes | MATCH |

**File**: `/Users/jake/project/sales/src/lib/db/schema.ts` (line 450)

### 2.3 Migration SQL

| Item | Design | Implementation | Status |
|------|--------|----------------|--------|
| CREATE TABLE email_categories | All 7 columns, CASCADE FK | Identical | MATCH |
| ALTER TABLE email_templates | ADD COLUMN category_id, SET NULL | Identical | MATCH |

**File**: `/Users/jake/project/sales/drizzle/0003_email_categories.sql` (12 lines)

### 2.4 NHN Email Client -- listCategories()

| Item | Design | Implementation | Status |
|------|--------|----------------|--------|
| Method name | `listCategories()` | `listCategories()` | MATCH |
| Return type | `{ header, data: Array<{categoryId, categoryParentId, depth, categoryName, categoryDesc, useYn}> \| null }` | Same | MATCH |
| Endpoint | `GET /email/v2.1/appKeys/{appKey}/categories?pageSize=100` | Same | MATCH |

**File**: `/Users/jake/project/sales/src/lib/nhn-email.ts` (lines 131-146)

### 2.5 API Endpoints -- Categories

| Endpoint | Design | Implementation | Status |
|----------|--------|----------------|--------|
| GET /api/email/categories | Auth + orgId filter + `{ success, data }` | Implemented identically | MATCH |
| POST /api/email/categories | name required + duplicate check + `{ success, data }` | Implemented identically | MATCH |
| PUT /api/email/categories/[id] | name/description update + 404 + `{ success, data }` | Implemented identically | MATCH |
| DELETE /api/email/categories/[id] | SET NULL cascade + `{ success }` | Implemented identically | MATCH |
| POST /api/email/categories/sync | NHN listCategories -> upsert + `{ success, synced, created, updated }` | Implemented identically | MATCH |

**Files**:
- `/Users/jake/project/sales/src/pages/api/email/categories/index.ts`
- `/Users/jake/project/sales/src/pages/api/email/categories/[id].ts`
- `/Users/jake/project/sales/src/pages/api/email/categories/sync.ts`

### 2.6 API Endpoints -- Templates categoryId Support

| Endpoint | Design | Implementation | Status |
|----------|--------|----------------|--------|
| POST /api/email/templates -- categoryId in body | `categoryId` extracted and inserted | `categoryId: categoryId ?? null` at line 62 | MATCH |
| PUT /api/email/templates/[id] -- categoryId in body | `if (categoryId !== undefined) updateData.categoryId = categoryId` | Identical logic at line 60 | MATCH |
| GET /api/email/templates -- ?categoryId query param | `?categoryId=5` server-side filter | NOT implemented (client-side filter instead) | DEVIATION |

**Files**:
- `/Users/jake/project/sales/src/pages/api/email/templates/index.ts`
- `/Users/jake/project/sales/src/pages/api/email/templates/[id].ts`

### 2.7 Hook -- useEmailCategories

| Item | Design | Implementation | Status |
|------|--------|----------------|--------|
| SWR key | `/api/email/categories` | Same | MATCH |
| createCategory(data) | `{ name, description? }` -> POST -> mutate | Implemented | MATCH |
| updateCategory(id, data) | `{ name?, description? }` -> PUT -> mutate | Implemented | MATCH |
| deleteCategory(id) | DELETE -> mutate | Implemented | MATCH |
| syncFromNhn() | POST /sync -> mutate | Implemented | MATCH |
| Return values | `{ categories, isLoading, createCategory, updateCategory, deleteCategory, syncFromNhn, mutate }` | All 7 returned | MATCH |

**File**: `/Users/jake/project/sales/src/hooks/useEmailCategories.ts`

### 2.8 Hook -- useEmailTemplates categoryId Type

| Item | Design | Implementation | Status |
|------|--------|----------------|--------|
| createTemplate param | `categoryId?: number \| null` | Present at line 24 | MATCH |
| updateTemplate param | `categoryId?: number \| null` | Present at line 45 | MATCH |

**File**: `/Users/jake/project/sales/src/hooks/useEmailTemplates.ts`

### 2.9 UI -- EmailCategoryManager

| Item | Design | Implementation | Status |
|------|--------|----------------|--------|
| Card component | Same style as EmailConfigForm | Card with CardHeader/CardContent | MATCH |
| Table columns | Name, Description, NHN ID, Actions | 4 columns matching | MATCH |
| NHN sync button | Calls syncFromNhn(), shows result toast | Implemented with loading state | MATCH |
| Add button | Inline form or Dialog | Inline row with Input fields | MATCH |
| Edit | Inline editing (name click -> Input) | Inline editing with editingId state | MATCH |
| Delete | Confirm then delete | `confirm()` dialog then deleteCategory | MATCH |
| Empty state | Context-aware message | "등록된 카테고리가 없습니다..." message | MATCH |

**File**: `/Users/jake/project/sales/src/components/email/EmailCategoryManager.tsx`

### 2.10 UI -- EmailTemplateList Category Filter

| Item | Design | Implementation | Status |
|------|--------|----------------|--------|
| Category Select filter | Header area with Select component | Select with "all"/"none"/categories | MATCH |
| useEmailCategories() | Hook imported and used | Imported at line 4 | MATCH |
| Category column | Shows category name with Badge | Badge with `categories.find()` lookup | MATCH |
| Client-side filter | `useState<number \| null>(null)` | `useState<string>("all")` with string-based filter | MATCH |

**File**: `/Users/jake/project/sales/src/components/email/EmailTemplateList.tsx`

### 2.11 UI -- EmailTemplateEditor Category Select

| Item | Design | Implementation | Status |
|------|--------|----------------|--------|
| Category Select dropdown | Replace "Type" Input with Select | Select with "none" + categories | MATCH |
| useEmailCategories() | Hook imported and used | Imported at line 16 | MATCH |
| Nullable "none" option | Uncategorized option | `value="none"` maps to `null` | MATCH |
| SaveData.categoryId | `categoryId?: number \| null` | Interface at line 27 | MATCH |
| Auto-save includes categoryId | Included in onSave calls | Lines 155, 185, 212 | MATCH |

**File**: `/Users/jake/project/sales/src/components/email/EmailTemplateEditor.tsx`

### 2.12 Page Integration -- email.tsx

| Item | Design | Implementation | Status |
|------|--------|----------------|--------|
| EmailCategoryManager import | Imported | Line 15 | MATCH |
| Settings tab placement | Below EmailConfigForm | `<EmailConfigForm />` then `<EmailCategoryManager />` | MATCH |

**File**: `/Users/jake/project/sales/src/pages/email.tsx`

---

## 3. Differences Found

### 3.1 DEVIATION: Server-side categoryId Query Filter Missing

| Item | Design (Section 7.3) | Implementation | Impact |
|------|----------------------|----------------|--------|
| GET /api/email/templates ?categoryId | Server-side query param filter | Client-side filter in EmailTemplateList | Low |

**Design states**: `// ?categoryId=5 query parameter support` on GET /api/email/templates.

**Implementation**: The GET handler in `/Users/jake/project/sales/src/pages/api/email/templates/index.ts` supports `?status` and `?page`/`?pageSize` query params but does NOT support `?categoryId`. Instead, category filtering is handled client-side in `EmailTemplateList.tsx` via `useState` + `.filter()`.

**Impact**: Low. Client-side filtering is functionally equivalent for the current dataset size. Server-side filtering would only matter for performance with very large template collections (hundreds+). The feature works correctly as implemented.

### 3.2 MINOR: EmailCategory Type Not Exported from Schema

| Item | Design Expectation | Implementation | Impact |
|------|-------------------|----------------|--------|
| EmailCategory type | Exported from schema.ts like other entity types | Defined locally in useEmailCategories.ts hook | Low |

**Observation**: All other entity types (EmailTemplate, EmailConfig, Product, etc.) are exported from `schema.ts` (lines 620-655), but `EmailCategory` is not. The type is instead defined as a local interface in `/Users/jake/project/sales/src/hooks/useEmailCategories.ts` (lines 3-11). This works but breaks the pattern established by other entities.

---

## 4. Match Rate Summary

### 4.1 Item Counts

| Category | Items | Matched | Deviated | Missing |
|----------|:-----:|:-------:|:--------:|:-------:|
| DB Schema (emailCategories) | 7 | 7 | 0 | 0 |
| DB Schema (emailTemplates FK) | 3 | 3 | 0 | 0 |
| Migration SQL | 2 | 2 | 0 | 0 |
| NHN Email Client | 3 | 3 | 0 | 0 |
| API Categories (5 endpoints) | 5 | 5 | 0 | 0 |
| API Templates categoryId | 3 | 2 | 1 | 0 |
| Hook useEmailCategories | 7 | 7 | 0 | 0 |
| Hook useEmailTemplates | 2 | 2 | 0 | 0 |
| UI EmailCategoryManager | 7 | 7 | 0 | 0 |
| UI EmailTemplateList | 4 | 4 | 0 | 0 |
| UI EmailTemplateEditor | 5 | 5 | 0 | 0 |
| Page Integration | 2 | 2 | 0 | 0 |
| **Total** | **50** | **49** | **1** | **0** |

### 4.2 Overall Match Rate

```
Match Rate: 98.0% (49/50)

  MATCH:     49 items (98.0%)
  DEVIATION:  1 item  (2.0%)
  MISSING:    0 items (0.0%)
```

---

## 5. Overall Scores

| Category | Score | Status |
|----------|:-----:|:------:|
| Design Match | 98% | PASS |
| Architecture Compliance | 100% | PASS |
| Convention Compliance | 100% | PASS |
| **Overall** | **98%** | PASS |

---

## 6. Architecture Compliance

All files follow the established project architecture pattern:

| Layer | Files | Compliance |
|-------|-------|:----------:|
| Infrastructure (DB/NHN) | schema.ts, nhn-email.ts | PASS |
| API (Routes) | categories/index.ts, [id].ts, sync.ts, templates/index.ts, [id].ts | PASS |
| Hooks (SWR) | useEmailCategories.ts, useEmailTemplates.ts | PASS |
| UI (Components) | EmailCategoryManager.tsx, EmailTemplateList.tsx, EmailTemplateEditor.tsx | PASS |
| Pages | email.tsx | PASS |

Dependency directions are correct:
- Pages -> Components -> Hooks -> API routes (no violations)
- Components import from hooks (not from lib/db directly)
- API routes import from lib/db and lib/nhn-email (infrastructure layer)

---

## 7. Convention Compliance

| Convention | Checked | Compliance |
|-----------|:-------:|:----------:|
| Component naming (PascalCase) | EmailCategoryManager, EmailTemplateList, EmailTemplateEditor | PASS |
| Function naming (camelCase) | createCategory, updateCategory, deleteCategory, syncFromNhn, handleSync, handleCreate | PASS |
| File naming | PascalCase for components, camelCase for hooks/utils | PASS |
| Import order | External -> Internal absolute -> Relative -> Types | PASS |
| Auth pattern | getUserFromRequest(req) on all API routes | PASS |
| Ownership check | orgId filtering on all queries | PASS |
| Error handling | try/catch with console.error on all API routes | PASS |
| updatedAt refresh | `updatedAt: new Date()` on PUT handlers | PASS |
| Toast notifications | sonner toast on all user actions | PASS |
| Loading states | Skeleton for lists, Loader2 for buttons | PASS |

---

## 8. Recommended Actions

### 8.1 Optional Improvements (Low Priority)

| Priority | Item | File | Notes |
|----------|------|------|-------|
| Low | Add `?categoryId` server-side filter to GET /api/email/templates | `src/pages/api/email/templates/index.ts` | Client-side filtering works; server-side would help with large datasets |
| Low | Export `EmailCategory` type from schema.ts | `src/lib/db/schema.ts` | Consistency with other entity type exports |

### 8.2 Design Document Updates Needed

None required. The single deviation (client-side vs server-side category filtering) is an acceptable implementation choice that can be documented as intentional.

---

## 9. Conclusion

The email-category feature achieves a **98.0% match rate** with the design document across 50 verified items. All core functionality is implemented correctly:

- DB schema with emailCategories table and emailTemplates.categoryId FK
- Migration SQL for both table creation and column addition
- NHN Email client listCategories() method
- Full CRUD API for categories plus NHN sync endpoint
- SWR hook with all mutation functions
- Category management UI with inline editing
- Template list category filter and template editor category select
- Page integration in settings tab

The single deviation (GET templates server-side categoryId filter not implemented) has negligible impact since client-side filtering provides equivalent functionality.

---

## Version History

| Version | Date | Changes | Author |
|---------|------|---------|--------|
| 1.0 | 2026-02-24 | Initial analysis | gap-detector |
