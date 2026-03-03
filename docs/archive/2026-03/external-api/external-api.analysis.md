# external-api Analysis Report

> **Analysis Type**: Gap Analysis (Design vs Implementation)
>
> **Project**: SalesFlow
> **Analyst**: gap-detector
> **Date**: 2026-03-03
> **Design Doc**: [external-api.design.md](../02-design/features/external-api.design.md)

---

## 1. Analysis Overview

### 1.1 Analysis Purpose

Verify that the `external-api` feature implementation matches the design document across all 11 specified files: DB schema, migration, auth functions, token CRUD APIs, external record APIs, SWR hook, UI components, and settings page integration.

### 1.2 Analysis Scope

- **Design Document**: `docs/02-design/features/external-api.design.md`
- **Implementation Files**: 11 files (schema, migration, auth, 4 API routes, hook, 2 UI components, settings page)
- **Analysis Date**: 2026-03-03

---

## 2. Gap Analysis (Design vs Implementation)

### 2-1. `src/lib/db/schema.ts` -- apiTokenScopes table

| Item | Design | Implementation | Status |
|------|--------|----------------|--------|
| Table name | `api_token_scopes` | `api_token_scopes` | MATCH |
| id (serial PK) | `serial("id").primaryKey()` | `serial("id").primaryKey()` | MATCH |
| tokenId (integer FK) | `.references(() => apiTokens.id, { onDelete: "cascade" }).notNull()` | `.references(() => apiTokens.id, { onDelete: "cascade" }).notNull()` | MATCH |
| scopeType (varchar 20) | `varchar("scope_type", { length: 20 }).notNull()` | `varchar("scope_type", { length: 20 }).notNull()` | MATCH |
| scopeId (integer) | `integer("scope_id").notNull()` | `integer("scope_id").notNull()` | MATCH |
| permissions (jsonb) | `jsonb("permissions").$type<{read,create,update,delete}>().notNull()` | `jsonb("permissions").$type<{read:boolean;create:boolean;update:boolean;delete:boolean}>().notNull()` | MATCH |
| Type export | `export type ApiTokenScope = typeof apiTokenScopes.$inferSelect` | `export type ApiTokenScope = typeof apiTokenScopes.$inferSelect` | MATCH |

**Result: 7/7 items MATCH (100%)**

---

### 2-2. `drizzle/0014_api_token_scopes.sql` -- Migration

| Item | Design | Implementation | Status |
|------|--------|----------------|--------|
| CREATE TABLE statement | All columns match design | All columns match | MATCH |
| id serial PK | `"id" serial PRIMARY KEY NOT NULL` | `"id" serial PRIMARY KEY NOT NULL` | MATCH |
| token_id FK CASCADE | `REFERENCES "api_tokens"("id") ON DELETE CASCADE` | `REFERENCES "api_tokens"("id") ON DELETE CASCADE` | MATCH |
| scope_type varchar(20) | `NOT NULL` | `NOT NULL` | MATCH |
| scope_id integer | `NOT NULL` | `NOT NULL` | MATCH |
| permissions jsonb | `NOT NULL` | `NOT NULL` | MATCH |
| Index on token_id | `CREATE INDEX ... "api_token_scopes_token_idx" ON ... ("token_id")` | `CREATE INDEX ... "api_token_scopes_token_idx" ON ... ("token_id")` | MATCH |
| Journal entry (idx 14) | `idx 14` entry in `_journal.json` | `idx: 14, tag: "0014_api_token_scopes"` present | MATCH |

**Result: 8/8 items MATCH (100%)**

---

### 2-3. `src/lib/auth.ts` -- Token auth functions

