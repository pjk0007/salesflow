import test from "node:test";
import assert from "node:assert/strict";
import { installFakeDb, isolateEnv } from "../auth-fake-db.test-helper";

test("UX-135 상담원 답장은 수신거부로 막힌 주소를 문구에 담고 발송 대기를 만들지 않는다", async (t) => {
    isolateEnv(t);
    const { db } = await import("../db");
    const { queueEmailReply } = await import("./outgoing");
    const { calls } = installFakeDb(t, db, (call) => {
        if (call.table === "inbox_email_threads")
            return [{
                thread: { conversationId: "c1", mailboxId: "m1", providerThreadId: "t1", correspondent: "blocked@example.test", subject: "문의", lastRfcMessageId: "<a@example.test>", lastInboundMessageId: null },
                mailbox: { id: "m1", orgId: "00000000-0000-4000-8000-000000000001", address: "help@example.test", googleAccount: null, enabled: true, version: 1 },
                connectionStatus: "connected",
            }];
        if (call.table === "email_unsubscribes") return call.params.includes("blocked@example.test") ? [{ id: 1 }] : [];
        return [];
    });
    await assert.rejects(queueEmailReply(db as never, "c1", 10, 0), (error: Error & { status?: number }) => {
        assert.equal(error.status, 409);
        assert.match(error.message, /blocked@example\.test/);
        assert.match(error.message, /빼주세요/);
        return true;
    });
    assert.equal(calls.filter((c) => c.op === "insert").length, 0);
});
