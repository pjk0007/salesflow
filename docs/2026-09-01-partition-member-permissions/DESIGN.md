# DESIGN — 파티션별 멤버 권한

- **사이클 ID**: `2026-09-01-partition-member-permissions`
- **근거**: `PLAN.md` (승인됨), `behaviors.json` B1~B15

## 1. 접근법

### 택한 안 — 순수 판정 함수 + 파티션을 덮는 scope 일괄 로드

권한 판정을 **DB를 전혀 모르는 순수 함수**(`canAccessPartition`)와 **얇은 DB 어댑터**(`requirePartitionAccess`)로 이분한다. 순수 함수는 "조직 내 그 파티션을 덮을 수 있는 scope 전부"와 "판정 대상 파티션의 위치(`{id, folderId, workspaceId}`)"를 받아 boolean만 낸다.

allow 기본 규칙("이 파티션을 덮는 scope가 조직 내에 하나도 없으면 통과")은 **조직 전체의 scope를 알아야 판정 가능**하므로, 인자로 "그 파티션을 덮는 후보 scope 전부(사용자 무관)"를 넘기고 함수 안에서 (a) 덮는 것이 있는가 (b) 그중 내 것이 있는가를 순서대로 본다.

### 기각한 대안

**B. `EXISTS` 서브쿼리 2번** — 쿼리 비용은 비슷하지만 판정 규칙이 SQL 안에 들어가 node:test로 못 잡는다. B1~B8을 TDD로 선고정하겠다는 PLAN의 검증 전략과 정면 충돌. 계층 상속 규칙이 `checkTokenAccess`와 두 벌이 되는 문제도 있다.

**C. 부여 시점에 하위 파티션으로 전개한 평면 테이블** — 판정이 가장 빠르지만 나중에 추가되는 파티션이 상속되지 않아 B6("워크스페이스 하위 **모든** 파티션")의 의미가 깨진다. 파티션 이동(`folderId` 변경)마다 재전개가 필요해 동기화 버그의 온상.

A를 택한 이유는 판정 규칙 전체가 순수 함수 한 곳에 모여 테스트 가능하고, 계층 변경이 즉시 반영되기 때문이다. 대가는 요청당 2쿼리인데 PLAN이 이미 수용한 비용이다.

## 2. 아키텍처

```
route handler
  │ getUserFromNextRequest(req) → JWTPayload {userId, orgId, role}
  ▼
src/lib/partition-access.ts
  requirePartitionAccess(user, partitionId, permission)
      ├─ ① 파티션 위치 + orgId 조회 (partitions ⋈ workspaces)  ← org 경계 검증
      ├─ ② 그 파티션을 덮는 memberScopes 조회 (member일 때만)
      └─ ③ canAccessPartition(...)  ← 순수, DB 없음
  ▼
  { ok: true, partition, workspace } | { ok: false, status, error }
```

| 레이어 | 위치 | DB | 검증 |
|---|---|---|---|
| 순수 판정 | `canAccessPartition` / `scopeCoversPartition` / `filterAccessiblePartitions` | ✗ | node:test (B1~B8, B11) |
| DB 어댑터 | `requirePartitionAccess` / `requireRecordAccess` / `loadOrgScopes` / `validateMemberScopes` | ✓ | curl |
| route | `src/app/api/...` | ✓ | curl |

## 3. `member_scopes` 스키마

### 결정과 근거

- **`orgId`를 컬럼으로 갖는다.** `api_token_scopes`는 `tokenId → apiTokens.orgId`로 org를 알 수 있지만, `member_scopes`의 소유자인 `users`의 `orgId`는 nullable(다중 조직 지원)이라 사용자를 타고 org를 확정할 수 없다. 핵심 쿼리가 "이 org에서 이 파티션을 덮는 scope"이므로 org를 직접 들고 있어야 한다.
- **scope 하나 = 행 하나, 4비트는 jsonb.** `api_token_scopes`와 동일. 죽은 `partition_permissions`를 재활용하지 않는 이유.
- **`(orgId, userId, scopeType, scopeId)` unique.** 같은 대상에 같은 사용자의 scope가 둘이면 "어느 쪽이 이기나"라는 정의되지 않은 질문이 생긴다. 부여는 upsert로 흡수.
- **`scopeId`는 org scope일 때 0으로 정규화.** `validateTokenScopes`와 같은 규약. NULL을 쓰면 Postgres에서 unique 제약이 무력화된다.
- **`scopeId`에 FK를 걸지 않는다.** scopeType에 따라 참조 대상이 달라 다형 참조라 FK 불가 — `api_token_scopes`와 같다. 고아 행은 아무 파티션도 덮지 못하므로 판정에 영향이 없다.
- **`grantedBy`는 `ON DELETE SET NULL`.** 부여자 계정 삭제 시 FK 위반을 피한다.

