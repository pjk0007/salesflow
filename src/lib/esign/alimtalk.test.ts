import assert from "node:assert/strict";
import { test } from "node:test";
import templates from "./alimtalk-templates.json";
import { createEsignAlimtalk, esignAlimtalkParameters } from "./alimtalk";
import { createEsignDelivery } from "./delivery";
import type { EsignJob } from "./types";
import { OTP_TTL_MS } from "./rules";

const config = { appKey: "fake-app", secretKey: "fake-secret", senderKey: "fake-sender" };
const job = { id: "fake-job-id", envelopeId: "fake-envelope", kind: "invitation", channel: "alimtalk" } as EsignJob;
const payload = { phone: "01000000001", name: "가상 수신자", title: "가상 계약서", token: "a".repeat(43), code: "123456" };
function setup(options: { status?: string; mutate?: (template: Record<string, unknown>) => void; response?: () => Response; throwPost?: boolean; throwGet?: boolean; enabled?: boolean; missingConfig?: boolean; senderBlocked?: boolean } = {}) {
    const calls: { url: string; method: string; body?: Record<string, unknown>; headers?: HeadersInit }[] = [];
    const adapter = createEsignAlimtalk({ enabled: options.enabled ?? true, publicOrigin: "https://esign.example.test", config: async orgId => { assert.equal(orgId, "fake-org"); return options.missingConfig ? null : config; }, fetcher: (async (url, init) => {
        const path = String(url), method = init?.method ?? "GET";
        calls.push({ url: path, method, headers: init?.headers, ...(init?.body ? { body: JSON.parse(String(init.body)) } : {}) });
        if (method === "GET") {
            if (options.throwGet) throw Error("fake-status-timeout");
            const expected = templates.find(t => path.endsWith("/" + t.templateCode));
            if (!expected) return Response.json({ header: { isSuccessful: true }, sender: { plusFriendId: "@가상채널", status: options.senderBlocked ? "YSC04" : "YSC03", kakaoStatus: "A", kakaoProfileStatus: "A", alimtalk: {} } });
            const template = { ...structuredClone(expected), status: options.status || "TSC03", block: false, dormant: false };
            options.mutate?.(template);
            return Response.json({ header: { isSuccessful: true }, template });
        }
        if (options.throwPost) throw Error("fake-submission-timeout");
        return options.response?.() ?? Response.json({ header: { isSuccessful: true }, message: { requestId: "fake-request", sendResults: [{ recipientNo: payload.phone, resultCode: 0 }] } });
    }) as typeof fetch });
    return { adapter, calls };
}
test("existing org channel and all three approved templates are required; transport uses the scoped org", async () => {
    const { adapter, calls } = setup();
    const status = await adapter.status("fake-org");
    assert.equal(status.ready, true); assert.equal(status.channelName, "@가상채널"); assert.equal(status.templates.length, 3);
    assert.equal(calls.length, 4); assert(calls.every(c => c.method === "GET"));
});
for (const status of ["TSC01", "TSC02", "TSC04", "unexpected"]) test(`unapproved ${status} blocks readiness and sending without any message POST`, async () => {
    const { adapter, calls } = setup({ status });
    assert.equal((await adapter.status("fake-org")).ready, false);
    assert.equal((await adapter.send(job, "fake-org", payload)).state, "failed");
    assert(!calls.some(c => c.method === "POST"));
});
for (const scenario of ["block", "dormant", "changed-content", "changed-button", "unavailable-channel"] as const) test(`approved but ${scenario} cannot send`, async () => {
    const { adapter, calls } = setup({ senderBlocked: scenario === "unavailable-channel", mutate: template => {
        if (scenario === "block" || scenario === "dormant") template[scenario] = true;
        if (scenario === "changed-content") template.templateContent = "Different unrelated message";
        if (scenario === "changed-button") template.buttons = [{ ordering: 1, type: "WL", name: "Wrong", linkMo: "https://unrelated.example.test" }];
    } });
    assert.equal((await adapter.send(job, "fake-org", payload)).state, "failed");
    assert(!calls.some(c => c.method === "POST"));
});
test("invitation/completion use normal API; OTP uses auth API; all disable SMS fallback and use provider idempotency", async () => {
    for (const kind of ["invitation", "otp", "completed"] as const) {
        const { adapter, calls } = setup();
        assert.deepEqual(await adapter.send({ ...job, kind }, "fake-org", payload), { state: "accepted", providerId: "fake-request" });
        const post = calls.filter(c => c.method === "POST"); assert.equal(post.length, 1);
        assert(post[0].url.endsWith(kind === "otp" ? "/auth/messages" : "/fake-app/messages"));
        assert.equal(new Headers(post[0].headers).get("X-NC-API-IDEMPOTENCY-KEY"), job.id);
        assert.deepEqual(post[0].body!.recipientList, [{ recipientNo: payload.phone, templateParameter: esignAlimtalkParameters({ kind }, payload, "https://esign.example.test"), resendParameter: { isResend: false } }]);
        assert.equal(post[0].body!.templateCode, templates.find(t => t.kind === kind)!.templateCode);
    }
});
for (const [label, response, expected] of [
    ["recipient rejection", () => Response.json({ header: { isSuccessful: true }, message: { requestId: "fake", sendResults: [{ recipientNo: payload.phone, resultCode: -1 }] } }), "failed"],
    ["provider rejection", () => Response.json({ header: { isSuccessful: false } }), "failed"],
    ["missing recipient result", () => Response.json({ header: { isSuccessful: true }, message: { requestId: "fake" } }), "unknown"],
    ["wrong recipient", () => Response.json({ header: { isSuccessful: true }, message: { requestId: "fake", sendResults: [{ recipientNo: "01000000002", resultCode: 0 }] } }), "unknown"],
    ["missing header", () => Response.json({}), "unknown"],
    ["server failure", () => new Response(null, { status: 503 }), "unknown"],
    ["request timeout", () => new Response(null, { status: 408 }), "unknown"],
] as const) test(`${label}: ${expected}, no retry or fallback`, async () => {
    const { adapter, calls } = setup({ response });
    assert.equal((await adapter.send(job, "fake-org", payload)).state, expected);
    assert.equal(calls.filter(c => c.method === "POST").length, 1);
});
test("network failures distinguish preflight failure from uncertain POST and never retry", async () => {
    for (const throwGet of [true, false]) {
        const { adapter, calls } = setup({ throwGet, throwPost: !throwGet });
        assert.equal((await adapter.send(job, "fake-org", payload)).state, throwGet ? "failed" : "unknown");
        assert.equal(calls.filter(c => c.method === "POST").length, throwGet ? 0 : 1);
    }
});
test("disabled/missing configuration and invalid recipient/code do not send", async () => {
    for (const options of [{ enabled: false }, { missingConfig: true }]) {
        const { adapter, calls } = setup(options);
        assert.equal((await adapter.status("fake-org")).ready, false);
        assert.equal((await adapter.send(job, "fake-org", payload)).state, "failed"); assert.equal(calls.length, 0);
    }
    const { adapter, calls } = setup();
    assert.equal((await adapter.send(job, "fake-org", { ...payload, phone: "+12025550123" })).state, "failed");
    assert.equal((await adapter.send({ ...job, kind: "otp" }, "fake-org", { ...payload, code: "no" })).state, "failed");
    assert(!calls.some(c => c.method === "POST"));
});
test("approved readiness is rechecked before send, and Alimtalk routes do not call email/SMS transports", async () => {
    const { adapter, calls } = setup();
    const delivery = createEsignDelivery({ publicOrigin: "https://esign.example.test", alimtalk: adapter, emailSender: async () => { throw Error("Email must not run"); }, fetcher: (async () => { throw Error("SMS must not run"); }) as typeof fetch });
    assert.equal(await delivery.ready("alimtalk", "fake-org"), true);
    calls.length = 0;
    assert.equal((await delivery.send(job, "fake-org", payload)).state, "accepted");
    assert.equal(calls.filter(c => c.method === "GET").length, 2);
    assert.equal(calls.filter(c => c.method === "POST").length, 1);
});
test("template variables preserve one exact HTTPS sign link, and OTP validity agrees with server", () => {
    assert.deepEqual(esignAlimtalkParameters(job, { ...payload, title: "계약\n제목" }, "https://esign.example.test"), { 이름: payload.name, 문서명: "계약 제목", 서명주소: `esign.example.test/sign/${payload.token}` });
    for (const origin of ["http://esign.example.test", "https://esign.example.test/other", "https://user:pass@esign.example.test", "https://esign.example.test?query=1"])
        assert.throws(() => esignAlimtalkParameters(job, payload, origin));
    assert.throws(() => esignAlimtalkParameters(job, { ...payload, token: "bad" }, "https://esign.example.test"));
    assert(templates.find(t => t.kind === "otp")!.templateContent.includes(`${OTP_TTL_MS / 60000}분`));
});

test("UX-261: 상태 조회 시간 초과는 unavailable로 표시하고 미승인과 구분한다", async () => {
    const timeout = await setup({ throwGet: true }).adapter.status("fake-org");
    assert.equal(timeout.ready, false); assert.equal(timeout.unavailable, true);
    const unapproved = await setup({ status: "TSC02" }).adapter.status("fake-org");
    assert.equal(unapproved.ready, false); assert.equal(unapproved.unavailable, undefined);
    assert.equal((await setup({ missingConfig: true }).adapter.status("fake-org")).unavailable, undefined);
});
