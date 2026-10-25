import test from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { installFakeDb, isolateEnv, isMembershipLookup } from "../auth-fake-db.test-helper";

const ORG = "00000000-0000-4000-8000-000000000001";
const mail = { subject: "가상 제목", htmlBody: "<p>가상 본문</p>" };

test("UX-168 기본 Claude·DeepSeek·Gemini가 올바른 공급자를 한 번 호출하고 사용량을 기록한다", async (t) => {
    isolateEnv(t, { ANTHROPIC_API_KEY: "fake-anthropic", DEEPSEEK_API_KEY: "fake-deepseek", GEMINI_API_KEY: "fake-gemini" });
    const { db } = await import("../db");
    const { generateToken } = await import("../auth");
    const { POST } = await import("../../app/api/ai/generate-email-stream/route");
    const identity = { userId: "00000000-0000-4000-8000-000000000002", orgId: ORG, email: "test@example.test", name: "가상", role: "owner" as const, tokenVersion: 0, membershipId: 71 };
    const token = generateToken(identity);
    for (const model of [undefined, "deepseek-v4-flash", "gemini-3.5-flash-lite"]) {
        await t.test(model ?? "기본 Claude", async (t) => {
            const { calls } = installFakeDb(t, db, call => {
                if (isMembershipLookup(call)) return [{ role: "owner", tokenVersion: 0, membershipId: 71 }];
                if (call.table === "ai_usage_quotas") return [{ id: 1, totalTokens: 0, quotaLimit: 100000 }];
                return [];
            });
            const urls: string[] = [];
            t.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
                const url = input instanceof Request ? input.url : String(input);
                urls.push(url);
                if (url.includes("anthropic.com")) return Response.json({ id: "msg_fake", type: "message", role: "assistant", content: [{ type: "text", text: JSON.stringify(mail) }], model: "claude-haiku-4-5", stop_reason: "end_turn", stop_sequence: null, usage: { input_tokens: 12, output_tokens: 8 } });
                if (url.includes("deepseek.com")) return new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: JSON.stringify(mail) } }], usage: { prompt_tokens: 12, completion_tokens: 8 } })}\n\ndata: [DONE]\n\n`);
                if (url.includes("googleapis.com")) return new Response(`data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(mail) }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 8 } })}\n\n`);
                throw new Error("예상하지 못한 외부 경로");
            });
            const response = await POST(new NextRequest("http://localhost/api/ai/generate-email-stream", { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ prompt: "안내", model }) }));
            const body = await response.text();
            assert.equal(response.status, 200);
            assert.equal(urls.length, 1);
            assert.ok(urls[0].includes(!model ? "anthropic.com" : model.startsWith("deepseek") ? "deepseek.com" : "googleapis.com"));
            assert.match(body, /event: chunk/);
            assert.match(body, /event: done/);
            assert.doesNotMatch(body, /event: error/);
            const usage = calls.filter(c => c.table === "ai_usage_logs" && c.op === "insert");
            assert.equal(usage.length, 1);
            assert.deepEqual({ ...(usage[0].values as object), promptTokens: 12, completionTokens: 8 }, usage[0].values);
        });
    }
    for (const kind of ["cutoff", "length", "quota-error"] as const) {
        await t.test(`완료로 속이지 않음: ${kind}`, async (t) => {
            t.mock.method(console, "error", () => {});
            installFakeDb(t, db, call => {
                if (isMembershipLookup(call)) return [{ role: "owner", tokenVersion: 0, membershipId: 71 }];
                if (call.table === "ai_usage_quotas") {
                    if (kind === "quota-error" && call.op === "update") return new Error("가상 사용량 저장 오류");
                    return [{ id: 1, totalTokens: 0, quotaLimit: 100000 }];
                }
                return [];
            });
            t.mock.method(globalThis, "fetch", async () => new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: JSON.stringify(mail) }, ...(kind === "length" ? { finish_reason: "length" } : {}) }], usage: { prompt_tokens: 12, completion_tokens: 8 } })}\n\n${kind === "cutoff" ? "" : "data: [DONE]\n\n"}`));
            const response = await POST(new NextRequest("http://localhost/api/ai/generate-email-stream", { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ prompt: "안내", model: "deepseek-v4-flash" }) }));
            const body = await response.text();
            assert.match(body, /event: error/);
            assert.doesNotMatch(body, /event: done/);
        });
    }
});
