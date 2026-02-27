# multi-org Analysis Report

> **Analysis Type**: Gap Analysis (Design vs Implementation)
>
> **Project**: SalesFlow
> **Analyst**: gap-detector
> **Date**: 2026-02-27
> **Design Doc**: [multi-org.design.md](../02-design/features/multi-org.design.md)
> **Plan Doc**: [multi-org.plan.md](../01-plan/features/multi-org.plan.md)

---

## 1. Analysis Overview

### 1.1 Analysis Purpose

Verify that the multi-org feature implementation (users.orgId 1:1 -> organizationMembers N:N transition) matches the design document across all 6 implementation phases and 17+ files.

### 1.2 Analysis Scope

- **Design Document**: `docs/02-design/features/multi-org.design.md`
- **Plan Document**: `docs/01-plan/features/multi-org.plan.md`
- **Implementation Files**: 18 files across schema, auth, API, frontend
- **Analysis Date**: 2026-02-27

---

## 2. Gap Analysis (Design vs Implementation)

### 2.1 Phase 1: DB Schema

#### 2.1.1 organizationMembers Table (`src/lib/db/schema.ts`)

| Design Item | Design | Implementation | Status |
|-------------|--------|----------------|--------|
| Table name | `organization_members` | `organization_members` | Match |
| id field | `serial("id").primaryKey()` | `serial("id").primaryKey()` | Match |
| organizationId | `uuid NOT NULL, FK organizations(id) CASCADE` | `uuid NOT NULL, FK organizations(id) CASCADE` | Match |
| userId | `uuid NOT NULL, FK users(id) CASCADE` | `uuid NOT NULL, FK users(id) CASCADE` | Match |
| role | `varchar("role", { length: 20 }).notNull()` | `varchar("role", { length: 20 }).notNull()` | Match |
| joinedAt | `timestamptz("joined_at").defaultNow().notNull()` | `timestamptz("joined_at").defaultNow().notNull()` | Match |
| orgUserUnique constraint | `unique().on(table.organizationId, table.userId)` | `unique().on(table.organizationId, table.userId)` | Match |
| userIdx index | `index("org_members_user_idx").on(table.userId)` | `index("org_members_user_idx").on(table.userId)` | Match |

#### 2.1.2 users.orgId Nullable (`src/lib/db/schema.ts`)

| Design Item | Design | Implementation | Status |
|-------------|--------|----------------|--------|
| orgId nullable | `.references(() => organizations.id, { onDelete: "cascade" })` (no `.notNull()`) | `.references(() => organizations.id, { onDelete: "cascade" })` (no `.notNull()`) | Match |
| orgEmailUnique constraint | Maintained | `unique().on(table.orgId, table.email)` still present | Match |

#### 2.1.3 Type Exports (`src/lib/db/schema.ts`)

| Design Item | Design | Implementation | Status |
|-------------|--------|----------------|--------|
| OrganizationMember type | `export type OrganizationMember = typeof organizationMembers.$inferSelect` | Line 820: present | Match |
| NewOrganizationMember type | `export type NewOrganizationMember = typeof organizationMembers.$inferInsert` | Line 821: present | Match |

#### 2.1.4 Migration SQL (`drizzle/0009_multi_org.sql`)

| Design Item | Design | Implementation | Status |
|-------------|--------|----------------|--------|
| CREATE TABLE | Matches design exactly | Matches | Match |
| UNIQUE constraint name | `organization_members_organization_id_user_id_unique` | `organization_members_organization_id_user_id_unique` | Match |
| CREATE INDEX | `org_members_user_idx` | `org_members_user_idx` | Match |
| Data migration INSERT | `INSERT INTO ... SELECT org_id, id, role, created_at FROM users WHERE org_id IS NOT NULL ON CONFLICT ... DO NOTHING` | Matches exactly | Match |
| ALTER users.org_id | `ALTER TABLE "users" ALTER COLUMN "org_id" DROP NOT NULL` | Matches exactly | Match |

**Phase 1 Score: 14/14 (100%)**

---

### 2.2 Phase 2: Auth/Session

#### 2.2.1 signup.ts (`src/pages/api/auth/signup.ts`)

