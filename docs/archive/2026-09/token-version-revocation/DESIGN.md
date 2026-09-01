# DESIGN — role 변경 즉시 반영 (tokenVersion)

- **사이클 ID**: `2026-09-01-token-version-revocation`
- **근거**: `PLAN.md`(승인됨), `behaviors.json` B1~B10
- **선행 참조**: `docs/archive/2026-09/partition-member-permissions/` 의 DESIGN(순수 판정 + DB 어댑터 이분)과 REPORT "배운 것" 1·3항(가드 목록 1:1 대조, 전수 조사를 DESIGN의 명시적 산출물로)

## 1. 접근법

세 조각으로 나눈다.

1. **저장** — `organization_members.token_version integer not null default 0`. role이 바뀌는 자리에서 같은 UPDATE로 증가.
2. **판정** — DB를 모르는 순수 함수 `checkTokenVersion(tokenVersion, dbVersion)`이 `"ok" | "stale" | "missing"`을 낸다.
3. **적용** — `requireAdmin(req, minRole?)`가 토큰 파싱 → `organizationMembers` 1회 조회 → 버전 대조 → **DB의 role**로 권한 판정까지 한 번에. 관리자 경로만 이걸 쓴다.

핵심은 **`requireAdmin`이 role을 JWT가 아니라 DB에서 다시 읽는다**는 점이다. 이미 `(organizationId, userId)`로 행 하나를 읽으므로 `token_version`과 `role`이 같은 행에 함께 온다. 추가 쿼리 0.

### 기각한 대안

- **`users.tokenVersion`** — §3에서 비교. 다중 조직에서 "A조직 강등이 B조직 세션을 끊는" 부작용을 내장하고, `requireAdmin`의 쿼리가 2회가 된다.
- **`getUserFromNextRequest` async 전환** — 164개 파일 diff + 모든 요청 +1쿼리. PLAN이 범위 밖으로 뺐다.
- **무효화 블랙리스트 테이블** — 멤버 제거·비밀번호 변경까지 커버하지만 이번 범위엔 과설계. 만료 정리 배치까지 필요해진다.
- **`withAuth`에 옵션 추가** — `api-handler.ts`가 이미 `minRole`을 갖고 있어 매력적이지만 **13곳 중 사용처가 0곳**이다. 선행 리팩터링이 필요해 이번 diff에 섞으면 회귀 원인 분리가 불가능해진다. §9에서 후속으로 남긴다.

## 2. 아키텍처

```
관리자 route (13곳)
  │ await requireAdmin(req)                      ← src/lib/auth-admin.ts
  ├─ ① verifyToken (동기)              실패 → 401 "인증이 필요합니다."
  ├─ ② organization_members 1행 조회   행 없음 → 401 "세션이 만료되었습니다…"
  ├─ ③ checkTokenVersion(...)  ← 순수  "stale" → 401 "세션이 만료되었습니다…"
  └─ ④ hasMinRole(row.role, minRole) ← 순수  false → 403 "접근 권한이 없습니다."
  ▼  { ok:true, user: JWTPayload(role은 DB값으로 덮어씀) }

일반 route (나머지)
  │ getUserFromNextRequest(req)   ← 변경 없음. 동기 유지
  ▼  JWT의 role을 그대로 신뢰 (B8이 명시하는 의도된 지연)
```

| 레이어 | 위치 | DB | 검증 |
|---|---|---|---|
| 순수 판정 | `checkTokenVersion` / `isTokenVersionAcceptable` / `hasMinRole` (`auth-admin-rules.ts`) | ✗ | node:test |
| DB 어댑터 | `requireAdmin` / `bumpTokenVersion` (`auth-admin.ts`) | ✓ | curl |
| 발급 | 각 발급 지점 | ✓ | curl (B7) |

**`-rules.ts` 분리는 필수다.** `auth-admin.ts`가 `@/lib/db`를 import하고 `db/index.ts`는 모듈 로드 시점에 postgres 커넥션을 만든다. `tsx --test`가 그걸 끌고 오면 DB 없이 테스트가 못 돈다. 직전 사이클이 `partition-access-rules.ts`를 뽑은 것과 같은 이유·같은 이름 규칙.

