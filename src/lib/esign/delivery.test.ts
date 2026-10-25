import { test } from "node:test";
import assert from "node:assert/strict";
import { createEsignDelivery, esignMessage } from "./delivery";
import type { EsignJob } from "./types";
import { OTP_TTL_MS } from "./rules";
import { EMAIL_SEND_BLOCKED, EMAIL_SEND_CHECK_FAILED, EMAIL_SEND_INVALID_CONTEXT } from "../email-send-guard";
const invitation = { id: "fake-job", kind: "invitation", channel: "sms" } as EsignJob;
const payload = { name: "가상 고객", phone: "01000000000", email: "fake@example.test", title: "가상 계약서", token: "a".repeat(43) };
const sms = { appKey: "fake-key", secretKey: "fake-secret", sender: "0200000000" };
test("이메일 단독 요청은 지정 발신자와 수신자 한 명으로 접수하고 SMS를 호출하지 않는다", async () => {
    const requests: unknown[] = [];
    const delivery = createEsignDelivery({ publicOrigin: "https://example.test", emailSender: async orgId => {
        assert.equal(orgId, "fake-org");
        return { address: "contract@example.test", name: "계약 담당자", submit: async request => {
            requests.push(request);
            return { header: { isSuccessful: true, resultCode: 0 }, data: { requestId: "fake-email-request", results: [{ resultCode: 0 }] } };
        } };
    }, fetcher: (async () => { throw new Error("이메일 단독 요청에서 SMS를 호출하면 안 됩니다."); }) as typeof fetch });
    assert.equal(await delivery.ready("email", "fake-org"), true);
    assert.deepEqual(await delivery.send({ ...invitation, channel: "email" }, "fake-org", payload), { state: "accepted", providerId: "fake-email-request" });
    assert.equal(requests.length, 1);
    assert.deepEqual(requests[0], { senderAddress: "contract@example.test", senderName: "계약 담당자", title: "[샌드비] 서명을 요청드립니다", body: esignMessage(invitation, payload, "https://example.test").html, receiverList: [{ receiveMailAddr: payload.email, receiveType: "MRT0" }] });
});
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
test("UX-266: 전송 전 설정 조회·공개 주소 오류는 unknown이 아닌 미발송", async () => {
    let sent = 0;
    for (const publicOrigin of ["invalid", "https://example.test"]) {
        const delivery = createEsignDelivery({ publicOrigin, emailSender: async () => { throw new Error("fake lookup failure"); }, fetcher: (async () => { sent++; throw Error("must not send"); }) as typeof fetch });
        const result = await delivery.send({ ...invitation, channel: "email" }, "fake-org", payload);
        assert.equal(result.state, "failed");
    }
    assert.equal(sent, 0);
});
test("UX-264: 발송 가드의 한국어 사유를 보존하고 누락된 접수 결과는 unknown", async () => {
    for (const code of [EMAIL_SEND_BLOCKED, EMAIL_SEND_CHECK_FAILED, EMAIL_SEND_INVALID_CONTEXT, 0]) {
        const delivery = createEsignDelivery({ publicOrigin: "https://example.test", emailSender: async () => ({ address: "sender@example.test", submit: async () => ({ header: { isSuccessful: code === 0, resultCode: code, resultMessage: "가상 수신거부 확인 실패: 보내지 않았습니다." }, data: null }) }) });
        const result = await delivery.send({ ...invitation, channel: "email" }, "fake-org", payload);
        assert.equal(result.state, code === 0 ? "unknown" : "failed");
        if (code !== 0) assert.match(result.error!, /가상 수신거부 확인 실패/);
    }
});
