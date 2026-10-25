import test from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { installFakeDb, isolateEnv, isMembershipLookup } from "./auth-fake-db.test-helper";

test("UX-049 OAuth 전 빈 토큰은 연결 대기로 저장·조회하고 실패 콜백은 연결됨을 쓰지 않는다", async (t) => {
    isolateEnv(t);
    const { db } = await import("./db");
    const { generateToken, sealOAuthState } = await import("./auth");
    const platforms = await import("../app/api/ad-platforms/route");
    const callback = await import("../app/api/meta/callback/route");
    const orgId = "00000000-0000-4000-8000-000000000049";
    const credentials = { type: "meta", accessToken: "", appId: "fake-app", appSecret: "short", pageAccessTokens: { page1: "private-page-token", type: "hidden" } };
    const token = generateToken({ userId: "00000000-0000-4000-8000-000000000001", orgId, role: "admin", tokenVersion: 0, membershipId: 71 } as never);
    const state = sealOAuthState("meta", { orgId, platformId: 5 });
    const request = (method = "GET") => new NextRequest("http://localhost/api/ad-platforms", { method,
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        ...(method === "POST" ? { body: JSON.stringify({ platform: "meta", name: "가상 연결", credentials }) } : {}),
    });
    await t.test("빈 토큰 신규와 과거 connected 행", async (t) => {
        const { calls } = installFakeDb(t, db, (c) => isMembershipLookup(c) ? [{ role: "admin", tokenVersion: 0, membershipId: 71, isSuperAdmin: 0 }]
            : c.table === "ad_platforms" ? [{ id: 5, orgId, platform: "meta", status: "connected", credentials }] : []);
        assert.equal((await platforms.POST(request("POST"))).status, 201);
        assert.equal((calls.find((c) => c.op === "insert")?.values as { status: string }).status, "disconnected");
        const response = await platforms.GET(request());
        const payload = await response.json();
        assert.equal(payload.data[0].status, "disconnected");
        assert.equal(payload.data[0].credentials.appSecret, "****");
        assert.equal(payload.data[0].credentials.pageAccessTokens.page1, "priv****");
        assert.equal(payload.data[0].credentials.pageAccessTokens.type, "****");
    });
    for (const reply of [{}, { error: { message: '</script><script>alert("external")</script>' } }, { access_token: "" }]) {
        await t.test("토큰 교환 실패", async (t) => {
            const { calls } = installFakeDb(t, db, () => [{ id: 5, orgId, credentials }]);
            t.mock.method(globalThis, "fetch", async () => Response.json(reply));
            const response = await callback.GET(new NextRequest(`http://localhost/api/meta/callback?code=fake&state=${encodeURIComponent(state)}`));
            const html = await response.text();
            assert.match(html, /Meta 인증에 실패/);
            assert.doesNotMatch(html, /alert\("external"\)/);
            assert.equal(calls.filter((c) => c.op === "update").length, 0);
        });
    }
    await t.test("정상 교환만 연결 상태로 저장", async (t) => {
        const { calls } = installFakeDb(t, db, () => [{ id: 5, orgId, credentials }]);
        t.mock.method(globalThis, "fetch", async () => Response.json({ access_token: "fake-success-token" }));
        const response = await callback.GET(new NextRequest(`http://localhost/api/meta/callback?code=fake&state=${encodeURIComponent(state)}`));
        assert.match(await response.text(), /Meta 연결이 완료/);
        assert.equal((calls.find((c) => c.op === "update")?.set as { status: string }).status, "connected");
    });
});

test("UX-049 콜백 안내 HTML은 utf-8로 선언해 취소·실패 문구가 깨지지 않는다", async (t) => {
    isolateEnv(t);
    const callback = await import("../app/api/meta/callback/route");
    for (const url of ["http://localhost/api/meta/callback?error=access_denied", "http://localhost/api/meta/callback", "http://localhost/api/meta/callback?code=x&state=forged"]) {
        const response = await callback.GET(new NextRequest(url));
        assert.equal(response.headers.get("content-type"), "text/html; charset=utf-8");
        assert.equal(response.headers.get("cache-control"), "no-store");
        const html = new TextDecoder("utf-8").decode(await response.arrayBuffer());
        assert.match(html, /<meta charset="utf-8">/);
        assert.match(html, /Meta 연결이 취소되었습니다|잘못된 요청입니다|연결 요청이 만료되었거나/);
    }
});