| Design Item | Design | Implementation | Status |
|-------------|--------|----------------|--------|
| Import organizationMembers | Required | Line 3: `organizationMembers` imported | Match |
| Create org -> user -> membership | Sequential creation | Lines 41-85: org -> subscription -> user -> organizationMembers | Match |
| organizationMembers INSERT | `{ organizationId: newOrg.id, userId: newUser.id, role: "owner" }` | Lines 81-85: matches exactly | Match |
| JWT payload unchanged | Uses newOrg.id, newUser fields | Lines 87-93: matches | Match |

#### 2.2.2 login.ts (`src/pages/api/auth/login.ts`)

| Design Item | Design | Implementation | Status |
|-------------|--------|----------------|--------|
| Import organizationMembers | Required | Line 2: imported | Match |
| Query memberships from organizationMembers | `select organizationId, role, joinedAt ... orderBy desc joinedAt` | Lines 42-50: matches exactly | Match |
| No memberships -> 403 | `status: 403, error: "소속된 조직이 없습니다."` | Lines 52-57: matches | Match |
| user.orgId preference logic | `user.orgId ? find matching or fallback to [0] : [0]` | Lines 60-62: matches exactly | Match |
| JWT payload from selectedOrg | `orgId: selectedOrg.organizationId, role: selectedOrg.role` | Lines 64-69: matches | Match |

#### 2.2.3 me.ts (`src/pages/api/auth/me.ts`)

| Design Item | Design | Implementation | Status |
|-------------|--------|----------------|--------|
| Import organizationMembers | Required | Line 3: imported | Match |
| Query myOrgs | `select organizationId, role, orgName ... innerJoin organizations ... where userId` | Lines 22-30: matches exactly | Match |
| Return organizations in response | `organizations: myOrgs` in user object | Lines 37: `organizations: myOrgs` | Match |
| Existing org query preserved | `onboardingCompleted` from organizations | Lines 16-19: preserved | Match |

**Phase 2 Score: 13/13 (100%)**

---

### 2.3 Phase 3: New APIs

#### 2.3.1 switch.ts (`src/pages/api/org/switch.ts`)

| Design Item | Design | Implementation | Status |
|-------------|--------|----------------|--------|
| Method | POST only | Line 8: `POST` check | Match |
| Auth check | `getUserFromRequest` | Lines 12-13 | Match |
| Body: orgId | `const { orgId } = req.body` | Line 17 | Match |
| orgId validation | Required | Line 18: `!orgId || typeof orgId !== "string"` (stricter than design) | Match |
| Membership check | `select from organizationMembers where userId AND organizationId` | Lines 24-33: matches | Match |
| 403 on no membership | `"해당 조직에 소속되어 있지 않습니다."` | Lines 35-39: matches | Match |
| JWT reissue | Payload with membership.organizationId, membership.role | Lines 43-49: matches | Match |
| Cookie set | Standard pattern | Lines 52-57: matches | Match |
| Response | `{ success: true, user: payload }` | Line 59: matches | Match |

#### 2.3.2 my-orgs.ts (`src/pages/api/org/my-orgs.ts`)

| Design Item | Design | Implementation | Status |
|-------------|--------|----------------|--------|
| Method | GET only | Line 7: `GET` check | Match |
| Auth check | `getUserFromRequest` | Lines 11-12 | Match |
| Query | `select id, name, slug, role, joinedAt from organizationMembers innerJoin organizations` | Lines 17-27: matches exactly | Match |
| Response | `{ success: true, data: orgs, currentOrgId: user.orgId }` | Lines 29-33: matches exactly | Match |

**Phase 3 Score: 13/13 (100%)**

---

### 2.4 Phase 4: Frontend

#### 2.4.1 SessionContext.tsx (`src/contexts/SessionContext.tsx`)