| Item | Design | Implementation | Status |
|------|--------|----------------|--------|
| ApiTokenInfo interface | `{ id: number; orgId: string; scopes: ApiTokenScope[] }` | `{ id: number; orgId: string; scopes: ApiTokenScope[] }` | MATCH |
| getApiTokenFromNextRequest signature | `(req: NextRequest): string \| null` | `(req: NextRequest): string \| null` | MATCH |
| Bearer header parsing | `authorization` header, `startsWith("Bearer ")`, substring(7) | Implemented identically | MATCH |
| x-api-key header fallback | `req.headers.get("x-api-key")` | `req.headers.get("x-api-key")` | MATCH |
| resolveApiToken signature | `(tokenStr: string): Promise<ApiTokenInfo \| null>` | `(tokenStr: string): Promise<ApiTokenInfo \| null>` | MATCH |
| Token lookup: active + not expired | isActive=1, expiresAt null or > now | `eq(isActive, 1), or(isNull(expiresAt), gt(expiresAt, new Date()))` | MATCH |
| No orgId in query (token self-identifies) | Design says "orgId not from header" | Implementation does NOT filter by orgId -- token self-identifies | MATCH |
| Scopes query by tokenId | `apiTokenScopes WHERE tokenId` | `apiTokenScopes WHERE eq(tokenId, apiToken.id)` | MATCH |
| lastUsedAt update | `update apiTokens set lastUsedAt` | `set({ lastUsedAt: new Date() })` | MATCH |
| Return `{ id, orgId, scopes }` | Return ApiTokenInfo | `return { id: apiToken.id, orgId: apiToken.orgId, scopes }` | MATCH |
| checkTokenAccess signature | `(tokenInfo, partitionId, permission): Promise<boolean>` | `(tokenInfo: ApiTokenInfo, partitionId: number, permission: Permission): Promise<boolean>` | MATCH |
| Permission type | `"read" \| "create" \| "update" \| "delete"` | `type Permission = "read" \| "create" \| "update" \| "delete"` | MATCH |
| Scope matching: partition direct | `scopeType === "partition" && scopeId === partitionId` | Implemented identically | MATCH |
| Scope matching: folder via DB | Query `partitions.folderId` | `partitions.folderId === scope.scopeId` after DB lookup | MATCH |
| Scope matching: workspace via DB | Query `partitions.workspaceId` | `partitions.workspaceId === scope.scopeId` after DB lookup | MATCH |
| Existing verifyApiToken/authenticateRequest preserved | "kept for compatibility" | Both functions still present (lines 83-142) | MATCH |

**Result: 16/16 items MATCH (100%)**

---

### 2-4. `src/app/api/api-tokens/route.ts` -- GET, POST

#### GET /api/api-tokens

| Item | Design | Implementation | Status |
|------|--------|----------------|--------|
| Auth: JWT via getUserFromNextRequest | Required | Lines 8-9 | MATCH |
| Role check: owner/admin | Required | Lines 12-14 | MATCH |
| Query: apiTokens WHERE orgId, ORDER BY createdAt DESC | Required | Lines 17-21 | MATCH |
| Scopes JOIN per token | Required | Lines 25-28 | MATCH |
| scopeName resolution (workspace/folder/partition) | Design mentions `scopeName?: string` for UI display | Lines 31-46: queries workspace/folder/partition names | MATCH |
| Token preview: first 8 chars + "..." | `token.slice(0, 8) + "..."` | Line 51: `t.token.slice(0, 8) + "..."` | MATCH |
| Response fields | `{ id, name, tokenPreview, scopes[], lastUsedAt, expiresAt, isActive, createdAt }` | Lines 48-57: all fields present | MATCH |
| Response format | `{ success: true, data: tokens[] }` | Line 61 | MATCH |

#### POST /api/api-tokens

| Item | Design | Implementation | Status |
|------|--------|----------------|--------|
| Auth + role check | owner/admin | Lines 69-75 | MATCH |
| Body: { name, expiresIn, scopes } | Required | Line 78 | MATCH |
| name validation: 1-100 chars | Required | Lines 80-82 | MATCH |
| scopes: min 1 | Required | Lines 83-85 | MATCH |
| scopeType validation: workspace/folder/partition | Required | Lines 88-108 | MATCH |
| scopeId org-ownership verification | Required | Lines 93-107: verifies via workspace/folder/partition org join | MATCH |
| Token generation: `crypto.randomBytes(32).toString('hex')` | 64 chars hex | Line 111 | MATCH |
| expiresAt calculation: 30d/90d/1y/null | Required | Lines 114-117 | MATCH |
| Transaction: INSERT apiTokens + INSERT apiTokenScopes | Required | Lines 119-141 | MATCH |
| Response: `{ id, name, token (plaintext!), expiresAt }` | Required, token only in this response | Lines 143-151 | MATCH |
| Response includes scopes in create response | Design says `data: { id, name, token, scopes, expiresAt }` | Lines 144-150: does NOT return scopes in create response | PARTIAL |

**Result: 18/19 items MATCH, 1 PARTIAL (POST response missing `scopes` array)**

---

### 2-5. `src/app/api/api-tokens/[id]/route.ts` -- PUT, DELETE

#### PUT /api/api-tokens/[id]

