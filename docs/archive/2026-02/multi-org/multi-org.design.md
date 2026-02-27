# multi-org Design Document

> **Summary**: users.orgId 1:1 구조 → organizationMembers 다대다 구조 전환. JWT.orgId를 "현재 선택된 조직"으로 재정의하여 기존 API 패턴 유지.
>
> **Date**: 2026-02-27
> **Status**: Draft
> **Planning Doc**: [multi-org.plan.md](../01-plan/features/multi-org.plan.md)

---

## 1. Overview

### 1.1 Design Goals

- 한 사용자가 여러 조직에 소속 가능 (organizationMembers junction table)
- JWT.orgId = "현재 선택된 조직" — 기존 74개 API의 `user.orgId` 패턴 변경 없음
- 조직 전환 = JWT 재발급 (쿠키 교체)
- 초대 수락 시 organizationMembers에 추가 → 새 조직으로 전환 가능

### 1.2 Data Flow

```
로그인 → organizationMembers에서 최근 조직 조회 → JWT(orgId=선택된 조직) 발급
조직 전환 → POST /api/org/switch → 소속 검증 → JWT 재발급 → 쿠키 갱신
모든 API → getUserFromRequest() → user.orgId (JWT에서 읽음, 기존과 동일)
```

---

## 2. Data Model

### 2.1 신규 테이블: organizationMembers

```typescript
// src/lib/db/schema.ts
export const organizationMembers = pgTable(
    "organization_members",
    {
        id: serial("id").primaryKey(),
        organizationId: uuid("organization_id")
            .notNull()
            .references(() => organizations.id, { onDelete: "cascade" }),
        userId: uuid("user_id")
            .notNull()
            .references(() => users.id, { onDelete: "cascade" }),
        role: varchar("role", { length: 20 }).notNull(), // owner | admin | member
        joinedAt: timestamptz("joined_at").defaultNow().notNull(),
    },
    (table) => ({
        orgUserUnique: unique().on(table.organizationId, table.userId),
        userIdx: index("org_members_user_idx").on(table.userId),
    })
);
```

### 2.2 users 테이블 변경

| 필드 | 현재 | 변경 |
|------|------|------|
| `orgId` | `uuid NOT NULL` | **nullable** (점진적 제거용, 하위호환) |
| `role` | `varchar NOT NULL` | **유지** (단일 조직 호환, organizationMembers.role이 우선) |

**`users.orgId`는 삭제하지 않음** — nullable로만 변경. 기존 unique 제약조건 `(orgId, email)`은 유지.

### 2.3 Entity Relationships

```
[User] N ──── N [Organization]
         via
    [OrganizationMember]
         (userId, organizationId, role)
```

---

## 3. 파일별 변경 상세

### Phase 1: DB Schema (3개 파일)

#### 3.1 `src/lib/db/schema.ts`

**추가**: `organizationMembers` 테이블 (2.1 참조)

**변경**: users 테이블의 orgId를 nullable로:
```typescript
// 현재 (L52-54)
orgId: uuid("org_id")
    .references(() => organizations.id, { onDelete: "cascade" })
    .notNull(),

// 변경
orgId: uuid("org_id")
    .references(() => organizations.id, { onDelete: "cascade" }),
```

**추가**: 타입 export:
```typescript
export type OrganizationMember = typeof organizationMembers.$inferSelect;
export type NewOrganizationMember = typeof organizationMembers.$inferInsert;
```

#### 3.2 `drizzle/XXXX_multi_org.sql`

```sql
-- 1. organizationMembers 테이블 생성
CREATE TABLE IF NOT EXISTS "organization_members" (
    "id" serial PRIMARY KEY,
    "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
    "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
    "role" varchar(20) NOT NULL,
    "joined_at" timestamptz DEFAULT now() NOT NULL,
    CONSTRAINT "organization_members_organization_id_user_id_unique" UNIQUE("organization_id", "user_id")
);
CREATE INDEX IF NOT EXISTS "org_members_user_idx" ON "organization_members"("user_id");

-- 2. 기존 데이터 마이그레이션
INSERT INTO "organization_members" ("organization_id", "user_id", "role", "joined_at")
SELECT "org_id", "id", "role", "created_at"
FROM "users"
WHERE "org_id" IS NOT NULL
ON CONFLICT ("organization_id", "user_id") DO NOTHING;

-- 3. users.orgId nullable로 변경
ALTER TABLE "users" ALTER COLUMN "org_id" DROP NOT NULL;
```

