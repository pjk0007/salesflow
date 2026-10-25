// UX-167 — 선택기 전용 버전 조회: 승인/사용 가능 상태·목적·사업 조건과 커서가 SQL에 들어가고,
// 선택기 조회는 버전 쪽만 돌려준다. 실제 DB 없이 원시 SQL 연결을 가로채 문장과 매개변수를 기록한다.
import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { installFakeDb, isolateEnv, isMembershipLookup } from "../auth-fake-db.test-helper";

const ORG = "00000000-0000-4000-8000-000000000001";

async function setup(t: TestContext, role: "owner" | "member" = "owner") {
    isolateEnv(t);
    const { db, queryClient } = await import("../db");
    const { generateToken } = await import("../auth");
    installFakeDb(t, db, (call) =>
        isMembershipLookup(call) ? [{ role, tokenVersion: 0, membershipId: 71 }] : [],
    );
    const sql: { text: string; values: unknown[] }[] = [];
    const rows = Array.from({ length: 51 }, (_, i) => ({ id: 200 - i, name: `버전 ${i}` }));
    const connection = Object.assign(
        async (strings: TemplateStringsArray, ...values: unknown[]) => {
            sql.push({ text: strings.join("?"), values });
            return strings.join("").includes("_versions v") ? rows : [];
        },
        { release() {} },
    );
    t.mock.method(queryClient, "reserve", async () => connection as never);
    const token = generateToken({
        userId: "00000000-0000-4000-8000-000000000002",
        orgId: ORG,
        email: "staff@example.test",
        name: "가상",
        role,
        tokenVersion: 0,
        membershipId: 71,
    });
    const get = (url: string) =>
        new NextRequest(`http://localhost${url}`, { headers: { authorization: `Bearer ${token}` } });
    return { sql, get };
}

test("UX-167 작성 지침 선택기: 승인·목적·사업 조건과 커서, 버전 쪽만 반환", async (t) => {
    const { sql, get } = await setup(t);
    const { GET } = await import("../../app/api/ai/copy-policies/route");
    const res = await GET(get("/api/ai/copy-policies?workspaceId=3&state=approved&purpose=initial_email&cursor=151"));
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.deepEqual(Object.keys(body.data).sort(), ["nextCursor", "versions"]);
    assert.equal(body.data.versions.length, 50);
    assert.equal(body.data.nextCursor, 151, "51번째가 있으면 50번째 id가 다음 커서");
    assert.equal(sql.length, 1, "사업·규칙·연결 목록은 다시 읽지 않는다");
    assert.match(sql[0].text, /v\.state='approved'/);
    assert.match(sql[0].text, /v\.state NOT IN \('blocked','retired'\)/);
    assert.match(sql[0].text, /v\.purpose=/);
    assert.ok(sql[0].values.includes(ORG), "조직 조건");
    assert.ok(sql[0].values.includes(3) && sql[0].values.includes(151), "사업·커서");
    assert.ok(sql[0].values.includes("approved") && sql[0].values.includes("initial_email"));
});

test("UX-167 비교 평가용 '사용 가능' 상태와 관리 목록 기본 조회는 기존 모양 유지", async (t) => {
    const { sql, get } = await setup(t);
    const { GET } = await import("../../app/api/ai/copy-policies/route");
    const usable = await (await GET(get("/api/ai/copy-policies?workspaceId=3&state=usable&purpose=visit_ack"))).json();
    assert.ok(sql[0].values.includes("usable") && sql[0].values.includes("visit_ack"));
    assert.deepEqual(Object.keys(usable.data).sort(), ["nextCursor", "versions"]);
    sql.length = 0;
    const full = await (await GET(get("/api/ai/copy-policies?cursor=0"))).json();
    assert.deepEqual(Object.keys(full.data).sort(), ["bindings", "nextCursor", "rules", "versions", "workspaces"]);
    assert.ok(sql[0].values.filter((v) => v === "").length >= 2, "상태·목적 미지정은 빈 값(조건 없음)");
});

test("UX-167 잘못된 상태·목적 값은 400, 지식 선택기는 승인 조건만 받는다", async (t) => {
    const { sql, get } = await setup(t);
    const policies = await import("../../app/api/ai/copy-policies/route");
    const knowledge = await import("../../app/api/ai/knowledge-versions/route");
    assert.equal((await policies.GET(get("/api/ai/copy-policies?state=blocked"))).status, 400);
    assert.equal((await policies.GET(get("/api/ai/copy-policies?state=approved&purpose=customer_chat"))).status, 400);
    assert.equal((await knowledge.GET(get("/api/ai/knowledge-versions?state=draft"))).status, 400);
    sql.length = 0;
    const res = await knowledge.GET(get("/api/ai/knowledge-versions?workspaceId=4&state=approved&cursor=0"));
    assert.equal(res.status, 200);
    assert.match(sql[0].text, /ai_copy_knowledge_versions/);
    assert.ok(sql[0].values.includes("approved") && sql[0].values.includes(4));
});

test("UX-167 member는 선택기 조회도 403", async (t) => {
    const { sql, get } = await setup(t, "member");
    const { GET } = await import("../../app/api/ai/copy-policies/route");
    assert.equal((await GET(get("/api/ai/copy-policies?state=approved"))).status, 403);
    assert.equal(sql.length, 0);
});
