# auth-integration Design Document

> **Summary**: Sales 인증을 Adion DB 참조로 전환 — uuid 마이그레이션 + Auto-Provision SSO
>
> **Project**: sales-manager
> **Version**: 0.1.0
> **Author**: AI
> **Date**: 2026-02-13
> **Status**: Draft
> **Planning Doc**: [auth-integration.plan.md](../01-plan/features/auth-integration.plan.md)

---

## 1. Overview

### 1.1 Design Goals

- Sales 로그인 시 Adion DB의 users 테이블로 인증, Sales DB에 자동 프로비저닝
- 전체 Sales DB PK/FK를 uuid로 마이그레이션하여 Adion과 ID 호환
- 기존 35개 API 라우트 + SessionContext 타입을 uuid(string) 기반으로 전환
- Adion 코드 변경 없이 Sales 쪽만 수정

### 1.2 Design Principles

- 단방향 의존성: Sales → Adion DB (읽기전용), Adion은 Sales를 모름
- Auto-Provision: 첫 로그인 시 Sales DB에 유저/조직 자동 생성
- 최소 변경: 기존 API 패턴(`getUserFromRequest`) 유지, 타입만 변경

---

## 2. Architecture

### 2.1 Component Diagram

```
┌─────────────┐     ┌─────────────────────────┐     ┌──────────────┐
│   Browser   │────▶│  Sales API Server        │────▶│  Sales DB    │
│  (Client)   │     │  (Next.js Pages Router)  │     │  (postgres)  │
└─────────────┘     └──────────┬──────────────┘     └──────────────┘
                               │ (로그인 시에만)
                               ▼
                        ┌──────────────┐
                        │  Adion DB    │
                        │  (READ-ONLY) │
                        └──────────────┘
```

### 2.2 인증 흐름 (Data Flow)

```
[로그인 요청]
  │
  ▼
[Adion DB] users 테이블에서 email로 조회
  │
  ├── 유저 없음 → 401 에러
  │
  ▼
[Adion DB] bcrypt.compare(password, hashedPassword)
  │
  ├── 불일치 → 401 에러
  │
  ▼
[Adion DB] organizationMembers에서 userId로 첫 번째 조직 조회
  │
  ├── 멤버십 없음 → 403 에러 ("소속 조직이 없습니다")
  │
  ▼
[Adion DB] organizations에서 조직 상세 조회
  │
  ▼
[Sales DB] organizations에서 동일 uuid 확인
  │
  ├── 없음 → INSERT (id, name, slug 복사)
  │
  ▼
[Sales DB] users에서 동일 uuid 확인
  │
  ├── 없음 → INSERT (id, orgId, email, name, role, password="ADION_SSO" 매핑)
  ├── 있음 → name, email 업데이트 (Adion 데이터 동기화)
  │
  ▼
[Sales JWT 생성] { userId: uuid, orgId: uuid, email, name, role }
  │
  ▼
[Cookie 설정] token=...; HttpOnly; SameSite=Lax; Max-Age=43200
```

### 2.3 Dependencies

| Component | Depends On | Purpose |
|-----------|-----------|---------|
| `src/lib/db/adion.ts` | Adion DB (ADION_DATABASE_URL) | 읽기전용 인증 조회 |
| `src/pages/api/auth/login.ts` | adionDb, Sales db | 인증 + auto-provision |
| `src/lib/auth.ts` | JWTPayload (uuid) | JWT 생성/검증 |
| 모든 API 라우트 | getUserFromRequest | orgId/userId string 타입 |

---

## 3. Data Model

### 3.1 Adion DB 참조 테이블 (READ-ONLY)

```typescript
// Adion users (읽기전용 — 인증 시에만 조회)
interface AdionUser {
  id: string;              // uuid PK
  email: string;           // unique, globally
  hashedPassword: string;  // bcrypt 12 rounds
  name: string | null;
  role: string;            // 'user' (Adion 시스템 역할, Sales에서 미사용)
  phone: string | null;
}

// Adion organizationMembers (읽기전용)
interface AdionOrgMember {
  id: string;              // uuid PK
  organizationId: string;  // FK → organizations.id
  userId: string;          // FK → users.id
  role: string;            // 'owner' | 'admin' | 'member' | 'viewer'
}

// Adion organizations (읽기전용)
interface AdionOrganization {
  id: string;              // uuid PK
  name: string;
  slug: string;            // unique
  isActive: boolean;
}
```