#### 3.3 `src/lib/db/index.ts`

변경 없음 — `export * from "./schema"` 패턴이므로 자동 export.

---

### Phase 2: Auth/Session (5개 파일)

#### 3.4 `src/types/index.ts`

변경 없음. JWTPayload의 orgId는 "현재 선택된 조직"으로 의미만 변경, 타입은 동일:
```typescript
export interface JWTPayload {
  userId: string;
  orgId: string;    // 현재 선택된 조직 (was: 유일한 소속 조직)
  email: string;
  name: string;
  role: OrgRole;    // 현재 조직에서의 역할
}
```

#### 3.5 `src/lib/auth.ts`

변경 없음. `getUserFromRequest()`는 JWT에서 payload를 읽을 뿐 — orgId의 출처가 users 테이블에서 organizationMembers로 바뀌는 건 login/signup에서 처리.

#### 3.6 `src/pages/api/auth/signup.ts`

**추가**: organizationMembers에 owner 멤버십 생성

```typescript
// 현재: org 생성 → user 생성 (orgId 포함)
// 변경: org 생성 → user 생성 (orgId 포함) → organizationMembers INSERT

// L63 이후, user 생성 후 추가:
await db.insert(organizationMembers).values({
    organizationId: newOrg.id,
    userId: newUser.id,
    role: "owner",
});
```

JWT payload 생성 로직은 변경 없음 (newUser.orgId가 여전히 존재).

#### 3.7 `src/pages/api/auth/login.ts`

**변경**: user.orgId 대신 organizationMembers에서 조직 조회

```typescript
// 현재 (L41-47):
const payload: JWTPayload = {
    userId: user.id,
    orgId: user.orgId,      // ← users 테이블에서 직접
    email: user.email,
    name: user.name,
    role: user.role as "owner" | "admin" | "member",
};

// 변경:
// 1. organizationMembers에서 소속 조직 목록 조회
const memberships = await db
    .select({
        organizationId: organizationMembers.organizationId,
        role: organizationMembers.role,
        joinedAt: organizationMembers.joinedAt,
    })
    .from(organizationMembers)
    .where(eq(organizationMembers.userId, user.id))
    .orderBy(desc(organizationMembers.joinedAt));

if (memberships.length === 0) {
    return res.status(403).json({
        success: false,
        error: "소속된 조직이 없습니다.",
    });
}

// 2. 가장 최근 조직 자동 선택 (또는 users.orgId가 있으면 그것 우선)
const selectedOrg = user.orgId
    ? memberships.find(m => m.organizationId === user.orgId) ?? memberships[0]
    : memberships[0];

const payload: JWTPayload = {
    userId: user.id,
    orgId: selectedOrg.organizationId,
    email: user.email,
    name: user.name,
    role: selectedOrg.role as OrgRole,
};
```

#### 3.8 `src/pages/api/auth/me.ts`

**변경**: 조직 목록도 함께 반환

```typescript
// 현재: org.onboardingCompleted만 반환
// 변경: + 소속 조직 목록 추가

// 기존 org 조회 로직 유지 (user.orgId = JWT의 현재 조직)
// 추가:
const myOrgs = await db
    .select({
        organizationId: organizationMembers.organizationId,
        role: organizationMembers.role,
        orgName: organizations.name,
    })
    .from(organizationMembers)
    .innerJoin(organizations, eq(organizations.id, organizationMembers.organizationId))
    .where(eq(organizationMembers.userId, user.userId));

return res.status(200).json({
    success: true,
    user: {
        ...user,
        onboardingCompleted: org?.onboardingCompleted ?? false,
        organizations: myOrgs,  // 신규: 소속 조직 목록
    },
});
```

---

### Phase 3: 조직 전환 API (2개 신규)

#### 3.9 `src/pages/api/org/switch.ts` (신규)

```typescript
// POST /api/org/switch
// Body: { orgId: string }
// 동작:
//   1. JWT에서 현재 유저 확인
//   2. organizationMembers에서 해당 조직 소속 확인
//   3. 새 JWT 발급 (orgId = 요청된 조직, role = 해당 조직에서의 role)
//   4. 쿠키 갱신
//   5. { success: true, user: JWTPayload } 반환

export default async function handler(req, res) {
    if (req.method !== "POST") return res.status(405)...;

    const user = getUserFromRequest(req);
    if (!user) return res.status(401)...;

    const { orgId } = req.body;
    if (!orgId) return res.status(400)...;

    // 소속 확인
    const [membership] = await db
        .select()
        .from(organizationMembers)
        .where(and(
            eq(organizationMembers.userId, user.userId),
            eq(organizationMembers.organizationId, orgId)
        ));

    if (!membership) {
        return res.status(403).json({
            success: false,
            error: "해당 조직에 소속되어 있지 않습니다.",
        });
    }

    // JWT 재발급
    const payload: JWTPayload = {
        userId: user.userId,
        orgId: membership.organizationId,
        email: user.email,
        name: user.name,
        role: membership.role as OrgRole,
    };

    const token = generateToken(payload);
    // 쿠키 설정 (기존 login.ts 패턴)
    // 응답
}
```