## 3. 결정 ① — `tokenVersion`을 어디에 둘 것인가

### 결론: `organization_members.token_version`

| 축 | `users.token_version` | **`organization_members.token_version`** |
|---|---|---|
| 다중 조직 시 | A조직 강등이 **B조직 세션까지 끊는다** | A조직 토큰만 끊는다 |
| 대조 키 | `userId` | `(userId, orgId)` — JWT가 둘 다 갖고 있다 |
| 발급 시 조달 | `users` 조회 필요 | **8곳 중 6곳이 이미 `organizationMembers`를 읽는다** |
| `requireAdmin` 쿼리 | users 1건 + role은 여전히 organizationMembers → **2쿼리** | 1건에서 role·version 동시 → **1쿼리** |
| 마이그레이션 | `ADD COLUMN` | `ADD COLUMN` — **동일** |
| 인덱스 | 불필요 | 불필요 — `(organization_id, user_id)` unique가 이미 커버 |

**다중 조직 사용자가 현재 0명**(실측: 총 11명 중 0명)이라는 사실은 "지금은 아무거나 골라도 관측 차이가 없다"를 뜻하지 "`users`가 낫다"를 뜻하지 않는다. 결정 근거는 다른 데 있다:

- **`role` 자체가 이미 `organization_members`에 산다.** 무효화 대상과 카운터를 같은 행에 두는 게 정합적이다. `users.role`은 legacy로 남아 있지만 role 변경 API는 `organization_members`만 UPDATE한다.
- **쿼리 수가 오히려 줄어든다** (2 → 1).
- **마이그레이션 난이도가 같다.**

### 미래에 다중 조직 사용자가 생기면

JWT는 한 시점에 **하나의 orgId**만 담으므로(쿠키 1개) "A조직 토큰"과 "B조직 토큰"이 동시에 존재하지 않는다. 실질 효과는 "A조직에 있는 동안만 끊긴다"이고, `org/switch`로 B로 가면 B의 버전으로 새 토큰이 나온다. `users`에 뒀을 때의 "전 조직 강제 로그아웃"보다 명백히 온건하다.

### Drizzle 정의 변경

```ts
export const organizationMembers = pgTable(
    "organization_members",
    {
        id: serial("id").primaryKey(),
        organizationId: uuid("organization_id").notNull()
            .references(() => organizations.id, { onDelete: "cascade" }),
        userId: uuid("user_id").notNull()
            .references(() => users.id, { onDelete: "cascade" }),
        role: varchar("role", { length: 20 }).notNull(), // owner | admin | member
        // role이 바뀔 때마다 +1. JWT에 구워진 값과 다르면 관리자 경로에서 거부된다.
        tokenVersion: integer("token_version").default(0).notNull(),
        joinedAt: timestamptz("joined_at").defaultNow().notNull(),
    },
    (table) => ({
        orgUserUnique: unique().on(table.organizationId, table.userId),
        userIdx: index("org_members_user_idx").on(table.userId),
    })
);
```

## 4. 결정 ② — 기존 토큰 호환 방침

### 결론: (c) `undefined`를 `0`으로 취급한다

| 선택지 | 배포 직후 | 문제 |
|---|---|---|
| (a) undefined면 거부 | 전원 강제 로그아웃 | 목적과 무관한 부작용 |
| (b) undefined면 통과 | 로그아웃 없음 | **치명적 구멍**: 배포 직전 토큰은 `tokenVersion`이 영원히 undefined라 아무리 강등해도 통과. 최대 30일. **고치려는 문제가 그대로 남는다** |
| **(c) undefined = 0** | 로그아웃 없음 | 강등되면 DB가 1이 되어 `0 ≠ 1` → 거부. **구멍이 닫힌다** |

(c)가 (b)의 구멍 없이 (a)의 전원 로그아웃도 피한다.

**(c)가 무효화를 놓치는 유일한 경우**는 배포 시점에 이미 `token_version > 0`인 사용자인데, 컬럼을 지금 만들고 DEFAULT 0으로 채우므로 **그런 행은 존재할 수 없다.** 즉 이 사이클에서 (c)는 (a)와 안전성이 동등하다.

