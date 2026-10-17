import { test } from "node:test";
import assert from "node:assert/strict";
import { createEsignDelivery, esignMessage } from "./delivery";
import type { EsignJob } from "./types";
import { OTP_TTL_MS } from "./rules";
const invitation = { id: "fake-job", kind: "invitation", channel: "sms" } as EsignJob;
const payload = { name: "가상 고객", phone: "01000000000", email: "fake@example.test", title: "가상 계약서", token: "a".repeat(43) };
const sms = { appKey: "fake-key", secretKey: "fake-secret", sender: "0200000000" };
test("확인 코드 안내 시간은 실제 서버 유효시간과 일치한다", () => {
    const message = esignMessage({ kind: "otp" }, { code: "123456" }, "https://example.test");
    assert.ok(message.text.includes(`${Math.floor(OTP_TTL_MS / 60_000)}분`));
    assert.ok(message.html.includes(`${Math.floor(OTP_TTL_MS / 60_000)}분`));
});
test("SMS 단독 발송은 NHN 문자 API로 보내고 공식 수신자별 결과로 접수를 판단한다", async () => {
    const calls: { url: string; body: Record<string, unknown> }[] = [];
    const delivery = createEsignDelivery({ publicOrigin: "https://example.test", emailSender: async () => null, sms, fetcher: (async (url, options) => {
        calls.push({ url: String(url), body: JSON.parse(options!.body as string) });
        return Response.json({ header: { isSuccessful: true }, body: { data: { requestId: "fake-request", sendResultList: [{ recipientNo: payload.phone, resultCode: 0 }] } } });
    }) as typeof fetch });
    assert.deepEqual(await delivery.send(invitation, "fake-org", payload), { state: "accepted", providerId: "fake-request" });
    assert.match(calls[0].url, /sms\.api\.nhncloudservice\.com\/sms\/v3\.0\/appKeys\/fake-key\/sender\/mms$/);
    assert.deepEqual(calls[0].body.recipientList, [{ recipientNo: payload.phone }]);
    assert(!calls[0].url.includes("alimtalk"));
});
test("확인 코드는 짧은 SMS로, 미설정 채널은 실제 요청 없이 실패로 표시한다", async () => {
    let calls = 0;
    const notReady = createEsignDelivery({ publicOrigin: "https://example.test", emailSender: async () => null, fetcher: (async () => { calls++; throw Error("must not send"); }) as typeof fetch });
    assert.equal(await notReady.ready("sms", "fake-org"), false);
    assert.equal((await notReady.send(invitation, "fake-org", payload)).state, "failed");
    assert.equal(calls, 0);
    const delivery = createEsignDelivery({ publicOrigin: "https://example.test", emailSender: async () => null, sms, fetcher: (async (url) => {
        assert.match(String(url), /\/sender\/sms$/);
        return Response.json({ header: { isSuccessful: true }, body: { data: { requestId: "fake-otp", sendResultList: [{ resultCode: 0 }] } } });
    }) as typeof fetch });
    assert.equal((await delivery.send({ ...invitation, kind: "otp" }, "fake-org", { ...payload, code: "123456" })).state, "accepted");
});
test("수신자 실패와 불확실한 응답을 구분하고 재전송하지 않는다", async () => {
    for (const [response, state] of [[Response.json({ header: { isSuccessful: true }, body: { data: { requestId: "fake", sendResultList: [{ resultCode: -1 }] } } }), "failed"], [Response.json({ header: { isSuccessful: true }, body: { data: { requestId: "fake" } } }), "unknown"], [new Response(null, { status: 503 }), "unknown"]] as const) {
        let calls = 0;
        const delivery = createEsignDelivery({ publicOrigin: "https://example.test", emailSender: async () => null, sms, fetcher: (async () => { calls++; return response; }) as typeof fetch });
        assert.equal((await delivery.send(invitation, "fake-org", payload)).state, state);
        assert.equal(calls, 1);
    }
});
test("이메일에는 계약명과 이름을 HTML로 삽입하지 않고 접수 불명은 자동 재발송하지 않는다", async () => {
    const content = esignMessage(invitation, { ...payload, name: '<img src=x>', title: '<script>bad</script>' }, "https://example.test");
    assert(!content.html.includes("<script>")); assert(!content.html.includes("<img"));
    let submissions = 0;
    const delivery = createEsignDelivery({ publicOrigin: "https://example.test", timeoutMs: 5, emailSender: async () => ({ address: "sender@example.test", submit: async () => { submissions++; return new Promise(() => undefined); } }) });
    assert.equal((await delivery.send({ ...invitation, channel: "email" }, "fake-org", payload)).state, "unknown");
    assert.equal(submissions, 1);
});