#### 3.10 `src/pages/api/org/my-orgs.ts` (신규)

```typescript
// GET /api/org/my-orgs
// 동작: 현재 유저의 소속 조직 목록 반환
// 응답: { success: true, data: [{ id, name, slug, role, joinedAt }] }

export default async function handler(req, res) {
    if (req.method !== "GET") return res.status(405)...;

    const user = getUserFromRequest(req);
    if (!user) return res.status(401)...;

    const orgs = await db
        .select({
            id: organizations.id,
            name: organizations.name,
            slug: organizations.slug,
            role: organizationMembers.role,
            joinedAt: organizationMembers.joinedAt,
        })
        .from(organizationMembers)
        .innerJoin(organizations, eq(organizations.id, organizationMembers.organizationId))
        .where(eq(organizationMembers.userId, user.userId));

    return res.status(200).json({
        success: true,
        data: orgs,
        currentOrgId: user.orgId,
    });
}
```

---

### Phase 4: Frontend (3개 파일)

#### 3.11 `src/contexts/SessionContext.tsx`

**변경**: organizations 배열 + switchOrg 함수 추가

```typescript
// SessionUser에 추가:
interface SessionOrg {
    id: string;
    name: string;
    slug: string;
    role: OrgRole;
}

interface SessionUser {
    // 기존 필드 유지
    id: string;
    orgId: string;
    name: string;
    email: string;
    role: OrgRole;
    onboardingCompleted: boolean;
    // 신규:
    organizations: SessionOrg[];
}

// SessionContextType에 추가:
interface SessionContextType {
    user: SessionUser | null;
    isLoading: boolean;
    logout: () => void;
    refreshSession: () => Promise<void>;
    switchOrg: (orgId: string) => Promise<void>;  // 신규
}

// switchOrg 구현:
const switchOrg = useCallback(async (orgId: string) => {
    const res = await fetch("/api/org/switch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgId }),
    });
    const data = await res.json();
    if (data.success) {
        // JWT 쿠키가 서버에서 갱신됨 → 세션 새로고침
        await fetchSession();
        router.push("/");  // 메인으로 이동
    }
}, [fetchSession, router]);

// fetchSession에서 organizations 매핑:
setUser({
    // ...기존 필드
    organizations: data.user.organizations?.map((o: any) => ({
        id: o.organizationId,
        name: o.orgName,
        slug: o.slug ?? "",
        role: o.role,
    })) ?? [],
});
```

#### 3.12 `src/components/OrgSwitcher.tsx` (신규)

```
┌──────────────────────────┐
│ [현재 조직명]         ▼  │  ← DropdownMenu trigger
├──────────────────────────┤
│  ✓ 조직 A  (owner)      │
│    조직 B  (member)      │
│    조직 C  (admin)       │
├──────────────────────────┤
│  + 새 조직 만들기        │  ← 향후 확장
└──────────────────────────┘
```

- ShadCN `DropdownMenu` 사용
- `useSession()`에서 `user.organizations`, `user.orgId`, `switchOrg` 가져옴
- 현재 조직에 체크 표시
- 클릭 시 `switchOrg(orgId)` 호출

#### 3.13 `src/components/layout/Sidebar.tsx` (또는 해당 레이아웃)

**변경**: OrgSwitcher 컴포넌트 배치

- 사이드바 상단 (조직명 표시 영역)에 OrgSwitcher 추가
- 조직이 1개뿐이면 드롭다운 대신 텍스트만 표시 (간결함 유지)

---

### Phase 5: 기존 API 마이그레이션 (5개 핵심 파일)

#### 3.14 `src/pages/api/org/invitations.ts`

**변경 1** (L125-128): "이미 소속된 이메일 체크" — users.orgId 대신 organizationMembers 확인

