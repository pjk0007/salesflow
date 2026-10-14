import { test } from "node:test";
import assert from "node:assert/strict";
import type { lookup } from "node:dns/promises";
import { publicAddress, webhookUrl, retryDelay } from "./webhook-rules";
import { resolveWebhookAddress } from "./webhook-transport";
import { signSendbWebhook, verifySendbWebhook } from "../../../sdk/webhooks";
import {
    sealWebhookSecret,
    openWebhookSecret,
    newWebhookSecret,
} from "./webhook-crypto";
test("웹훅은 공개 HTTPS 호스트·경로만 등록", () => {
    assert.equal(
        webhookUrl("https://receiver.example.com/path"),
        "https://receiver.example.com/path",
    );
    for (const raw of [
        "http://example.com",
        "https://127.0.0.1/x",
        "https://[::1]/",
        "https://user:pass@example.com/",
        "https://example.com/?key=x",
        "https://example.com/#x",
        "https://example.com:444/",
        "https://service.internal/",
        "https://localhost/",
    ])
        assert.throws(() => webhookUrl(raw));
});
test("DNS 주소는 public IPv4/IPv6만 허용·private/metadata/문서용 범위 거절", () => {
    for (const ip of [
        "8.8.8.8",
        "1.1.1.1",
        "192.0.78.25",
        "2001:4860:4860::8888",
        "2606:4700:4700::1111",
    ])
        assert.ok(publicAddress(ip), ip);
    for (const ip of [
        "127.1.2.3",
        "0.0.0.0",
        "10.0.0.1",
        "100.64.0.1",
        "169.254.169.254",
        "172.16.0.1",
        "172.31.255.255",
        "192.168.1.1",
        "192.0.2.1",
        "198.18.0.1",
        "198.51.100.3",
        "203.0.113.7",
        "224.0.0.1",
        "255.255.255.255",
        "::1",
        "::ffff:8.8.8.8",
        "fe80::1",
        "fc00::1",
        "2001:db8::1",
        "2002:0808:0808::1",
        "not-an-ip",
    ])
        assert.ok(!publicAddress(ip), ip);
});
test("DNS 전체 결과 검증 후 실제 연결에 쓸 주소 반환", async () => {
    const resolver = (async () => [
        { address: "8.8.8.8", family: 4 },
    ]) as unknown as typeof lookup;
    assert.equal(
        (await resolveWebhookAddress("receiver.example.com", resolver)).address,
        "8.8.8.8",
    );
    await assert.rejects(
        resolveWebhookAddress("receiver.example.com", (async () => [
            { address: "8.8.8.8", family: 4 },
            { address: "127.0.0.1", family: 4 },
        ]) as unknown as typeof lookup),
    );
});
test("원문+이벤트 ID+시간 HMAC 검증과 변조/재생 거절", () => {
    const secret = newWebhookSecret(),
        now = new Date("2026-10-14T00:00:00Z"),
        id = "event-id",
        body = JSON.stringify({ id, data: { text: "한글 이벤트" } }),
        timestamp = String(now.getTime() / 1000),
        signature = signSendbWebhook(body, id, timestamp, secret),
        headers = { id, timestamp, signature };
    assert.ok(verifySendbWebhook(body, headers, secret, now));
    for (const wrong of [
        { ...headers, id: "other" },
        { ...headers, timestamp: String(Number(timestamp) - 301) },
        { ...headers, signature: "v1=short" },
        { ...headers, signature: "v1=" + "0".repeat(64) },
    ])
        assert.ok(!verifySendbWebhook(body, wrong, secret, now));
    assert.ok(!verifySendbWebhook(body + " ", headers, secret, now));
    assert.ok(!verifySendbWebhook(body, headers, newWebhookSecret(), now));
    const mismatch = JSON.stringify({ id: "other" });
    assert.ok(
        !verifySendbWebhook(
            mismatch,
            {
                ...headers,
                signature: signSendbWebhook(mismatch, id, timestamp, secret),
            },
            secret,
            now,
        ),
    );
});
test("서명 키는 암호화 저장·조직/연동 AAD 격리", () => {
    const before = process.env.CUSTOMER_WEBHOOK_ENCRYPTION_KEY;
    process.env.CUSTOMER_WEBHOOK_ENCRYPTION_KEY =
        "isolated-webhook-test-master";
    try {
        const secret = newWebhookSecret(),
            sealed = sealWebhookSecret(secret, "org-a:endpoint-a");
        assert.ok(!sealed.includes(secret));
        assert.equal(openWebhookSecret(sealed, "org-a:endpoint-a"), secret);
        assert.throws(() => openWebhookSecret(sealed, "org-b:endpoint-a"));
    } finally {
        if (before === undefined)
            delete process.env.CUSTOMER_WEBHOOK_ENCRYPTION_KEY;
        else process.env.CUSTOMER_WEBHOOK_ENCRYPTION_KEY = before;
    }
});
test("재시도 간격·Retry-After·날짜·최대 하루 경계", () => {
    const now = new Date("2026-10-14T00:00:00Z");
    assert.equal(retryDelay(1, null, now), 60000);
    assert.equal(retryDelay(2, null, now), 300000);
    assert.equal(retryDelay(1, "180", now), 180000);
    assert.equal(retryDelay(1, "Wed, 14 Oct 2026 00:04:00 GMT", now), 240000);
    assert.equal(retryDelay(1, "99999999", now), 86400000);
    assert.equal(retryDelay(1, "invalid", now), 60000);
});
