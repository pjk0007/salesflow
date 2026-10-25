// 실제 DB·마이그레이션·발송 없이 공개 초대 재인증과 세션 회복을 실행한다.
import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { installFakeDb, isolateEnv, isMembershipLookup } from "./auth-fake-db.test-helper";

const ORG = "00000000-0000-4000-8000-0000000000aa";
const USER = "00000000-0000-4000-8000-000000000001";
const EMAIL = "returned@example.test";
const PASSWORD = "fixture-password";
async function fixture(t: TestContext, options: { expired?: boolean; inactive?: boolean } = {}) {
    isolateEnv(t);
    const auth = await import("./auth");
    const { db } = await import("./db");
    const accept = await import("../app/api/org/invitations/accept/route");
    const login = await import("../app/api/auth/login/route");
    const account = { id: USER, orgId: ORG, email: EMAIL, name: "복귀 직원", password: await auth.hashPassword(PASSWORD), isActive: options.inactive ? 0 : 1, isSuperAdmin: 0 };
    let invite = { id: 10, orgId: ORG, token: "valid-invitation", status: "pending", email: EMAIL, role: "member", expiresAt: new Date(Date.now() + (options.expired ? -60000 : 60000)) };
    let membership: { id: number; organizationId: string; userId: string; role: string; tokenVersion: number } | null = null;
    const { calls } = installFakeDb(t, db, (c) => {
        if (isMembershipLookup(c)) return membership && account.isActive === 1 ? [{ ...membership, membershipId: membership.id, isSuperAdmin: 0 }] : [];
        if (c.table === "organization_invitations") {
            if (c.op === "select") return c.params.includes(invite.token) && invite.status === "pending" && invite.expiresAt > new Date() ? [invite] : [];
            if (c.op === "update") { invite = { ...invite, ...c.set as object }; return []; }
        }
        if (c.table === "users" && c.op === "select") return c.params.includes(EMAIL) ? [account] : [];
        if (c.table === "organization_members") {
            if (c.op === "select") return membership ? [membership] : [];
            if (c.op === "insert") {
                assert.equal(membership, null, "멤버십 중복 생성 금지");
                membership = { id: 72, tokenVersion: 0, ...c.values as { organizationId: string; userId: string; role: string } };
                return [membership];
            }
        }
        return [];
    });
    // DB 행 잠금의 요청 직렬화를 모사한다. 실제 PostgreSQL 잠금 검증은 별도이다.
    let tail = Promise.resolve();
    t.mock.method(db, "transaction", (fn: (tx: typeof db) => Promise<unknown>) => {
        const operation = tail.then(async () => {
            const before = structuredClone({ invite, membership });
            try { return await fn(db); } catch (error) { invite = before.invite; membership = before.membership; throw error; }
        });
        tail = operation.then(() => {}, () => {});
        return operation;
    });
    t.mock.method(globalThis, "fetch", () => { throw new Error("외부 호출 금지"); });
    const request = (url: string, body: unknown) => new NextRequest("http://localhost" + url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    return {
        ...auth, calls,
        accept: (overrides: Record<string, unknown> = {}) => accept.POST(request("/api/org/invitations/accept", { token: invite.token, email: EMAIL, password: PASSWORD, ...overrides })),
        login: () => login.POST(request("/api/auth/login", { email: EMAIL, password: PASSWORD })),
    };
}

test("UX-014 마지막 소속 제거 계정은 유효 재초대와 기존 비밀번호로 참여하고 다시 로그인한다", async (t) => {
    const f = await fixture(t);
    assert.equal((await f.login()).status, 403, "소속 없는 일반 로그인은 세션을 발급하지 않는다");
    const old = { userId: USER, orgId: ORG, email: EMAIL, name: "복귀 직원", role: "member" as const, membershipId: 71, tokenVersion: 0 };
    const response = await f.accept();
    assert.equal(response.status, 200);
    const next = f.verifyToken(response.cookies.get("token")!.value)!;
    assert.equal(next.membershipId, 72);
    assert.equal(next.userId, USER, "새 계정을 만들지 않는다");
    assert.ok(await f.resolveActiveUser(next));
    assert.ok(await f.resolveActiveUser(next, "account"));
    assert.equal(await f.resolveActiveUser(old), null, "예전 JWT는 재초대 후에도 거부");
    const loggedIn = await f.login();
    assert.equal(loggedIn.status, 200);
    assert.equal(f.verifyToken(loggedIn.cookies.get("token")!.value)?.membershipId, 72);
    assert.equal(f.calls.filter((c) => c.op === "insert" && c.table === "users").length, 0);
});

test("UX-014 재초대는 잘못된 비밀번호·타인 이메일·만료/없는 초대·비활성 계정을 거부한다", async (t) => {
    for (const entry of [
        { name: "잘못된 비밀번호", options: {}, body: { password: "wrong-password" }, status: 401 },
        { name: "타인 이메일", options: {}, body: { email: "other@example.test" }, status: 403 },
        { name: "없는 초대", options: {}, body: { token: "wrong-token" }, status: 400 },
        { name: "만료 초대", options: { expired: true }, body: {}, status: 400 },
        { name: "전역 비활성 계정", options: { inactive: true }, body: {}, status: 403 },
    ]) await t.test(entry.name, async (t) => {
        const f = await fixture(t, entry.options);
        const response = await f.accept(entry.body);
        assert.equal(response.status, entry.status);
        assert.equal(response.cookies.get("token"), undefined);
        assert.equal(f.calls.filter((c) => c.op !== "select").length, 0);
    });
});

test("UX-014 같은 초대의 동시 비밀번호 수락은 멤버십을 한 번만 만든다", async (t) => {
    const f = await fixture(t);
    const responses = await Promise.all([f.accept(), f.accept()]);
    assert.deepEqual(responses.map((r: Response) => r.status).sort(), [200, 400]);
    assert.equal(f.calls.filter((c) => c.table === "organization_members" && c.op === "insert").length, 1);
    assert.equal(f.calls.filter((c) => c.table === "organization_invitations" && c.op === "update").length, 1);
});

test("UX-014 신규 초대 가입도 계정·멤버십·수락을 원자적으로 만들고 현재 ID를 발급한다", async (t) => {
    isolateEnv(t);
    const auth = await import("./auth");
    const { db } = await import("./db");
    const { POST } = await import("../app/api/org/invitations/accept/route");
    const { calls } = installFakeDb(t, db, (c) => {
        if (isMembershipLookup(c)) return [{ membershipId: 72, role: "member", tokenVersion: 0, isSuperAdmin: 0 }];
        if (c.table === "organization_invitations" && c.op === "select") return [{ id: 10, orgId: ORG, email: EMAIL, role: "member" }];
        if (c.table === "users" && c.op === "insert") return [{ id: USER, email: EMAIL, name: "새 직원", role: "member", isSuperAdmin: 0 }];
        if (c.table === "organization_members" && c.op === "insert") return [{ id: 72, role: "member", tokenVersion: 0 }];
        return [];
    });
    const response = await POST(new NextRequest("http://localhost/api/org/invitations/accept", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: "valid", email: EMAIL, name: "새 직원", password: PASSWORD }) }));
    assert.equal(response.status, 200);
    assert.equal(auth.verifyToken(response.cookies.get("token")!.value)?.membershipId, 72);
    assert.deepEqual(calls.filter((c) => c.op !== "select").map((c) => [c.op, c.table]), [["insert", "users"], ["insert", "organization_members"], ["update", "organization_invitations"]]);
    assert.equal((db.transaction as unknown as { mock: { callCount(): number } }).mock.callCount(), 1);
});

