import test from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { installFakeDb, isolateEnv, isMembershipLookup } from "./auth-fake-db.test-helper";

const ORG = "00000000-0000-4000-8000-000000000049";
const OTHER_ORG = "00000000-0000-4000-8000-000000000050";
const admin = { role: "admin", tokenVersion: 0, membershipId: 71, isSuperAdmin: 0 };

async function staffToken(role = "admin") {
    const { generateToken } = await import("./auth");
    return generateToken({ userId: "00000000-0000-4000-8000-000000000001", orgId: ORG, email: "test@example.test", name: "가상", role, tokenVersion: 0, membershipId: 71 } as never);
}

test("UX-049·051 Meta 오류 해석 — 토큰 오류만 다시 인증 안내, 영문 원문은 화면 문구에 싣지 않는다", async (t) => {
    isolateEnv(t);
    const { isMetaTokenError, metaErrorMessage } = await import("./meta-graph");
    assert.equal(isMetaTokenError({ code: 190, message: "Error validating access token: Session has expired" }), true);
    assert.equal(isMetaTokenError({ code: 102 }), true);
    assert.equal(isMetaTokenError({ code: 4 }), false);
    assert.equal(isMetaTokenError(null), false);
    for (const error of [{ code: 190, message: "Error validating access token" }, { code: 17 }, { code: 200 }, { code: 1, message: "An unknown error occurred" }, undefined]) {
        const text = metaErrorMessage(error);
        assert.match(text, /[가-힣]/);
        assert.doesNotMatch(text, /Error validating|unknown error/);
    }
    assert.match(metaErrorMessage({ code: 190 }), /다시 연결/);
});

test("UX-049 장기 토큰 교환 — 성공하면 장기 토큰·만료 시각, 실패하면 단기 토큰과 그 만료 시각으로 연결을 막지 않는다", async (t) => {
    isolateEnv(t);
    const { exchangeLongLivedToken } = await import("./meta-graph");
    const now = new Date("2026-10-25T00:00:00.000Z");
    const urls: string[] = [];
    const ok = await exchangeLongLivedToken({ appId: "app", appSecret: "secret", shortToken: "short", shortExpiresIn: 3600 },
        async (url) => { urls.push(url); return { ok: true, json: async () => ({ access_token: "long", expires_in: 5184000 }) }; }, now);
    assert.deepEqual(ok, { accessToken: "long", expiresAt: "2026-12-24T00:00:00.000Z", longLived: true });
    const query = new URL(urls[0]).searchParams;
    assert.equal(query.get("grant_type"), "fb_exchange_token");
    assert.equal(query.get("fb_exchange_token"), "short");

    for (const reply of [{ ok: false, json: async () => ({ error: { code: 190 } }) }, { ok: true, json: async () => ({}) }]) {
        const fallback = await exchangeLongLivedToken({ appId: "app", appSecret: "secret", shortToken: "short", shortExpiresIn: 3600 }, async () => reply, now);
        assert.deepEqual(fallback, { accessToken: "short", expiresAt: "2026-10-25T01:00:00.000Z", longLived: false });
    }
    const thrown = await exchangeLongLivedToken({ appId: "app", appSecret: "secret", shortToken: "short" }, async () => { throw new TypeError("network"); }, now);
    assert.deepEqual(thrown, { accessToken: "short", expiresAt: null, longLived: false });
});

test("UX-049 콜백은 장기 토큰과 만료 시각을 저장하고 응답에 비밀값을 싣지 않는다", async (t) => {
    isolateEnv(t);
    const { db } = await import("./db");
    const { sealOAuthState } = await import("./auth");
    const callback = await import("../app/api/meta/callback/route");
    const credentials = { type: "meta", accessToken: "", appId: "fake-app", appSecret: "fake-secret", pageAccessTokens: {}, webhookVerifyToken: "v" };
    const state = sealOAuthState("meta", { orgId: ORG, platformId: 5 });
    const { calls } = installFakeDb(t, db, () => [{ id: 5, orgId: ORG, credentials }]);
    const fetched: string[] = [];
    t.mock.method(globalThis, "fetch", async (url: string) => {
        fetched.push(String(url));
        return String(url).includes("fb_exchange_token")
            ? Response.json({ access_token: "fake-long-token", expires_in: 5184000 })
            : Response.json({ access_token: "fake-short-token", expires_in: 3600 });
    });
    const response = await callback.GET(new NextRequest(`http://localhost/api/meta/callback?code=fake&state=${encodeURIComponent(state)}`));
    const html = await response.text();
    assert.match(html, /Meta 연결이 완료/);
    assert.doesNotMatch(html, /fake-long-token|fake-secret/);
    assert.equal(fetched.length, 2);
    const set = calls.find((c) => c.op === "update")?.set as { status: string; credentials: { accessToken: string; tokenExpiresAt: string } };
    assert.equal(set.status, "connected");
    assert.equal(set.credentials.accessToken, "fake-long-token");
    assert.ok(Date.parse(set.credentials.tokenExpiresAt) > Date.now() + 50 * 86400000);
});

