import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { fixture, openQa, qaUrl } from "./db-fixture.test-helper";

const url = qaUrl();
test("통계 라우트의 인증·권한·조직 격리", { skip: !url }, async (t) => {
    const c = await openQa();
    process.env.JWT_SECRET = "email-stats-qa-route-test-only";
    try {
        const orgs = await fixture(c);
        const { generateToken } = await import("../auth");
        const { POST } = await import("../../app/api/analytics/email-stats/refresh/route");
        const { GET } = await import("../../app/api/analytics/email-stats/route");
        // 직원 API는 DB의 현재 멤버십을 확인한다(UX-014) — 가상 member 계정·멤버십을 둔다(TRUNCATE organizations CASCADE로 함께 정리)
        const userId = randomUUID();
        await c`INSERT INTO users(id,org_id,email,password,name,role) VALUES(${userId},${orgs[0].orgId},'qa-member@example.invalid','qa-not-a-password','QA','member')`;
        await c`INSERT INTO organization_members(organization_id,user_id,role) VALUES(${orgs[0].orgId},${userId},'member')`;
        const token = generateToken({ userId, orgId: orgs[0].orgId, email: "qa-member@example.invalid", name: "QA", role: "member" });
        await t.test("refresh POST 토큰 없음 401", async () => {
            assert.equal((await POST(new NextRequest("http://localhost/api/analytics/email-stats/refresh", { method: "POST" }))).status, 401);
        });
        await t.test("refresh POST member 403", async () => {
            assert.equal((await POST(new NextRequest("http://localhost/api/analytics/email-stats/refresh", { method: "POST", headers: { Authorization: `Bearer ${token}` } }))).status, 403);
        });
        await t.test("GET 다른 조직 workspaceId 400", async () => {
            const request = new NextRequest(`http://localhost/api/analytics/email-stats?view=kpi&from=2026-01-01&to=2026-01-01&workspaceId=${orgs[1].workspaceId}`, { headers: { Authorization: `Bearer ${token}` } });
            const response = await GET(request);
            assert.equal(response.status, 400);
            assert.deepEqual(await response.json(), { success: false, error: "워크스페이스를 확인해 주세요." });
        });
    } finally {
        const { queryClient } = await import("../db");
        await queryClient.end();
        await c.end();
    }
});
