import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { installFakeDb, isolateEnv, isMembershipLookup } from "../auth-fake-db.test-helper";
import { readAiEmailStream } from "../../components/email/api/ai-email";

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
            const body = await response.clone().text();
            const result = await readAiEmailStream(response, new AbortController().signal, () => {});
            assert.equal(result.success, true);
            assert.deepEqual(result.data, mail);
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

test("UX-168 Claude 엄격 이메일은 정상 종료와 완성 JSON을 모두 요구한다", async t => {
    isolateEnv(t, { ANTHROPIC_API_KEY: "fake-anthropic" });
    const { db } = await import("../db");
    const { generateToken } = await import("../auth");
    const { POST } = await import("../../app/api/ai/generate-email-stream/route");
    const { callClaudeEmail } = await import("./claude");
    const identity = { userId: "00000000-0000-4000-8000-000000000002", orgId: ORG, email: "test@example.test", name: "가상", role: "owner" as const, tokenVersion: 0, membershipId: 71 };
    const token = generateToken(identity);
    const incomplete = '{"subject":"가상 제목","htmlBody":"<p>잘린 본문';
    for (const [name, stopReason, text] of [
        ["max_tokens 유효 JSON", "max_tokens", JSON.stringify(mail)],
        ["max_tokens 불완전 JSON", "max_tokens", incomplete],
        ["end_turn 불완전 JSON", "end_turn", incomplete],
        ["end_turn 잘못된 필드", "end_turn", '{"subject":"제목","htmlBody":7}'],
        ["종료 사유 누락", null, JSON.stringify(mail)],
    ] as const) await t.test(name, async t => {
        t.mock.method(console, "error", () => {});
        installFakeDb(t, db, call => {
            if (isMembershipLookup(call)) return [{ role: "owner", tokenVersion: 0, membershipId: 71 }];
            if (call.table === "ai_usage_quotas") return [{ id: 1, totalTokens: 0, quotaLimit: 100000 }];
            return [];
        });
        let requests = 0;
        t.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
            assert.match(input instanceof Request ? input.url : String(input), /api\.anthropic\.com/);
            requests++;
            return Response.json({ id: "msg_fake", type: "message", role: "assistant", content: [{ type: "text", text }], model: "claude-haiku-4-5", stop_reason: stopReason, stop_sequence: null, usage: { input_tokens: 12, output_tokens: 8 } });
        });
        const response = await POST(new NextRequest("http://localhost/api/ai/generate-email-stream", { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ prompt: "가상 안내" }) }));
        const body = await response.clone().text();
        const result = await readAiEmailStream(response, new AbortController().signal, () => {});
        assert.equal(requests, 1);
        assert.match(body, /event: error/);
        assert.doesNotMatch(body, /event: done|event: chunk/);
        assert.equal(result.success, false);
    });
    await t.test("기존 비엄격 이메일 복구 계약 유지", async t => {
        t.mock.method(console, "log", () => {});
        t.mock.method(globalThis, "fetch", async () => Response.json({ id: "msg_fake", type: "message", role: "assistant", content: [{ type: "text", text: incomplete }], model: "claude-haiku-4-5", stop_reason: "max_tokens", stop_sequence: null, usage: { input_tokens: 12, output_tokens: 8 } }));
        const result = await callClaudeEmail({ provider: "claude", model: "claude-haiku-4-5", apiKey: "fake-anthropic" }, "가상", "가상");
        assert.equal(result.subject, "가상 제목");
        assert.equal(result.htmlBody, "<p>잘린 본문");
    });
});

