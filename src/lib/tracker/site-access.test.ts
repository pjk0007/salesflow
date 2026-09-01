import { test } from "node:test";
import assert from "node:assert";
import {
    resolveScopeWorkspaces,
    scopeAllowsWorkspace,
    filterAccessibleSites,
    type TokenScopeLike,
    type ScopeWorkspaceLookup,
} from "./site-access-rules";
import type { ScopePermissions } from "@/lib/partition-access-rules";

const RW: ScopePermissions = { read: true, create: false, update: false, delete: false };
const NORW: ScopePermissions = { read: false, create: false, update: false, delete: false };

// folder 7 → workspace 3, partition 100 → workspace 5
const LOOKUP: ScopeWorkspaceLookup = {
    folderWorkspaceId: new Map([[7, 3]]),
    partitionWorkspaceId: new Map([[100, 5]]),
};

const scope = (scopeType: string, scopeId: number, permissions: ScopePermissions = RW): TokenScopeLike => ({
    scopeType,
    scopeId,
    permissions,
});

const ids = (r: ReturnType<typeof resolveScopeWorkspaces>) =>
    r.kind === "some" ? [...r.ids].sort((a, b) => a - b) : "all";

// ── resolveScopeWorkspaces — B13 ──

test("org 스코프는 조직 전체를 연다 (B13)", () => {
    assert.deepEqual(resolveScopeWorkspaces([scope("org", 0)], LOOKUP), { kind: "all" });
});

test("workspace 스코프는 그 워크스페이스만 연다 (B13)", () => {
    assert.deepEqual(ids(resolveScopeWorkspaces([scope("workspace", 3)], LOOKUP)), [3]);
});

test("folder 스코프는 상위 워크스페이스로 올라간다 (B13)", () => {
    assert.deepEqual(ids(resolveScopeWorkspaces([scope("folder", 7)], LOOKUP)), [3]);
});

test("partition 스코프도 상위 워크스페이스로 올라간다 (B13)", () => {
    assert.deepEqual(ids(resolveScopeWorkspaces([scope("partition", 100)], LOOKUP)), [5]);
});

test("여러 스코프의 워크스페이스가 합쳐진다", () => {
    const r = resolveScopeWorkspaces([scope("workspace", 3), scope("partition", 100)], LOOKUP);
    assert.deepEqual(ids(r), [3, 5]);
});

test("org가 하나라도 있으면 나머지와 무관하게 전체다", () => {
    assert.deepEqual(resolveScopeWorkspaces([scope("workspace", 3), scope("org", 0)], LOOKUP), {
        kind: "all",
    });
});

test("read 권한 없는 org 스코프는 전체를 열지 않는다", () => {
    // 권한 비트 검사가 scopeType 분기보다 먼저여야 한다
    assert.deepEqual(ids(resolveScopeWorkspaces([scope("org", 0, NORW)], LOOKUP)), []);
});

test("read 권한 없는 workspace 스코프는 무시된다", () => {
    assert.deepEqual(ids(resolveScopeWorkspaces([scope("workspace", 3, NORW)], LOOKUP)), []);
});

test("스코프가 없으면 아무것도 열지 않는다", () => {
    assert.deepEqual(ids(resolveScopeWorkspaces([], LOOKUP)), []);
});

test("lookup에 없는 folder 스코프는 조용히 버려진다", () => {
    // 폴더가 삭제된 경우. 예외를 던지면 MCP 전체가 500이 되고,
    // 전체를 열면 격리가 깨진다 — 버리는 게 유일하게 안전하다
    assert.deepEqual(ids(resolveScopeWorkspaces([scope("folder", 999)], LOOKUP)), []);
});

test("lookup에 없는 partition 스코프도 버려진다", () => {
    assert.deepEqual(ids(resolveScopeWorkspaces([scope("partition", 999)], LOOKUP)), []);
});

test("알 수 없는 scopeType은 무시된다 (fail-closed)", () => {
    assert.deepEqual(ids(resolveScopeWorkspaces([scope("site", 1)], LOOKUP)), []);
});

test("같은 워크스페이스를 가리키는 중복 스코프는 한 번만 센다", () => {
    // workspace 3 과 folder 7(→3)이 같은 곳을 가리킨다
    const r = resolveScopeWorkspaces([scope("workspace", 3), scope("folder", 7)], LOOKUP);
    assert.deepEqual(ids(r), [3]);
});

test("권한 종류를 바꾸면 판정도 바뀐다", () => {
    // read만 있는 스코프로 create를 물으면 안 열린다
    assert.deepEqual(ids(resolveScopeWorkspaces([scope("org", 0, RW)], LOOKUP, "create")), []);
});

// ── scopeAllowsWorkspace / filterAccessibleSites ──

test("전체 범위는 어떤 워크스페이스든 통과시킨다", () => {
    assert.equal(scopeAllowsWorkspace({ kind: "all" }, 999), true);
});

test("목록에 있는 워크스페이스는 통과한다", () => {
    assert.equal(scopeAllowsWorkspace({ kind: "some", ids: new Set([3, 5]) }, 3), true);
});

test("목록에 없는 워크스페이스는 거부한다", () => {
    assert.equal(scopeAllowsWorkspace({ kind: "some", ids: new Set([3, 5]) }, 4), false);
});

test("빈 목록은 전체가 아니라 아무것도 아니다", () => {
    // null로 "전체"를 표현했다면 빈 배열과 뭉개져 여기서 true가 났을 것이다
    assert.equal(scopeAllowsWorkspace({ kind: "some", ids: new Set() }, 3), false);
});

const SITES = [
    { id: 1, workspaceId: 1 },
    { id: 2, workspaceId: 2 },
    { id: 3, workspaceId: 3 },
];

test("전체 범위면 사이트 목록이 그대로 남는다 (B1)", () => {
    assert.equal(filterAccessibleSites(SITES, { kind: "all" }).length, 3);
});

test("범위 밖 사이트는 목록에서 빠진다 (B1)", () => {
    const r = filterAccessibleSites(SITES, { kind: "some", ids: new Set([2]) });
    assert.deepEqual(r.map((s) => s.id), [2]);
});

test("빈 범위는 빈 목록을 낸다 (B1)", () => {
    assert.equal(filterAccessibleSites(SITES, { kind: "some", ids: new Set() }).length, 0);
});