### 인덱스

조회 패턴은 둘뿐이다. 판정(`WHERE org_id = ? AND 덮는 4조건`)과 B11 목록(`WHERE org_id = ?`) → `member_scopes_org_idx (org_id)` 하나로 커버. 관리 API의 사용자별 조회는 unique 제약이 만드는 인덱스의 좌측 접두사로 커버되므로 별도 인덱스 불필요.

### Drizzle 정의 (`src/lib/db/schema.ts`, `partitionPermissions` 아래)

```ts
export const memberScopes = pgTable(
    "member_scopes",
    {
        id: serial("id").primaryKey(),
        orgId: uuid("org_id")
            .references(() => organizations.id, { onDelete: "cascade" })
            .notNull(),
        userId: uuid("user_id")
            .references(() => users.id, { onDelete: "cascade" })
            .notNull(),
        // "org" | "workspace" | "folder" | "partition" — scopeId는 org일 때 0
        scopeType: varchar("scope_type", { length: 20 }).notNull(),
        scopeId: integer("scope_id").notNull(),
        permissions: jsonb("permissions")
            .$type<{ read: boolean; create: boolean; update: boolean; delete: boolean }>()
            .notNull(),
        grantedBy: uuid("granted_by").references(() => users.id, { onDelete: "set null" }),
        createdAt: timestamptz("created_at").defaultNow().notNull(),
        updatedAt: timestamptz("updated_at").defaultNow().notNull(),
    },
    (table) => ({
        orgIdx: index("member_scopes_org_idx").on(table.orgId),
        scopeUnique: unique().on(table.orgId, table.userId, table.scopeType, table.scopeId),
    })
);

export type MemberScope = typeof memberScopes.$inferSelect;
export type NewMemberScope = typeof memberScopes.$inferInsert;
```

### 마이그레이션 — `drizzle/0065_member_scopes.sql`

마지막 파일이 `0064_email_send_log_sender.sql`, journal 마지막 `idx`가 64임을 확인함. `when`은 기존 패턴(100000씩 증가)을 따라 `1770952800000`.

```sql
-- 조직 member 역할 사용자에게 파티션 단위 권한을 부여한다.
-- allow 기본: 어떤 파티션을 덮는 행이 하나도 없으면 그 파티션은 전체 허용(기존 동작 유지).
-- scope_id는 다형 참조(workspace/folder/partition)라 FK를 걸지 않는다. org 스코프는 0으로 정규화.

CREATE TABLE IF NOT EXISTS "member_scopes" (
    "id" serial PRIMARY KEY NOT NULL,
    "org_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
    "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
    "scope_type" varchar(20) NOT NULL,
    "scope_id" integer NOT NULL,
    "permissions" jsonb NOT NULL,
    "granted_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "member_scopes_org_user_scope_unique" UNIQUE ("org_id", "user_id", "scope_type", "scope_id")
);

CREATE INDEX IF NOT EXISTS "member_scopes_org_idx" ON "member_scopes" ("org_id");
```

`_journal.json`의 `entries` 끝에 `{ "idx": 65, "version": "7", "when": 1770952800000, "tag": "0065_member_scopes", "breakpoints": true }` 추가.

데이터 마이그레이션 없음 — 빈 테이블 = 모든 파티션 allow = 기존 동작.

## 4. 순수 판정 함수 — TDD 계약

```ts
import type { OrgRole } from "@/types";

export type Permission = "read" | "create" | "update" | "delete";
export type ScopeType = "org" | "workspace" | "folder" | "partition";

export interface ScopePermissions {
    read: boolean;
    create: boolean;
    update: boolean;
    delete: boolean;
}

/** 판정에 필요한 scope의 최소 형태. DB row(MemberScope)가 구조적으로 이 타입을 만족한다. */
export interface ScopeLike {
    userId: string;
    scopeType: string;   // DB가 varchar라 string. 함수 안에서 리터럴 비교로 좁힌다.
    scopeId: number;
    permissions: ScopePermissions;
}

/** 판정 대상 파티션의 계층 위치. */
export interface PartitionLocation {
    id: number;
    folderId: number | null;
    workspaceId: number;
}

export interface AccessInput {
    user: { userId: string; role: OrgRole };
    partition: PartitionLocation;
    permission: Permission;
    /**
     * 이 파티션을 덮을 가능성이 있는 조직 내 scope 전부 (사용자 필터 없음).
     * allow 기본은 "이 파티션을 덮는 scope가 조직에 하나도 없으면 통과"이므로
     * 타인의 scope까지 있어야 판정할 수 있다. 이미 org 경계로 걸러진 목록이어야 한다.
     */
    orgScopes: readonly ScopeLike[];
}

export function canAccessPartition(input: AccessInput): boolean;

/** scope 한 건이 특정 파티션을 덮는지. 계층 상속 규칙의 단일 정의. */
export function scopeCoversPartition(scope: ScopeLike, partition: PartitionLocation): boolean;

/** B11용. canAccessPartition을 건별 호출한 것과 결과가 동일해야 한다. */
export function filterAccessiblePartitions<T extends PartitionLocation>(args: {
    user: { userId: string; role: OrgRole };
    partitions: readonly T[];
    permission: Permission;
    orgScopes: readonly ScopeLike[];
}): T[];
```