### 3.2 Sales DB 스키마 변경 (uuid 마이그레이션)

#### organizations 테이블

```typescript
// Before
id: serial("id").primaryKey()

// After
id: uuid("id").defaultRandom().primaryKey()
```

#### users 테이블

```typescript
// Before
id: serial("id").primaryKey()
orgId: integer("org_id").references(() => organizations.id)
password: varchar("password", { length: 255 }).notNull()

// After
id: uuid("id").defaultRandom().primaryKey()
orgId: uuid("org_id").references(() => organizations.id)
password: varchar("password", { length: 255 }).notNull()  // "ADION_SSO" for provisioned users
```

- `unique().on(table.orgId, table.email)` 유지 (orgId 타입만 변경)

#### 전체 FK 변경 요약

| 테이블 | 컬럼 | Before | After |
|--------|------|--------|-------|
| **organizations** | id | serial | uuid |
| **users** | id | serial | uuid |
| **users** | orgId | integer FK | uuid FK |
| **workspaces** | orgId | integer FK | uuid FK |
| **records** | orgId | integer (denorm) | uuid (string, denorm) |
| **memos** | createdBy | integer FK | uuid FK |
| **workspacePermissions** | userId, grantedBy | integer FK | uuid FK |
| **partitionPermissions** | userId, grantedBy | integer FK | uuid FK |
| **apiTokens** | orgId | integer FK | uuid FK |
| **apiTokens** | createdBy | integer FK | uuid FK |
| **alimtalkConfigs** | orgId | integer FK | uuid FK |
| **alimtalkTemplateLinks** | createdBy | integer FK | uuid FK |
| **alimtalkSendLogs** | orgId | integer (denorm) | uuid (string, denorm) |
| **alimtalkSendLogs** | sentBy | integer FK | uuid FK |
| **emailConfigs** | orgId | integer FK | uuid FK |
| **emailTemplates** | orgId | integer FK | uuid FK |

**변경되지 않는 PK**: workspaces, fieldDefinitions, folders, partitions, records, memos, workspacePermissions, partitionPermissions, statusOptionCategories, statusOptions, apiTokens, alimtalkConfigs, alimtalkTemplateLinks, alimtalkSendLogs, emailConfigs, emailTemplates — 이들의 자체 PK는 serial 유지 (uuid 전환 불필요)

### 3.3 Drizzle 스키마 코드 변경

```typescript
import { uuid } from "drizzle-orm/pg-core";

// organizations
export const organizations = pgTable("organizations", {
    id: uuid("id").defaultRandom().primaryKey(),
    // ... (나머지 동일)
});

// users
export const users = pgTable(
    "users",
    {
        id: uuid("id").defaultRandom().primaryKey(),
        orgId: uuid("org_id")
            .references(() => organizations.id, { onDelete: "cascade" })
            .notNull(),
        // ... (나머지 동일)
    },
    (table) => ({
        orgEmailUnique: unique().on(table.orgId, table.email),
    })
);

// 모든 FK도 동일 패턴으로 integer → uuid 변경
// records.orgId: integer("org_id") → uuid("org_id") (denormalized, no FK constraint)
// alimtalkSendLogs.orgId: 동일
```

---

## 4. API Specification

### 4.1 변경되는 API

#### `POST /api/auth/login` (재작성)

**Request:**
```json
{
  "email": "user@example.com",
  "password": "password123"
}
```

**Success Response (200):**
```json
{
  "success": true,
  "user": {
    "userId": "550e8400-e29b-41d4-a716-446655440000",
    "orgId": "660e8400-e29b-41d4-a716-446655440000",
    "email": "user@example.com",
    "name": "홍길동",
    "role": "admin"
  }
}
```

**Error Responses:**
- `400`: 이메일/비밀번호 미입력
- `401`: 이메일 또는 비밀번호 불일치
- `403`: 소속 조직이 없음 (Adion에서 조직 멤버십 없음)
- `500`: Adion DB 연결 실패 또는 서버 오류

#### `POST /api/auth/signup` (비활성화)

**Response (410 Gone):**
```json
{
  "success": false,
  "error": "회원가입은 Adion(app.adion.com)에서 진행해주세요."
}
```

#### `GET /api/auth/me` (타입 변경만)

기존 로직 유지, JWTPayload의 userId/orgId가 string으로 바뀜에 따라 응답 타입 자동 변경.

### 4.2 API 라우트 타입 변경 패턴

38개 API 라우트 모두 동일 패턴:

