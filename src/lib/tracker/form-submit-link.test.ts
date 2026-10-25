import test from "node:test";
import assert from "node:assert/strict";
import { installFakeDb, isolateEnv } from "../auth-fake-db.test-helper";

const ORG = "00000000-0000-4000-8000-000000000285";

async function setup(t: import("node:test").TestContext, visitor: { id: number; recordId: number | null } | null) {
    isolateEnv(t);
    const { db } = await import("../db");
    const { linkVisitorByFormSubmit } = await import("./match-record");
    const { calls } = installFakeDb(t, db, () => []);
    t.mock.method(db.query.trackerSites, "findFirst", async () => ({ id: 3, orgId: ORG, workspaceId: 1, isActive: 1 }));
    t.mock.method(db.query.trackerVisitors, "findFirst", async () => visitor && { ...visitor, email: null, name: null, phone: null });
    return { calls, linkVisitorByFormSubmit };
}

const links = (calls: Awaited<ReturnType<typeof setup>>["calls"]) =>
    calls.filter((c) => c.op === "insert" && c.table === "visitor_record_links").map((c) => c.values as { recordId: number; visitorId: number; source: string; orgId: string });

test("UX-285 두 번째 폼 제출은 이전 레코드 링크를 남기고 새 레코드도 링크에 누적한다", async (t) => {
    const { calls, linkVisitorByFormSubmit } = await setup(t, { id: 77, recordId: 100 });
    await linkVisitorByFormSubmit({ workspaceId: 1, visitorId: "v-1", recordId: 200 });
    assert.deepEqual(links(calls).map((l) => [l.visitorId, l.recordId, l.source, l.orgId]), [
        [77, 100, "form_submit", ORG],
        [77, 200, "form_submit", ORG],
    ]);
    const update = calls.find((c) => c.op === "update" && c.table === "tracker_visitors");
    assert.equal((update?.set as { recordId: number }).recordId, 200);
});

test("UX-285 첫 제출·같은 레코드 재제출은 링크 하나만 (멱등 upsert)", async (t) => {
    await t.test("첫 제출", async (t) => {
        const { calls, linkVisitorByFormSubmit } = await setup(t, { id: 77, recordId: null });
        await linkVisitorByFormSubmit({ workspaceId: 1, visitorId: "v-1", recordId: 200 });
        assert.deepEqual(links(calls).map((l) => l.recordId), [200]);
    });
    await t.test("같은 레코드", async (t) => {
        const { calls, linkVisitorByFormSubmit } = await setup(t, { id: 77, recordId: 200 });
        await linkVisitorByFormSubmit({ workspaceId: 1, visitorId: "v-1", recordId: 200 });
        assert.deepEqual(links(calls).map((l) => l.recordId), [200]);
    });
    await t.test("방문자 없음", async (t) => {
        const { calls, linkVisitorByFormSubmit } = await setup(t, null);
        await linkVisitorByFormSubmit({ workspaceId: 1, visitorId: "v-1", recordId: 200 });
        assert.equal(calls.length, 0);
    });
});

test("UX-284 identify 이메일 비교는 역매칭과 같이 대소문자를 무시한다", async (t) => {
    isolateEnv(t);
    const { NextRequest } = await import("next/server");
    const { db } = await import("../db");
    const { POST } = await import("../../app/api/tracker/identify/route");
    const { calls } = installFakeDb(t, db, (c) => c.op === "execute" ? [{ id: 500 }] : []);
    t.mock.method(db.query.trackerSites, "findFirst", async () => ({ id: 3, orgId: ORG, workspaceId: 1, isActive: 1, matchField: null, domains: [] }));
    t.mock.method(db.query.trackerVisitors, "findFirst", async () => ({ id: 77, recordId: null, matchValue: null, email: null, name: null, phone: null }));
    const response = await POST(new NextRequest("http://localhost/api/tracker/identify", {
        method: "POST",
        headers: { "x-api-key": "fake-site-key-284", "content-type": "application/json" },
        body: JSON.stringify({ visitor_id: "v-284", email: "Kim@Example.COM" }),
    }));
    assert.equal(response.status, 200);
    const emailLookup = calls.find((c) => c.op === "execute" && c.sql.includes("email"));
    assert.ok(emailLookup, "이메일로 레코드를 찾아야 한다");
    assert.match(emailLookup.sql, /lower\(trim\(data->>'email'\)\)/);
    assert.ok(emailLookup.params.includes("kim@example.com"));
    const link = calls.find((c) => c.op === "insert" && c.table === "visitor_record_links")?.values as { recordId: number };
    assert.equal(link.recordId, 500);
});