### allow 기본을 순수 함수가 판정하는 방법

핵심은 **`orgScopes`에 사용자 필터를 걸지 않는다**는 것. 한 번의 순회로 두 가지를 동시에 모은다.

```
1) owner/admin → true
2) covered = false
   for scope of orgScopes:
       if !scopeCoversPartition(scope, partition): continue
       covered = true                                   // 누가 가졌든 "제한 모드" 전환
       if scope.userId === user.userId && scope.permissions[permission]: return true
   return !covered                                      // 덮는 게 없었으면 allow 기본
```

이 구조 덕분에 "파티션 하나에 권한을 걸면 그 파티션만 제한 모드"가 자연히 성립한다 — 다른 파티션은 덮는 scope가 없어 `covered=false`로 통과.

### `scopeCoversPartition` — `checkTokenAccess`(auth.ts:220-223)의 규칙 이식

| scopeType | 덮는 조건 |
|---|---|
| `org` | 항상 true |
| `workspace` | `partition.workspaceId === scope.scopeId` |
| `folder` | `partition.folderId !== null && partition.folderId === scope.scopeId` |
| `partition` | `partition.id === scope.scopeId` |
| 그 외 | false (알 수 없는 scopeType은 아무것도 덮지 않는다) |

`folderId`가 null인 파티션에 folder scope가 매칭되지 않도록 명시적으로 null을 배제한다 — `scopeId`가 0인 folder scope와 우연히 맞물리는 사고를 막는다.

`any` 없음 — `scopeType`은 DB에서 `string`으로 오므로 그대로 받고 내부에서 리터럴 비교로 좁힌다. 캐스팅하지 않는다.

### 중요한 비대칭

`permission`은 "가진 비트 중 하나라도"가 아니라 **"그 비트"** 다. `read`만 가진 사용자의 `create` 요청은 거부된다(B4). 상위 scope가 있어도 비트가 없으면 안 된다.

## 5. DB 레이어

```ts
export type AccessResult =
    | { ok: true; partition: Partition; workspace: Workspace }
    | { ok: false; status: 404 | 403; error: string };

export async function requirePartitionAccess(
    user: Pick<JWTPayload, "userId" | "orgId" | "role">,
    partitionId: number,
    permission: Permission
): Promise<AccessResult>;
```

### 쿼리 ① 파티션 위치 + org 경계

```ts
const [row] = await db
    .select({ partition: partitions, workspace: workspaces })
    .from(partitions)
    .innerJoin(workspaces, eq(partitions.workspaceId, workspaces.id))
    .where(and(eq(partitions.id, partitionId), eq(workspaces.orgId, user.orgId)));
if (!row) return { ok: false, status: 404, error: "파티션을 찾을 수 없습니다." };
```

`workspaces.orgId = user.orgId`를 WHERE에 넣어 **org 경계를 쿼리 단계에서 강제**. 기존 7개 헬퍼가 전부 이 형태였으므로 반환 shape만 통일하면 동작이 그대로다.

### 쿼리 ② 이 파티션을 덮는 scope만

전체 org scope를 끌어오지 않고 덮을 수 있는 4가지만 OR로 좁힌다.

```ts
const p = row.partition;
const covering = await db
    .select({
        userId: memberScopes.userId,
        scopeType: memberScopes.scopeType,
        scopeId: memberScopes.scopeId,
        permissions: memberScopes.permissions,
    })
    .from(memberScopes)
    .where(
        and(
            eq(memberScopes.orgId, user.orgId),
            or(
                eq(memberScopes.scopeType, "org"),
                and(eq(memberScopes.scopeType, "workspace"), eq(memberScopes.scopeId, p.workspaceId)),
                and(eq(memberScopes.scopeType, "partition"), eq(memberScopes.scopeId, p.id)),
                ...(p.folderId !== null
                    ? [and(eq(memberScopes.scopeType, "folder"), eq(memberScopes.scopeId, p.folderId))]
                    : []),
            ),
        ),
    );
```

