import test from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { isolateEnv } from "./auth-fake-db.test-helper";

test("UX-053 임베드 허용 헤더는 실제 공개 폼 경로 /f/*에 CSP frame-ancestors로만 붙고 전자서명은 계속 막는다", async () => {
    const { default: config } = await import("../../next.config");
    const rules = await config.headers!();
    const form = rules.find((r) => r.source === "/f/:slug*");
    assert.ok(form, "/f/:slug* 규칙이 있어야 한다");
    assert.deepEqual(form.headers, [{ key: "Content-Security-Policy", value: "frame-ancestors *" }]);
    assert.equal(rules.some((r) => r.source.startsWith("/forms")), false);
    assert.equal(rules.some((r) => r.headers.some((h) => h.value === "ALLOWALL")), false);
    const sign = rules.find((r) => r.source === "/sign/:token*");
    assert.ok(sign?.headers.some((h) => h.key === "X-Frame-Options" && h.value === "DENY"));
});

test("UX-041 v1 사전 요청은 PATCH·x-api-key를 허용하고 레코드 API도 같은 CORS·한국어 오류를 돌려준다", async (t) => {
    isolateEnv(t);
    const { middleware } = await import("../../middleware");
    const preflight = middleware(new NextRequest("http://localhost/api/v1/crm/contacts/1", {
        method: "OPTIONS",
        headers: { "access-control-request-method": "PATCH", "access-control-request-headers": "x-api-key, content-type" },
    }));
    assert.equal(preflight.status, 204);
    assert.match(preflight.headers.get("access-control-allow-methods") ?? "", /\bPATCH\b/);
    assert.match(preflight.headers.get("access-control-allow-headers") ?? "", /x-api-key/);

    const { POST, GET } = await import("../app/api/v1/records/route");
    const post = await POST(new NextRequest("http://localhost/api/v1/records", { method: "POST", body: "{}" }));
    assert.equal(post.status, 401);
    assert.equal((await post.json()).error, "API 토큰이 없거나 올바르지 않습니다.");
    // 라우트가 붙이는 헤더가 middleware 값을 줄이지 않는다 (예전엔 POST만·x-api-key 없음으로 덮었다)
    assert.equal(post.headers.get("access-control-allow-methods"), preflight.headers.get("access-control-allow-methods"));
    assert.match(post.headers.get("access-control-allow-headers") ?? "", /x-api-key/);

    const get = await GET(new NextRequest("http://localhost/api/v1/records?partitionId=1"));
    assert.equal(get.status, 401);
    assert.match((await get.json()).error, /[가-힣]/);
});

test("UX-041 외부 이벤트 입력 검증 문구는 한국어다", async () => {
    const { parseEventInput } = await import("./record-events");
    for (const input of [null, [], { label: "x" }, { type: "t" }, { type: "t", label: "l", occurredAt: "nope" }, { type: "t", label: "l", meta: [] }]) {
        const result = parseEventInput(input);
        assert.equal(result.ok, false);
        if (!result.ok) assert.match(result.error, /[가-힣]/);
    }
});
