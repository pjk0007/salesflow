import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import {
    channelInput,
    inputErrorMessage,
    messageInput,
    normalizeOrigins,
    safePageUrl,
    sameRequestOrigin,
    sameApplicationOrigin,
} from "./rules";
test("공개 HTTPS 주소를 설정한 프록시 배포는 내부 HTTP와 독립적으로 같은 출처를 판별", () => {
    const app = "https://preview.example.test";
    const internal = "http://0.0.0.0:3000";
    assert.ok(sameApplicationOrigin(app, internal, app));
    for (const origin of [
        internal,
        "https://other.example.test",
        "http://preview.example.test",
        "https://preview.example.test:444",
        "https://preview.example.test.evil.test",
        "null",
    ])
        assert.equal(sameApplicationOrigin(origin, internal, app), false);
    assert.ok(sameApplicationOrigin("https://sendb.kr", internal, "https://sendb.kr/"));
});
test("공개 주소가 없는 로컬 개발은 기존 비교, 잘못된 공개 주소는 거부", () => {
    assert.ok(sameApplicationOrigin("http://127.0.0.1:3120", "http://localhost:3120", undefined));
    for (const app of ["broken", "javascript:alert(1)", "https://user:password@example.test"])
        assert.equal(sameApplicationOrigin("https://example.test", "https://example.test", app), false);
});
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

test("입력 오류는 스키마의 한국어 문구를 유지하고 영어 기본 문구만 라벨+고정 문구로 바꾼다", () => {
    const tooLong = messageInput.safeParse({ clientId: "00000000-0000-4000-8000-000000000001", body: "가".repeat(5001) });
    assert.equal(tooLong.success, false);
    assert.equal(inputErrorMessage(tooLong.error!), "메시지는 5,000자까지 입력할 수 있습니다.");
    const email = z.object({ email: z.string().email() }).safeParse({ email: "not-email" });
    assert.equal(inputErrorMessage(email.error!), "이메일: 입력 형식과 길이를 확인해주세요.");
    const unknownField = messageInput.safeParse({ clientId: "x", body: "안녕하세요" });
    assert.equal(inputErrorMessage(unknownField.error!), "입력값: 입력 형식과 길이를 확인해주세요.");
});