### B6의 계약

> payload에 `tokenVersion`이 없는 토큰은 `tokenVersion === 0`과 **동일하게** 취급된다. DB 버전이 0이면 통과, 0보다 크면 거부.

단 판정 함수는 `"missing"`을 별도로 **구별해서 돌려준다** — 정책 전환 지점을 하나로 만들기 위함(§5).

## 5. 순수 판정 함수 — `src/lib/auth-admin-rules.ts`

```ts
import type { OrgRole } from "@/types";

/**
 * - "ok"      : 유효
 * - "stale"   : role이 바뀐 뒤 발급된 토큰이 아니다. 재로그인 필요
 * - "missing" : payload에 tokenVersion이 없다 (이번 배포 이전 발급)
 */
export type TokenVersionCheck = "ok" | "stale" | "missing";

export function checkTokenVersion(
    tokenVersion: number | undefined,
    dbVersion: number
): TokenVersionCheck;

/** 세 결과 중 통과로 취급할 것. 정책이 바뀌면 여기만 고친다. */
export function isTokenVersionAcceptable(result: TokenVersionCheck): boolean;

/** owner > admin > member. 알 수 없는 role은 -1로 떨어뜨린다(fail-closed). */
export function hasMinRole(role: string, minRole: OrgRole): boolean;
```

### `checkTokenVersion`의 계약

```
if (tokenVersion === undefined) return dbVersion === 0 ? "missing" : "stale";
return tokenVersion === dbVersion ? "ok" : "stale";
```

- `undefined` + `db 0` → `"missing"` (통과)
- `undefined` + `db ≥ 1` → `"stale"` (거부) ← §4-(c)가 구멍을 닫는 지점
- 같은 수 → `"ok"` / 다른 수 → `"stale"` (**작든 크든**. 롤백·복제 지연도 fail-closed)

`isTokenVersionAcceptable`을 따로 두는 이유: 정책 전환("30일 뒤 missing도 거부")이 **한 줄**로 끝나고 테스트로 고정된다.

### `hasMinRole`의 계약

```
const ORDER = { member: 0, admin: 1, owner: 2 };
return (ORDER[role] ?? -1) >= ORDER[minRole];
```

`api-handler.ts:16`의 `roleOrder`와 같은 순서지만, 그쪽은 미지 role을 `?? 0`(member)로 떨어뜨리는 반면 여기서는 **`-1`**을 쓴다. `minRole`이 `"member"`일 때 미지 role이 통과하는 걸 막기 위함. 이 비대칭은 의도적이며 주석으로 명시한다.

`role`은 DB에서 `string`으로 온다. `OrgRole`로 캐스팅하지 않고 `string`으로 받아 인덱싱한다 (직전 사이클의 `scopeType: string`과 같은 방식).

## 6. 결정 ③ — 발급 8곳의 조달

### `JWTPayload` 확장

```ts
export interface JWTPayload {
  userId: string;
  orgId: string;
  email: string;
  name: string;
  role: OrgRole;
  /** 발급 시점의 organization_members.token_version. 배포 이전 토큰엔 없다 — 없으면 0으로 취급. */
  tokenVersion?: number;
  isSuperAdmin?: boolean;
}
```

**optional로 둔다.** required면 배포 전 토큰을 `JWTPayload`로 캐스팅하는 순간 타입이 거짓말이 된다. `checkTokenVersion`의 `number | undefined`와도 일관된다.

`generateToken`/`verifyToken`은 **시그니처 변경 없음** — payload를 통째로 다루므로 필드가 늘어도 그대로 동작한다.

### 8곳 — 추가 쿼리 전부 0

| # | 파일 | 조달 |
|---|---|---|
| 1 | `auth/login` | select에 `tokenVersion` 추가 → `selectedOrg.tokenVersion` |
| 2 | `auth/signup` | 방금 insert한 새 멤버십 → 리터럴 `0` |
| 3 | `auth/profile` | `{ ...currentUser, name }` 스프레드로 자동 전파 — **코드 변경 없음** |
| 4 | `org/switch` | select에 추가 → **전환 대상 조직의 값** |
| 5 | `org/settings` (DELETE) | select에 추가 → `nextOrg.tokenVersion` |
| 6 | `org/create` | 새 멤버십 → 리터럴 `0` |
| 7 | `org/invite-accept` | 새 멤버십 → 리터럴 `0` |
| 8 | `org/invitations/accept` | 새 멤버십 → 리터럴 `0` |

