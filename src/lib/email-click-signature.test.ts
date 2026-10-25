/**
 * UX-271: 클릭 추적 주소는 서명이 맞거나(새 링크) 유예 기간 안의 예전 링크가 그 메일 본문의 호스트로 갈 때만 이동한다.
 * 가상 db만 쓴다 (실제 DB 연결 없음).
 */
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test, type TestContext } from "node:test";
import { NextRequest } from "next/server";
import { installFakeDb, isolateEnv, type FakeCall } from "./auth-fake-db.test-helper";

const orgId = "00000000-0000-4000-8000-000000000001";
const NOW = new Date("2026-10-25T00:00:00Z");
const DAY = 24 * 60 * 60 * 1000;

async function load(t: TestContext, log: { body: string; sentAt: Date } | null) {
    isolateEnv(t, { NEXT_PUBLIC_BASE_URL: "https://sendb.example" });
    const { db } = await import("./db");
    const { calls } = installFakeDb(t, db, (c: FakeCall) => {
        if (c.op === "select" && c.table === "email_send_logs") return log ? [{ ...log, orgId }] : [];
        return [];
    });
    const tracking = await import("./email-click-tracking");
    return { ...tracking, calls };
}

function trackedHref(html: string): URL {
    const m = /href="([^"]+)"/.exec(html);
    assert(m);
    return new URL(m[1].replaceAll("&amp;", "&"));
}

test("UX-271: 새로 감싼 링크는 발송 id·도착 주소 서명을 달고, 서명이 맞을 때만 이동 대상이 된다", async (t) => {
    const { wrapTrackingUrls, verifiedClickTarget } = await load(t, null);
    const href = trackedHref(wrapTrackingUrls('<a href="https://shop.example/p?a=1&amp;b=2">상품</a>', 42));
    assert.equal(href.origin + href.pathname, "https://sendb.example/api/track/click");
    assert.equal(href.searchParams.get("url"), "https://shop.example/p?a=1&b=2");
    assert.match(href.searchParams.get("s") ?? "", /^[A-Za-z0-9_-]{22}$/);
    assert.deepEqual(await verifiedClickTarget(href.searchParams, NOW), { sendLogId: 42, url: "https://shop.example/p?a=1&b=2" });

    // 도착 주소·발송 id를 바꾸거나 서명을 망가뜨리면 거절 (서명 있는 요청은 예전 링크 규칙으로 넘어가지 않는다)
    const forged = new URLSearchParams(href.searchParams);
    forged.set("url", "https://phish.example/login");
    assert.equal(await verifiedClickTarget(forged, NOW), null);
    const otherId = new URLSearchParams(href.searchParams);
    otherId.set("id", "43");
    assert.equal(await verifiedClickTarget(otherId, NOW), null);
    const broken = new URLSearchParams(href.searchParams);
    broken.set("s", "x".repeat(22));
    assert.equal(await verifiedClickTarget(broken, NOW), null);
});

test("UX-271: 서명 없는 예전 링크 — 발송 기록이 있고 유예 기간 안이며 본문 링크 호스트로 갈 때만", async (t) => {
    const body = '<p>안내</p><a href="https://shop.example/a?x=1&amp;y=2">보기</a><a href="mailto:a@b.example">메일</a>';
    const legacy = (url: string, id = "7") => new URLSearchParams({ id, url });

    const recent = await load(t, { body, sentAt: new Date(NOW.getTime() - 10 * DAY) });
    assert.deepEqual(await recent.verifiedClickTarget(legacy("https://shop.example/other-path"), NOW), { sendLogId: 7, url: "https://shop.example/other-path" });
    assert.equal(await recent.verifiedClickTarget(legacy("https://phish.example/"), NOW), null, "본문에 없던 호스트");
    assert.equal(await recent.verifiedClickTarget(legacy("javascript:alert(1)"), NOW), null, "웹 주소가 아님");
    assert.equal(await recent.verifiedClickTarget(legacy("https://shop.example/a", "abc"), NOW), null, "id 형식");
});

test("UX-271: 서명 없는 예전 링크도 유예 기간이 지났거나 발송 기록이 없으면 거절", async (t) => {
    const body = '<a href="https://shop.example/a">보기</a>';
    const old = await load(t, { body, sentAt: new Date(NOW.getTime() - 181 * DAY) });
    assert.equal(await old.verifiedClickTarget(new URLSearchParams({ id: "7", url: "https://shop.example/a" }), NOW), null);
});

test("UX-271: 발송 기록이 없는 id로 만든 주소는 거절", async (t) => {
    const none = await load(t, null);
    assert.equal(await none.verifiedClickTarget(new URLSearchParams({ id: "999", url: "https://shop.example/a" }), NOW), null);
});

test("UX-271: 라우트 — 위조 주소는 400(기록·이동 없음), 정상 링크는 302 + sendb_cid", async (t) => {
    const { wrapTrackingUrls, calls } = await load(t, { body: "", sentAt: new Date() });
    const { GET } = await import("../app/api/track/click/route");

    const bad = await GET(new NextRequest("https://sendb.example/api/track/click?id=5&url=https%3A%2F%2Fphish.example%2F"));
    assert.equal(bad.status, 400);
    assert.equal(bad.headers.get("location"), null);
    assert(!calls.some((c) => c.op === "insert"), "클릭을 기록하지 않는다");

    const href = trackedHref(wrapTrackingUrls('<a href="https://shop.example/p">x</a>', 5));
    const ok = await GET(new NextRequest(href.toString()));
    assert.equal(ok.status, 302);
    const location = new URL(ok.headers.get("location")!);
    assert.equal(location.origin + location.pathname, "https://shop.example/p");
    assert.match(location.searchParams.get("sendb_cid") ?? "", /^clk_/);
    assert(calls.some((c) => c.op === "insert" && c.table === "email_click_logs"));
});

test("UX-271: 오픈 픽셀 서명은 이전과 같은 값이다 (공용 서명 함수로 옮겨도 이미 보낸 픽셀이 유효)", async () => {
    const { openSignature } = await import("./email-open-pixel");
    const key = createHmac("sha256", "s3cret").update("sendb/email-open-pixel/v1").digest();
    const legacy = createHmac("sha256", key).update("open:123").digest("base64url").slice(0, 16);
    assert.equal(openSignature(123, "s3cret"), legacy);
});