| Item | Design | Implementation | Status |
|------|--------|----------------|--------|
| Auth + role check | owner/admin | Lines 10-16 | MATCH |
| Token ownership check (tokenId + orgId) | Required | Lines 26-33 | MATCH |
| Body: { name?, isActive?, scopes? } | Required | Line 35 | MATCH |
| name update (if present) | Required | Line 39 | MATCH |
| isActive update (if present) | Required | Line 40 | MATCH |
| Scopes update: DELETE existing + INSERT new (transaction) | Required | Lines 49-59 | MATCH |
| Response: `{ success: true, data: updated token }` | Design says return updated token | Line 62: `{ success: true }` -- no `data` returned | PARTIAL |

#### DELETE /api/api-tokens/[id]

| Item | Design | Implementation | Status |
|------|--------|----------------|--------|
| Auth + role check | owner/admin | Lines 73-79 | MATCH |
| Token ownership check | Required | Lines 88-95 | MATCH |
| DELETE apiTokens WHERE id (cascade) | Required | Line 97 | MATCH |
| Response message | Design: "토큰이 삭제되었습니다." | Line 99: "토큰이 삭제되었습니다." | MATCH |

**Result: 10/11 items MATCH, 1 PARTIAL (PUT response missing `data` field)**

---

### 2-6. `src/app/api/v1/records/route.ts` -- GET, POST

#### authenticateExternalRequest helper

| Item | Design | Implementation | Status |
|------|--------|----------------|--------|
| Call getApiTokenFromNextRequest | Required | Line 13 | MATCH |
| Call resolveApiToken | Required | Line 14 | MATCH |
| Return null on failure | Required | Lines 14-15 | MATCH |

#### GET /api/v1/records

| Item | Design | Implementation | Status |
|------|--------|----------------|--------|
| authenticateExternalRequest(req) | Required | Lines 33-36, 401 response | MATCH |
| partitionId required (query param) | Required | Lines 39-42 | MATCH |
| checkTokenAccess(tokenInfo, partitionId, "read") -- 403 | Required | Lines 44-47 | MATCH |
| Parameters: page, pageSize, search, sortField, sortOrder, filters | Required | Lines 55-65 | MATCH |
| WHERE partitionId + filter conditions | Required | Lines 68-116 | MATCH |
| ORDER BY + LIMIT/OFFSET | Required | Lines 120-139 | MATCH |
| Response: `{ success, data, total, page, pageSize, totalPages }` | Required | Lines 141-148 | MATCH |

#### POST /api/v1/records

| Item | Design | Implementation | Status |
|------|--------|----------------|--------|
| authenticateExternalRequest(req) | Required | Lines 157-160 | MATCH |
| Body: { partitionId, data } | Required | Line 163 | MATCH |
| checkTokenAccess(tokenInfo, partitionId, "create") -- 403 | Required | Lines 172-175 | MATCH |
| verifyPartitionAccess(partitionId, tokenInfo.orgId) -- 404 | Required | Lines 177-180 | MATCH |
| Plan limit check (checkPlanLimit) | Required | Lines 185-192 | MATCH |
| Duplicate check (duplicateCheckField) | Required | Lines 195-216 | MATCH |
| Transaction: integrated code + distribution order + record create | Required | Lines 218-256 | MATCH |
| Automation trigger (alimtalk + email) | Required | Lines 258-271 | MATCH |
| SSE broadcast | Required | Lines 272-275 | MATCH |
| Response: `{ success: true, data: record }` | Required | Line 277 | MATCH |

**Result: 20/20 items MATCH (100%)**

---

### 2-7. `src/app/api/v1/records/[id]/route.ts` -- GET, PUT, DELETE

#### GET /api/v1/records/[id]

| Item | Design | Implementation | Status |
|------|--------|----------------|--------|
| authenticateExternalRequest(req) | Required | Lines 21-24 | MATCH |
| records WHERE id AND orgId | Required | Lines 33-36 | MATCH |
| checkTokenAccess(tokenInfo, record.partitionId, "read") -- 403 | Required | Lines 42-45 | MATCH |
| Response: `{ success: true, data: record }` | Required | Line 47 | MATCH |

#### PUT /api/v1/records/[id]