test("UX-014 로그인 상태의 초대 수락도 대상 멤버십 ID로 전환한다", async (t) => {
    isolateEnv(t);
    const auth = await import("./auth");
    const { db } = await import("./db");
    const { POST } = await import("../app/api/org/invite-accept/route");
    const otherOrg = "00000000-0000-4000-8000-0000000000bb";
    installFakeDb(t, db, (c) => {
        if (isMembershipLookup(c)) return [{ membershipId: c.params.includes(otherOrg) ? 72 : 71, role: "member", tokenVersion: 0, isSuperAdmin: 0 }];
        if (c.table === "organization_invitations" && c.op === "select") return [{ id: 10, orgId: otherOrg, email: EMAIL, role: "member" }];
        if (c.table === "organization_members" && c.op === "insert") return [{ id: 72, role: "member", tokenVersion: 0 }];
        return [];
    });
    const token = auth.generateToken({ userId: USER, orgId: ORG, email: EMAIL, name: "직원", role: "member", membershipId: 71, tokenVersion: 0 });
    const response = await POST(new NextRequest("http://localhost/api/org/invite-accept", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify({ token: "valid" }) }));
    assert.equal(response.status, 200);
    assert.equal(auth.verifyToken(response.cookies.get("token")!.value)?.membershipId, 72);
    assert.equal(auth.verifyToken(response.cookies.get("token")!.value)?.orgId, otherOrg);
});