4곳은 리터럴 `0`, 3곳은 이미 도는 select에 컬럼 하나 추가, 1곳은 스프레드 자동 전파.

**#3의 확인 사항**: `...currentUser`가 `iat`/`exp`도 스프레드하는데 `jwt.sign`이 `expiresIn`과 payload `exp` 충돌 시 에러를 던진다. 현재 동작 중이므로 새 위험은 아니지만 구현 시 재발급 1회를 실행해 확인한다.

**리터럴 `0`에 주석**: `// 새 멤버십이라 token_version은 DEFAULT 0. 별도 조회 불필요`

### B7의 검증 — 분모를 코드에서 뽑는다

`Grep "generateToken(" src/app/api` → **8건 확인 완료**. 각 호출의 payload에 `tokenVersion`이 있는지 1:1 대조표를 REPORT에 싣는다. **9곳 이상이면 조사가 틀린 것이므로 즉시 보고.**

## 7. 결정 ④ — `requireAdmin` 시그니처

```ts
export type AdminAuthResult =
    | { ok: true; user: JWTPayload }
    | { ok: false; status: 401 | 403; error: string };

/**
 * 관리자 경로의 단일 진입점. getUserFromNextRequest와 달리 DB를 본다.
 * role 판정은 JWT가 아니라 DB의 현재 role로 한다 —
 * 반환되는 user.role이 DB 값으로 덮어써지므로 호출부의 세부 분기도 최신값을 본다.
 */
export async function requireAdmin(
    req: NextRequest,
    minRole: OrgRole = "admin"
): Promise<AdminAuthResult>;

/** role 변경 없이 세션만 끊어야 하는 경우를 위한 보조. */
export async function bumpTokenVersion(orgId: string, userId: string): Promise<void>;
```

### 401 vs 403

| 상황 | 상태 | 메시지 |
|---|---|---|
| 토큰 없음/서명 실패/만료 | 401 | `"인증이 필요합니다."` (기존 문구 그대로) |
| 멤버십 행 없음 | 401 | `"세션이 만료되었습니다. 다시 로그인해주세요."` |
| `tokenVersion` 불일치 | **401** | `"세션이 만료되었습니다. 다시 로그인해주세요."` |
| DB role이 minRole 미만 | 403 | `"접근 권한이 없습니다."` (기존 문구 그대로) |

**stale을 401로 두는 이유**: 403을 주면 사용자는 "권한이 없어졌구나"로 이해하고 재로그인하지 않는다. 재로그인하면 실제로 admin일 수도 있으므로(승격 B3) 401 + "다시 로그인해주세요"가 유일하게 정확한 안내다. B1의 계약과도 일치.

### `minRole` 인자가 필요한 실측 근거

owner 전용 API가 실재한다:
- `org/settings/route.ts:115` (조직 삭제)
- `billing/cancel/route.ts:12` (구독 해지)

`org/settings`는 **한 파일에 GET/PATCH(admin)와 DELETE(owner)가 공존**해 `minRole` 없이는 헬퍼로 못 옮긴다. 기본값 `"admin"`으로 두어 대부분은 인자 없이 호출한다.

### 호출부 변환

```ts
// before (13곳 공통)
const user = getUserFromNextRequest(req);
if (!user) return NextResponse.json({ success:false, error:"인증이 필요합니다." }, { status:401 });
if (user.role === "member") return NextResponse.json({ success:false, error:"접근 권한이 없습니다." }, { status:403 });

// after
const auth = await requireAdmin(req);
if (!auth.ok) return NextResponse.json({ success:false, error:auth.error }, { status:auth.status });
const user = auth.user;
```

`const user = auth.user`로 받아 **아래 본문을 건드리지 않는다.** diff가 최소가 되고 1:1 대조가 가능해진다.

## 8. role 변경 시 무효화