| Design Item | Design | Implementation | Status |
|-------------|--------|----------------|--------|
| SessionOrg interface | `{ id, name, slug, role }` | `{ id, name, role }` -- **missing `slug`** | Mismatch |
| SessionUser.organizations | `organizations: SessionOrg[]` | Line 25: present | Match |
| SessionContextType.switchOrg | `switchOrg: (orgId: string) => Promise<void>` | Line 33: matches | Match |
| switchOrg implementation | `fetch /api/org/switch POST -> fetchSession -> router.push("/")` | Lines 78-93: matches exactly | Match |
| fetchSession organizations mapping | Maps `organizationId -> id`, `orgName -> name`, `slug -> slug`, `role -> role` | Lines 62-66: maps `organizationId`, `orgName`, `role` -- **missing `slug`** | Mismatch |

#### 2.4.2 OrgSwitcher.tsx (`src/components/OrgSwitcher.tsx`)

| Design Item | Design | Implementation | Status |
|-------------|--------|----------------|--------|
| Component exists | New file | Present, 51 lines | Match |
| Uses ShadCN DropdownMenu | Required | Lines 3-8: DropdownMenu imported | Match |
| Uses useSession | `user.organizations, user.orgId, switchOrg` | Line 12: destructured | Match |
| Current org check mark | Required | Lines 43-45: `Check` icon for current org | Match |
| Click triggers switchOrg | Required | Lines 36-37: `switchOrg(org.id)` on non-current | Match |
| Single org = hidden | Design says text only, impl returns null | Line 14: `organizations.length <= 1` returns null | Match (acceptable variant) |
| Role display next to org name | Design wireframe shows `(owner)`, `(member)` | Not displayed in implementation | Mismatch |

#### 2.4.3 Sidebar (`src/components/dashboard/sidebar.tsx`)

| Design Item | Design | Implementation | Status |
|-------------|--------|----------------|--------|
| Import OrgSwitcher | Required | Line 26: imported | Match |
| OrgSwitcher in Desktop sidebar | Top area, below header | Lines 133-137: below header, inside border-b section | Match |
| OrgSwitcher in Mobile sidebar | Required | Lines 196-198: present in MobileSidebar | Match |
| Collapsed state hides OrgSwitcher | Implied by design (collapsed = compact) | Line 133: `{!collapsed && ...}` | Match |

**Phase 4 Score: 13/16 (81.3%)**

**Mismatches Found:**
1. `SessionOrg.slug` field missing from interface and fetchSession mapping
2. `OrgSwitcher` does not display role information next to organization names

---

### 2.5 Phase 5: Existing API Migration

#### 2.5.1 invitations.ts (`src/pages/api/org/invitations.ts`)

| Design Item | Design | Implementation | Status |
|-------------|--------|----------------|--------|
| Import organizationMembers | Required | Line 2: imported | Match |
| handlePost: existing member check | `users innerJoin organizationMembers where organizationId AND email` | Lines 116-123: matches exactly | Match |
| handleGet: unchanged | `organizationInvitations.orgId` based | Lines 30-48: unchanged, correct | Match |

#### 2.5.2 members.ts (`src/pages/api/org/members.ts`)

| Design Item | Design | Implementation | Status |
|-------------|--------|----------------|--------|
| Import organizationMembers | Required | Line 2: imported | Match |
| Query from organizationMembers | `from(organizationMembers) innerJoin users` | Lines 35-36: matches | Match |
| Select role from organizationMembers | `role: organizationMembers.role` | Line 30: matches | Match |
| Where clause | `eq(organizationMembers.organizationId, orgId)` | Line 37: matches | Match |
| OrderBy | `desc(organizationMembers.role), asc(users.createdAt)` | Line 38: matches exactly | Match |

#### 2.5.3 members/[id].ts (`src/pages/api/org/members/[id].ts`)

| Design Item | Design | Implementation | Status |
|-------------|--------|----------------|--------|
| handlePatch: target query | `from organizationMembers innerJoin users where userId AND organizationId` | Lines 45-55: matches | Match |
| handlePatch: role update | `update organizationMembers set role where userId AND organizationId` | Lines 76-82: matches | Match |
| handleDelete: remove from organizationMembers | `delete from organizationMembers where userId AND organizationId` | Lines 128-133: matches | Match |

#### 2.5.4 users/index.ts (`src/pages/api/users/index.ts`)