| Item | Design | Implementation | Status |
|------|--------|----------------|--------|
| authenticateExternalRequest(req) | Required | Lines 59-62 | MATCH |
| Body: { data } | Required | Line 71 | MATCH |
| Existing record query (orgId check) | Required | Lines 76-83 | MATCH |
| checkTokenAccess(tokenInfo, record.partitionId, "update") -- 403 | Required | Lines 85-88 | MATCH |
| Data merge: `{...existing.data, ...newData}` | Required | Line 90 | MATCH |
| UPDATE + returning | Required | Lines 92-96 | MATCH |
| Automation trigger + SSE broadcast | Required | Lines 98-115 | MATCH |
| Response: `{ success: true, data: updated }` | Required | Line 117 | MATCH |

#### DELETE /api/v1/records/[id]

| Item | Design | Implementation | Status |
|------|--------|----------------|--------|
| authenticateExternalRequest(req) | Required | Lines 129-132 | MATCH |
| Existing record query (orgId check) | Required | Lines 141-148 | MATCH |
| checkTokenAccess(tokenInfo, record.partitionId, "delete") -- 403 | Required | Lines 150-153 | MATCH |
| DELETE record | Required | Line 155 | MATCH |
| SSE broadcast | Required | Lines 157-160 | MATCH |
| Response message | Design: "레코드가 삭제되었습니다." | Line 162: "Record deleted." (English) | PARTIAL |

**Result: 15/16 items MATCH, 1 PARTIAL (DELETE message in English instead of Korean)**

---

### 2-8. `src/hooks/useApiTokens.ts` -- SWR hook

| Item | Design | Implementation | Status |
|------|--------|----------------|--------|
| useSWR with `/api/api-tokens` endpoint | Required | Line 41-44 | MATCH |
| ApiTokenWithScopes type | All fields: id, name, tokenPreview, scopes[], lastUsedAt, expiresAt, isActive, createdAt | Lines 11-19: all fields match | MATCH |
| ApiTokenScope nested type | id, scopeType, scopeId, scopeName?, permissions | Lines 3-8: all fields match | MATCH |
| CreateTokenInput type | name, expiresIn, scopes[] | Lines 22-30: all fields match | MATCH |
| UpdateTokenInput type | name?, isActive?, scopes? | Lines 32-36: all fields match | MATCH |
| createToken function | POST /api/api-tokens, mutate on success, return result | Lines 46-55 | MATCH |
| updateToken function | PUT /api/api-tokens/{id}, mutate on success | Lines 57-66 | MATCH |
| deleteToken function | DELETE /api/api-tokens/{id}, mutate on success | Lines 68-75 | MATCH |
| Return shape | `{ tokens, isLoading, error, createToken, updateToken, deleteToken }` | Lines 77-84 | MATCH |
| tokens default | `data?.data ?? []` | Line 78 | MATCH |

**Result: 10/10 items MATCH (100%)**

---

### 2-9. `src/components/settings/ApiTokensTab.tsx` -- Token management UI

| Item | Design | Implementation | Status |
|------|--------|----------------|--------|
| Card with "API 토큰" header | Required | Lines 122-134: Card > CardHeader with title "API 토큰" | MATCH |
| "토큰 생성" button in header | Required | Lines 128-133 | MATCH |
| Table columns: 이름, 토큰, 권한, 마지막 사용, 만료, 상태, 액션 | Required | Lines 144-150 | MATCH |
| Token preview in font-mono | Required | Lines 157-161: `code` with `font-mono` class | MATCH |
| Scope count as Badge ("N개 범위") | Required | Lines 162-165 | MATCH |
| Relative time for last used | Required | Lines 167-169 + formatRelativeTime function | MATCH |
| Expiry date or "무제한" | Required | Lines 170-172 + formatDate function | MATCH |
| Status Switch toggle | Required | Lines 173-179 | MATCH |
| Toggle calls updateToken({ isActive: 0\|1 }) | Required | Lines 103-108 | MATCH |
| DropdownMenu: 수정, 삭제 | Required | Lines 182-201 | MATCH |
| Empty state: "등록된 API 토큰이 없습니다." | Required | Lines 136-139 | MATCH |
| AlertDialog for delete confirmation | Required | Lines 232-247 | MATCH |
| Created token display AlertDialog | Required | Lines 250-273 | MATCH |
| "다시 표시되지 않습니다" warning | Required | Line 255 | MATCH |
| font-mono + copy button (navigator.clipboard) | Required | Lines 258-267 | MATCH |
| "확인" button to close | Required | Line 270 | MATCH |

**Result: 16/16 items MATCH (100%)**

---

### 2-10. `src/components/settings/ApiTokenCreateDialog.tsx` -- Create/edit dialog