```typescript
// Before
const user = getUserFromRequest(req);
const orgId: number = user.orgId;
const userId: number = user.userId;

// After — 코드 변경 불필요 (타입이 자동으로 string)
const user = getUserFromRequest(req);
const orgId: string = user.orgId;   // JWTPayload.orgId가 string이므로
const userId: string = user.userId; // JWTPayload.userId가 string이므로
```

**주의가 필요한 API** (parseInt 등 숫자 변환 사용 가능성):

| API | 파일 | 확인 사항 |
|-----|------|-----------|
| `GET /api/users/[id]` | `src/pages/api/users/[id].ts` | `parseInt(id)` → 직접 string 사용 |
| `PUT /api/records/[id]` | `src/pages/api/records/[id].ts` | record.orgId 비교 |
| `POST /api/alimtalk/send` | `src/pages/api/alimtalk/send.ts` | orgId로 config 조회 |
| `GET /api/alimtalk/logs` | `src/pages/api/alimtalk/logs/index.ts` | orgId 필터 |

### 4.3 전체 API 라우트 목록 (38개)

| # | Path | 변경 유형 |
|---|------|-----------|
| 1 | `/api/auth/login` | 재작성 (Adion DB 인증) |
| 2 | `/api/auth/signup` | 비활성화 (410 반환) |
| 3 | `/api/auth/me` | 타입 자동 변경 |
| 4 | `/api/auth/logout` | 변경 없음 |
| 5 | `/api/org/settings` | orgId 타입 변경 |
| 6 | `/api/users/index` | orgId 타입 변경 |
| 7 | `/api/users/[id]` | parseInt 제거 필요 |
| 8 | `/api/workspaces/index` | orgId 타입 변경 |
| 9 | `/api/workspaces/[id]/index` | orgId 타입 변경 |
| 10 | `/api/workspaces/[id]/settings` | orgId 타입 변경 |
| 11 | `/api/workspaces/[id]/partitions` | orgId 타입 변경 |
| 12 | `/api/workspaces/[id]/folders` | orgId 타입 변경 |
| 13 | `/api/workspaces/[id]/fields` | orgId 타입 변경 |
| 14 | `/api/workspaces/[id]/fields/reorder` | orgId 타입 변경 |
| 15 | `/api/partitions/[id]/index` | orgId 타입 변경 |
| 16 | `/api/partitions/[id]/records` | orgId 타입 변경 |
| 17 | `/api/records/[id]` | orgId 비교 타입 변경 |
| 18 | `/api/records/bulk-delete` | orgId 타입 변경 |
| 19 | `/api/folders/[id]` | orgId 타입 변경 |
| 20 | `/api/fields/[id]` | orgId 타입 변경 |
| 21 | `/api/alimtalk/config` | orgId 타입 변경 |
| 22 | `/api/alimtalk/config/default-sender` | orgId 타입 변경 |
| 23 | `/api/alimtalk/config/test` | orgId 타입 변경 |
| 24 | `/api/alimtalk/senders/index` | orgId 타입 변경 |
| 25 | `/api/alimtalk/senders/[senderKey]` | orgId 타입 변경 |
| 26 | `/api/alimtalk/senders/token` | orgId 타입 변경 |
| 27 | `/api/alimtalk/sender-categories` | orgId 타입 변경 |
| 28 | `/api/alimtalk/send` | orgId 타입 변경 |
| 29 | `/api/alimtalk/templates/index` | orgId 타입 변경 |
| 30 | `/api/alimtalk/templates/[templateCode]/index` | orgId 타입 변경 |
| 31 | `/api/alimtalk/templates/[templateCode]/comments` | orgId 타입 변경 |
| 32 | `/api/alimtalk/template-categories` | orgId 타입 변경 |
| 33 | `/api/alimtalk/template-links/index` | orgId 타입 변경 |
| 34 | `/api/alimtalk/template-links/[id]` | orgId 타입 변경 |
| 35 | `/api/alimtalk/logs/index` | orgId 타입 변경 |
| 36 | `/api/alimtalk/logs/[id]` | orgId 타입 변경 |
| 37 | `/api/alimtalk/logs/sync` | orgId 타입 변경 |
| 38 | `/api/alimtalk/stats` | orgId 타입 변경 |

---

## 5. 신규 모듈

### 5.1 `src/lib/db/adion.ts` — Adion DB 읽기전용 연결