test("UX-049·051 계정 동기화 — 토큰 만료는 '만료됨'+한국어 409, 미구현 플랫폼은 성공으로 답하지 않고, 기타 오류는 고정 문구", async (t) => {
    isolateEnv(t);
    const { db } = await import("./db");
    const sync = await import("../app/api/ad-platforms/[id]/sync/route");
    const token = await staffToken();
    const request = () => new NextRequest("http://localhost/api/ad-platforms/5/sync", { method: "POST", headers: { authorization: `Bearer ${token}` } });
    const ctx = { params: Promise.resolve({ id: "5" }) };
    const meta = { id: 5, orgId: ORG, platform: "meta", status: "connected", credentials: { type: "meta", accessToken: "fake-token" } };

    await t.test("토큰 만료", async (t) => {
        const { calls } = installFakeDb(t, db, (c) => isMembershipLookup(c) ? [admin] : c.table === "ad_platforms" && c.op === "select" ? [meta] : []);
        t.mock.method(globalThis, "fetch", async () => Response.json({ error: { code: 190, message: "Error validating access token: Session has expired" } }, { status: 400 }));
        const response = await sync.POST(request(), ctx);
        assert.equal(response.status, 409);
        const body = await response.json();
        assert.match(body.error, /다시 연결/);
        assert.doesNotMatch(body.error, /Error validating/);
        const updates = calls.filter((c) => c.op === "update" && c.table === "ad_platforms");
        assert.equal(updates.length, 1);
        assert.equal((updates[0].set as { status: string }).status, "expired");
    });
    await t.test("연결 실패", async (t) => {
        installFakeDb(t, db, (c) => isMembershipLookup(c) ? [admin] : c.table === "ad_platforms" && c.op === "select" ? [meta] : []);
        t.mock.method(globalThis, "fetch", async () => { throw new TypeError("fetch failed"); });
        const response = await sync.POST(request(), ctx);
        assert.equal(response.status, 502);
        assert.match((await response.json()).error, /연결하지 못했습니다/);
    });
    await t.test("미구현 플랫폼", async (t) => {
        const { calls } = installFakeDb(t, db, (c) => isMembershipLookup(c) ? [admin] : c.table === "ad_platforms" && c.op === "select" ? [{ ...meta, platform: "google" }] : []);
        const fetchMock = t.mock.method(globalThis, "fetch", async () => Response.json({}));
        const response = await sync.POST(request(), ctx);
        assert.equal(response.status, 400);
        assert.equal((await response.json()).success, false);
        assert.equal(fetchMock.mock.callCount(), 0);
        assert.equal(calls.filter((c) => c.op === "update").length, 0);
    });
    await t.test("DB 내부 오류", async (t) => {
        installFakeDb(t, db, (c) => isMembershipLookup(c) ? [admin] : c.table === "ad_platforms" && c.op === "select" ? [meta] : c.table === "ad_accounts" ? new Error('relation "ad_accounts" does not exist') : []);
        t.mock.method(globalThis, "fetch", async () => Response.json({ data: [{ id: "act_1", name: "가상", account_status: 1, currency: "KRW", amount_spent: "0" }] }));
        const response = await sync.POST(request(), ctx);
        assert.equal(response.status, 500);
        assert.equal((await response.json()).error, "서버 오류가 발생했습니다.");
    });
});

test("UX-049 웹훅 리드 조회의 토큰 오류는 플랫폼을 '만료됨'으로 바꾸고 실패 사유를 한국어로 남긴다", async (t) => {
    isolateEnv(t);
    const { db } = await import("./db");
    const { processMetaLead } = await import("./meta-lead-record");
    const integration = { id: 9, orgId: ORG, adAccountId: 3, formId: "form-1", partitionId: 11, fieldMappings: {}, defaultValues: null, isActive: 1, platform: "meta" };
    const { calls } = installFakeDb(t, db, (c) => {
        if (c.table === "ad_lead_integrations") return [integration];
        if (c.table === "ad_lead_logs" && c.op === "select") return [];
        if (c.table === "ad_accounts") return [{ platformId: 5, credentials: { type: "meta", accessToken: "fake-token" } }];
        return [];
    });
    t.mock.method(globalThis, "fetch", async () => Response.json({ error: { code: 190, message: "Error validating access token" } }));
    await processMetaLead("lead-1", "form-1");
    const expired = calls.find((c) => c.op === "update" && c.table === "ad_platforms");
    assert.equal((expired?.set as { status: string }).status, "expired");
    const log = calls.find((c) => c.op === "insert" && c.table === "ad_lead_logs")?.values as { status: string; errorMessage: string };
    assert.equal(log.status, "failed");
    assert.match(log.errorMessage, /다시 연결/);
    assert.equal(calls.some((c) => c.op === "insert" && c.table === "records"), false);
});