현재 UPDATE에 `tokenVersion`을 합친다. **별도 UPDATE를 추가하지 않는다** — 두 문장이면 사이에서 실패했을 때 "role은 바뀌었는데 토큰은 유효"라는 최악의 상태가 남는다.

```ts
await db
    .update(organizationMembers)
    .set({ role, tokenVersion: sql`${organizationMembers.tokenVersion} + 1` })
    .where(and(
        eq(organizationMembers.userId, targetId),
        eq(organizationMembers.organizationId, user.orgId)
    ));
```

`sql\`... + 1\``을 쓰는 이유: read-modify-write를 하면 두 관리자가 동시에 같은 사람의 role을 바꿀 때 증가가 유실될 수 있다. **DB에서 원자적으로 증가**시키면 경쟁이 없다.

### 무효화가 일어나지 않는 경로 (의도)

- **role 값이 안 바뀌어도 증가한다.** "role 변경 API가 성공하면 무조건 무효화"가 더 단순하고 안전하다.
- **owner는 도달 불가.** `target.role === "owner"`가 403으로 막고(48행), `role`이 `["admin","member"]`로 제한된다(23행). **B9는 코드 추가 없이 기존 가드로 보장**된다.
- **DELETE(멤버 제거)는 손대지 않는다**(범위 밖). 단 §7의 "멤버십 행 없음 → 401"이 **부수적으로 제거된 멤버를 관리자 경로에서 차단**한다 — 의도치 않은 이득이므로 REPORT에 기록.

## 9. 결정 ⑤ — 검증 누락 방지

REPORT "배운 것" 3항("100%는 분모의 함수다")이 겨냥하는 지점.

### 분모 확정

실측으로 `role === "member"`가 **54건 / 39파일**. PLAN이 지목한 것은 그중 **12파일**이고, 나머지 27파일은 워크스페이스·필드·제품·트래커·광고 계열로 "일반 데이터 관리"에 해당해 이번 범위 밖(B8의 지연 반영 영역)이다.

### 구조적 방지 — 세 겹

1. **목록을 DESIGN에 못박고 REPORT에서 1:1 대조한다.** §10의 표가 그 목록이다. 구현 후 같은 Grep을 돌려 **13파일에서 `role === "member"`가 0건**임을 확인한다.
2. **남는 파일에 경계를 명시한다.** `auth-admin.ts` 상단 JSDoc에 "이 헬퍼를 쓰는 경로 = 관리자 경로"라는 정의와 현재 목록을 적는다.
3. **`billing/cancel`을 추가한다.** 실측으로 발견된 owner 전용 빌링 API로 PLAN 목록에 빠져 있었다. 강등된 owner는 존재할 수 없어 실질 리스크는 0이지만, **"빌링 4개는 전부 헬퍼를 쓴다"가 기억하기 쉬운 규칙**이라 넣는다. **12 → 13곳으로 확정.**

**하지 않는 것**: `role === "member"`를 금지하는 lint 규칙은 27개 정상 사용처를 오탐으로 만든다. YAGNI.

### `withAuth`와의 관계 (후속)

`api-handler.ts`의 `withAuth({ minRole })`가 같은 역할 판정을 갖고 있지만 13곳 중 사용처는 0곳이다. 장기적으로 `withAuth`에 `freshRole` 옵션을 넣는 게 옳지만, **이번 사이클에서는 하지 않는다** — 핸들러 시그니처 전체를 바꾸는 별개 리팩터링이고 무효화 검증과 섞이면 회귀 원인 분리가 불가능해진다.

## 10. 파일 계획

### 신규

| 파일 | 역할 | 예상 |
|---|---|---|
| `src/lib/auth-admin-rules.ts` | 순수 판정 3함수. **DB import 금지** | ~50줄 |
| `src/lib/auth-admin.ts` | `requireAdmin` / `bumpTokenVersion` + rules re-export | ~90줄 |
| `src/lib/auth-admin.test.ts` | 순수부 node:test. import는 `./auth-admin-rules`에서만 | ~90줄 |
| `drizzle/0066_org_member_token_version.sql` | 컬럼 추가 | §11 |

### 수정 — 스키마 / 타입

