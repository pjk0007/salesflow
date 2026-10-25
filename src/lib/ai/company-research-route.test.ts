import test from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { installFakeDb, isolateEnv, isMembershipLookup } from "../auth-fake-db.test-helper";

test("UX-239·240 회사 조사 실패와 정상 정보 없음은 구분하고 공급자 원문을 숨긴다", async (t) => {
    isolateEnv(t, { ANTHROPIC_API_KEY: "fake-research" });
    const { db } = await import("../db");
    const { generateToken } = await import("../auth");
    const { POST } = await import("../../app/api/ai/research-company/route");
    const identity = { userId: "00000000-0000-4000-8000-000000000002", orgId: "00000000-0000-4000-8000-000000000001", email: "test@example.test", name: "가상", role: "owner" as const, tokenVersion: 0, membershipId: 71 };
    const token = generateToken(identity);
    for (const scenario of ["normal", "empty", "malformed", "auth", "network"] as const) {
        await t.test(scenario, async (t) => {
            t.mock.method(console, "error", () => {});
            const { calls } = installFakeDb(t, db, call => {
                if (isMembershipLookup(call)) return [{ role: "owner", tokenVersion: 0, membershipId: 71 }];
                if (call.table === "ai_usage_quotas") return [{ id: 1, totalTokens: 0, quotaLimit: 100000 }];
                return [];
            });
            let requests = 0;
            t.mock.method(globalThis, "fetch", async () => {
                requests++;
                if (scenario === "network") throw new TypeError("synthetic offline");
                if (scenario === "auth") return Response.json({ type: "error", error: { type: "authentication_error", message: "synthetic invalid API key" } }, { status: 401 });
                const text = scenario === "malformed" ? "bad-json" : JSON.stringify({ companyName: "가상 회사", description: scenario === "empty" ? "정보 없음" : "가상 회사 소개", industry: "정보 없음" });
                return Response.json({ id: "msg_fake", type: "message", role: "assistant", content: [{ type: "text", text }], model: "claude-haiku-4-5", stop_reason: "end_turn", stop_sequence: null, usage: { input_tokens: 12, output_tokens: 8 } });
            });
            const response = await POST(new NextRequest("http://localhost/api/ai/research-company", { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ companyName: "가상 회사" }) }));
            const body = await response.json();
            assert.equal(requests, 1);
            if (["normal", "empty"].includes(scenario)) {
                assert.equal(response.status, 200);
                assert.equal(body.success, true);
                assert.equal(body.data.description, scenario === "empty" ? "정보 없음" : "가상 회사 소개");
            } else {
                assert.equal(response.status, 503);
                assert.equal(body.success, false);
                assert.equal(body.data, undefined);
                assert.match(body.error, scenario === "auth" ? /조직 AI 연결/ : /조회하지 못했습니다/);
                assert.doesNotMatch(body.error, /synthetic|API key|bad-json/);
                assert.equal(calls.filter(c => c.table === "ai_usage_logs" && c.op === "insert").length, 0);
            }
        });
    }
});
