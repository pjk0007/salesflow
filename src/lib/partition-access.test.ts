import { test } from "node:test";
import assert from "node:assert";
import {
    canAccessPartition,
    canCreateInWorkspace,
    scopeCoversPartition,
    filterAccessiblePartitions,
    type ScopeLike,
    type ScopePermissions,
    type PartitionLocation,
    type Permission,
} from "./partition-access-rules";

const ALICE = { userId: "u-alice", role: "member" as const };
const ADMIN = { userId: "u-admin", role: "admin" as const };
const OWNER = { userId: "u-owner", role: "owner" as const };

// P1: ws=1, folder=10 / P2: ws=1, folder 없음 / P3: ws=2, folder=20
const P1: PartitionLocation = { id: 101, folderId: 10, workspaceId: 1 };
const P2: PartitionLocation = { id: 102, folderId: null, workspaceId: 1 };
const P3: PartitionLocation = { id: 103, folderId: 20, workspaceId: 2 };

const RO: ScopePermissions = { read: true, create: false, update: false, delete: false };
const RC: ScopePermissions = { read: true, create: true, update: false, delete: false };
const NONE: ScopePermissions = { read: false, create: false, update: false, delete: false };

const scope = (
    userId: string,
    scopeType: string,
    scopeId: number,
    permissions: ScopePermissions = RO
): ScopeLike => ({ userId, scopeType, scopeId, permissions });

const can = (
    user: { userId: string; role: "owner" | "admin" | "member" },
    partition: PartitionLocation,
    permission: Permission,
    orgScopes: ScopeLike[]
) => canAccessPartition({ user, partition, permission, orgScopes });

// ── B1: allow 기본 ──

test("scope가 하나도 없으면 member도 통과한다 (allow 기본)", () => {
    assert.equal(can(ALICE, P1, "read", []), true);
});

test("다른 파티션에만 scope가 걸려 있으면 이 파티션은 여전히 통과한다", () => {
    // 파티션 하나에 권한을 걸어도 나머지는 제한 모드로 넘어가지 않는다
    assert.equal(can(ALICE, P1, "read", [scope("u-bob", "partition", 102)]), true);
});

// ── B2: 권한 부여는 남의 접근을 빼앗지 않는다 ──

test("타인이 이 파티션 권한을 받아도 나머지 member는 그대로 접근한다 (B2)", () => {
    // 체크 = 부여이지 잠금이 아니다. 예전에는 여기서 false가 나와
    // "한 명에게 주면 나머지가 막히는" 혼란을 낳았다.
    assert.equal(can(ALICE, P1, "read", [scope("u-bob", "partition", 101)]), true);
});

test("타인의 workspace scope도 다른 member의 접근을 막지 않는다 (B2)", () => {
    assert.equal(can(ALICE, P1, "read", [scope("u-bob", "workspace", 1)]), true);
});

// ── B3: 권한 보유자 통과 ──

test("자기 partition scope가 있으면 통과한다", () => {
    assert.equal(can(ALICE, P1, "read", [scope("u-alice", "partition", 101)]), true);
});

test("제한된 파티션에 나와 타인 scope가 함께 있어도 나는 통과한다", () => {
    const scopes = [scope("u-alice", "partition", 101), scope("u-bob", "partition", 101)];
    assert.equal(can(ALICE, P1, "read", scopes), true);
});

// ── B4: permission 비트 분리 ──

test("데이터 접근에서는 비트와 무관하게 통과한다 — member의 기본 능력이다 (B4)", () => {
    // permission 비트는 denyByDefault 경로(구조 변경)에서만 의미를 갖는다
    assert.equal(can(ALICE, P1, "create", [scope("u-alice", "partition", 101, RO)]), true);
    assert.equal(can(ALICE, P1, "read", [scope("u-alice", "partition", 101, NONE)]), true);
});

test("구조 변경에서는 비트가 정확히 대조된다 (B4)", () => {
    const deny = (perm: Permission, perms: ScopePermissions) =>
        canAccessPartition({
            user: ALICE,
            partition: P1,
            permission: perm,
            orgScopes: [scope("u-alice", "partition", 101, perms)],
            denyByDefault: true,
        });
    assert.equal(deny("update", RO), false);   // read만 있으면 수정 불가
    assert.equal(deny("create", RC), true);    // create 비트가 있으면 통과
    assert.equal(deny("read", NONE), false);   // 전부 꺼진 scope는 아무것도 못 한다
});