| Design Item | Design | Implementation | Status |
|-------------|--------|----------------|--------|
| handleGet: conditions | `eq(organizationMembers.organizationId, orgId)` | Line 32: matches | Match |
| handleGet: from organizationMembers | `from(organizationMembers) innerJoin users` | Lines 66-67: matches | Match |
| handleGet: select orgId | `orgId: organizationMembers.organizationId` | Line 57: matches | Match |
| handleGet: select role | `role: organizationMembers.role` | Line 60: matches | Match |
| handlePost: user creation | `insert users` then `insert organizationMembers` | Lines 136-158: matches | Match |
| handlePost: organizationMembers INSERT | `{ organizationId: orgId, userId: created.id, role: targetRole }` | Lines 154-158: matches exactly | Match |

#### 2.5.5 users/[id].ts (`src/pages/api/users/[id].ts`)

| Design Item | Design | Implementation | Status |
|-------------|--------|----------------|--------|
| Target user query | `from organizationMembers innerJoin users where userId AND organizationId` | Lines 27-38: matches | Match |
| Select role | `role: organizationMembers.role` | Line 30: matches | Match |
| Role update | `update organizationMembers set role where userId AND organizationId` | Lines 111-117: matches | Match |
| name, phone, isActive on users table | Preserved | Lines 88-106: preserved | Match |

**Phase 5 Score: 18/18 (100%)**

---

### 2.6 Phase 6: Invite Accept API

#### 2.6.1 invite-accept.ts (`src/pages/api/org/invite-accept.ts`)

| Design Item | Design | Implementation | Status |
|-------------|--------|----------------|--------|
| File exists | New file | Present, 107 lines | Match |
| Method | POST only | Line 8: POST check | Match |
| Auth: requires login | `getUserFromRequest` | Lines 12-13 | Match |
| Token from body | `const { token } = req.body` | Line 17 | Match |
| Invitation query | `pending + not expired` | Lines 24-31: matches | Match |
| Email match check | `invitation.email === user.email` | Lines 41-46: matches | Match |
| Existing member check | Check organizationMembers before inserting | Lines 49-55: matches | Match |
| Already member handling | Accept invitation, return message | Lines 57-67: matches | Match |
| organizationMembers INSERT | `{ organizationId: invitation.orgId, userId: user.userId, role: invitation.role }` | Lines 70-74: matches | Match |
| Invitation status update | `set status "accepted"` | Lines 77-79: matches | Match |
| JWT reissue (auto switch) | New JWT with invitation orgId and role | Lines 82-96: matches | Match |

#### 2.6.2 invitations/accept.ts (`src/pages/api/org/invitations/accept.ts`)

| Design Item | Design (implied) | Implementation | Status |
|-------------|------------------|----------------|--------|
| File exists | Updated with organizationMembers | Present, 160 lines | Match |
| handleAccept: existing member check | organizationMembers-based check | Lines 89-96: `users innerJoin organizationMembers` check | Match |
| handleAccept: organizationMembers INSERT | After user creation | Lines 121-125: present | Match |
| handleAccept: invitation status update | Set "accepted" | Lines 128-131: present | Match |
| handleAccept: JWT issued | With correct orgId | Lines 134-147: present | Match |

**Phase 6 Score: 16/16 (100%)**

---

### 2.7 billing.ts (`src/lib/billing.ts`)

| Design Item | Design | Implementation | Status |
|-------------|--------|----------------|--------|
| Import organizationMembers | Required | Line 1: imported | Match |
| Members count query | `from(organizationMembers) where(organizationMembers.organizationId, orgId)` | Lines 138-142: matches exactly | Match |

**billing.ts Score: 2/2 (100%)**

---

## 3. Difference Summary

### 3.1 Missing Features (Design O, Implementation X)

| # | Item | Design Location | Description | Impact |
|---|------|-----------------|-------------|--------|
| 1 | SessionOrg.slug | design.md:349 | `slug: string` field missing from SessionOrg interface | Low |
| 2 | fetchSession slug mapping | design.md:395 | `slug: o.slug ?? ""` not in fetchSession mapping | Low |
| 3 | me.ts slug return | design.md:232 (implied) | /api/auth/me does not return org `slug` in myOrgs query | Low |

