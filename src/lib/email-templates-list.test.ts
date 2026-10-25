// UX-146 — 이메일 템플릿 목록이 20건 상한으로 잘리지 않게: 서버 검색·카테고리·id 조회·페이지 경계, 화면 키·연결 템플릿 id.
// 실제 DB를 쓰지 않는다(가상 db).
import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { NextRequest } from "next/server";
import { installFakeDb, isolateEnv, isMembershipLookup, type FakeCall } from "./auth-fake-db.test-helper";
import { emailTemplatesKey, linkTemplateIds } from "../hooks/useEmailTemplates";

const orgId = "00000000-0000-4000-8000-0000000000d1";
const userId = "00000000-0000-4000-8000-0000000000d2";

async function list(t: TestContext, query: string, total: number) {
    isolateEnv(t);
    const { db } = await import("./db"), { generateToken } = await import("./auth");
    const { GET } = await import("../app/api/email/templates/route");
    const token = generateToken({ userId, orgId, name: "가상", email: "staff@example.test", role: "member", membershipId: 71, tokenVersion: 0 } as never);
    const { calls } = installFakeDb(t, db, (c: FakeCall) => {
        if (isMembershipLookup(c)) return [{ role: "member", membershipId: 71, tokenVersion: 0, isSuperAdmin: 0 }];
        if (c.op === "select" && c.table === "email_templates") return c.sql && calls.filter((x) => x.table === "email_templates").length === 1 ? [{ count: total }] : [{ id: 1 }];
        return [];
    });
    const response = await GET(new NextRequest(`https://example.test/api/email/templates${query}`, { headers: { authorization: `Bearer ${token}` } }));
    const json = await response.json();
    return { json, calls: calls.filter((c) => c.table === "email_templates") };
}

test("UX-146: 템플릿 목록 API 페이지·검색 계약", async (t) => {
    await t.test("21건 2페이지: 총 건수·페이지 수, 기본 20건", async (t) => {
        const { json } = await list(t, "?page=2", 21);
        assert.deepEqual({ total: json.total, totalCount: json.totalCount, page: json.page, pageSize: json.pageSize, totalPages: json.totalPages },
            { total: 21, totalCount: 21, page: 2, pageSize: 20, totalPages: 2 });
    });
    await t.test("마지막 페이지를 넘는 요청은 마지막 유효 페이지로", async (t) => {
        const { json } = await list(t, "?page=9&pageSize=20", 21);
        assert.equal(json.page, 2);
    });
    await t.test("0건은 totalPages 0, page 1", async (t) => {
        const { json } = await list(t, "?page=3", 0);
        assert.deepEqual([json.page, json.totalPages], [1, 0]);
    });
    await t.test("pageSize 상한 100, 잘못된 값은 기본값", async (t) => {
        assert.equal((await list(t, "?pageSize=500", 101)).json.pageSize, 100);
        assert.equal((await list(t, "?pageSize=-3", 5)).json.pageSize, 20);
    });
    await t.test("검색·카테고리·초안 제외·id 조건을 서버에서 건다(조직 조건 포함)", async (t) => {
        const { calls } = await list(t, "?q=%ED%99%98%EC%98%81&categoryId=4&status=published", 3);
        const where = calls[1];
        assert.ok(where.params.includes(orgId));
        assert.ok(where.params.includes("%환영%"));
        assert.ok(where.params.includes(4) && where.params.includes("published"));
        const none = (await list(t, "?categoryId=none", 1)).calls[1];
        assert.match(none.sql, /"category_id" is null/);
        const ids = (await list(t, "?ids=3,abc,9", 2)).calls[1];
        assert.ok(ids.params.includes(3) && ids.params.includes(9));
    });
});

test("UX-146: 화면 키와 연결 템플릿 id", () => {
    assert.equal(emailTemplatesKey(), "/api/email/templates");
    assert.equal(emailTemplatesKey({ page: 2, q: " 환영 ", categoryId: "none" }), "/api/email/templates?page=2&q=%ED%99%98%EC%98%81&categoryId=none");
    assert.equal(emailTemplatesKey({ status: "published", pageSize: 100, ids: [3, 9] }), "/api/email/templates?pageSize=100&status=published&ids=3%2C9");
    assert.deepEqual(linkTemplateIds(5, [{ delayDays: 3, onClicked: { templateId: 7 } }, { delayDays: 2, onNotClicked: { templateId: 8 } }]), [5, 7, 8]);
    assert.deepEqual(linkTemplateIds(null, { delayDays: 3, onNotClicked: { templateId: 4 } }), [4]);
    assert.deepEqual(linkTemplateIds(null, null), []);
});
