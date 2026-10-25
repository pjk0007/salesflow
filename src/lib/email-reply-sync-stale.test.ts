// UX-137 — 회신 읽기 회차가 아예 돌지 않아 오류가 남지 않아도, on이면 6시간 넘은 정체를 오류(stale)로 돌려준다.
// 실제 DB·Gmail을 쓰지 않는다(가상 db.execute).
import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { installFakeDb, isolateEnv } from "./auth-fake-db.test-helper";
import { isReplySyncIdleStale, replyErrorText, STALE_SYNC_MS } from "./email-reply-rules";

const PROD_ENV = {
    NEXT_PUBLIC_BASE_URL: "https://sendb.kr",
    REPLY_GOOGLE_CLIENT_ID: "test-client",
    REPLY_GOOGLE_CLIENT_SECRET: "test-secret",
    REPLY_GOOGLE_REFRESH_TOKEN: "test-refresh",
    REPLY_PRIVATE_DOMAINS: "alias-ceo.test",
};
const now = new Date("2026-10-25T12:00:00Z");
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3600_000);

test("UX-137: 정체 판정 — on에서만, 마지막 성공(없으면 실행) 기준 6시간 초과", () => {
    assert.equal(isReplySyncIdleStale("on", hoursAgo(1), hoursAgo(1), now), false, "정상 회차 직후");
    assert.equal(isReplySyncIdleStale("on", hoursAgo(7), hoursAgo(7), now), true, "7시간 무회차");
    assert.equal(isReplySyncIdleStale("on", new Date(now.getTime() - STALE_SYNC_MS), null, now), false, "정확히 6시간은 아직 아님");
    assert.equal(isReplySyncIdleStale("on", null, hoursAgo(8), now), true, "성공 기록 없으면 마지막 실행 기준");
    assert.equal(isReplySyncIdleStale("on", null, null, now), false, "한 번도 안 돌았으면 판단 안 함");
    assert.equal(isReplySyncIdleStale("off", hoursAgo(9), hoursAgo(9), now), false);
    assert.equal(isReplySyncIdleStale("dry_run", hoursAgo(9), hoursAgo(9), now), false);
});

async function status(t: TestContext, mode: string, row: Record<string, unknown>) {
    isolateEnv(t);
    const { db } = await import("./db");
    installFakeDb(t, db, (c) => (c.op === "execute" && c.sql.includes("email_reply_mailbox_state") ? [row] : []));
    const { loadReplySyncStatus } = await import("./email-reply-sync");
    return loadReplySyncStatus({ ...PROD_ENV, REPLY_SYNC_MODE: mode }, now);
}

const base = { last_error_code: null, last_error: null, last_error_at: null, backfill_done_at: hoursAgo(100), stats: null };

test("UX-137: 상태 띠 자료 — 7시간 무회차면 stale 오류, 정상·off는 그대로", async (t) => {
    await t.test("on·7시간 무회차 → errorCode stale", async (t) => {
        const s = await status(t, "on", { ...base, last_run_at: hoursAgo(7), last_success_at: hoursAgo(7) });
        assert.equal(s.mode, "on");
        assert.equal(s.errorCode, "stale");
        assert.equal(s.errorText, replyErrorText("stale"));
        assert.equal(s.errorSince, hoursAgo(7).toISOString());
    });
    await t.test("on·정상 회차 직후 → 오류 없음", async (t) => {
        const s = await status(t, "on", { ...base, last_run_at: hoursAgo(0.1), last_success_at: hoursAgo(0.1) });
        assert.equal(s.errorCode, null);
    });
    await t.test("off·오래됨 → 경고 안 함", async (t) => {
        const s = await status(t, "off", { ...base, last_run_at: hoursAgo(30), last_success_at: hoursAgo(30) });
        assert.equal(s.errorCode, null);
    });
    await t.test("이미 남은 오류 코드는 그대로", async (t) => {
        const s = await status(t, "on", { ...base, last_run_at: hoursAgo(8), last_success_at: hoursAgo(9), last_error_code: "auth" });
        assert.equal(s.errorCode, "auth");
    });
});
