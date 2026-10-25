/**
 * UX-193: 원본 Message-ID 없는 반송의 대체 짝짓기는 기간 안 후보 전체의 조직이 하나일 때만 잇는다.
 * 가상 db는 SQL을 실행하지 않는다 — 조직 판정을 창 함수(LIMIT 전 전체 후보)로 묻는지와 그 답에 따른 동작을 본다.
 */
import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { installFakeDb, isolateEnv, type FakeCall } from "./auth-fake-db.test-helper";

const orgA = "00000000-0000-4000-8000-00000000000a";
const orgB = "00000000-0000-4000-8000-00000000000b";

async function run(t: TestContext, candidate: { multi_org: boolean } | null) {
    isolateEnv(t);
    const { db } = await import("./db");
    const { calls } = installFakeDb(t, db, (c: FakeCall) => {
        if (c.op !== "execute") return [];
        if (c.sql.includes("FROM email_send_logs l") && c.sql.includes("OVER ()")) {
            return candidate ? [{ id: 11, org_id: orgA, record_id: 5, recipient_email: "dead@example.test", workspace_id: 2, ...candidate }] : [];
        }
        if (c.sql.includes("INSERT INTO email_bounce_signals")) return [{ id: 900 }];
        return [];
    });
    const { recordBounceSignal } = await import("./email-bounce-signal");
    const out = await recordBounceSignal({
        orgIds: [orgA, orgB],
        gmailMessageId: "gm-1",
        receivedAt: new Date("2026-10-25T00:00:00Z"),
        toAddress: "sender@shared.example",
        threadLogId: null,
        signal: "dsn",
        apply: true,
        recipients: [{ finalRecipient: "dead@example.test", originalRecipient: null, action: "failed", status: "5.1.1", diagnostic: "user unknown" }],
    });
    return { out, calls };
}

test("UX-193: 대체 짝짓기 조회는 기간 안 후보 전체의 조직 수를 창 함수로 묻고 최신 1건만 받는다", async (t) => {
    const { calls } = await run(t, { multi_org: false });
    const q = calls.find((c) => c.op === "execute" && c.sql.includes("OVER ()"))!;
    assert.match(q.sql, /min\(l\.org_id::text\) OVER \(\) <> max\(l\.org_id::text\) OVER \(\) AS multi_org/);
    assert.match(q.sql, /LIMIT 1\b/);
    assert.doesNotMatch(q.sql, /LIMIT 10\b/);
});

test("UX-193: 후보 전체가 한 조직이면 최신 발송에 잇고 실패로 센다", async (t) => {
    const { out, calls } = await run(t, { multi_org: false });
    assert.equal(out[0].sendLogId, 11);
    assert.equal(out[0].recipientMatch, "same");
    const insert = calls.find((c) => c.sql.includes("INSERT INTO email_bounce_signals"))!;
    assert(insert.params.includes(orgA));
});

test("UX-193: 11번째 이전이라도 다른 조직 후보가 있으면(multi_org) 잇지 않고, 조직이 둘이라 신호도 남기지 않는다", async (t) => {
    const { out, calls } = await run(t, { multi_org: true });
    assert.equal(out.length, 0);
    assert(!calls.some((c) => c.sql.includes("INSERT INTO email_bounce_signals")), "조직 섞임 막기");
    assert(!calls.some((c) => c.sql.includes("UPDATE email_send_logs")), "다른 조직 발송을 실패로 바꾸지 않는다");
});