// ── B5: 관리자 우회 ──

test("admin은 자기 scope가 없어도 통과한다", () => {
    assert.equal(can(ADMIN, P1, "delete", [scope("u-bob", "partition", 101)]), true);
});

test("owner는 scope가 전부 타인 것이어도 통과한다", () => {
    assert.equal(can(OWNER, P1, "delete", [scope("u-bob", "org", 0)]), true);
});

// ── B6: workspace 상속 ──

test("workspace scope는 하위 모든 파티션을 덮는다 (B6)", () => {
    // 상속은 denyByDefault 경로에서 관측된다 — 데이터 접근은 어차피 전원 통과라 구분이 안 된다
    const scopes = [scope("u-alice", "workspace", 1, RC)];
    const deny = (p: PartitionLocation) =>
        canAccessPartition({ user: ALICE, partition: p, permission: "create", orgScopes: scopes, denyByDefault: true });
    assert.equal(deny(P1), true);
    assert.equal(deny(P2), true);
    assert.equal(deny(P3), false); // 다른 워크스페이스는 안 덮는다
});

test("데이터 접근은 scope 유무·소유자와 무관하게 통과한다", () => {
    assert.equal(can(ALICE, P3, "read", [scope("u-alice", "workspace", 1)]), true);
    assert.equal(can(ALICE, P3, "read", [scope("u-bob", "workspace", 1)]), true);
});

// ── B7: folder 상속 ──

test("folder scope는 그 폴더 하위 파티션을 덮는다 (B7)", () => {
    const deny = (p: PartitionLocation, owner = "u-alice") =>
        canAccessPartition({
            user: ALICE, partition: p, permission: "create",
            orgScopes: [scope(owner, "folder", 10, RC)], denyByDefault: true,
        });
    assert.equal(deny(P1), true);
    assert.equal(deny(P2), false);  // 미분류 파티션은 폴더 권한에 묶이지 않는다
    assert.equal(deny(P3), false);  // 다른 폴더
    assert.equal(deny(P1, "u-bob"), false); // 타인의 scope는 나에게 권한을 주지 않는다
});

// ── org scope / 미지의 scopeType ──

test("org scope는 조직 내 모든 파티션을 덮는다", () => {
    const deny = (owner: string) =>
        canAccessPartition({
            user: ALICE, partition: P3, permission: "create",
            orgScopes: [scope(owner, "org", 0, RC)], denyByDefault: true,
        });
    assert.equal(deny("u-alice"), true);
    assert.equal(deny("u-bob"), false); // 타인 것은 나에게 적용되지 않는다
});

test("알 수 없는 scopeType은 아무 파티션도 덮지 않는다", () => {
    assert.equal(
        canAccessPartition({
            user: ALICE, partition: P1, permission: "create",
            orgScopes: [scope("u-alice", "universe", 1, RC)], denyByDefault: true,
        }),
        false
    );
});

// ── scopeCoversPartition 직접 ──

test("scopeCoversPartition은 계층 규칙을 단독으로 판정한다", () => {
    assert.equal(scopeCoversPartition(scope("u-a", "org", 0), P1), true);
    assert.equal(scopeCoversPartition(scope("u-a", "workspace", 1), P1), true);
    assert.equal(scopeCoversPartition(scope("u-a", "workspace", 2), P1), false);
    assert.equal(scopeCoversPartition(scope("u-a", "folder", 10), P1), true);
    assert.equal(scopeCoversPartition(scope("u-a", "folder", 10), P2), false);
    assert.equal(scopeCoversPartition(scope("u-a", "partition", 101), P1), true);
    assert.equal(scopeCoversPartition(scope("u-a", "partition", 999), P1), false);
});

test("scopeId가 0인 folder scope가 folderId null과 맞물리지 않는다", () => {
    assert.equal(scopeCoversPartition(scope("u-a", "folder", 0), P2), false);
});

// ── B11: 목록 필터 ──

test("목록은 타인 권한 때문에 줄어들지 않는다 (B11)", () => {
    // 예전에는 [P3]만 남아 "한 명에게 권한을 주면 나머지 목록이 사라지는" 문제가 있었다
    const result = filterAccessiblePartitions({
        user: ALICE,
        partitions: [P1, P2, P3],
        permission: "read",
        orgScopes: [scope("u-bob", "workspace", 1)],
    });
    assert.deepEqual(result, [P1, P2, P3]);
});

