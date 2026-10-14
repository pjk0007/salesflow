import { test } from "node:test";
import assert from "node:assert/strict";
import {
    channelInput,
    normalizeOrigins,
    safePageUrl,
    sameRequestOrigin,
} from "./rules";
test("Next.js가 정규화하는 로컬 주소는 같은 출처, 외부 출처와 다른 포트는 차단", () => {
    assert.ok(
        sameRequestOrigin("http://127.0.0.1:3120", "http://localhost:3120"),
    );
    assert.ok(sameRequestOrigin("https://sendb.kr", "https://sendb.kr"));
    assert.ok(!sameRequestOrigin("https://other.test", "https://sendb.kr"));
    assert.ok(
        !sameRequestOrigin("http://localhost:3121", "http://localhost:3120"),
    );
    assert.ok(!sameRequestOrigin("http://sendb.kr", "https://sendb.kr"));
});
test("설치 도메인과 방문 페이지는 정확한 origin만 허용하고 쿼리는 버림", () => {
    assert.deepEqual(
        normalizeOrigins(["https://example.test/", "https://example.test"]),
        ["https://example.test"],
    );
    assert.throws(() => normalizeOrigins(["https://example.test/path"]));
    assert.throws(() => normalizeOrigins(["http://external.test"]));
    assert.throws(() => normalizeOrigins(["https://a:b@example.test"]));
    assert.equal(
        safePageUrl("https://example.test/pricing?email=private#secret", [
            "https://example.test",
        ]),
        "https://example.test/pricing",
    );
    assert.equal(
        safePageUrl("https://example.test.evil.test/", [
            "https://example.test",
        ]),
        null,
    );
    assert.equal(
        safePageUrl("javascript:alert(1)", ["https://example.test"]),
        null,
    );
});
test("상담창의 잘못된 도메인과 도메인 없는 활성화는 입력 오류", () => {
    const base = {
        workspaceId: 8,
        name: "상담",
        greeting: "안녕하세요",
        color: "#635BFF",
        enabled: true,
    };
    assert.equal(
        channelInput.safeParse({ ...base, allowedOrigins: ["not-a-url"] })
            .success,
        false,
    );
    assert.equal(
        channelInput.safeParse({ ...base, allowedOrigins: [] }).success,
        false,
    );
});