`folderId`가 null이면 folder 조건을 붙이지 않는다 — `eq(col, null)`이 `= NULL`이 되는 걸 피한다.

**owner/admin이면 쿼리 ②를 건너뛴다.** `canAccessPartition`이 어차피 true를 내므로 낭비다. 관리자 요청은 기존과 동일한 1쿼리, member만 2쿼리.

### 레코드 경유 진입점 (B10)

`/api/records/[id]`는 partitionId를 URL에 갖고 있지 않다.

```ts
export async function requireRecordAccess(
    user: Pick<JWTPayload, "userId" | "orgId" | "role">,
    recordId: number,
    permission: Permission
): Promise<RecordAccessResult>;
```

내부는 `records ⋈ partitions ⋈ workspaces`를 한 번에 조회 + member면 covering scope 1쿼리. **`records.orgId`가 아니라 `workspaces.orgId`로 검증**한다 — `records.orgId`는 FK 없는 비정규화 컬럼이라 파티션의 실제 소속과 어긋날 여지가 있고, 권한 판정은 파티션 계층 기준이어야 일관된다.

### 목록용 (B11)

```ts
/** 조직의 member scope 전량. 목록 API에서 1회만 호출. */
export async function loadOrgScopes(orgId: string): Promise<ScopeLike[]>;
```

## 6. B11 목록 API의 N+1 회피

두 목록 API 모두 파티션 건별 권한 조회를 하지 않는다.

```
① 기존 파티션 목록 쿼리 그대로              ← 1쿼리
② role !== "member" 면 그대로 반환          ← 추가 0
③ member면 loadOrgScopes(orgId) 1회         ← +1쿼리
④ filterAccessiblePartitions 로 메모리 필터
```

쿼리 증가는 **member 요청당 정확히 1**이며 파티션 수와 무관.

- **`/api/partitions/route.ts`** — 기존 select에 `folderId`가 없다. **`folderId: partitions.folderId` 추가**해야 folder scope 상속(B7)을 목록에서도 판정할 수 있다.
- **`/api/workspaces/[id]/partitions/route.ts`** — `partitionList`를 폴더 그룹핑 **전에** 필터한다. 그룹핑 후 필터하면 폴더 안팎 두 곳을 손봐야 한다. 필터 결과 파티션이 0개인 폴더는 목록에 남긴다(폴더 자체는 권한 대상이 아니고, 숨기면 트리가 요동친다).

## 7. 7곳 복붙 헬퍼의 통합

반환 타입이 제각각인 이유는 각자 필요한 만큼만 select했기 때문이다. 공통 함수는 **항상 `{ partition, workspace }` 전체 row를 반환**한다. 두 테이블 모두 이미 조인 중이라 select 폭을 넓혀도 쿼리 비용은 사실상 같다.

```ts
// before
const access = await verifyPartitionAccess(partitionId, user.orgId);
if (!access) {
    return NextResponse.json({ success: false, error: "파티션을 찾을 수 없습니다." }, { status: 404 });
}

// after
const access = await requirePartitionAccess(user, partitionId, "read");
if (!access.ok) {
    return NextResponse.json({ success: false, error: access.error }, { status: access.status });
}
// access.partition / access.workspace — 이름 그대로
```

`ok` 판별식을 쓰는 discriminated union이라 TS가 좁혀준다. 로컬 헬퍼 정의는 각 파일에서 삭제하고 import로 대체.

**404/403 구분**: org 밖 또는 미존재는 404(기존 문구 유지), org 안인데 권한 없음은 403("이 파티션에 대한 권한이 없습니다."). 존재 여부를 403으로 흘리지 않는다.

## 8. f894553이 고친 결함의 재발 방지

그 커밋은 (1) org 경계 미검증 (2) 수정 API가 검증 우회 두 건을 고쳤다. 같은 함정을 구조로 막는다.

```ts
/**
 * 부여/수정 시 요청 scope가 유효하고 해당 org에 속하는지 검증한다.
 * POST와 PUT이 반드시 같은 함수를 통과해야 한다.
 */
export async function validateMemberScopes(
    scopes: MemberScopeInput[],
    orgId: string
): Promise<{ ok: true; scopes: ValidatedMemberScope[] } | { ok: false; error: string }>;
```