| Item | Design | Implementation | Status |
|------|--------|----------------|--------|
| Props: open, onOpenChange, mode, token? | Required | Lines 39-62 | MATCH |
| Props: onSuccess callback with token | Design: `onSuccess: (result: { token?: string }) => void` | Implementation: `onSubmit` prop returns `Promise<{success, data?, error?}>` | PARTIAL |
| State: name, expiresIn, scopes, submitting | Required | Lines 73-76 | MATCH |
| Dialog title: "API 토큰 생성" / "수정" | Required | Line 196 | MATCH |
| Token name Input (maxLength=100) | Required | Lines 207-212 | MATCH |
| Expires select: none/30d/90d/1y | Required | Lines 215-229 | MATCH |
| Expires select only shown on create mode | Required | Lines 215-229: `{mode === "create" && ...}` | MATCH |
| Scope list with permission checkboxes | Required | Lines 369-401 | MATCH |
| "+ 범위 추가" button opens Popover | Required | Lines 235-360 | MATCH |
| Popover: RadioGroup (workspace/folder/partition) | Required | Lines 245-265 | MATCH |
| Workspace select when type=workspace | Required | Lines 268-286 | MATCH |
| Workspace+folder/partition select when type=folder/partition | Required | Lines 287-349 | MATCH |
| Default permission: read=true, others false | Required | Line 137: `{ read: true, create: false, update: false, delete: false }` | MATCH |
| Permission checkboxes per scope item | Required | Lines 387-396 | MATCH |
| Remove scope button | Required | Lines 378-385 | MATCH |
| Cancel + Submit buttons in footer | Required | Lines 405-413 | MATCH |
| Submitting state with Loader2 spinner | Required | Lines 409-411 | MATCH |
| Form reset on open via useEffect | Required | Lines 86-105 | MATCH |
| Duplicate scope check | Not explicitly in design but defensive | Lines 110-114: checks for duplicate before adding | MATCH |

**Result: 18/19 items MATCH, 1 PARTIAL (callback prop name differs: `onSuccess` vs `onSubmit`, but functionally equivalent -- the parent ApiTokensTab wraps it to handle created token display)**

---

### 2-11. `src/app/settings/organization/page.tsx` -- Tab addition

| Item | Design | Implementation | Status |
|------|--------|----------------|--------|
| Import Key from lucide-react | Required | Line 9: `import { Building2, Users, Bot, Key } from "lucide-react"` | MATCH |
| Import ApiTokensTab | Required | Line 14: `import ApiTokensTab from "@/components/settings/ApiTokensTab"` | MATCH |
| TabsTrigger value="api-tokens" | Required | Lines 65-68 | MATCH |
| Key icon with className "mr-2 h-4 w-4" | Required | Line 66: `<Key className="mr-2 h-4 w-4" />` | MATCH |
| Label "API 토큰" | Required | Line 67 | MATCH |
| TabsContent value="api-tokens" with className="mt-6" | Required | Lines 83-85 | MATCH |
| Renders `<ApiTokensTab />` | Required | Line 84 | MATCH |

**Result: 7/7 items MATCH (100%)**

---

## 3. Match Rate Summary

### Per-Section Summary

| Section | Design Items | Match | Partial | Missing | Match Rate |
|---------|:-----------:|:-----:|:-------:|:-------:|:----------:|
| 2-1. schema.ts (apiTokenScopes) | 7 | 7 | 0 | 0 | 100% |
| 2-2. Migration SQL | 8 | 8 | 0 | 0 | 100% |
| 2-3. auth.ts functions | 16 | 16 | 0 | 0 | 100% |
| 2-4. api-tokens/route.ts (GET, POST) | 19 | 18 | 1 | 0 | 97.4% |
| 2-5. api-tokens/[id]/route.ts (PUT, DELETE) | 11 | 10 | 1 | 0 | 95.5% |
| 2-6. v1/records/route.ts (GET, POST) | 20 | 20 | 0 | 0 | 100% |
| 2-7. v1/records/[id]/route.ts (GET, PUT, DELETE) | 16 | 15 | 1 | 0 | 96.9% |
| 2-8. useApiTokens.ts hook | 10 | 10 | 0 | 0 | 100% |
| 2-9. ApiTokensTab.tsx | 16 | 16 | 0 | 0 | 100% |
| 2-10. ApiTokenCreateDialog.tsx | 19 | 18 | 1 | 0 | 97.4% |
| 2-11. settings page tab | 7 | 7 | 0 | 0 | 100% |
| **Total** | **149** | **145** | **4** | **0** | **98.7%** |