```typescript
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { pgTable, uuid, text, varchar, timestamp, boolean, uniqueIndex, index } from "drizzle-orm/pg-core";

const connectionString = process.env.ADION_DATABASE_URL;
if (!connectionString) {
    throw new Error("ADION_DATABASE_URL 환경 변수가 설정되지 않았습니다.");
}

const queryClient = postgres(connectionString, {
    max: 3,           // 최소 커넥션 (읽기전용이므로 적게)
});

// Adion 테이블 정의 (Sales에서 필요한 것만)
export const adionUsers = pgTable("users", {
    id: uuid("id").primaryKey(),
    email: text("email").unique().notNull(),
    hashedPassword: text("hashed_password"),
    name: text("name"),
    role: varchar("role", { length: 20 }),
    phone: varchar("phone", { length: 20 }),
});

export const adionOrganizations = pgTable("organizations", {
    id: uuid("id").primaryKey(),
    name: text("name").notNull(),
    slug: varchar("slug", { length: 100 }).notNull(),
    isActive: boolean("is_active"),
});

export const adionOrgMembers = pgTable("organization_members", {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id").notNull(),
    userId: uuid("user_id").notNull(),
    role: varchar("role", { length: 20 }).notNull(),
});

export const adionDb = drizzle(queryClient);
```

### 5.2 `src/pages/api/auth/login.ts` — 재작성

```typescript
import type { NextApiRequest, NextApiResponse } from "next";
import { db, users, organizations } from "@/lib/db";
import { adionDb, adionUsers, adionOrganizations, adionOrgMembers } from "@/lib/db/adion";
import { eq } from "drizzle-orm";
import { compare } from "bcryptjs";
import { generateToken, getTokenExpiryMs } from "@/lib/auth";
import type { JWTPayload, OrgRole } from "@/types";

// Adion role → Sales role 매핑
function mapRole(adionRole: string): OrgRole {
    switch (adionRole) {
        case "owner": return "owner";
        case "admin": return "admin";
        case "member": return "member";
        case "viewer": return "member"; // viewer → member 다운그레이드
        default: return "member";
    }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== "POST") {
        return res.status(405).json({ success: false, error: "Method not allowed" });
    }

    try {
        const { email, password } = req.body;
        if (!email || !password) {
            return res.status(400).json({ success: false, error: "이메일과 비밀번호를 입력해주세요." });
        }

        // 1. Adion DB에서 유저 조회
        const [adionUser] = await adionDb
            .select()
            .from(adionUsers)
            .where(eq(adionUsers.email, email));

        if (!adionUser || !adionUser.hashedPassword) {
            return res.status(401).json({ success: false, error: "이메일 또는 비밀번호가 올바르지 않습니다." });
        }

        // 2. 비밀번호 검증 (Adion은 bcrypt 12 rounds)
        const isValid = await compare(password, adionUser.hashedPassword);
        if (!isValid) {
            return res.status(401).json({ success: false, error: "이메일 또는 비밀번호가 올바르지 않습니다." });
        }

        // 3. Adion에서 조직 멤버십 조회
        const [membership] = await adionDb
            .select()
            .from(adionOrgMembers)
            .where(eq(adionOrgMembers.userId, adionUser.id));

        if (!membership) {
            return res.status(403).json({ success: false, error: "소속 조직이 없습니다. Adion에서 조직에 가입해주세요." });
        }

        // 4. Adion 조직 상세 조회
        const [adionOrg] = await adionDb
            .select()
            .from(adionOrganizations)
            .where(eq(adionOrganizations.id, membership.organizationId));

        if (!adionOrg) {
            return res.status(403).json({ success: false, error: "조직 정보를 찾을 수 없습니다." });
        }

        // 5. Sales DB auto-provision: 조직
        const [existingOrg] = await db
            .select()
            .from(organizations)
            .where(eq(organizations.id, adionOrg.id));

        if (!existingOrg) {
            await db.insert(organizations).values({
                id: adionOrg.id,
                name: adionOrg.name,
                slug: adionOrg.slug,
            });
        }

        // 6. Sales DB auto-provision: 유저
        const salesRole = mapRole(membership.role);
        const [existingUser] = await db
            .select()
            .from(users)
            .where(eq(users.id, adionUser.id));

        if (!existingUser) {
            await db.insert(users).values({
                id: adionUser.id,
                orgId: adionOrg.id,
                email: adionUser.email,
                password: "ADION_SSO",
                name: adionUser.name || adionUser.email,
                role: salesRole,
                phone: adionUser.phone || null,
            });
        } else {
            // 기존 유저 정보 동기화
            await db.update(users)
                .set({
                    name: adionUser.name || existingUser.name,
                    email: adionUser.email,
                    role: salesRole,
                    updatedAt: new Date(),
                })
                .where(eq(users.id, adionUser.id));
        }

        // 7. Sales JWT 생성
        const payload: JWTPayload = {
            userId: adionUser.id,
            orgId: adionOrg.id,
            email: adionUser.email,
            name: adionUser.name || adionUser.email,
            role: salesRole,
        };

        const token = generateToken(payload);
        const maxAge = Math.floor(getTokenExpiryMs() / 1000);

        res.setHeader(
            "Set-Cookie",
            `token=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`
        );

        return res.status(200).json({ success: true, user: payload });
    } catch (error) {
        console.error("Login error:", error);
        return res.status(500).json({ success: false, error: "서버 오류가 발생했습니다." });
    }
}
```