검증 내용:
1. `scopeType`이 4개 리터럴 중 하나인가 → `유효하지 않은 범위 유형: ${scopeType}`
2. `org` → `scopeId = 0` 정규화, 대상 검증 없음
3. `workspace`/`folder`/`partition` → **`workspaces.orgId = orgId` 조인으로 대상이 이 조직 소유인지 확인** (B8)
4. `permissions` 4비트가 모두 boolean인가 → `권한 값이 올바르지 않습니다.`

추가로 **대상 사용자의 org 소속도 검증**한다(토큰 검증에는 없던 축). `organization_members`에 `(organizationId, userId)` 행이 있어야 하고, `role`이 owner/admin이면 "관리자에게는 파티션 권한을 설정할 필요가 없습니다."로 400.

**PUT이 우회할 수 없는 구조**: PUT은 (a) 대상 행이 `orgId = user.orgId`인지 먼저 확인 (b) scope 변경이 있으면 `validateMemberScopes` 통과. `api-tokens/[id]/route.ts:38-45`와 같은 형태. B9가 겨냥한다.

## 9. API 계약

전부 `{success, data}` / `{success, error}`, 한국어 에러.

### `GET /api/member-scopes?userId=&partitionId=`

owner/admin만(B14). scopeName을 해석해 UI가 바로 그리게 한다 — org 단위로 workspaces/folders/partitions를 각 1회 조회해 Map으로 붙인다(건별 조회 N+1 회피).

```ts
interface MemberScopeItem {
    id: number;
    userId: string;
    userName: string;
    userEmail: string;
    scopeType: ScopeType;
    scopeId: number;
    scopeName: string;          // "조직 전체" | 워크스페이스/폴더/파티션 이름
    permissions: ScopePermissions;
    createdAt: string;
}
```

### `POST /api/member-scopes`

`{ userId: string; scopes: MemberScopeInput[] }` → `{ granted: number }`. upsert(`onConflictDoUpdate` on unique 키 → `permissions`, `updatedAt`)라 **멱등**.

### `PUT /api/member-scopes/[id]` / `DELETE /api/member-scopes/[id]`

부분 수정 `{ permissions?, scopeType?, scopeId? }` / orgId 확인 후 hard delete.

### `PATCH /api/partitions/[id]/scheduled-registrations/config` (B12·B13)

```ts
{ scheduledRegistrationConfig: { enabled: boolean; timeOfDay: string; countPerDay: number } | null }
```

**B13을 구조로 보장**: `db.update(partitions).set({ scheduledRegistrationConfig, updatedAt })`만 호출한다. `updateData`를 요청 본문에서 조립하지 않고 **필드 이름을 코드에 하드코딩**. 본문의 다른 키(`name`, `folderId` 등)는 파싱조차 하지 않으므로 물리적으로 반영될 수 없다.

권한은 `requirePartitionAccess(user, partitionId, "update")`. member라도 update 비트가 있으면 통과 — 원래 문제의 해결.

## 10. behavior → 구현 매핑

| id | 담당 |
|---|---|
| B1 | `canAccessPartition` — `covered=false` 경로 |
| B2 | `canAccessPartition` — `covered=true` + 내 scope 없음; route가 403 변환 |
| B3 | `canAccessPartition` — 내 scope + 비트 매칭 |
| B4 | `permissions[permission]` 비트 검사; records POST가 `"create"` 전달 |
| B5 | `canAccessPartition` 1단계 role 분기 |
| B6 | `scopeCoversPartition`의 `workspace` 분기 |
| B7 | `scopeCoversPartition`의 `folder` 분기 (+ null 배제) |
| B8 | `validateMemberScopes` — `workspaces.orgId` 조인 검증 |
| B9 | PUT이 POST와 동일한 `validateMemberScopes` 호출 |
| B10 | `requireRecordAccess` + `/api/records/[id]` 3개 메서드 |
| B11 | `filterAccessiblePartitions` + `loadOrgScopes`; 두 목록 route |
| B12 | config route + `requirePartitionAccess(..., "update")` |
| B13 | config route가 `scheduledRegistrationConfig`만 `set` |
| B14 | 4개 관리 route 상단 role 체크 |
| B15 | `MemberScopeDialog` + `useMemberScopes`의 `mutate()` |

## 11. 파일 계획

### 신규