### 3.2 Changed Features (Design != Implementation)

| # | Item | Design | Implementation | Impact |
|---|------|--------|----------------|--------|
| 1 | OrgSwitcher role display | Wireframe shows `(owner)`, `(member)` next to org names | Only org name displayed, no role | Low |

### 3.3 Positive Deviations (Implementation exceeds design)

| # | Item | Implementation Location | Description |
|---|------|------------------------|-------------|
| 1 | invite-accept.ts already-member handling | L49-67 | Extra check for existing membership before insert (prevents duplicates) |
| 2 | switch.ts orgId type validation | L18 | `typeof orgId !== "string"` additional type check |
| 3 | OrgSwitcher collapsed handling | sidebar.tsx:133 | Hides OrgSwitcher when sidebar collapsed |
| 4 | MobileSidebar OrgSwitcher | sidebar.tsx:196-198 | OrgSwitcher also in mobile sidebar |
| 5 | members/[id].ts DELETE handler | L91-140 | Full delete implementation with role-based permission checks |

---

## 4. Match Rate Calculation

### Item Counts by Phase

| Phase | Category | Total Items | Matched | Mismatched |
|-------|----------|:-----------:|:-------:|:----------:|
| Phase 1 | DB Schema | 14 | 14 | 0 |
| Phase 2 | Auth/Session | 13 | 13 | 0 |
| Phase 3 | New APIs | 13 | 13 | 0 |
| Phase 4 | Frontend | 16 | 13 | 3 |
| Phase 5 | API Migration | 18 | 18 | 0 |
| Phase 6 | Invite Accept | 16 | 16 | 0 |
| Extra | billing.ts | 2 | 2 | 0 |
| **Total** | | **92** | **89** | **3** |

### Overall Match Rate

```
+---------------------------------------------+
|  Overall Match Rate: 96.7% (89/92)          |
+---------------------------------------------+
|  Match:     89 items (96.7%)                |
|  Mismatch:   3 items ( 3.3%)               |
+---------------------------------------------+
|  Status: PASS (>= 90%)                     |
+---------------------------------------------+
```

### Per-Category Scores

| Category | Score | Status |
|----------|:-----:|:------:|
| Phase 1: DB Schema | 100% | PASS |
| Phase 2: Auth/Session | 100% | PASS |
| Phase 3: New APIs | 100% | PASS |
| Phase 4: Frontend | 81.3% | WARN |
| Phase 5: API Migration | 100% | PASS |
| Phase 6: Invite Accept | 100% | PASS |
| billing.ts | 100% | PASS |
| **Overall** | **96.7%** | **PASS** |

---

## 5. Verification Checklist (from Design Section 6)

| # | Verification Item | Result |
|---|-------------------|--------|
| 1 | organizationMembers table schema matches design | PASS |
| 2 | users.orgId is nullable | PASS |
| 3 | Login reads from organizationMembers (not users.orgId directly) | PASS |
| 4 | Signup creates organizationMembers entry | PASS |
| 5 | me.ts returns organizations list | PASS |
| 6 | switch.ts validates membership and reissues JWT | PASS |
| 7 | my-orgs.ts returns org list with roles | PASS |
| 8 | invite-accept.ts creates organizationMembers entry | PASS |
| 9 | invitations.ts checks membership via organizationMembers JOIN | PASS |
| 10 | members.ts queries via organizationMembers JOIN | PASS |
| 11 | members/[id].ts updates organizationMembers.role | PASS |
| 12 | users/index.ts uses organizationMembers JOIN (GET) and INSERT (POST) | PASS |
| 13 | users/[id].ts uses organizationMembers for role management | PASS |
| 14 | billing.ts counts members from organizationMembers | PASS |
| 15 | SessionContext has switchOrg + organizations array | PASS |
| 16 | OrgSwitcher renders dropdown with org list | PASS |
| 17 | Sidebar includes OrgSwitcher component | PASS |
| 18 | Migration SQL creates table + migrates data + alters column | PASS |

**All 18 verification items: PASS**

---

## 6. Detailed Gap Descriptions

### Gap 1: SessionOrg.slug Missing (Low Impact)