```typescript
// 현재:
const [existingUser] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.orgId, currentUser.orgId), eq(users.email, email.toLowerCase())));

// 변경:
const [existingMember] = await db
    .select({ id: users.id })
    .from(users)
    .innerJoin(organizationMembers, and(
        eq(organizationMembers.userId, users.id),
        eq(organizationMembers.organizationId, currentUser.orgId)
    ))
    .where(eq(users.email, email.toLowerCase()));
```

**나머지**: handleGet은 organizationInvitations.orgId 기반이므로 변경 불필요.

#### 3.15 `src/pages/api/org/members.ts`

**변경**: users.orgId 대신 organizationMembers JOIN

```typescript
// 현재 (L25-37):
const members = await db
    .select({...})
    .from(users)
    .where(eq(users.orgId, orgId))
    .orderBy(...);

// 변경:
const members = await db
    .select({
        id: users.id,
        name: users.name,
        email: users.email,
        role: organizationMembers.role,   // ← users.role 대신
        phone: users.phone,
        isActive: users.isActive,
        createdAt: users.createdAt,
    })
    .from(organizationMembers)
    .innerJoin(users, eq(users.id, organizationMembers.userId))
    .where(eq(organizationMembers.organizationId, orgId))
    .orderBy(desc(organizationMembers.role), asc(users.createdAt));
```

#### 3.16 `src/pages/api/org/members/[id].ts`

**변경**: role을 organizationMembers에서 읽고 organizationMembers를 업데이트

```typescript
// handlePatch: 대상 멤버 조회
// 현재: users WHERE id AND orgId
// 변경:
const [target] = await db
    .select({
        id: users.id,
        role: organizationMembers.role,
    })
    .from(organizationMembers)
    .innerJoin(users, eq(users.id, organizationMembers.userId))
    .where(and(
        eq(organizationMembers.userId, targetId),
        eq(organizationMembers.organizationId, currentUser.orgId)
    ));

// role 업데이트: users.role 대신 organizationMembers.role
await db
    .update(organizationMembers)
    .set({ role })
    .where(and(
        eq(organizationMembers.userId, targetId),
        eq(organizationMembers.organizationId, currentUser.orgId)
    ));

// handleDelete: 비활성화 대신 organizationMembers에서 제거
await db
    .delete(organizationMembers)
    .where(and(
        eq(organizationMembers.userId, targetId),
        eq(organizationMembers.organizationId, currentUser.orgId)
    ));
```

#### 3.17 `src/pages/api/users/index.ts`

**변경**: GET — organizationMembers JOIN, POST — organizationMembers INSERT 추가

```typescript
// handleGet: users.orgId 대신 organizationMembers JOIN
const conditions = [eq(organizationMembers.organizationId, orgId)];
// ...

const data = await db
    .select({
        id: users.id,
        orgId: organizationMembers.organizationId,  // ← users.orgId 대신
        email: users.email,
        name: users.name,
        role: organizationMembers.role,
        phone: users.phone,
        isActive: users.isActive,
        createdAt: users.createdAt,
        updatedAt: users.updatedAt,
    })
    .from(organizationMembers)
    .innerJoin(users, eq(users.id, organizationMembers.userId))
    .where(whereClause)
    .orderBy(sql`${users.createdAt} desc`)
    .limit(pageSize)
    .offset(offset);

// handlePost: user 생성 후 organizationMembers에도 추가
const [created] = await db
    .insert(users)
    .values({ orgId, email, password: hashedPassword, name, role: targetRole, phone })
    .returning({...});

await db.insert(organizationMembers).values({
    organizationId: orgId,
    userId: created.id,
    role: targetRole,
});
```

#### 3.18 `src/pages/api/users/[id].ts`

**변경**: 대상 사용자 조회 시 organizationMembers JOIN

```typescript
// 현재 (L27-35):
const [targetUser] = await db
    .select({ id: users.id, orgId: users.orgId, role: users.role, isActive: users.isActive })
    .from(users)
    .where(and(eq(users.id, targetId), eq(users.orgId, currentUser.orgId)));

// 변경:
const [targetUser] = await db
    .select({
        id: users.id,
        role: organizationMembers.role,
        isActive: users.isActive,
    })
    .from(organizationMembers)
    .innerJoin(users, eq(users.id, organizationMembers.userId))
    .where(and(
        eq(organizationMembers.userId, targetId),
        eq(organizationMembers.organizationId, currentUser.orgId)
    ));

// role 업데이트 시 organizationMembers에 반영
if (role !== undefined) {
    await db.update(organizationMembers)
        .set({ role })
        .where(and(
            eq(organizationMembers.userId, targetId),
            eq(organizationMembers.organizationId, currentUser.orgId)
        ));
}
// name, phone, isActive는 users 테이블에서 업데이트 (기존과 동일)
```