---

## 6. Type 변경

### 6.1 `src/types/index.ts`

```typescript
// Before
export interface JWTPayload {
  userId: number;
  orgId: number;
  email: string;
  name: string;
  role: OrgRole;
}

// After
export interface JWTPayload {
  userId: string;  // uuid
  orgId: string;   // uuid
  email: string;
  name: string;
  role: OrgRole;
}
```

```typescript
// Before
export interface UserListItem {
  id: number;
  orgId: number;
  // ...
}

// After
export interface UserListItem {
  id: string;   // uuid (from DB)
  orgId: string; // uuid (from DB)
  // ...
}
```

```typescript
// Before
export interface FieldDefinition {
  id: number;
  workspaceId: number;
  // ...
  statusOptionCategoryId: number | null;
}
export interface OrgInfo {
  id: number;
  // ...
}
export interface WorkspaceDetail {
  id: number;
  // ...
}

// After — 이들은 변경 없음 (workspaces, fieldDefinitions 등의 PK는 serial 유지)
```

**변경 대상 타입 요약:**

| 타입 | 변경 필드 | Before → After |
|------|-----------|----------------|
| `JWTPayload` | userId, orgId | number → string |
| `UserListItem` | id, orgId | number → string |
| `OrgInfo` | id | number → string |
| `CreatePartitionInput` | folderId | number → number (변경 없음) |
| `ReorderFieldsInput` | fieldIds | number[] → number[] (변경 없음) |
| `AlimtalkSendResult.results[].recordId` | recordId | number → number (변경 없음) |

### 6.2 `src/contexts/SessionContext.tsx`

```typescript
// Before
interface SessionUser {
    id: number;
    orgId: number;
    name: string;
    email: string;
    role: OrgRole;
}

// After
interface SessionUser {
    id: string;    // uuid
    orgId: string; // uuid
    name: string;
    email: string;
    role: OrgRole;
}
```

### 6.3 `src/lib/auth.ts`

```typescript
// verifyApiToken: orgId 타입 변경
// Before
export async function verifyApiToken(token: string, orgId: number): Promise<boolean>

// After
export async function verifyApiToken(token: string, orgId: string): Promise<boolean>

// authenticateRequest: orgId 타입 변경
// Before
{ type: "api-token"; orgId: number }

// After
{ type: "api-token"; orgId: string }
```

---

## 7. Role 매핑

| Adion Role | Sales Role | 비고 |
|------------|-----------|------|
| owner | owner | 1:1 매핑 |
| admin | admin | 1:1 매핑 |
| member | member | 1:1 매핑 |
| viewer | member | Sales에 viewer 없으므로 member로 다운그레이드 |

---

## 8. 환경 변수

| Variable | Purpose | 값 | 상태 |
|----------|---------|------|------|
| `DATABASE_URL` | Sales DB (기존) | `postgresql://jake:...@localhost:5432/sales` | 기존 유지 |
| `ADION_DATABASE_URL` | Adion DB (신규, 읽기전용) | `postgresql://jake:...@localhost:5432/adion` | **신규 추가** |
| `JWT_SECRET` | Sales JWT 서명 (기존) | `your-jwt-secret-...` | 기존 유지 |

---

## 9. Error Handling

### 9.1 Adion DB 연결 실패