### Overall Match Rate

```
Overall Match Rate: 98.7% (147/149 weighted)

  MATCH:   145 items (97.3%)
  PARTIAL:   4 items ( 2.7%)
  MISSING:   0 items ( 0.0%)
```

---

## 4. Differences Found

### 4.1 PARTIAL Items (Design ~= Implementation)

| # | Section | Item | Design | Implementation | Impact |
|---|---------|------|--------|----------------|--------|
| 1 | 2-4 | POST response scopes | `data: { id, name, token, scopes, expiresAt }` | `data: { id, name, token, expiresAt }` -- scopes omitted | Low -- scopes already known to caller |
| 2 | 2-5 | PUT response data | `{ success: true, data: updated token }` | `{ success: true }` -- no data returned | Low -- client calls mutate() to refresh |
| 3 | 2-7 | DELETE message language | Korean: "레코드가 삭제되었습니다." | English: "Record deleted." | Low -- external API uses English consistently |
| 4 | 2-10 | Callback prop name | `onSuccess: (result) => void` | `onSubmit: (input) => Promise<result>` | Low -- functionally equivalent, parent handles token display |

### 4.2 Missing Items (Design O, Implementation X)

None.

### 4.3 Added Items (Design X, Implementation O)

| # | Location | Description | Impact |
|---|----------|-------------|--------|
| 1 | `ApiTokenCreateDialog.tsx:110-114` | Duplicate scope check before adding | Positive -- defensive UX improvement |
| 2 | `v1/records/route.ts:18-29` | `verifyPartitionAccess()` helper function | Positive -- additional org ownership verification |

---

## 5. Overall Scores

| Category | Score | Status |
|----------|:-----:|:------:|
| Design Match | 98.7% | PASS |
| Architecture Compliance | 100% | PASS |
| Convention Compliance | 100% | PASS |
| **Overall** | **98.7%** | **PASS** |

---

## 6. Architecture & Convention Notes

### Architecture Compliance

- Presentation (components, hooks) -> Application (API routes, services) -> Domain (types) -> Infrastructure (DB) dependency direction is correct
- Components use SWR hook (useApiTokens) as service layer, not direct API calls
- API routes use auth.ts functions from lib layer appropriately
- No dependency violations detected

### Convention Compliance

- Component files: PascalCase (ApiTokensTab.tsx, ApiTokenCreateDialog.tsx) -- correct
- Hook file: camelCase (useApiTokens.ts) -- correct
- API routes: kebab-case folders (api-tokens) -- correct
- Import order: external libs first, @/ imports second, relative imports third -- correct across all files
- Toast via sonner -- project standard
- Form reset via useEffect on dialog open -- project pattern

---

## 7. Recommended Actions

### Optional Improvements (Low Priority)

These are all low-impact deviations. No immediate action is required since the overall match rate exceeds 90%.

1. **POST /api/api-tokens response**: Consider including `scopes` in the create response to fully match design spec. The caller already knows the scopes, so this is cosmetic.

2. **PUT /api/api-tokens/[id] response**: Consider returning `{ success: true, data: updatedToken }` with the updated token details. The client already calls `mutate()` so this is non-blocking.

3. **v1/records/[id] DELETE message**: The design specifies Korean ("레코드가 삭제되었습니다.") but the implementation uses English ("Record deleted."). Since the v1 external API consistently uses English messages (all 401/403/404/500 responses are in English), the English version is arguably more appropriate for an external-facing API. Consider updating the design document to reflect this intentional choice.

4. **ApiTokenCreateDialog callback prop**: `onSuccess` was renamed to `onSubmit` with a slightly different signature (returns Promise instead of void). The parent component wraps it correctly. This is a design-implementation naming difference with no functional impact.

### Documentation Update Suggestion

- Update design doc section 2-7 DELETE response message to English to reflect the intentional external API language choice
- Update design doc section 2-4 POST response to clarify that `scopes` is optional in create response

---

## 8. Conclusion

The `external-api` feature implementation is an excellent match to the design document at **98.7% match rate** across 149 comparison items. All 11 files specified in the design are present and implemented. The 4 partial items are all low-impact deviations (response field omission, message language, prop naming) that do not affect functionality. No items are missing from the implementation.

---

## Version History

| Version | Date | Changes | Author |
|---------|------|---------|--------|
| 1.0 | 2026-03-03 | Initial analysis | gap-detector |
