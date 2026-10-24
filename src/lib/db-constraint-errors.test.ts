// UX-033·035·034·013·005 — DB 제약 오류(23505·23503)를 '서버 오류' 대신 한국어 안내로 돌려주는지, 생성은 원자적인지.
// 실제 DB 없음: 가상 db가 drizzle처럼 원래 오류를 cause에 담은 예외를 던진다.
import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { installFakeDb, isolateEnv, isMembershipLookup, type FakeCall, type Responder } from "./auth-fake-db.test-helper";
import { isForeignKeyViolation, isUniqueViolation } from "./db/errors";

const ORG_A = "00000000-0000-4000-8000-0000000000aa";
const ORG_B = "00000000-0000-4000-8000-0000000000bb";
const USER = "00000000-0000-4000-8000-000000000001";

/** drizzle은 pg 오류를 cause에 담아 "Failed query: ..."로 다시 던진다 */
const pgError = (code: string) => new Error("Failed query: insert ...\nparams: x", { cause: Object.assign(new Error(`pg ${code}`), { code }) });

async function load(t: TestContext) {
    isolateEnv(t);
    const auth = await import("./auth");
    const { db } = await import("./db");
    return { ...auth, db };
}
const member = (role: string): Responder => (c) => (isMembershipLookup(c) ? [{ role, tokenVersion: 0, isSuperAdmin: 0 }] : undefined);
const chain = (...responders: Responder[]): Responder => (call) => {
    for (const r of responders) {
        const result = r(call);
        if (result !== undefined) return result;
    }
    return [];
};
const transactionCount = (db: object) => (db as { transaction: { mock: { callCount(): number } } }).transaction.mock.callCount();
function bearer(token: string, url: string, method = "GET", body?: unknown) {
    return new NextRequest(url, { method, headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
}

test("SQLSTATE 판별은 drizzle의 cause까지 본다", () => {
    assert.equal(isUniqueViolation(pgError("23505")), true);
    assert.equal(isForeignKeyViolation(pgError("23503")), true);
    assert.equal(isUniqueViolation(pgError("23503")), false);
    assert.equal(isForeignKeyViolation(Object.assign(new Error("x"), { code: "23503" })), true);
    assert.equal(isForeignKeyViolation(new Error("violates foreign key constraint")), false, "문구가 아니라 코드로만 판별");
    assert.equal(isUniqueViolation(null), false);
});

test("속성 추가: 같은 key는 409 '이미 존재하는 key', 다른 오류는 500 (UX-033)", async (t) => {
    const { generateToken, db } = await load(t);
    const { POST } = await import("../app/api/workspaces/[id]/fields/route");
    const token = generateToken({ userId: USER, orgId: ORG_A, email: "a@example.test", name: "가상", role: "admin", tokenVersion: 0 });
    const call = () => POST(bearer(token, "http://localhost/api/workspaces/3/fields", "POST", { key: "company", label: "회사", fieldType: "text" }), { params: Promise.resolve({ id: "3" }) });
    const respond = (insertError: Error | null): Responder => chain(member("admin"), (c) => {
        if (c.op === "insert") return insertError ?? [{ id: 1, key: "company", label: "회사" }];
        if (c.table === "workspaces") return [{ id: 3 }];
        return undefined;
    });

    await t.test("고유 제약 위반", async (t) => {
        installFakeDb(t, db, respond(pgError("23505")));
        const res = await call();
        assert.equal(res.status, 409);
        assert.equal((await res.json()).error, "이미 존재하는 key입니다.");
    });
    await t.test("다른 DB 오류는 그대로 500", async (t) => {
        installFakeDb(t, db, respond(pgError("23514")));
        assert.equal((await call()).status, 500);
    });
    await t.test("정상 추가는 201", async (t) => {
        installFakeDb(t, db, respond(null));
        assert.equal((await call()).status, 201);
    });
});

test("속성 일괄 추가: 요청 안 중복·형식 오류를 이유와 함께 건너뛰고 나머지는 만든다 (UX-035)", async (t) => {
    const { generateToken, db } = await load(t);
    const { POST } = await import("../app/api/workspaces/[id]/fields/bulk/route");
    const token = generateToken({ userId: USER, orgId: ORG_A, email: "a@example.test", name: "가상", role: "admin", tokenVersion: 0 });
    const { calls } = installFakeDb(t, db, chain(member("admin"), (c) => {
        if (c.table === "workspaces") return [{ id: 3 }];
        if (c.table === "field_definitions" && c.op === "select") return c.params.length === 1 && calls.filter((x) => x.table === "field_definitions").length === 1 ? [{ key: "existing" }] : [{ maxSort: 4 }];
        return undefined;
    }));
    const res = await POST(bearer(token, "http://localhost/api/workspaces/3/fields/bulk", "POST", {
        fields: [
            { key: "email", label: "이메일", fieldType: "email" },
            { key: "email", label: "이메일2", fieldType: "email" },
            { key: "1bad", label: "형식", fieldType: "text" },
            { key: "existing", label: "기존", fieldType: "text" },
            { key: "memo", label: "메모", fieldType: "nope" },
        ],
    }), { params: Promise.resolve({ id: "3" }) });
    assert.equal(res.status, 201);
    const { data } = await res.json();
    assert.equal(data.created, 1);
    assert.equal(data.skipped, 4);
    assert.deepEqual(data.skippedItems.map((i: { key: string }) => i.key), ["email", "1bad", "existing", "memo"]);
    assert.match(data.skippedItems[0].reason, /이미 존재하는 key/);
    assert.match(data.skippedItems[1].reason, /영문으로 시작/);
    assert.equal(calls.filter((c: FakeCall) => c.op === "insert").length, 1, "중복 key는 한 번만 insert");
});

test("워크스페이스 삭제: 상담·메일 기록 FK 위반은 409 한국어 안내 (UX-034)", async (t) => {
    const { generateToken, db } = await load(t);
    const { DELETE } = await import("../app/api/workspaces/[id]/route");
    const token = generateToken({ userId: USER, orgId: ORG_A, email: "a@example.test", name: "가상", role: "admin", tokenVersion: 0 });
    installFakeDb(t, db, chain(member("admin"), (c) => {
        if (c.op === "delete") return pgError("23503");
        if (c.table === "workspaces") return c.params.includes(7) ? [{ id: 7 }] : [{ count: 3 }];
        return undefined;
    }));
    const res = await DELETE(bearer(token, "http://localhost/api/workspaces/7", "DELETE"), { params: Promise.resolve({ id: "7" }) });
    assert.equal(res.status, 409);
    assert.match((await res.json()).error, /숨김/);
});

test("조직 삭제: 다른 조직에도 속한 사용자의 기본 조직을 먼저 옮기고, FK 위반은 409 (UX-013·034)", async (t) => {
    const { generateToken, verifyToken, db } = await load(t);
    const { DELETE } = await import("../app/api/org/settings/route");
    const token = generateToken({ userId: USER, orgId: ORG_A, email: "a@example.test", name: "가상", role: "owner", tokenVersion: 0 });

    await t.test("users.org_id 이동 → 조직 삭제 순서, 다음 조직으로 전환", async (t) => {
        const { calls } = installFakeDb(t, db, chain(member("owner"), (c) =>
            c.table === "organization_members" ? [{ organizationId: ORG_A, role: "owner", tokenVersion: 0 }, { organizationId: ORG_B, role: "admin", tokenVersion: 2 }] : undefined));
        const res = await DELETE(bearer(token, "http://localhost/api/org/settings", "DELETE"));
        assert.equal(res.status, 200);
        const writes = calls.filter((c) => c.op === "execute" || c.op === "delete");
        assert.deepEqual(writes.map((c) => c.op), ["execute", "delete"]);
        assert.equal(transactionCount(db), 1, "기본 조직 이동과 삭제가 한 트랜잭션");
        assert.match(writes[0].sql, /UPDATE users u SET org_id = other\.organization_id/);
        assert.ok(writes[0].params.includes(ORG_A));
        assert.equal(writes[1].table, "organizations");
        assert.equal(verifyToken(res.cookies.get("token")!.value)?.orgId, ORG_B);
    });
    await t.test("발송 이력 등 FK 위반", async (t) => {
        installFakeDb(t, db, chain(member("owner"), (c) => (c.op === "delete" ? pgError("23503") : c.table === "organization_members" ? [] : undefined)));
        const res = await DELETE(bearer(token, "http://localhost/api/org/settings", "DELETE"));
        assert.equal(res.status, 409);
        assert.match((await res.json()).error, /삭제할 수 없습니다/);
    });
    await t.test("남은 조직이 없으면 쿠키를 지운다", async (t) => {
        installFakeDb(t, db, chain(member("owner"), (c) => (c.table === "organization_members" ? [{ organizationId: ORG_A, role: "owner", tokenVersion: 0 }] : undefined)));
        const res = await DELETE(bearer(token, "http://localhost/api/org/settings", "DELETE"));
        assert.equal((await res.json()).noOrgsLeft, true);
        assert.equal(res.cookies.get("token")?.value, "");
    });
});

test("가입·조직 생성: 한 트랜잭션, 동시 중복 가입 409, Free 요금제 없으면 만들지 않는다 (UX-005)", async (t) => {
    const { generateToken, db } = await load(t);
    const signup = await import("../app/api/auth/signup/route");
    const create = await import("../app/api/org/create/route");
    const body = { email: "New@Example.test", password: "secret12", name: "새사람" };
    const signupReq = () => signup.POST(new NextRequest("http://localhost/api/auth/signup", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } }));

    await t.test("같은 이메일 동시 가입(고유 제약) → 409", async (t) => {
        installFakeDb(t, db, (c) => {
            if (c.table === "plans") return [{ id: 1 }];
            if (c.op === "insert" && c.table === "users") return pgError("23505");
            if (c.op === "insert") return [{ id: ORG_A }];
            return [];
        });
        const res = await signupReq();
        assert.equal(res.status, 409);
        assert.equal((await res.json()).error, "이미 등록된 이메일입니다.");
    });
    await t.test("Free 요금제가 없으면 503, 아무것도 만들지 않는다", async (t) => {
        const { calls } = installFakeDb(t, db, () => []);
        const res = await signupReq();
        assert.equal(res.status, 503);
        assert.equal(calls.filter((c) => c.op === "insert").length, 0);
    });
    await t.test("정상 가입은 트랜잭션 안에서 조직→구독→계정→멤버십", async (t) => {
        const { calls } = installFakeDb(t, db, (c) => {
            if (c.table === "plans") return [{ id: 1 }];
            if (c.op === "insert" && c.table === "users") return [{ id: USER, email: "new@example.test", name: "새사람", role: "owner" }];
            if (c.op === "insert") return [{ id: ORG_A }];
            return [];
        });
        const res = await signupReq();
        assert.equal(res.status, 200);
        assert.deepEqual(calls.filter((c) => c.op === "insert").map((c) => c.table), ["organizations", "subscriptions", "users", "organization_members"]);
        assert.equal(transactionCount(db), 1, "네 insert가 한 트랜잭션 안에서 실행된다");
        assert.ok(res.cookies.get("token")?.value);
    });
    await t.test("새 조직 만들기도 Free 요금제가 없으면 503", async (t) => {
        const token = generateToken({ userId: USER, orgId: ORG_A, email: "a@example.test", name: "가상", role: "owner", tokenVersion: 0 });
        const { calls } = installFakeDb(t, db, (c) => (c.table === "users" ? [{ isSuperAdmin: 0 }] : []));
        const res = await create.POST(bearer(token, "http://localhost/api/org/create", "POST", { name: "둘째 조직" }));
        assert.equal(res.status, 503);
        assert.equal(calls.filter((c) => c.op === "insert").length, 0);
    });
});