```typescript
// login.ts에서 try-catch로 감싸되, 명확한 에러 메시지 반환
catch (error) {
    if (error.message?.includes("ADION_DATABASE_URL")) {
        return res.status(503).json({
            success: false,
            error: "인증 서버에 연결할 수 없습니다. 관리자에게 문의해주세요."
        });
    }
    // ... 기타 에러
}
```

### 9.2 에러 코드 정의

| Code | 상황 | 메시지 |
|------|------|--------|
| 400 | 이메일/비밀번호 미입력 | "이메일과 비밀번호를 입력해주세요." |
| 401 | 인증 실패 | "이메일 또는 비밀번호가 올바르지 않습니다." |
| 403 | 조직 멤버십 없음 | "소속 조직이 없습니다. Adion에서 조직에 가입해주세요." |
| 410 | 회원가입 비활성화 | "회원가입은 Adion(app.adion.com)에서 진행해주세요." |
| 500 | 서버 오류 | "서버 오류가 발생했습니다." |
| 503 | Adion DB 연결 실패 | "인증 서버에 연결할 수 없습니다." |

---

## 10. Security Considerations

- [x] Adion DB 접근은 SELECT만 허용 (읽기전용 연결)
- [x] bcryptjs.compare 사용 (Adion의 12 rounds 해시 호환)
- [x] Sales DB에 비밀번호 저장하지 않음 (`"ADION_SSO"` 플레이스홀더)
- [x] JWT secret은 Sales 자체 키 유지 (Adion과 독립)
- [x] Cookie: HttpOnly, SameSite=Lax
- [ ] Production: Cookie domain을 `.adion.com`으로 설정 (서브도메인 공유)

---

## 11. Implementation Guide

### 11.1 File Structure (변경/신규 파일)

```
src/
├── lib/
│   ├── db/
│   │   ├── index.ts          # 기존 유지
│   │   ├── schema.ts         # uuid 마이그레이션 (organizations.id, users.id, 모든 FK)
│   │   └── adion.ts          # 신규: Adion DB 읽기전용 연결
│   └── auth.ts               # orgId 타입 변경 (number → string)
├── types/
│   └── index.ts              # JWTPayload, UserListItem, OrgInfo 타입 변경
├── contexts/
│   └── SessionContext.tsx     # SessionUser.id, orgId: string
├── pages/api/
│   ├── auth/
│   │   ├── login.ts          # 재작성 (Adion 인증 + auto-provision)
│   │   ├── signup.ts         # 비활성화 (410 반환)
│   │   ├── me.ts             # 타입 자동 반영
│   │   └── logout.ts         # 변경 없음
│   └── ... (34개 라우트)     # orgId/userId 타입 자동 반영
scripts/
└── seed.ts                   # Adion 연동 테스트용 재작성
.env.local                    # ADION_DATABASE_URL 추가
```

### 11.2 Implementation Order

1. [ ] `.env.local`에 `ADION_DATABASE_URL` 추가
2. [ ] `src/lib/db/adion.ts` — Adion DB 연결 모듈 생성
3. [ ] `src/lib/db/schema.ts` — organizations.id, users.id → uuid, 모든 관련 FK → uuid
4. [ ] `src/types/index.ts` — JWTPayload(userId/orgId: string), UserListItem, OrgInfo 타입 변경
5. [ ] `src/lib/auth.ts` — verifyApiToken, authenticateRequest의 orgId 타입 변경
6. [ ] `src/pages/api/auth/login.ts` — Adion DB 인증 + auto-provision 재작성
7. [ ] `src/pages/api/auth/signup.ts` — 410 Gone 반환으로 비활성화
8. [ ] `src/contexts/SessionContext.tsx` — SessionUser.id, orgId → string
9. [ ] API 라우트 일괄 점검 — parseInt 제거, 타입 불일치 수정
10. [ ] `scripts/seed.ts` — Adion 연동 테스트용 재작성
11. [ ] Drizzle migration 생성 (`pnpm drizzle-kit generate`)
12. [ ] Migration 실행 + seed 실행
13. [ ] `pnpm build` 검증 (타입 에러 0)

### 11.3 Migration 전략

개발환경이므로 DB를 drop & recreate:

```bash
# 1. Sales DB 초기화
dropdb sales && createdb sales

# 2. Migration 생성 및 실행
pnpm drizzle-kit generate
pnpm drizzle-kit migrate

# 3. Seed 실행
pnpm tsx scripts/seed.ts
```

---

## Version History

| Version | Date | Changes | Author |
|---------|------|---------|--------|
| 0.1 | 2026-02-13 | Initial draft | AI |