| 파일 | 변경 |
|---|---|
| `src/lib/db/schema.ts` | `organizationMembers`에 `tokenVersion` |
| `drizzle/meta/_journal.json` | `idx: 66` |
| `src/types/index.ts` | `JWTPayload.tokenVersion?: number` |
| `src/lib/auth.ts` | **변경 없음** |

### 수정 — 토큰 발급 (8곳)

§6의 표대로. `auth/profile`은 변경 없음(스프레드 전파 확인만).

### 수정 — `requireAdmin` 적용 (13곳)

| 파일 | minRole |
|---|---|
| `org/route.ts` (GET) | admin |
| `org/settings/route.ts` (GET, PATCH) | admin |
| ↑ 같은 파일 (DELETE) | **owner** |
| `org/onboarding-complete/route.ts` | admin |
| `org/members/route.ts` (GET) | admin |
| `org/members/[id]/route.ts` (PATCH, DELETE) | admin |
| `org/invitations/route.ts` (GET, POST) | admin |
| `org/invitations/[id]/route.ts` | admin |
| `billing/issue-billing-key` · `subscribe` · `delete-billing-key` | admin |
| `billing/cancel/route.ts` | **owner** (§9-3 추가분) |
| `member-scopes/route.ts` · `member-scopes/[id]/route.ts` | admin |

교체 후 이 13파일에서 role 게이트가 0건이어야 한다. 단 `org/members/[id]:53,58`의 `user.role === "admin"`(admin의 세부 제약)과 `org/invitations:95`의 `user.role !== "owner"`(admin 초대 제한)는 **게이트가 아니라 비즈니스 규칙**이므로 남긴다 — 이제 `auth.user.role`이 DB 값이라 오히려 정확해진다.

### 수정 — 무효화 (1곳)

`org/members/[id]/route.ts` PATCH의 UPDATE에 `tokenVersion: sql\`... + 1\`` 합침.

## 11. 마이그레이션 — `drizzle/0066_org_member_token_version.sql`

직전이 `0065_member_scopes.sql`(idx 65, when `1770952800000`). `when`은 `1770952900000`.

```sql
-- 조직 멤버의 role이 바뀌면 이 값을 1 증가시켜 기존 JWT를 무효화한다.
-- JWT payload에 발급 시점의 값이 구워지고, 관리자 경로(requireAdmin)에서만 대조한다.
-- users가 아니라 organization_members에 두는 이유: role이 여기 살고,
-- 다중 조직 사용자의 A조직 강등이 B조직 세션을 끊지 않아야 한다.
-- DEFAULT 0 — 배포 이전에 발급된 토큰(tokenVersion 없음)은 0으로 간주되어 그대로 통과한다.

ALTER TABLE "organization_members"
    ADD COLUMN IF NOT EXISTS "token_version" integer DEFAULT 0 NOT NULL;
```

journal 엔트리: `{ "idx": 66, "version": "7", "when": 1770952900000, "tag": "0066_org_member_token_version", "breakpoints": true }`

데이터 마이그레이션 없음 — **배포 직후 동작 변화 0**(로그아웃 없음).

## 12. behavior → 구현 매핑

| id | 담당 | 검증 |
|---|---|---|
| B1 | `checkTokenVersion` → `"stale"` → 401 + §8 UPDATE | curl |
| B2 | `auth/login`이 새 버전 담음 + `requireAdmin`이 DB role로 판정 | curl |
| B3 | §8 UPDATE가 방향 무관하게 `+1` | curl |
| B4 | UPDATE의 `WHERE userId = targetId` | curl |
| B5 | `checkTokenVersion` → `"ok"` | curl |
| B6 | `undefined` 분기 (§4-c) | node:test + curl |
| B7 | 발급 8곳 + Grep 분모 대조 | Grep 1:1 |
| B8 | **코드 없음** — 일반 route가 `getUserFromNextRequest` 유지 | curl + REPORT 명시 |
| B9 | **코드 추가 없음** — 기존 가드 | curl (403 + version 불변) |
| B10 | 순수 3함수 | node:test |

## 13. TDD 계약 — `src/lib/auth-admin.test.ts`

**`./auth-admin-rules`에서만 import** (DB 커넥션 회피).

