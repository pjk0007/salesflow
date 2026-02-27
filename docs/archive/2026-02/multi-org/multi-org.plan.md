# multi-org Plan Document

> **Summary**: users.orgId 1:1 구조 → organizationMembers 다대다 구조로 전환. 한 사용자가 여러 조직에 속할 수 있도록 변경.
>
> **Date**: 2026-02-27
> **Status**: Draft

---

## 1. 문제 분석

### 현재 구조 (1유저 = 1조직)
```
users.orgId (NOT NULL, FK → organizations.id)
```
- 사용자가 회원가입하면 자동으로 조직 1개 생성, `users.orgId`에 고정
- JWT에 `orgId`가 포함되어 모든 API에서 `user.orgId`로 데이터 격리
- 다른 조직에 초대받아도 참여 불가 (orgId가 고정)

### 영향 범위
- `user.orgId` 직접 참조: **74개 API 파일, 148회**
- `getUserFromRequest` + orgId 사용: **83개 API 파일, 326회**
- JWTPayload.orgId: types/index.ts, auth.ts, SessionContext.tsx
- 프론트엔드 SessionUser.orgId: SessionContext.tsx, 각종 컴포넌트

### 목표 구조 (adion 패턴)
```
organizationMembers (userId, organizationId, role)  ← 다대다 junction
JWT: { userId, orgId(현재 조직) }                     ← orgId는 "현재 선택된 조직"
```

---

## 2. 핵심 전략: orgId 의미 변경

**기존**: `users.orgId` = 유저가 소속된 유일한 조직 (DB 컬럼)
**변경**: `JWT.orgId` = 유저가 현재 선택한 조직 (세션 상태)

### 이 전략의 장점
- **74개 API 파일의 `user.orgId` 패턴을 그대로 유지** — JWT에서 읽은 orgId를 그대로 사용
- users 테이블에서 orgId 컬럼을 nullable로 변경하되, API 코드에서의 사용 패턴은 동일
- 실제 소유권은 `organizationMembers` 테이블로 관리
- 조직 전환 = JWT 재발급 (orgId 교체)

---

## 3. 변경 범위

### Phase 1: DB 스키마 (3개 파일)

| 파일 | 변경 |
|------|------|
| `src/lib/db/schema.ts` | `organizationMembers` 테이블 추가, `users.orgId` nullable로 변경, users.role 제거 (멤버십 role로 이동) |
| `drizzle/XXXX_multi_org.sql` | 마이그레이션 SQL |
| `src/lib/db/index.ts` | `organizationMembers` export 추가 |

### Phase 2: Auth/Session (5개 파일)

| 파일 | 변경 |
|------|------|
| `src/types/index.ts` | JWTPayload에 orgId를 optional이 아닌 유지 (선택된 조직) |
| `src/lib/auth.ts` | `getUserFromRequest`에서 orgId 검증 로직 추가 |
| `src/pages/api/auth/signup.ts` | 조직 생성 + organizationMembers 생성 |
| `src/pages/api/auth/login.ts` | 로그인 시 최근 조직 자동 선택 (organizationMembers에서 조회) |
| `src/pages/api/auth/me.ts` | 현재 조직 정보 포함하여 반환 |

### Phase 3: 조직 전환 API (2개 파일 신규)

| 파일 | 변경 |
|------|------|
| `src/pages/api/org/switch.ts` | 신규 — 조직 전환 (JWT 재발급) |
| `src/pages/api/org/my-orgs.ts` | 신규 — 내가 속한 조직 목록 |

### Phase 4: 프론트엔드 (3개 파일)

| 파일 | 변경 |
|------|------|
| `src/contexts/SessionContext.tsx` | `switchOrg()` 함수 추가, 조직 목록 관리 |
| `src/components/OrgSwitcher.tsx` | 신규 — 조직 전환 드롭다운 UI |
| `src/components/layout/Sidebar.tsx` (또는 해당 레이아웃) | OrgSwitcher 배치 |

### Phase 5: 기존 API 마이그레이션 (~5개 핵심 파일)

주요 변경이 필요한 API (orgId 접근 방식이 달라지는 곳):
| 파일 | 변경 이유 |
|------|----------|
| `src/pages/api/org/invitations.ts` | 초대 시 organizationMembers에 추가 |
| `src/pages/api/org/members.ts` | organizationMembers 조회로 변경 |
| `src/pages/api/org/members/[id].ts` | organizationMembers에서 role 관리 |
| `src/pages/api/users/index.ts` | 조직 멤버 목록 → organizationMembers JOIN |
| `src/pages/api/users/[id].ts` | 같은 조직 소속 확인 → organizationMembers |

나머지 ~69개 API: `user.orgId` 패턴 그대로 (JWT에서 현재 조직 ID를 읽으므로 변경 불필요)

### Phase 6: 데이터 마이그레이션

- 기존 users 데이터 → organizationMembers 행 자동 생성 (SQL)
- `users.orgId` → nullable 전환 (하위호환)

---

## 4. organizationMembers 스키마

```typescript
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

---

## 5. 조직 전환 플로우

```
1. 로그인 → organizationMembers에서 최근 조직 조회 → JWT 발급 (orgId = 선택된 조직)
2. 사이드바 OrgSwitcher → 조직 목록 표시
3. 조직 클릭 → POST /api/org/switch { orgId } → JWT 재발급 → 쿠키 갱신
4. SessionContext.refreshSession() → 페이지 리프레시
5. 모든 API는 기존처럼 user.orgId 사용 (JWT에서 읽은 현재 조직)
```

---

## 6. 마이그레이션 SQL

```sql
-- 1. organizationMembers 테이블 생성
CREATE TABLE IF NOT EXISTS "organization_members" (
    "id" serial PRIMARY KEY,
    "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
    "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
    "role" varchar(20) NOT NULL,
    "joined_at" timestamptz DEFAULT now() NOT NULL,
    CONSTRAINT "org_members_org_user_unique" UNIQUE("organization_id", "user_id")
);
CREATE INDEX IF NOT EXISTS "org_members_user_idx" ON "organization_members"("user_id");

-- 2. 기존 데이터 마이그레이션 (users.orgId → organizationMembers)
INSERT INTO "organization_members" ("organization_id", "user_id", "role", "joined_at")
SELECT "org_id", "id", "role", "created_at"
FROM "users"
WHERE "org_id" IS NOT NULL
ON CONFLICT ("organization_id", "user_id") DO NOTHING;

-- 3. users.orgId nullable로 변경 (점진적 제거)
ALTER TABLE "users" ALTER COLUMN "org_id" DROP NOT NULL;
```

---

## 7. 검증

- [ ] `pnpm build` 성공
- [ ] 기존 사용자 로그인 → 자동 조직 선택 동작
- [ ] 조직 전환 → JWT 재발급 → 데이터 격리 동작
- [ ] 초대 수락 → organizationMembers 생성 → 조직 전환 가능
- [ ] 신규 회원가입 → 조직 자동 생성 + organizationMembers 생성
- [ ] 74개 API의 `user.orgId` 패턴 정상 동작