**Design** (Section 3.11, Line 349):
```typescript
interface SessionOrg {
    id: string;
    name: string;
    slug: string;  // <-- missing
    role: OrgRole;
}
```

**Implementation** (`src/contexts/SessionContext.tsx`, Line 12-16):
```typescript
interface SessionOrg {
    id: string;
    name: string;
    role: OrgRole;
    // slug field not present
}
```

**Root Cause**: The `me.ts` API does not return `slug` in the `myOrgs` query, so the frontend has no slug data to map. Both the API response and the frontend interface need the `slug` field added.

**Impact**: Low. The slug is not currently used in any frontend display or routing logic. It would be needed if org-specific URLs (e.g., `/org/{slug}/...`) are introduced in the future.

### Gap 2: OrgSwitcher Role Display Missing (Low Impact)

**Design** (Section 3.12, Wireframe):
```
|  V  Org A  (owner)      |
|    Org B  (member)       |
|    Org C  (admin)        |
```

**Implementation** (`src/components/OrgSwitcher.tsx`, Lines 32-47):
Only the org name is displayed. No role badge next to the name.

**Impact**: Low. This is a cosmetic difference. Role information is available in the `SessionOrg` data but not rendered.

---

## 7. Recommended Actions

### 7.1 Optional Improvements (Non-blocking)

| # | Item | Files | Effort |
|---|------|-------|--------|
| 1 | Add `slug` to me.ts myOrgs query | `src/pages/api/auth/me.ts` | 1 line |
| 2 | Add `slug` to SessionOrg interface | `src/contexts/SessionContext.tsx` | 2 lines |
| 3 | Map `slug` in fetchSession | `src/contexts/SessionContext.tsx` | 1 line |
| 4 | Add role badge to OrgSwitcher | `src/components/OrgSwitcher.tsx` | 3 lines |

### 7.2 Decision Required

The 3 mismatched items are all Low-impact frontend cosmetic/future-proofing items. Options:

1. **Fix implementation** to match design (add slug + role display) -- ~10 min effort
2. **Update design** to match implementation (remove slug, remove role display from wireframe)
3. **Record as intentional** (slug deferred to future URL routing, role display deferred to UX iteration)

---

## 8. Files Analyzed

| # | File Path | Type | Phase | Lines |
|---|-----------|------|-------|:-----:|
| 1 | `src/lib/db/schema.ts` | Modified | 1 | 833 |
| 2 | `drizzle/0009_multi_org.sql` | New | 1 | 21 |
| 3 | `src/pages/api/auth/signup.ts` | Modified | 2 | 109 |
| 4 | `src/pages/api/auth/login.ts` | Modified | 2 | 90 |
| 5 | `src/pages/api/auth/me.ts` | Modified | 2 | 41 |
| 6 | `src/pages/api/org/switch.ts` | New | 3 | 65 |
| 7 | `src/pages/api/org/my-orgs.ts` | New | 3 | 39 |
| 8 | `src/pages/api/org/invite-accept.ts` | New | 6 | 107 |
| 9 | `src/pages/api/org/invitations.ts` | Modified | 5 | 176 |
| 10 | `src/pages/api/org/invitations/accept.ts` | Modified | 6 | 160 |
| 11 | `src/pages/api/org/members.ts` | Modified | 5 | 46 |
| 12 | `src/pages/api/org/members/[id].ts` | Modified | 5 | 141 |
| 13 | `src/pages/api/users/index.ts` | Modified | 5 | 166 |
| 14 | `src/pages/api/users/[id].ts` | Modified | 5 | 130 |
| 15 | `src/lib/billing.ts` | Modified | 5 | 147 |
| 16 | `src/contexts/SessionContext.tsx` | Modified | 4 | 121 |
| 17 | `src/components/OrgSwitcher.tsx` | New | 4 | 51 |
| 18 | `src/components/dashboard/sidebar.tsx` | Modified | 4 | 219 |

**Total**: 18 files, ~2,462 lines analyzed

---

## Version History

| Version | Date | Changes | Author |
|---------|------|---------|--------|
| 0.1 | 2026-02-27 | Initial analysis -- 92 items, 96.7% match rate | gap-detector |