| 파일 | 역할 | 예상 |
|---|---|---|
| `src/lib/partition-access.ts` | 순수 판정 + DB 어댑터 + `validateMemberScopes` | ~190줄. 200줄 근접 시 순수부를 `partition-access-rules.ts`로 분리 후 re-export |
| `src/lib/partition-access.test.ts` | B1~B8, B11의 node:test | ~120줄 |
| `drizzle/0065_member_scopes.sql` | 마이그레이션 | §3 |
| `src/app/api/member-scopes/route.ts` | GET(목록·이름 해석) / POST(부여) | ~150줄 |
| `src/app/api/member-scopes/[id]/route.ts` | PUT / DELETE | ~90줄 |
| `src/app/api/partitions/[id]/scheduled-registrations/config/route.ts` | PATCH — config 전용 | ~70줄 |
| `src/hooks/useMemberScopes.ts` | SWR 훅 | ~55줄 |
| `src/components/settings/MemberScopeDialog.tsx` | 권한 부여/편집 다이얼로그. **scope 유형은 workspace/folder/partition만 노출 — org 제외**(§15) | ~200줄. 넘으면 scope 추가 Popover를 `MemberScopePicker.tsx`로 분리 |

### 수정 — 스키마

| 파일 | 변경 |
|---|---|
| `src/lib/db/schema.ts` | `memberScopes` + 타입 2개. 기존 `partitionPermissions`·`workspacePermissions`는 손대지 않음 |
| `drizzle/meta/_journal.json` | `idx: 65` 엔트리 |

### 수정 — 권한 체크 삽입

| 파일 | 정확히 무엇이 |
|---|---|
| `partitions/[id]/records/route.ts` | 로컬 헬퍼(13-24) 삭제. GET(42) → `"read"`, POST(183) → `"create"` |
| `partitions/[id]/records/group-counts/route.ts` | 로컬 헬퍼(6-13) 삭제, GET(32) → `"read"` |
| `partitions/[id]/records/export/route.ts` | 인라인 검증(57-60) → `"read"` |
| `partitions/[id]/records/bulk-import/route.ts` | 인라인 검증(38-42) → `"create"`. `workspaceOrgId` → `access.workspace.orgId` |
| `partitions/[id]/records/delete-all/route.ts` | 인라인 검증(35-42) → `"delete"` |
| `partitions/[id]/resolved-fields/route.ts` | 인라인 검증(19-30) → `"read"` |
| `partitions/[id]/scheduled-registrations/route.ts` | 로컬 헬퍼(9-16) 삭제. GET(33) → `"read"`, DELETE(84) → `"delete"` |
| `partitions/[id]/scheduled-registrations/upload/route.ts` | 인라인 검증(73-76) → `"create"` |
| `records/[id]/route.ts` | **role 체크 0건인 우회 경로.** GET/PATCH/DELETE의 `records.orgId` 단독 조회를 `requireRecordAccess`로 교체 |
| `partitions/[id]/route.ts` | 로컬 `verifyOwnership`(6-13) 삭제 → 공통 함수. **`role === "member"` 차단(23·65·192)은 유지** — 파티션 구조 변경은 관리자 전용이라는 기존 정책 그대로. PATCH의 config 처리(151-169)는 config route와의 중복을 피해 `src/lib/scheduled-registration.ts`에 `normalizeScheduledConfig`로 추출 후 양쪽에서 호출 |
| `partitions/route.ts` (GET) | select에 `folderId` 추가 + member면 `loadOrgScopes` + 필터 |
| `workspaces/[id]/partitions/route.ts` (GET) | `partitionList`를 그룹핑 전에 필터 |

### 수정 — UI

| 파일 | 변경 |
|---|---|
| `settings/OrgTeamTab.tsx` | 멤버 행 드롭다운(218-245)에 "파티션 권한" 항목. 역할 안내 하드코딩(331-335)의 `member` 항목 갱신. 파일이 418줄이라 **다이얼로그 로직을 넣지 않고** 컴포넌트+훅으로 밀어낸다(state는 `open`/`targetUserId` 둘만 추가) |
| `records/PartitionNav.tsx` | 파티션 드롭다운 두 곳(269-328, 369-425)에 "권한 관리" 항목. **관리자에게만 노출.** 다이얼로그 상태는 상위에서 관리하는 콜백 prop(`onManagePermissions?: (id: number, name: string) => void`) — `onDistributionSettings`와 동일 패턴 |
| `records/scheduled-registration/ui/ScheduledRegistrationDialog.tsx` | `SettingsTab.handleSave`(452)의 fetch 대상을 config route로 변경. body 형태는 동일 |

## 12. TDD 계약 — `src/lib/partition-access.test.ts`

기존 스타일(`node:test` + `node:assert`, 한국어 테스트명)을 따른다. **순수 함수만 테스트한다.**