### `checkTokenVersion` — B10 / B6

| # | 테스트명 | (token, db) | 기대 |
|---|---|---|---|
| B10-1 | 토큰과 DB 버전이 같으면 통과한다 | (0, 0) | `"ok"` |
| B10-2 | 버전이 올라간 뒤의 옛 토큰은 stale이다 | (0, 1) | `"stale"` |
| B10-3 | 여러 번 강등된 뒤에도 옛 토큰은 stale이다 | (1, 5) | `"stale"` |
| B10-4 | 0이 아닌 같은 버전끼리도 통과한다 | (3, 3) | `"ok"` |
| B10-5 | 토큰 버전이 DB보다 커도 거부한다 (fail-closed) | (5, 3) | `"stale"` |
| B6-1 | tokenVersion이 없는 배포 전 토큰은 DB가 0이면 missing이다 | (undefined, 0) | `"missing"` |
| B6-2 | tokenVersion이 없어도 이미 강등된 멤버면 stale이다 | (undefined, 1) | `"stale"` |
| B6-3 | tokenVersion이 없고 DB가 여러 번 올라갔어도 stale이다 | (undefined, 7) | `"stale"` |

### `isTokenVersionAcceptable` — 정책의 단일 지점

| # | 테스트명 | 입력 | 기대 |
|---|---|---|---|
| P-1 | ok는 통과시킨다 | `"ok"` | `true` |
| P-2 | stale은 거부한다 | `"stale"` | `false` |
| P-3 | 배포 전 토큰(missing)은 현재 정책상 통과시킨다 | `"missing"` | `true` |

### `hasMinRole` — 게이트 경계

| # | 테스트명 | (role, minRole) | 기대 |
|---|---|---|---|
| R-1 | member는 admin 게이트를 통과하지 못한다 | ("member","admin") | `false` |
| R-2 | admin은 admin 게이트를 통과한다 | ("admin","admin") | `true` |
| R-3 | owner는 admin 게이트를 통과한다 | ("owner","admin") | `true` |
| R-4 | admin은 owner 게이트를 통과하지 못한다 | ("admin","owner") | `false` |
| R-5 | owner는 owner 게이트를 통과한다 | ("owner","owner") | `true` |
| R-6 | 알 수 없는 role은 member 게이트도 통과하지 못한다 | ("guest","member") | `false` |
| R-7 | 빈 문자열 role도 거부한다 | ("","admin") | `false` |

## 14. TDD 밖 검증 (curl)

하나의 흐름으로 묶어 실행한다. A(admin), B(admin, 대조군), O(owner).

1. **B5** — A로 로그인 → `GET /api/org/settings` → 200
2. **B1** — O가 A를 member로 강등 → **A의 옛 토큰**으로 관리자 API → **401**
3. **B8** — 같은 옛 토큰으로 `GET /api/records?...` → **200** (의도된 지연. REPORT에 명시)
4. **B4** — B의 토큰으로 관리자 API → 200 (영향 없음)
5. **B2** — A 재로그인 → 관리자 API → **403** (member가 됨)
6. **B3** — O가 A를 admin으로 승격 → (5)의 토큰으로 → **401**. 재로그인 후 → **200**
7. **B9** — owner 대상 PATCH → 403 + `token_version` 불변 확인
8. **B6** — `tokenVersion` 없이 서명한 JWT 수동 생성 → DB 0인 멤버로 관리자 API → 200. 강등 후 같은 토큰 → 401
9. **owner 게이트** — admin 토큰으로 `DELETE /api/org/settings`, `POST /api/billing/cancel` → 403
10. **B7 분모 대조** — `Grep "generateToken("` 8건, 각 payload에 `tokenVersion` 확인
11. **누락 대조** — 13파일에서 role 게이트 0건 확인
12. **회귀** — `pnpm test` 102개 + 신규 18개, `tsc`, `next build`

## 15. 도메인 체크리스트

