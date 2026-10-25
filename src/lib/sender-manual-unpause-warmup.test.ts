// UX-138 — 웜업 중 손으로 일시 정지했다 풀면, 자동 해제와 같은 규칙으로 멈춘 기간만큼 웜업 시작일을 미룬다.
// 실제 DB를 쓰지 않는다(가상 db).
import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { NextRequest } from "next/server";
import { installFakeDb, isolateEnv, isMembershipLookup, type FakeCall } from "./auth-fake-db.test-helper";
import { addDaysYmd, kstParts, kstToDate } from "./kst";

const orgId = "00000000-0000-4000-8000-0000000000e1";
const userId = "00000000-0000-4000-8000-0000000000e2";
const today = kstParts(new Date()).date;

const profile = (over: Record<string, unknown>) => ({
    id: 5, orgId, name: "가상", fromName: "가상", fromEmail: "sender@example.test", isDefault: false,
    dailyLimit: 200, warmupEnabled: true, warmupStartCount: 10, warmupStep: 5, warmupStartedOn: addDaysYmd(today, -14),
    sendWindowStart: null, sendWindowEnd: null, weekdaysOnly: false, spreadEvenly: false,
    isPaused: true, pausedSource: "manual", pausedReason: null, pausedAt: kstToDate(addDaysYmd(today, -10), 10),
    healthAction: "auto",
    ...over,
});

async function unpause(t: TestContext, existing: Record<string, unknown>, body: Record<string, unknown> = { isPaused: false }) {
    isolateEnv(t);
    const { db } = await import("./db"), { generateToken } = await import("./auth");
    const { PUT } = await import("../app/api/email/sender-profiles/[id]/route");
    const token = generateToken({ userId, orgId, name: "가상", email: "admin@example.test", role: "admin", membershipId: 71, tokenVersion: 0 } as never);
    const { calls } = installFakeDb(t, db, (c: FakeCall) => {
        if (isMembershipLookup(c)) return [{ role: "admin", membershipId: 71, tokenVersion: 0, isSuperAdmin: 0 }];
        if (c.op === "select" && c.table === "email_sender_profiles") return [existing];
        if (c.op === "update" && c.table === "email_sender_profiles") return [{ ...existing, ...(c.set as object) }];
        return [];
    });
    const response = await PUT(new NextRequest("https://example.test/api/email/sender-profiles/5", {
        method: "PUT",
        headers: { authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
    }), { params: Promise.resolve({ id: "5" }) });
    const update = calls.find((c) => c.op === "update" && c.table === "email_sender_profiles");
    return { status: response.status, set: update?.set as Record<string, unknown> | undefined };
}

test("UX-138: 손 정지 해제는 멈춘 날부터의 보낼 수 있는 날만큼 웜업 시작일을 미룬다", async (t) => {
    await t.test("매일 보내는 주소, 10일 정지 → 시작일 10일 뒤로(풀린 날 일차 = 멈춘 날 일차)", async (t) => {
        const { status, set } = await unpause(t, profile({}));
        assert.equal(status, 200);
        assert.equal(set?.warmupStartedOn, addDaysYmd(today, -4));
        assert.equal(set?.isPaused, false);
        assert.equal(set?.pausedAt, null);
    });
    await t.test("웜업 꺼진 주소는 시작일 그대로", async (t) => {
        const { set } = await unpause(t, profile({ warmupEnabled: false }));
        assert.equal(set?.warmupStartedOn ?? addDaysYmd(today, -14), addDaysYmd(today, -14));
    });
    await t.test("같은 날 정지·해제는 그대로", async (t) => {
        const { set } = await unpause(t, profile({ pausedAt: new Date() }));
        assert.equal(set?.warmupStartedOn, addDaysYmd(today, -14));
    });
    await t.test("멈춘 시각 기록이 없는 옛 정지는 그대로", async (t) => {
        const { set } = await unpause(t, profile({ pausedAt: null, pausedSource: null }));
        assert.equal(set?.warmupStartedOn, addDaysYmd(today, -14));
    });
    await t.test("평일만 주소는 정지 기간의 평일 수만큼만 미룬다", async (t) => {
        const { set } = await unpause(t, profile({ weekdaysOnly: true }));
        const { shiftWarmupStart, toLimitSettings } = await import("./email-sender-limit-rules");
        const expected = shiftWarmupStart(
            { ...toLimitSettings(profile({ weekdaysOnly: true }) as never), isPaused: false },
            addDaysYmd(today, -10),
            today,
        );
        assert.equal(set?.warmupStartedOn, expected);
        const { warmupDayIndex } = await import("./email-sender-limit-rules");
        const before = { ...toLimitSettings(profile({ weekdaysOnly: true }) as never), isPaused: false };
        assert.equal(warmupDayIndex({ ...before, warmupStartedOn: expected }, today), warmupDayIndex(before, addDaysYmd(today, -10)),
            "풀린 날 웜업 일차 = 멈춘 날 웜업 일차");
    });
});