```ts
const ALICE = { userId: "u-alice", role: "member" as const };
const ADMIN = { userId: "u-admin", role: "admin" as const };

// P1: ws=1, folder=10 / P2: ws=1, folder=null / P3: ws=2, folder=20
const P1 = { id: 101, folderId: 10, workspaceId: 1 };
const P2 = { id: 102, folderId: null, workspaceId: 1 };
const P3 = { id: 103, folderId: 20, workspaceId: 2 };

const RO   = { read: true,  create: false, update: false, delete: false };
const RC   = { read: true,  create: true,  update: false, delete: false };
const NONE = { read: false, create: false, update: false, delete: false };

const scope = (userId: string, scopeType: string, scopeId: number, permissions = RO) =>
    ({ userId, scopeType, scopeId, permissions });
```

| # | 테스트명 | 입력 | 기대 |
|---|---|---|---|
| B1-1 | scope가 하나도 없으면 member도 통과한다 (allow 기본) | ALICE, P1, read, `[]` | `true` |
| B1-2 | 다른 파티션에만 scope가 걸려 있으면 이 파티션은 여전히 통과한다 | ALICE, P1, read, `[scope(bob,"partition",102)]` | `true` |
| B2-1 | 타인의 partition scope가 걸리면 권한 없는 member는 차단된다 | ALICE, P1, read, `[scope(bob,"partition",101)]` | `false` |
| B2-2 | 타인의 workspace scope도 그 워크스페이스 하위를 제한 모드로 만든다 | ALICE, P1, read, `[scope(bob,"workspace",1)]` | `false` |
| B3-1 | 자기 partition scope가 있으면 통과한다 | ALICE, P1, read, `[scope(alice,"partition",101)]` | `true` |
| B3-2 | 제한된 파티션에 나와 타인 scope가 함께 있어도 나는 통과한다 | ALICE, P1, read, 둘 다 | `true` |
| B4-1 | read만 있는 scope로는 create가 거부된다 | ALICE, P1, create, `[scope(alice,…,RO)]` | `false` |
| B4-2 | read+create scope면 create가 통과한다 | ALICE, P1, create, `[… RC]` | `true` |
| B4-3 | 비트가 전부 꺼진 scope는 제한만 걸고 아무것도 허용하지 않는다 | ALICE, P1, read, `[… NONE]` | `false` — 명시적 차단 표현 수단 |
| B5-1 | admin은 자기 scope가 없어도 통과한다 | ADMIN, P1, delete, `[scope(bob,…)]` | `true` |
| B5-2 | owner는 scope가 전부 타인 것이어도 통과한다 | owner, P1, delete, `[scope(bob,"org",0)]` | `true` |
| B6-1 | workspace scope는 하위 모든 파티션을 덮는다 | ALICE, P1·P2, read, `[scope(alice,"workspace",1)]` | 둘 다 `true` |
| B6-2 | workspace scope는 다른 워크스페이스 파티션을 덮지 않는다 | ALICE, P3, read, `[scope(alice,"workspace",1)]` | `true` — 제한 모드와 소유를 혼동하지 않게 하는 케이스 |
| B6-3 | 타인의 workspace scope가 있으면 그 워크스페이스 밖은 영향받지 않는다 | ALICE, P3, read, `[scope(bob,"workspace",1)]` | `true` |
| B7-1 | folder scope는 그 폴더 하위 파티션을 덮는다 | ALICE, P1, read, `[scope(alice,"folder",10)]` | `true` |
| B7-2 | folderId가 null인 파티션은 folder scope에 걸리지 않는다 | ALICE, P2, read, `[scope(bob,"folder",10)]` | `true` |
| B7-3 | folder scope는 다른 폴더 파티션을 덮지 않는다 | ALICE, P3, read, `[scope(bob,"folder",10)]` | `true` |
| B-org | org scope는 조직 내 모든 파티션을 덮는다 | ALICE, P3, read, `[scope(bob,"org",0)]` → `false` / `[scope(alice,"org",0)]` → `true` | |
| B-unk | 알 수 없는 scopeType은 아무 파티션도 덮지 않는다 | ALICE, P1, read, `[scope(bob,"universe",1)]` | `true` — 미래 scopeType이 기존 접근을 깨지 않는다 |
| B11-1 | filterAccessiblePartitions는 건별 판정과 같은 결과를 낸다 | `[P1,P2,P3]`, ALICE, read, `[scope(bob,"workspace",1)]` | `[P3]` |
| B11-2 | admin에게는 목록이 그대로 유지된다 | `[P1,P2,P3]`, ADMIN, read, `[scope(bob,"org",0)]` | `[P1,P2,P3]` |

