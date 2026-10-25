// UX-014·016·017 — 직원 세션을 DB의 현재 멤버십·계정 활성·역할로 다시 확인하는지(실제 DB 없음, 가상 db).
import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { installFakeDb, isolateEnv, isMembershipLookup, type FakeCall, type Responder } from "./auth-fake-db.test-helper";

const ORG_A = "00000000-0000-4000-8000-0000000000aa";
const USER = "00000000-0000-4000-8000-000000000001";
const OTHER_USER = "00000000-0000-4000-8000-000000000002";

async function load(t: TestContext) {
    isolateEnv(t);
    const auth = await import("./auth");
    const { db } = await import("./db");
    return { ...auth, db };
}

type Member = { role: string; membershipId: number; tokenVersion: number; isSuperAdmin: number } | null;
/** 멤버십 확인 질의에는 member(없으면 [])를, 나머지는 rest가 답한다. */
const withMember = (member: Member, rest: Responder = () => []): Responder => (call) =>
    isMembershipLookup(call) ? (member ? [member] : []) : rest(call);

function bearer(token: string, url: string, init: { method?: string; body?: unknown } = {}) {
    return new NextRequest(url, {
        method: init.method ?? "GET",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
}

test("resolveActiveUser: 멤버십·계정 활성·토큰 버전·DB 역할", async (t) => {
    const { resolveActiveUser, db } = await load(t);
    const payload = { userId: USER, orgId: ORG_A, email: "a@example.test", name: "가상", role: "admin" as const, membershipId: 71, tokenVersion: 2 };

    await t.test("조직에서 제거됐거나 계정이 비활성이면(질의 결과 없음) null", async (t) => {
        const { calls } = installFakeDb(t, db, withMember(null));
        assert.equal(await resolveActiveUser(payload), null);
        const lookup = calls.find(isMembershipLookup)!;
        // 조직·사용자·is_active=1을 한 질의에서 확인한다
        assert.ok(lookup.params.includes(ORG_A) && lookup.params.includes(USER) && lookup.params.includes(1));
    });

    await t.test("강등되어 token_version이 달라진 옛 토큰은 null", async (t) => {
        installFakeDb(t, db, withMember({ role: "member", membershipId: 71, tokenVersion: 3, isSuperAdmin: 0 }));
        assert.equal(await resolveActiveUser(payload), null);
    });

    await t.test("역할은 토큰이 아니라 DB 값을 쓴다", async (t) => {
        installFakeDb(t, db, withMember({ role: "member", membershipId: 71, tokenVersion: 2, isSuperAdmin: 0 }));
        const user = await resolveActiveUser(payload);
        assert.equal(user?.role, "member");
        assert.equal(user?.isSuperAdmin, undefined);
    });

    await t.test("tokenVersion이 없는 도입 전 토큰은 DB 버전 0일 때만 통과", async (t) => {
        installFakeDb(t, db, withMember({ role: "owner", membershipId: 71, tokenVersion: 0, isSuperAdmin: 0 }));
        const legacy = { ...payload, tokenVersion: undefined };
        assert.equal((await resolveActiveUser(legacy))?.role, "owner");
    });

    await t.test("슈퍼관리자 표시는 DB에서 채운다 — 토큰에서 빠져 있어도 유지, DB가 0이면 토큰 값도 버린다 (UX-017)", async (t) => {
        installFakeDb(t, db, withMember({ role: "admin", membershipId: 71, tokenVersion: 2, isSuperAdmin: 1 }));
        assert.equal((await resolveActiveUser(payload))?.isSuperAdmin, true);
        t.mock.restoreAll();
        installFakeDb(t, db, withMember({ role: "admin", membershipId: 71, tokenVersion: 2, isSuperAdmin: 0 }));
        assert.equal((await resolveActiveUser({ ...payload, isSuperAdmin: true }))?.isSuperAdmin, undefined);
    });

    await t.test("account 범위도 멤버십이 없으면 재발급을 거부한다", async (t) => {
        const { calls } = installFakeDb(t, db, (call) => (call.table === "users" ? [{ isSuperAdmin: 0 }] : []));
        const user = await resolveActiveUser(payload, "account");
        assert.equal(user, null);
        assert.equal(calls.length, 1);
        assert.match(calls[0].sql, /"users"\."is_active"/);
    });

    await t.test("account 범위에서도 비활성 계정은 null", async (t) => {
        installFakeDb(t, db, () => []);
        assert.equal(await resolveActiveUser(payload, "account"), null);
    });
});

test("requireAdmin: 401(토큰 없음·세션 무효)과 403(역할 부족)을 구분한다", async (t) => {
    const { generateToken, db } = await load(t);
    const { requireAdmin } = await import("./auth-admin");
    const token = generateToken({ userId: USER, orgId: ORG_A, email: "a@example.test", name: "가상", role: "admin", membershipId: 71, tokenVersion: 0 });
    const url = "http://localhost/api/org/settings";

    await t.test("토큰 없음", async () => {
        const result = await requireAdmin(new NextRequest(url));
        assert.deepEqual(result, { ok: false, status: 401, error: "인증이 필요합니다." });
    });
    await t.test("제거된 관리자", async (t) => {
        installFakeDb(t, db, withMember(null));
        const result = await requireAdmin(bearer(token, url));
        assert.equal(result.ok, false);
        assert.equal(!result.ok && result.status, 401);
    });
    await t.test("DB에서 member로 강등(토큰 버전은 같음)", async (t) => {
        installFakeDb(t, db, withMember({ role: "member", membershipId: 71, tokenVersion: 0, isSuperAdmin: 0 }));
        const result = await requireAdmin(bearer(token, url));
        assert.equal(!result.ok && result.status, 403);
    });
    await t.test("현재 관리자", async (t) => {
        installFakeDb(t, db, withMember({ role: "admin", membershipId: 71, tokenVersion: 0, isSuperAdmin: 0 }));
        const result = await requireAdmin(bearer(token, url));
        assert.equal(result.ok, true);
    });
});

test("워크스페이스 삭제(파괴 경로): 제거·강등·다른 조직은 삭제하지 않는다 (UX-014)", async (t) => {
    const { generateToken, db } = await load(t);
    const { DELETE } = await import("../app/api/workspaces/[id]/route");
    const token = generateToken({ userId: USER, orgId: ORG_A, email: "a@example.test", name: "가상", role: "admin", membershipId: 71, tokenVersion: 0 });
    const call = () => DELETE(bearer(token, "http://localhost/api/workspaces/7", { method: "DELETE" }), { params: Promise.resolve({ id: "7" }) });
    const deletes = (calls: FakeCall[]) => calls.filter((c) => c.op === "delete");

    await t.test("제거된 사용자는 기존 JWT로도 401", async (t) => {
        const { calls } = installFakeDb(t, db, withMember(null));
        const res = await call();
        assert.equal(res.status, 401);
        assert.equal(deletes(calls).length, 0);
    });
    await t.test("강등된 관리자(DB 역할 member)는 403", async (t) => {
        const { calls } = installFakeDb(t, db, withMember({ role: "member", membershipId: 71, tokenVersion: 0, isSuperAdmin: 0 }));
        const res = await call();
        assert.equal(res.status, 403);
        assert.equal(deletes(calls).length, 0);
    });
    await t.test("다른 조직 워크스페이스 id는 404", async (t) => {
        const { calls } = installFakeDb(t, db, withMember({ role: "admin", membershipId: 71, tokenVersion: 0, isSuperAdmin: 0 }));
        const res = await call();
        assert.equal(res.status, 404);
        assert.equal(deletes(calls).length, 0);
        const lookup = calls.find((c) => c.table === "workspaces")!;
        assert.ok(lookup.params.includes(ORG_A), "워크스페이스 조회가 요청자 조직으로 제한된다");
    });
    await t.test("현재 관리자는 정상 삭제", async (t) => {
        const { calls } = installFakeDb(
            t,
            db,
            withMember({ role: "admin", membershipId: 71, tokenVersion: 0, isSuperAdmin: 0 }, (c) =>
                c.table === "workspaces" && c.op === "select" ? (c.params.includes(7) ? [{ id: 7, orgId: ORG_A }] : [{ count: 2 }]) : [],
            ),
        );
        const res = await call();
        assert.equal(res.status, 200);
        assert.equal(deletes(calls).length, 1);
    });
});

test("일반 조회 API와 /api/auth/me도 제거·비활성 사용자를 401로 돌려보낸다 (UX-014)", async (t) => {
    const { generateToken, db } = await load(t);
    const me = await import("../app/api/auth/me/route");
    const records = await import("../app/api/records/[id]/route");
    const token = generateToken({ userId: USER, orgId: ORG_A, email: "a@example.test", name: "가상", role: "member", membershipId: 71, tokenVersion: 0 });

    await t.test("auth/me", async (t) => {
        installFakeDb(t, db, withMember(null));
        assert.equal((await me.GET(bearer(token, "http://localhost/api/auth/me"))).status, 401);
    });
    await t.test("레코드 상세", async (t) => {
        const { calls } = installFakeDb(t, db, withMember(null));
        const res = await records.GET(bearer(token, "http://localhost/api/records/5"), { params: Promise.resolve({ id: "5" }) });
        assert.equal(res.status, 401);
        assert.equal(calls.filter((c) => c.table === "records").length, 0, "레코드를 읽지 않는다");
    });
    await t.test("정상 멤버의 auth/me는 DB 역할·슈퍼관리자 표시를 돌려준다 (UX-017)", async (t) => {
        installFakeDb(t, db, withMember({ role: "member", membershipId: 71, tokenVersion: 0, isSuperAdmin: 1 }, (c) =>
            c.table === "organizations" ? [{ onboardingCompleted: true }] : c.table === "organization_members" ? [{ organizationId: ORG_A, role: "member", orgName: "A", orgSlug: "a" }] : []));
        const body = await (await me.GET(bearer(token, "http://localhost/api/auth/me"))).json();
        assert.equal(body.success, true);
        assert.equal(body.user.isSuperAdmin, true);
    });
});

test("조직 전환은 DB의 슈퍼관리자 표시를 새 토큰에 이어 담는다 (UX-017)", async (t) => {
    const { generateToken, verifyToken, db } = await load(t);
    const { POST } = await import("../app/api/org/switch/route");
    const ORG_B = "00000000-0000-4000-8000-0000000000bb";
    // 예전 전환으로 토큰에서 isSuperAdmin이 이미 빠진 상태
    const token = generateToken({ userId: USER, orgId: ORG_A, email: "a@example.test", name: "가상", role: "admin", membershipId: 71, tokenVersion: 0 });
    installFakeDb(t, db, (c) => isMembershipLookup(c)
        ? [{ membershipId: c.params.includes(ORG_B) ? 72 : 71, role: "member", tokenVersion: c.params.includes(ORG_B) ? 4 : 0, isSuperAdmin: 1 }]
        : c.table === "organization_members" ? [{ organizationId: ORG_B, role: "member", membershipId: 72, tokenVersion: 4 }] : []);
    const res = await POST(bearer(token, "http://localhost/api/org/switch", { method: "POST", body: { orgId: ORG_B } }));
    assert.equal(res.status, 200);
    const cookie = res.cookies.get("token")?.value ?? "";
    const next = verifyToken(cookie);
    assert.equal(next?.orgId, ORG_B);
    assert.equal(next?.tokenVersion, 4);
    assert.equal(next?.membershipId, 72);
    assert.equal(next?.isSuperAdmin, true);
    assert.equal(res.cookies.get("token")?.httpOnly, true);
});

test("조직 관리자는 소속 수와 관계없이 전역 계정 비활성화를 하지 못한다 (UX-016)", async (t) => {
    const { generateToken, db } = await load(t);
    const { PATCH } = await import("../app/api/users/[id]/route");
    const token = generateToken({ userId: USER, orgId: ORG_A, email: "a@example.test", name: "관리자", role: "owner", membershipId: 71, tokenVersion: 0 });
    const call = () => PATCH(bearer(token, `http://localhost/api/users/${OTHER_USER}`, { method: "PATCH", body: { isActive: 0 } }), { params: Promise.resolve({ id: OTHER_USER }) });
    const target = { id: OTHER_USER, role: "member", isActive: 1 };
    const respond = (otherOrg: boolean): Responder => withMember({ role: "owner", membershipId: 71, tokenVersion: 0, isSuperAdmin: 0 }, (c) => {
        if (c.op !== "select") return [{ id: OTHER_USER, isActive: 0 }];
        if (c.sql.includes("<>")) return otherOrg ? [{ id: 99 }] : [];
        return [target];
    });

    await t.test("다중 조직 → 409, users 갱신 없음", async (t) => {
        const { calls } = installFakeDb(t, db, respond(true));
        const res = await call();
        assert.equal(res.status, 409);
        assert.match((await res.json()).error, /멤버에서 제거/);
        assert.equal(calls.filter((c) => c.op === "update").length, 0);
    });
    await t.test("단일 조직도 → 409, 새 조직 가입과의 경합으로 전역 차단하지 않음", async (t) => {
        const { calls } = installFakeDb(t, db, respond(false));
        const res = await call();
        assert.equal(res.status, 409);
        assert.equal(calls.filter((c) => c.op === "update").length, 0);
    });
});

test("UX-014 알 수 없는 DB 역할은 일반 API 인증에서도 거부한다", async (t) => {
    const { resolveActiveUser, db } = await load(t);
    installFakeDb(t, db, withMember({ role: "", membershipId: 71, tokenVersion: 0, isSuperAdmin: 0 }));
    assert.equal(await resolveActiveUser({ userId: USER, orgId: ORG_A, email: "a@example.test", name: "가상", role: "member", membershipId: 71, tokenVersion: 0 }), null);
});

test("UX-014 빈 역할 저장과 관리자의 관리자 승격 우회는 쓰기 전에 차단한다", async (t) => {
    const { generateToken, db } = await load(t);
    const users = await import("../app/api/users/[id]/route");
    const members = await import("../app/api/org/members/[id]/route");
    const token = generateToken({ userId: USER, orgId: ORG_A, email: "a@example.test", name: "가상", role: "admin", membershipId: 71, tokenVersion: 0 });
    const { calls } = installFakeDb(t, db, withMember({ role: "admin", membershipId: 71, tokenVersion: 0, isSuperAdmin: 0 }, () => [{ id: OTHER_USER, role: "member", isActive: 1 }]));
    assert.equal((await users.PATCH(bearer(token, "http://localhost/api/users/other", { method: "PATCH", body: { role: "" } }), { params: Promise.resolve({ id: OTHER_USER }) })).status, 400);
    assert.equal((await members.PATCH(bearer(token, "http://localhost/api/org/members/other", { method: "PATCH", body: { role: "admin" } }), { params: Promise.resolve({ id: OTHER_USER }) })).status, 403);
    assert.equal(calls.filter((c) => c.op !== "select").length, 0);
});

test("UX-015 직접 생성 이메일은 정규화하고 계정·멤버십을 같은 트랜잭션에서 만든다", async (t) => {
    const { generateToken, db, verifyPassword } = await load(t);
    const { POST } = await import("../app/api/users/route");
    const token = generateToken({ userId: USER, orgId: ORG_A, email: "a@example.test", name: "가상", role: "owner", membershipId: 71, tokenVersion: 0 });
    const { calls } = installFakeDb(t, db, withMember({ role: "owner", membershipId: 71, tokenVersion: 0, isSuperAdmin: 0 }, (c) =>
        c.op === "insert" && c.table === "users" ? [{ id: OTHER_USER, email: "kim@example.test", name: "김", role: "member" }] : []));
    const res = await POST(bearer(token, "http://localhost/api/users", { method: "POST", body: { name: " 김 ", email: "Kim@Example.test ", password: "fake-password" } }));
    assert.equal(res.status, 201);
    const account = calls.find((c) => c.table === "users" && c.op === "insert")?.values as { email: string; password: string; name: string };
    assert.equal(account.email, "kim@example.test");
    assert.equal(account.name, "김");
    assert.equal(await verifyPassword("fake-password", account.password), true);
    assert.deepEqual(calls.filter((c) => c.op === "insert").map((c) => c.table), ["users", "organization_members"]);
    assert.equal((db.transaction as unknown as { mock: { callCount(): number } }).mock.callCount(), 1);
});

test("UX-015 다른 조직의 같은 이메일도 초대 안내 409, 계정 생성 없음", async (t) => {
    const { generateToken, db } = await load(t);
    const { POST } = await import("../app/api/users/route");
    const token = generateToken({ userId: USER, orgId: ORG_A, email: "a@example.test", name: "가상", role: "owner", membershipId: 71, tokenVersion: 0 });
    const { calls } = installFakeDb(t, db, withMember({ role: "owner", membershipId: 71, tokenVersion: 0, isSuperAdmin: 0 }, (c) =>
        c.table === "users" ? [{ id: OTHER_USER }] : []));
    const res = await POST(bearer(token, "http://localhost/api/users", { method: "POST", body: { name: "김", email: "Kim@Example.test ", password: "fake-password" } }));
    assert.equal(res.status, 409);
    assert.match((await res.json()).error, /초대/);
    const lookup = calls.find((c) => c.table === "users")!;
    assert.ok(lookup.params.includes("kim@example.test"));
    assert.equal(lookup.joins.length, 0);
    assert.equal(calls.filter((c) => c.op === "insert").length, 0);
});

test("UX-014 제거 → 재초대가 버전 0이어도 이전 JWT는 조직·계정·고객 권한으로 부활하지 않는다", async (t) => {
    const { generateToken, verifyToken, resolveActiveUser, setSessionCookie, db } = await load(t);
    const { NextResponse } = await import("next/server");
    const { activeCustomerActor } = await import("./customer-access/access");
    const switchRoute = await import("../app/api/org/switch/route");
    const profile = await import("../app/api/auth/profile/route");
    const payload = { userId: USER, orgId: ORG_A, email: "a@example.test", name: "가상", role: "admin" as const, membershipId: 71, tokenVersion: 0 };
    const oldToken = generateToken(payload);
    let current: Member = { membershipId: 71, role: "admin", tokenVersion: 0, isSuperAdmin: 0 };
    const { calls } = installFakeDb(t, db, (c) => isMembershipLookup(c) && current ? [current] : []);
    assert.ok(await resolveActiveUser(payload));
    current = null; // DELETE organization_members
    assert.equal(await resolveActiveUser(payload), null);
    current = { membershipId: 72, role: "admin", tokenVersion: 0, isSuperAdmin: 0 }; // 재초대 INSERT, 새 PK
    assert.equal(await resolveActiveUser(payload), null);
    assert.equal(await resolveActiveUser(payload, "account"), null);
    await assert.rejects(activeCustomerActor(payload), /세션이 만료/);
    assert.equal((await switchRoute.POST(bearer(oldToken, "http://localhost/api/org/switch", { method: "POST", body: { orgId: ORG_A } }))).status, 401);
    assert.equal((await profile.PATCH(bearer(oldToken, "http://localhost/api/auth/profile", { method: "PATCH", body: { name: "새 이름" } }))).status, 401);
    assert.equal(calls.filter((c) => c.op !== "select").length, 0);
    // 새 로그인/초대 수락은 공통 발급기에서 현재 실제 ID를 읽는다.
    const response = NextResponse.json({ success: true });
    await assert.rejects(setSessionCookie(response, payload), /멤버십이 변경/);
    assert.equal(response.cookies.get("token"), undefined, "프로필 인증과 발급 사이 재초대돼도 예전 세션을 갱신하지 않는다");
    await setSessionCookie(response, { ...payload, membershipId: undefined });
    const next = verifyToken(response.cookies.get("token")!.value)!;
    assert.equal(next.membershipId, 72);
    assert.ok(await resolveActiveUser(next));
    assert.ok(await resolveActiveUser(next, "account"));
    assert.equal((await activeCustomerActor(next)).role, "admin");
    const legacy = generateToken({ ...payload, membershipId: undefined });
    assert.equal(verifyToken(legacy), null, "ID 없는 이전 토큰은 구분할 근거가 없어 한 번 재로그인");
    assert.equal(await resolveActiveUser({ ...payload, membershipId: undefined }), null);
});

test("UX-014 관리자는 관리자 초대를 발급하거나 발송할 수 없다", async (t) => {
    const { generateToken, db } = await load(t);
    const { POST } = await import("../app/api/org/invitations/route");
    const token = generateToken({ userId: USER, orgId: ORG_A, email: "a@example.test", name: "가상", role: "admin", membershipId: 71, tokenVersion: 0 });
    const { calls } = installFakeDb(t, db, withMember({ role: "admin", membershipId: 71, tokenVersion: 0, isSuperAdmin: 0 }));
    t.mock.method(globalThis, "fetch", () => { throw new Error("외부 발송 금지"); });
    assert.equal((await POST(bearer(token, "http://localhost/api/org/invitations", { method: "POST", body: { email: "new@example.test", role: "admin" } }))).status, 403);
    assert.equal(calls.filter((c) => c.op !== "select").length, 0);
});