test("UX-049 실패 리드 다시 처리 — 권한·조직·상태를 확인하고 실패 로그의 연동으로만 다시 처리한다", async (t) => {
    isolateEnv(t);
    const { db } = await import("./db");
    const retry = await import("../app/api/ad-lead-logs/[id]/retry/route");
    const call = async (role: string) => retry.POST(new NextRequest("http://localhost/api/ad-lead-logs/7/retry", {
        method: "POST", headers: { authorization: `Bearer ${await staffToken(role)}` },
    }), { params: Promise.resolve({ id: "7" }) });
    const failedLog = { status: "failed", externalLeadId: "lead-1", integrationId: 9, formId: "form-1", platform: "meta", isActive: 1 };

    await t.test("member는 403", async (t) => {
        installFakeDb(t, db, (c) => isMembershipLookup(c) ? [{ ...admin, role: "member" }] : []);
        assert.equal((await call("member")).status, 403);
    });
    await t.test("다른 조직 로그는 404이고 Meta를 부르지 않는다", async (t) => {
        const { calls } = installFakeDb(t, db, (c) => isMembershipLookup(c) ? [admin] : []);
        const fetchMock = t.mock.method(globalThis, "fetch", async () => Response.json({}));
        const response = await call("admin");
        assert.equal(response.status, 404);
        assert.equal(fetchMock.mock.callCount(), 0);
        const lookup = calls.find((c) => c.table === "ad_lead_logs");
        assert.ok(lookup?.params.includes(ORG));
        assert.equal(lookup?.params.includes(OTHER_ORG), false);
    });
    await t.test("이미 성공한 로그·꺼진 연동은 409", async (t) => {
        for (const row of [{ ...failedLog, status: "success" }, { ...failedLog, isActive: 0 }]) {
            await t.test(row.status, async (t) => {
                installFakeDb(t, db, (c) => isMembershipLookup(c) ? [admin] : c.table === "ad_lead_logs" ? [row] : []);
                const fetchMock = t.mock.method(globalThis, "fetch", async () => Response.json({}));
                assert.equal((await call("admin")).status, 409);
                assert.equal(fetchMock.mock.callCount(), 0);
            });
        }
    });
    await t.test("실패 로그는 같은 연동으로 다시 처리하고 최신 결과를 돌려준다", async (t) => {
        let logReads = 0;
        const { calls } = installFakeDb(t, db, (c) => {
            if (isMembershipLookup(c)) return [admin];
            if (c.table === "ad_lead_logs" && c.op === "select") {
                logReads++;
                if (logReads === 1) return [failedLog];
                if (logReads === 2) return []; // hasProcessedMetaLead: 아직 성공 없음
                return [{ id: 8, status: "failed", recordId: null, errorMessage: "Meta 요청을 처리하지 못했습니다. 잠시 뒤 다시 시도해주세요." }];
            }
            if (c.table === "ad_lead_integrations") return [{ id: 9, orgId: ORG, adAccountId: 3, formId: "form-1", partitionId: 11, fieldMappings: {}, defaultValues: null, isActive: 1 }];
            if (c.table === "ad_accounts") return [{ platformId: 5, credentials: { type: "meta", accessToken: "fake-token" } }];
            return [];
        });
        const fetched: string[] = [];
        t.mock.method(globalThis, "fetch", async (url: string) => { fetched.push(String(url)); return Response.json({ error: { code: 1, message: "temporary" } }); });
        const response = await call("admin");
        assert.equal(response.status, 200);
        const body = await response.json();
        assert.equal(body.data.status, "failed");
        assert.match(body.data.errorMessage, /[가-힣]/);
        assert.equal(fetched.length, 1);
        assert.match(fetched[0], /lead-1/);
        const integrationLookup = calls.find((c) => c.table === "ad_lead_integrations");
        assert.ok(integrationLookup?.params.includes(9), "실패 로그의 연동 id로 고정해야 한다");
    });
});
