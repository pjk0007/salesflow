// UX-018 관리자 목록·결제 내역이 최근 순(동률은 id)으로 정렬되고 페이지 이동이 같은 순서를 따르는지,
// UX-021 옛 설정 주소가 요금제·팀 탭으로 이어지는지. 가상 db만 사용(SQL 실행 없음).
import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { sql, type SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { installFakeDb, isolateEnv, isMembershipLookup, type Responder } from "./auth-fake-db.test-helper";

const ORG = "00000000-0000-4000-8000-0000000000aa";
const USER = "00000000-0000-4000-8000-000000000001";
const dialect = new PgDialect();

async function load(t: TestContext, respond: Responder) {
    isolateEnv(t);
    const auth = await import("./auth");
    const { db } = await import("./db");
    const fake = installFakeDb(t, db, (c) => (isMembershipLookup(c) ? [{ role: "owner", membershipId: 71, tokenVersion: 0, isSuperAdmin: 1 }] : respond(c)));
    // 가상 db는 orderBy를 기록하지 않으므로 select 체인을 한 겹 감싸 정렬식을 SQL로 남긴다
    const orders: string[] = [];
    const select = db.select as unknown as (...args: unknown[]) => object;
    const wrap = (target: object): object => new Proxy(target, {
        get(inner, prop) {
            const value = Reflect.get(inner, prop);
            if (prop === "then" || typeof value !== "function") return value;
            return (...args: unknown[]) => {
                if (prop === "orderBy") orders.push(dialect.sqlToQuery(sql.join(args as SQL[], sql`, `)).sql);
                return wrap(value(...args));
            };
        },
    });
    t.mock.method(db, "select", (...args: unknown[]) => wrap(select(...args)));
    const token = auth.generateToken({ userId: USER, orgId: ORG, email: "admin@example.test", name: "운영자", role: "owner", membershipId: 71, tokenVersion: 0 });
    const get = (path: string) => new NextRequest(`http://localhost${path}`, { headers: { authorization: `Bearer ${token}` } });
    return { ...fake, orders, get };
}

test("UX-018 관리자 조직 목록은 가입 최근 순·id 순으로 페이지를 나눈다", async (t) => {
    const { calls, get } = await load(t, (c) => (c.op === "select" ? [{ total: 45 }] : []));
    const { GET } = await import("../app/api/admin/organizations/route");
    const res = await GET(get("/api/admin/organizations?page=2&limit=20"));
    assert.equal(res.status, 200);
    assert.deepEqual((await res.json()).pagination, { page: 2, limit: 20, total: 45, totalPages: 3 });
    const list = calls.find((c) => c.op === "execute");
    assert.ok(list);
    assert.match(list.sql, /ORDER BY o\.created_at DESC, o\.id DESC\s+LIMIT \$\d+ OFFSET \$\d+/);
    assert.deepEqual(list.params.slice(-2), [20, 20]);
});

test("UX-018 관리자 사용자 목록도 가입 최근 순·id 순", async (t) => {
    const { orders, get } = await load(t, (c) => (c.op === "select" && c.table === "users" ? [{ total: 1 }] : []));
    const { GET } = await import("../app/api/admin/users/route");
    assert.equal((await GET(get("/api/admin/users?page=1"))).status, 200);
    assert.ok(orders.includes('"users"."created_at" desc, "users"."id" desc'), orders.join(" | "));
});

test("UX-018 관리자 조직 상세의 결제 내역은 최근 결제 20건", async (t) => {
    const { orders, get } = await load(t, (c) => (c.op === "select" && c.table === "organizations" ? [{ id: ORG, name: "가상 조직", slug: "fake", createdAt: new Date() }] : []));
    const { GET } = await import("../app/api/admin/organizations/[id]/route");
    const res = await GET(get(`/api/admin/organizations/${ORG}`), { params: Promise.resolve({ id: ORG }) });
    assert.equal(res.status, 200);
    assert.ok(orders.includes('"payments"."created_at" desc, "payments"."id" desc'), orders.join(" | "));
});

test("UX-021 옛 설정 주소는 알려진 탭만 새 경로로 옮긴다", async () => {
    const { default: SettingsRedirect } = await import("../app/settings/page");
    const target = async (tab?: string) => {
        try {
            await SettingsRedirect({ searchParams: Promise.resolve(tab === undefined ? {} : { tab }) });
        } catch (error) {
            // next/navigation redirect()는 NEXT_REDIRECT;<종류>;<경로>;<상태>; digest를 담아 던진다
            const digest = (error as { digest?: string }).digest ?? "";
            return digest.split(";")[2];
        }
        return undefined;
    };
    assert.equal(await target("billing"), "/settings/billing");
    assert.equal(await target("users"), "/settings/organization?tab=team");
    assert.equal(await target(), "/settings/organization");
    assert.equal(await target("unknown"), "/settings/organization");
});