test("UX-168 Gemini 키는 주소가 아니라 헤더로 보내고, 실패한 호출도 쓴 토큰을 기록한다", async t => {
    isolateEnv(t, { ANTHROPIC_API_KEY: "fake-anthropic", DEEPSEEK_API_KEY: "fake-deepseek", GEMINI_API_KEY: "fake-gemini" });
    const { db } = await import("../db");
    const { generateToken } = await import("../auth");
    const { POST } = await import("../../app/api/ai/generate-email-stream/route");
    const { callGeminiEmail } = await import("./gemini");
    const token = generateToken({ userId: "00000000-0000-4000-8000-000000000002", orgId: ORG, email: "test@example.test", name: "가상", role: "owner", tokenVersion: 0, membershipId: 71 });
    const request = (model?: string) => new NextRequest("http://localhost/api/ai/generate-email-stream", { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ prompt: "안내", model }) });
    const fakeDb = (t: TestContext) => installFakeDb(t, db, call => {
        if (isMembershipLookup(call)) return [{ role: "owner", tokenVersion: 0, membershipId: 71 }];
        if (call.table === "ai_usage_quotas") return [{ id: 1, totalTokens: 0, quotaLimit: 100000 }];
        return [];
    });

    await t.test("스트림·단발 Gemini 호출 모두 주소에 키가 없다", async t => {
        fakeDb(t);
        const sent: { url: string; key: string | null }[] = [];
        t.mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
            sent.push({ url: String(input), key: new Headers(init?.headers).get("x-goog-api-key") });
            return String(input).includes("alt=sse")
                ? new Response(`data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(mail) }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 } })}\n\n`)
                : Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify(mail) }] }, finishReason: "STOP" }] });
        });
        await (await POST(request("gemini-3.5-flash-lite"))).text();
        await callGeminiEmail({ provider: "gemini", model: "gemini-3.5-flash-lite", apiKey: "fake-gemini" }, "가상", "가상");
        assert.equal(sent.length, 2);
        for (const s of sent) {
            assert.doesNotMatch(s.url, /key=|fake-gemini/);
            assert.equal(s.key, "fake-gemini");
        }
    });

    for (const [name, model, reply] of [
        ["Claude max_tokens", undefined, () => Response.json({ id: "msg_fake", type: "message", role: "assistant", content: [{ type: "text", text: JSON.stringify(mail) }], model: "claude-haiku-4-5", stop_reason: "max_tokens", stop_sequence: null, usage: { input_tokens: 12, output_tokens: 8 } })],
        ["Claude 잘못된 JSON", undefined, () => Response.json({ id: "msg_fake", type: "message", role: "assistant", content: [{ type: "text", text: "{오류" }], model: "claude-haiku-4-5", stop_reason: "end_turn", stop_sequence: null, usage: { input_tokens: 12, output_tokens: 8 } })],
        ["DeepSeek 잘림", "deepseek-v4-flash", () => new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: "{" } }], usage: { prompt_tokens: 12, completion_tokens: 8 } })}\n\ndata: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "length" }] })}\n\n`)],
    ] as const) await t.test(`실패 사용량 기록: ${name}`, async t => {
        t.mock.method(console, "error", () => {});
        const { calls } = fakeDb(t);
        t.mock.method(globalThis, "fetch", async () => reply());
        const body = await (await POST(request(model))).text();
        assert.match(body, /event: error/);
        assert.doesNotMatch(body, /event: done/);
        const logs = calls.filter(c => c.table === "ai_usage_logs" && c.op === "insert");
        assert.equal(logs.length, 1, "실패해도 사용 기록 1건");
        assert.equal((logs[0].values as { promptTokens: number }).promptTokens, 12);
        assert.equal((logs[0].values as { completionTokens: number }).completionTokens, 8);
        assert.equal(calls.filter(c => c.table === "ai_usage_quotas" && c.op === "update").length, 1, "한도 누적 1회");
    });

    await t.test("토큰을 쓰기 전 연결 실패는 기록하지 않는다", async t => {
        t.mock.method(console, "error", () => {});
        const { calls } = fakeDb(t);
        t.mock.method(globalThis, "fetch", async () => Response.json({ error: { message: "가상 거절" } }, { status: 401 }));
        const body = await (await POST(request("deepseek-v4-flash"))).text();
        assert.match(body, /event: error/);
        assert.equal(calls.filter(c => c.table === "ai_usage_logs").length, 0);
    });
});

test("UX-168 클라이언트 중지 → 상류 호출이 한 번 끊기고 사용량 기록을 더하지 않는다", async t => {
    isolateEnv(t, { ANTHROPIC_API_KEY: "fake-anthropic", DEEPSEEK_API_KEY: "fake-deepseek", GEMINI_API_KEY: "fake-gemini" });
    const { db } = await import("../db");
    const { generateToken } = await import("../auth");
    const { POST } = await import("../../app/api/ai/generate-email-stream/route");
    const token = generateToken({ userId: "00000000-0000-4000-8000-000000000002", orgId: ORG, email: "test@example.test", name: "가상", role: "owner", tokenVersion: 0, membershipId: 71 });
    for (const model of [undefined, "deepseek-v4-flash", "gemini-3.5-flash-lite"]) {
        await t.test(model ?? "기본 Claude", async t => {
            t.mock.method(console, "error", () => {});
            const { calls } = installFakeDb(t, db, call => {
                if (isMembershipLookup(call)) return [{ role: "owner", tokenVersion: 0, membershipId: 71 }];
                if (call.table === "ai_usage_quotas") return [{ id: 1, totalTokens: 0, quotaLimit: 100000 }];
                return [];
            });
            let requests = 0;
            let aborts = 0;
            let started!: () => void;
            const upstreamStarted = new Promise<void>(resolve => { started = resolve; });
            // 공급자가 응답하지 않는 동안 사용자가 중지한다. 상류는 받은 signal이 끊길 때만 끝난다.
            t.mock.method(globalThis, "fetch", (input: string | URL | Request, init?: RequestInit) => new Promise<Response>((_, reject) => {
                requests++;
                const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
                assert.ok(signal, "상류 호출에 signal이 있어야 한다");
                signal.addEventListener("abort", () => { aborts++; reject(new DOMException("aborted", "AbortError")); }, { once: true });
                started();
            }));
            const client = new AbortController();
            const response = await POST(new NextRequest("http://localhost/api/ai/generate-email-stream", { method: "POST", signal: client.signal, headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ prompt: "안내", model }) }));
            const body = response.text();
            await upstreamStarted;
            client.abort();
            // 중지 전파는 동기라 응답을 기다리기 전에 이미 1회여야 한다 — 시간 초과만 남은 회귀는 여기서 바로 실패한다 (Fable REVIEW-2 E1)
            assert.equal(aborts, 1, "중지 즉시 상류 abort");
            assert.doesNotMatch(await body, /event: done|event: chunk/);
            assert.equal(requests, 1, "중지 후 재시도하지 않는다");
            assert.equal(aborts, 1, "상류 abort 1회");
            assert.equal(calls.filter(c => c.table === "ai_usage_logs").length, 0, "토큰을 쓰기 전 중지는 사용 기록 0");
            assert.equal(calls.filter(c => c.table === "ai_usage_quotas" && c.op === "update").length, 0, "한도 누적 0");
        });
    }
});