#### 3.19 `src/lib/billing.ts` (L137-143)

**변경**: members 카운트 — users.orgId 대신 organizationMembers

```typescript
// 현재:
if (resource === "members") {
    const [result] = await db
        .select({ count: count() })
        .from(users)
        .where(eq(users.orgId, orgId));
    return result?.count ?? 0;
}

// 변경:
if (resource === "members") {
    const [result] = await db
        .select({ count: count() })
        .from(organizationMembers)
        .where(eq(organizationMembers.organizationId, orgId));
    return result?.count ?? 0;
}
```

---

### Phase 6: 초대 수락 API (1개 신규)

#### 3.20 `src/pages/api/org/invite-accept.ts` (신규)

현재 초대 수락 API가 없으므로 신규 생성:

```typescript
// POST /api/org/invite-accept
// Body: { token: string }
// 동작:
//   1. token으로 invitation 조회 (pending + 만료 전)
//   2. 현재 JWT 유저 확인 (로그인 상태)
//   3. 이메일 일치 확인 (invitation.email === user.email)
//   4. organizationMembers에 추가 (role = invitation.role)
//   5. invitation.status = "accepted"
//   6. 새 조직으로 JWT 재발급 (자동 전환)
```

---

## 4. 변경하지 않는 파일 (~69개 API)

다음 패턴을 사용하는 API들은 **변경 불필요**:

```typescript
const user = getUserFromRequest(req);
// user.orgId ← JWT에서 읽은 현재 선택된 조직 ID
const data = await db.select()...where(eq(table.orgId, user.orgId));
```

JWT의 orgId가 "현재 선택된 조직"이 되므로, 이 패턴은 그대로 정상 동작.

---

## 5. 구현 순서

| # | 파일 | 유형 | 검증 |
|---|------|------|------|
| 1 | `src/lib/db/schema.ts` | 수정 | 타입 체크 |
| 2 | `drizzle/XXXX_multi_org.sql` | 신규 | SQL 실행 |
| 3 | `src/pages/api/auth/signup.ts` | 수정 | 빌드 |
| 4 | `src/pages/api/auth/login.ts` | 수정 | 빌드 |
| 5 | `src/pages/api/auth/me.ts` | 수정 | 빌드 |
| 6 | `src/pages/api/org/switch.ts` | 신규 | 빌드 |
| 7 | `src/pages/api/org/my-orgs.ts` | 신규 | 빌드 |
| 8 | `src/pages/api/org/invite-accept.ts` | 신규 | 빌드 |
| 9 | `src/pages/api/org/invitations.ts` | 수정 | 빌드 |
| 10 | `src/pages/api/org/members.ts` | 수정 | 빌드 |
| 11 | `src/pages/api/org/members/[id].ts` | 수정 | 빌드 |
| 12 | `src/pages/api/users/index.ts` | 수정 | 빌드 |
| 13 | `src/pages/api/users/[id].ts` | 수정 | 빌드 |
| 14 | `src/lib/billing.ts` | 수정 | 빌드 |
| 15 | `src/contexts/SessionContext.tsx` | 수정 | 빌드 |
| 16 | `src/components/OrgSwitcher.tsx` | 신규 | 빌드 |
| 17 | Sidebar/Layout에 OrgSwitcher 배치 | 수정 | `pnpm build` |

---

## 6. 검증 체크리스트

- [ ] `pnpm build` 성공
- [ ] 마이그레이션 SQL 실행 → organization_members 테이블 생성
- [ ] 기존 users 데이터 → organization_members 자동 마이그레이션
- [ ] 신규 회원가입 → 조직 + user + organizationMember 생성
- [ ] 기존 사용자 로그인 → organizationMembers에서 조직 조회 → JWT 발급
- [ ] 조직 전환 → /api/org/switch → JWT 재발급 → 데이터 격리
- [ ] 멤버 목록 → organizationMembers JOIN 기반 조회
- [ ] 멤버 역할 변경 → organizationMembers.role 업데이트
- [ ] 초대 → 이미 소속 체크 organizationMembers 기반
- [ ] 초대 수락 → organizationMembers INSERT
- [ ] OrgSwitcher UI → 조직 목록 표시 + 전환

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 0.1 | 2026-02-27 | Initial draft |
