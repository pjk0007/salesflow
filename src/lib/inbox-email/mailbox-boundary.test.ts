import test from "node:test";
import assert from "node:assert/strict";
import { installFakeDb, isolateEnv, isMembershipLookup } from "../auth-fake-db.test-helper";
import { isOtherMailboxRecipient, OtherMailboxRecipientError } from "./google-identity";

const base = { id: "base", orgId: "00000000-0000-4000-8000-000000000001", workspaceId: 1, address: "account@example.test", googleAccount: null, enabled: true };
const input = { providerMessageId: "msg1", providerThreadId: "thread1", rfcMessageId: "<msg1@example.test>", from: "customer@example.test", to: ["business@example.test"], cc: [] as string[], deliveredTo: [base.address], subject: "가상", body: "다른 사업의 가상 문의", receivedAt: "2026-01-01T00:00:00Z", autoSubmitted: "auto-replied" };

test("Delivered-To는 기본 계정으로 수신했더라도 다른 사업 To/Cc를 격리한다", () => {
    assert.equal(isOtherMailboxRecipient(base, input, input.to), true);
    assert.equal(isOtherMailboxRecipient(base, { ...input, to: [], cc: input.to }, input.to), true);
    assert.equal(isOtherMailboxRecipient(base, input, []), false, "단독 기본 메일함은 유지");
    assert.equal(isOtherMailboxRecipient(base, { ...input, cc: [base.address] }, input.to), false, "두 주소를 명시하면 양쪽 수신");
    assert.equal(isOtherMailboxRecipient({ address: input.to[0], googleAccount: base.address }, input, input.to), false);
});

test("수신 저장 경계: 같은 조직/로그인 계정의 다른 사업 문의는 원문·영수증 쓰기 0회", async (t) => {
    isolateEnv(t);
    const { db } = await import("../db");
    const { receiveEmail } = await import("./repository");
    t.mock.method(globalThis, "fetch", async () => { throw new Error("외부 호출 금지"); });
    const { calls } = installFakeDb(t, db, call => {
        if (isMembershipLookup(call)) return [{ role: "owner", tokenVersion: 0 }];
        if (call.table === "workspaces") return [{ id: 1 }];
        if (call.table === "inbox_mailboxes") return call.params.includes("base") ? [base] : [{ address: input.to[0] }];
        return [];
    });
    await assert.rejects(receiveEmail({ orgId: base.orgId, userId: "00000000-0000-4000-8000-000000000002", name: "가상 직원", role: "owner" }, "base", input), OtherMailboxRecipientError);
    assert.equal(calls.filter(c => c.op !== "select").length, 0);
    const aliases = calls.find(c => c.table === "inbox_mailboxes" && !c.params.includes("base"))!;
    assert.ok(aliases.params.includes(base.orgId));
    assert.ok(aliases.params.includes(base.address));
    assert.match(aliases.sql, /google_account/);
});

test("기본 메일함 직접 수신·단독 기본 계정은 기존 영수증 경로를 유지한다", async (t) => {
    isolateEnv(t);
    const { db } = await import("../db");
    const { receiveEmail } = await import("./repository");
    for (const cc of [[base.address], []]) {
        await t.test(cc.length ? "Cc 직접 수신" : "등록된 별칭 없음", async (t) => {
            const { calls } = installFakeDb(t, db, call => {
                if (isMembershipLookup(call)) return [{ role: "owner", tokenVersion: 0 }];
                if (call.table === "workspaces") return [{ id: 1 }];
                if (call.table === "inbox_mailboxes") return call.params.includes("base") ? [base] : [];
                if (call.op === "insert" && call.table === "inbox_email_receipts") return [{ id: "receipt1" }];
                return [];
            });
            const result = await receiveEmail({ orgId: base.orgId, userId: "00000000-0000-4000-8000-000000000002", name: "가상 직원", role: "owner" }, "base", { ...input, cc });
            assert.equal(result.receiptId, "receipt1");
            assert.equal(result.ignoredReason, "automatic_message");
            if (cc.length) assert.equal(calls.filter(c => c.table === "inbox_mailboxes").length, 1, "직접 수신은 추가 별칭 조회 없음");
        });
    }
});

test("UX-126 메일함 연결 상태는 요청한 조직·사업 조건으로만 조회한다", async (t) => {
    isolateEnv(t);
    const { db } = await import("../db");
    const { listMailboxes } = await import("./repository");
    const { calls } = installFakeDb(t, db, call => {
        if (isMembershipLookup(call)) return [{ role: "owner", tokenVersion: 0 }];
        if (call.table === "workspaces") return [{ id: 1 }];
        if (call.table === "inbox_mailboxes") return [{ ...base, connectionStatus: "reconnect", connectionErrorCode: "auth" }];
        return [];
    });
    const rows = await listMailboxes({ orgId: base.orgId, userId: "00000000-0000-4000-8000-000000000002", name: "가상 직원", role: "owner" }, 1);
    assert.equal(rows[0].connectionStatus, "reconnect");
    const lookup = calls.find(c => c.table === "inbox_mailboxes")!;
    assert.ok(lookup.params.includes(base.orgId));
    assert.ok(lookup.params.includes(1));
    assert.ok(lookup.joins.includes("inbox_google_connections"));
});

test("UX-127 재연결로 넓힌 범위에서 이미 받은 메일을 다시 받아도 상담·메시지를 새로 만들지 않는다", async (t) => {
    isolateEnv(t);
    const { db } = await import("../db");
    const { receiveEmail } = await import("./repository");
    const { emailFingerprint, inboundInput } = await import("./rules");
    const direct = { ...input, to: [base.address], autoSubmitted: "no" };
    const { calls } = installFakeDb(t, db, call => {
        if (isMembershipLookup(call)) return [{ role: "owner", tokenVersion: 0 }];
        if (call.table === "workspaces") return [{ id: 1 }];
        if (call.table === "inbox_mailboxes") return [base];
        if (call.table === "inbox_email_receipts")
            return [{ id: "receipt-old", messageId: null, ignoredReason: null, envelope: direct, fingerprint: emailFingerprint(inboundInput.parse(direct)) }];
        return [];
    });
    const result = await receiveEmail({ orgId: base.orgId, userId: "00000000-0000-4000-8000-000000000002", name: "가상 직원", role: "owner" }, "base", direct);
    assert.equal(result.duplicate, true);
    assert.equal(result.receiptId, "receipt-old");
    assert.equal(calls.filter(c => c.op !== "select").length, 0, "상담·메시지·영수증 쓰기 0회");
});
