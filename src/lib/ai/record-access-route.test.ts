import test from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { installFakeDb, isolateEnv, isMembershipLookup } from "../auth-fake-db.test-helper";

test("UX-166 생성 두 경로는 타 조직 레코드 호출 0회·허용 레코드 입력 1회를 유지한다", async (t) => {
    isolateEnv(t, { ANTHROPIC_API_KEY: "fake-record-access" });
    const { db } = await import("../db");
    const { generateToken } = await import("../auth");
    const plain = await import("../../app/api/ai/generate-email/route");
    const stream = await import("../../app/api/ai/generate-email-stream/route");
    const identity = { userId: "00000000-0000-4000-8000-000000000002", orgId: "00000000-0000-4000-8000-000000000001", email: "test@example.test", name: "가상", role: "member" as const, tokenVersion: 0, membershipId: 71 };
    const token = generateToken(identity);
    for (const [name, handler] of [["일반", plain.POST], ["스트림", stream.POST]] as const) {
        for (const own of [false, true]) await t.test(`${name} ${own ? "허용" : "타 조직"}`, async (t) => {
            const { calls } = installFakeDb(t, db, call => {
                if (isMembershipLookup(call)) return [{ role: "member", tokenVersion: 0, membershipId: 71 }];
                if (call.table === "ai_usage_quotas") return [{ id: 1, totalTokens: 0, quotaLimit: 100000 }];
                if (call.table === "records") return own ? [{ record: { id: 42, data: { name: "허용된 가상 고객" } }, partition: { id: 11, workspaceId: 3, folderId: null } }] : [];
                return [];
            });
            const prompts: string[] = [];
            t.mock.method(globalThis, "fetch", async (_url: unknown, init?: RequestInit) => {
                prompts.push(String(init?.body));
                return Response.json({ id: "msg_fake", type: "message", role: "assistant", content: [{ type: "text", text: JSON.stringify({ subject: "안내", htmlBody: "본문" }) }], model: "claude-haiku-4-5", stop_reason: "end_turn", stop_sequence: null, usage: { input_tokens: 12, output_tokens: 8 } });
            });
            const response = await handler(new NextRequest("http://localhost/api/ai/generate-email", { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ prompt: "안내", recordId: 42 }) }));
            const body = await response.text();
            assert.equal(response.status, own ? 200 : 404);
            assert.equal(prompts.length, own ? 1 : 0);
            if (own) {
                assert.match(prompts[0], /허용된 가상 고객/);
                assert.match(body, name === "스트림" ? /event: done/ : /"success":true/);
            }
            const lookup = calls.filter(call => call.table === "records");
            assert.equal(lookup.length, 1);
            assert.ok(lookup[0].params.includes(identity.orgId));
            assert.ok(lookup[0].joins.includes("workspaces"));
        });
    }
});