| 영역 | 결론 |
|---|---|
| 데이터 모델 | `integer NOT NULL DEFAULT 0`. nullable 아님(undefined가 들어오는 축은 JWT 하나뿐이어야 한다). 인덱스 불필요. 데이터 변환 없음 |
| API 계약 | `{success,data}`/`{success,error}`, 한국어. **role PATCH는 멱등하지 않다** — 같은 role로 두 번 부르면 version이 2 오른다. 의도된 선택이며 최종 상태(role)는 같으므로 재시도가 안전하다 |
| 상태 관리 | `SessionContext`의 `role`은 `/api/auth/me`가 주는 **JWT의 role**이라 강등 후에도 옛 값 → UI에 관리자 메뉴가 남고 누르면 401. §16 열린 질문 |
| 보안 | 인가는 route 진입 직후 한 곳. 테넌트 격리는 `(organizationId=payload.orgId, userId=payload.userId)` 복합 조건 — orgId 위조는 서명 검증이 이미 막는다 |
| 동시성 | `sql\`+1\``이 DB에서 원자적. role 변경과 요청의 경쟁은 최대 1요청만 옛 권한으로 통과 |
| 성능 | 관리자 13곳 **+1쿼리**(unique 인덱스 조회), 일반 route **+0**. role을 함께 읽으므로 users 조회 불필요. N+1 없음 |

## 16. 리스크 / 열린 질문

- **🔴 잔여 리스크 — 데이터 접근은 여전히 지연 반영된다 (PLAN에서 이월).** 강등된 admin이 파티션 판정에서 "전체 허용"으로 최대 30일 남는다(B8). **구현 후 재판단.** 완화 옵션 둘: (1) `TOKEN_EXPIRY`를 30d → 1d로 줄이면 노출 창이 30배 줄고 `getUserFromNextRequest`는 그대로다. (2) `requirePartitionAccess`가 이미 async + DB이므로 거기서 `user.role !== "member"` 분기를 DB role로 바꾸면 데이터 축도 즉시 반영된다(이미 도는 쿼리에 조인). **(2)가 diff 대비 효과가 압도적이라 후속 1순위로 제안.**

- **🟢 UI role 갱신 — 이번 범위에 포함 (결정됨).** `/api/auth/me`가 `organization_members`의 현재 role을 반환하도록 고친다. 이미 그 테이블을 조회 중이라 **추가 쿼리 0**. B11로 고정. 남는 부분(401 응답 시 로그아웃 유도)은 후속.
- **🟡 (원 기록) UI가 옛 role을 계속 보여준다.** `/api/auth/me`가 JWT의 role을 반환하므로(`...user` 스프레드) 강등되면 관리자 메뉴가 남고 누르면 401인데 **클라이언트에 401 처리가 없다**. 사용자는 "저장이 안 된다"만 겪는다. 후속 두 가지: (a) `/api/auth/me`가 `organization_members`에서 role을 다시 읽어 반환 — **이미 그 테이블을 조회 중이라 추가 쿼리 0, 3줄**, (b) 401 시 로그아웃 유도. **(a)를 이번 범위에 넣을지 사용자 판단 필요.**

- **🟡 `auth/profile`의 스프레드 전파 미검증.** `{ ...currentUser, name }`이 `tokenVersion`을 전파한다는 것이 §6-#3의 전제. `iat`/`exp`도 함께 스프레드되는데 현재 동작 중이므로 새 위험은 아니지만 구현 시 재발급 1회로 확인한다.

- **🟢 배포 순서 (결정됨).** 마이그레이션을 **먼저** 적용하고 코드를 배포한다. 컬럼 없이 새 코드가 뜨면 `requireAdmin`의 select가 실패해 관리자 API 전체가 500이 된다. 반대 순서는 무해하다.

- **🟢 롤백 안전성 (결정됨).** 코드만 롤백해도 컬럼이 남을 뿐 옛 코드는 `tokenVersion`을 무시한다. 발급된 토큰의 필드도 옛 `verifyToken`이 무시한다. **양방향 안전.**

- **🟢 `missing` 정책의 수명 (결정됨).** 배포 후 30일이 지나면 `tokenVersion` 없는 토큰은 존재할 수 없다. 그때 `isTokenVersionAcceptable`의 `"missing"`을 `false`로 바꾸는 게 정석이지만 안 바꿔도 위험이 없다. 후속 정리 항목으로만 남기고 알림·배치는 만들지 않는다.