**B8은 DB를 보므로 순수 테스트 대상이 아니다** — curl로 검증. 순수 함수 쪽 계약은 "판정 함수가 org 필터링을 스스로 하지 않는다"이며, org 경계는 쿼리 ①·②의 `orgId` 조건과 `validateMemberScopes`가 책임진다. 이 분리를 `AccessInput.orgScopes` JSDoc에 명시.

## 13. TDD 밖 검증 (curl / 육안)

- **B8**: 타 조직 파티션 id로 POST → 400 `파티션을 찾을 수 없습니다.`
- **B9**: 같은 id로 PUT → 동일 400
- **B10**: 권한 없는 member 토큰으로 `/api/records/{id}` PATCH·DELETE → 403
- **B12**: member(update 비트)로 config PATCH → 200, 설정 반영
- **B13**: config PATCH 본문에 `{ scheduledRegistrationConfig: …, name: "해킹" }` → 200이지만 `partitions.name` 불변
- **B14**: member 토큰으로 4개 관리 API → 전부 403
- **B15**: 관리자 UI에서 부여 → 목록 즉시 반영(육안)
- **회귀**: `pnpm test` 기존 68개 + 신규 전부 통과

## 14. 도메인 체크리스트

| 영역 | 결론 |
|---|---|
| 데이터 모델 | §3 확정. hard delete(권한은 이력 가치가 낮다). 조직·사용자 삭제 시 CASCADE, 부여자 삭제 시 `grantedBy` SET NULL |
| API 계약 | 전부 `{success, data}` / `{success, error}`, 한국어 에러. POST는 upsert로 멱등. 페이징 없음(조직당 수십~수백 규모) |
| 상태 관리 | SWR. **낙관적 업데이트 없음** — 권한은 틀린 화면을 잠깐이라도 보여주면 안 된다. 부여 후 `mutate()` 재검증 |
| 보안 | 인가는 route 진입 직후 한 곳에서만. 테넌트 격리는 쿼리 ①의 `workspaces.orgId`와 쿼리 ②의 `memberScopes.orgId` 두 겹. 입력 검증은 `validateMemberScopes` |
| 동시성 | 중복 제출은 unique + upsert로 흡수. 권한 회수와 데이터 요청의 경쟁은 허용(요청 시점 기준, 최대 1요청 지연) |
| 성능 | member 요청당 +1쿼리(파티션 수 무관), 관리자 +0. 목록도 +1 고정 |

## 15. 리스크 / 열린 질문

- **🟢 org scope는 UI에서 제외 (결정됨)** — 한 사용자에게 org scope를 주는 순간 조직의 모든 파티션이 제한 모드가 되어 권한을 안 받은 나머지 member 전원이 즉시 차단된다. 규칙상 맞는 동작이지만 사고 가능성이 커서 **`MemberScopeDialog`에서 org scope 옵션을 노출하지 않는다**. 스키마·판정 함수·`validateMemberScopes`는 org scope를 그대로 지원하고(`scopeCoversPartition`의 org 분기, 테스트 B-org 유지), UI만 workspace 이하로 제한한다. 나중에 필요해지면 UI만 열면 된다.
- **🟢 `records.orgId` vs `workspaces.orgId` 불일치 (로컬 확인됨)** — `requireRecordAccess`는 후자를 신뢰한다. 둘이 어긋나는 행이 있으면 기존 동작과 결과가 달라지는데, **로컬 DB에서 0건 확인**(2026-09-01). 운영 DB는 배포 전 같은 쿼리로 재확인할 것:
  ```sql
  SELECT count(*) FROM records r
    JOIN partitions p ON p.id = r.partition_id
    JOIN workspaces w ON w.id = p.workspace_id
   WHERE r.org_id <> w.org_id;
  ```
- **🟡 `PartitionNav`의 role 인지** — 현재 이 컴포넌트는 role을 모른다. prop으로 내리는 쪽이 컴포넌트 순수성 면에서 낫지만 호출부 수정이 함께 필요하다. 구현 시 판단.
- **🟢 `partitions/[id]` PATCH의 member 차단 유지** — member는 config 전용 경로만 쓴다. 향후 "member가 파티션 이름을 바꿀 수 있어야 한다" 요구가 오면 그때 확장(지금은 YAGNI).
- **🟢 목록에서 파티션이 사라지는 체감** — allow 기본이라 권한을 걸기 전까지 아무 변화가 없으므로 기존 사용자 영향 0.