test("admin에게는 목록이 그대로 유지된다", () => {
    const result = filterAccessiblePartitions({
        user: ADMIN,
        partitions: [P1, P2, P3],
        permission: "read",
        orgScopes: [scope("u-bob", "org", 0)],
    });
    assert.deepEqual(result, [P1, P2, P3]);
});

// ── B16~B20: 워크스페이스 안에 구조(파티션·폴더)를 만들 권한 ──
// 데이터 접근과 달리 allow 기본이 아니다 — 명시적으로 받은 사람만 만들 수 있다.

const canCreate = (
    user: { userId: string; role: "owner" | "admin" | "member" },
    workspaceId: number,
    orgScopes: ScopeLike[]
) => canCreateInWorkspace({ user, workspaceId, orgScopes });

test("workspace scope의 create 비트가 있으면 파티션을 만들 수 있다 (B16)", () => {
    assert.equal(canCreate(ALICE, 1, [scope("u-alice", "workspace", 1, RC)]), true);
});

test("workspace scope가 있어도 create 비트가 없으면 거부된다 (B17)", () => {
    assert.equal(canCreate(ALICE, 1, [scope("u-alice", "workspace", 1, RO)]), false);
});

test("다른 워크스페이스의 create 권한으로는 만들 수 없다 (B17)", () => {
    assert.equal(canCreate(ALICE, 2, [scope("u-alice", "workspace", 1, RC)]), false);
});

test("scope가 하나도 없으면 member는 만들 수 없다 — 구조 변경은 allow 기본이 아니다 (B20)", () => {
    // 데이터 접근(canAccessPartition)과 갈리는 지점. 여기서 통과시키면
    // 권한을 안 받은 member 전원이 파티션을 만들 수 있게 된다.
    assert.equal(canCreate(ALICE, 1, []), false);
});

test("타인이 그 워크스페이스 create를 가져도 나는 만들 수 없다 (B20)", () => {
    assert.equal(canCreate(ALICE, 1, [scope("u-bob", "workspace", 1, RC)]), false);
});

test("owner/admin은 scope 없이도 만들 수 있다 (B16)", () => {
    assert.equal(canCreate(ADMIN, 1, []), true);
    assert.equal(canCreate(OWNER, 99, []), true);
});

test("org scope의 create는 모든 워크스페이스에 적용된다 (B16)", () => {
    assert.equal(canCreate(ALICE, 7, [scope("u-alice", "org", 0, RC)]), true);
});

test("partition/folder scope로는 새 파티션을 만들 수 없다 (B17)", () => {
    // 파티션 하나에 대한 권한이 워크스페이스에 무언가를 추가할 권한은 아니다
    assert.equal(canCreate(ALICE, 1, [scope("u-alice", "partition", 101, RC)]), false);
    assert.equal(canCreate(ALICE, 1, [scope("u-alice", "folder", 10, RC)]), false);
});

// ── B21: 구조 변경(수정·삭제)은 allow 기본의 대상이 아니다 ──

test("권한이 하나도 없어도 구조 변경은 통과시키지 않는다 (B21)", () => {
    // 데이터 접근은 통과하지만
    assert.equal(can(ALICE, P1, "delete", []), true);
    // 구조 변경은 막힌다 — 아무도 권한을 안 걸었다고 누구나 지워도 되는 건 아니다
    assert.equal(
        canAccessPartition({
            user: ALICE,
            partition: P1,
            permission: "delete",
            orgScopes: [],
            denyByDefault: true,
        }),
        false
    );
});

test("denyByDefault여도 자기 scope가 있으면 통과한다 (B21)", () => {
    assert.equal(
        canAccessPartition({
            user: ALICE,
            partition: P1,
            permission: "delete",
            orgScopes: [scope("u-alice", "partition", 101, { read: true, create: true, update: true, delete: true })],
            denyByDefault: true,
        }),
        true
    );
});

test("denyByDefault여도 admin은 통과한다 (B21)", () => {
    assert.equal(
        canAccessPartition({
            user: ADMIN,
            partition: P1,
            permission: "delete",
            orgScopes: [],
            denyByDefault: true,
        }),
        true
    );
});
