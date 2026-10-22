import test from "node:test";
import assert from "node:assert/strict";
import { buildPublicUnsubscribeUrl, isPublicUnsubscribeUrl, resolveEmailPublicOrigin } from "./email-public-url";

const dev = "https://port-next-sendb-dev-1ru12mlw8nvyar.sel5.cloudtype.app";

test("development service uses its own host even with the old production base URL", () => {
    const env = { NEXT_PUBLIC_APP_URL: dev, NEXT_PUBLIC_BASE_URL: "https://sendb.kr", NODE_ENV: "production" };
    assert.equal(buildPublicUnsubscribeUrl("unsub_123", false, env), `${dev}/unsubscribe?token=unsub_123`);
    assert.equal(buildPublicUnsubscribeUrl("unsub_123", true, env), `${dev}/api/email/unsubscribe/one-click?token=unsub_123`);
});

test("explicit server URL and legacy configurations resolve predictably", () => {
    assert.equal(resolveEmailPublicOrigin({ EMAIL_PUBLIC_BASE_URL: "https://mail.example.test/", NEXT_PUBLIC_APP_URL: dev }), "https://mail.example.test");
    assert.equal(resolveEmailPublicOrigin({ NEXT_PUBLIC_BASE_URL: "https://sendb.kr/" }), "https://sendb.kr");
    assert.equal(resolveEmailPublicOrigin({ NODE_ENV: "development" }), "http://localhost:3000");
    assert.equal(resolveEmailPublicOrigin({}), "https://sendb.kr");
    assert.equal(resolveEmailPublicOrigin({ EMAIL_PUBLIC_BASE_URL: "http://localhost:3100" }), "http://localhost:3100");
});

test("invalid public URL fails rather than producing unusable or credential-bearing links", () => {
    for (const value of ["not a URL", "javascript:alert(1)", "http://dev.example.test", "https://user:secret@example.test", "https://example.test/path", "https://example.test/?q=1", "https://example.test/#x"]) {
        assert.throws(() => resolveEmailPublicOrigin({ EMAIL_PUBLIC_BASE_URL: value }));
    }
});

test("unsubscribe tokens are encoded and only exact unsubscribe paths skip tracking", () => {
    const env = { NEXT_PUBLIC_APP_URL: dev };
    const url = buildPublicUnsubscribeUrl('a&b="<>', false, env);
    assert.equal(new URL(url).searchParams.get("token"), 'a&b="<>');
    assert.equal(isPublicUnsubscribeUrl(url, env), true);
    assert.equal(isPublicUnsubscribeUrl("https://sendb.kr/unsubscribe?token=old", env), true);
    assert.equal(isPublicUnsubscribeUrl(buildPublicUnsubscribeUrl("x", true, env), env), true);
    for (const value of ["https://sendb.kr.evil.test/unsubscribe", `${dev}/unsubscribe-pretend`, "https://other.example.test/unsubscribe", "/unsubscribe"]) {
        assert.equal(isPublicUnsubscribeUrl(value, env), false);
    }
});
