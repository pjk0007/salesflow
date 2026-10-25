import test from "node:test";
import assert from "node:assert/strict";
import { EMAIL_SEND_BLOCKED, EMAIL_SEND_CHECK_FAILED, EMAIL_SEND_INVALID_CONTEXT, submitEmailWithGuard } from "./email-send-guard";

test("organization suppression stops the entire mixed-recipient request before provider submission", async () => {
    let sent = 0;
    const lookups: string[] = [];
    const result = await submitEmailWithGuard("org-a", ["ok@example.test", " BLOCKED@EXAMPLE.TEST "], async (orgId, email) => {
        lookups.push(`${orgId}:${email}`);
        return orgId === "org-a" && email === "blocked@example.test";
    }, async () => { sent++; return "accepted"; });
    assert.equal(sent, 0);
    assert.notEqual(result, "accepted");
    if (typeof result !== "string") assert.equal(result.header.resultCode, EMAIL_SEND_BLOCKED);
    assert.deepEqual(lookups, ["org-a:ok@example.test", "org-a:blocked@example.test"]);
});

test("another organization remains independent and recipient normalization reaches the provider", async () => {
    const result = await submitEmailWithGuard("org-b", [" BLOCKED@EXAMPLE.TEST "], async (orgId) => orgId === "org-a", async (recipients) => recipients);
    assert.deepEqual(result, ["blocked@example.test"]);
});

test("missing organization, invalid recipients and unavailable lookup never submit", async () => {
    let sent = 0;
    for (const [orgId, recipients, lookup, code] of [
        [undefined, ["a@example.test"], async () => false, EMAIL_SEND_INVALID_CONTEXT],
        ["org-a", [], async () => false, EMAIL_SEND_INVALID_CONTEXT],
        ["org-a", ["a@example.test\r\nBcc:evil@example.test"], async () => false, EMAIL_SEND_INVALID_CONTEXT],
        ["org-a", ["a@example.test"], async () => { throw new Error("sensitive DB detail"); }, EMAIL_SEND_CHECK_FAILED],
    ] as const) {
        const result = await submitEmailWithGuard(orgId, recipients, lookup, async () => { sent++; return "accepted"; });
        assert.notEqual(result, "accepted");
        if (typeof result !== "string") {
            assert.equal(result.header.resultCode, code);
            assert.equal(JSON.stringify(result).includes("sensitive DB detail"), false);
        }
    }
    assert.equal(sent, 0);
});

test("a later unsubscribe is rechecked on every submission and duplicate recipients are queried once", async () => {
    let blocked = false, checks = 0, sent = 0;
    const lookup = async () => { checks++; return blocked; };
    const submit = async () => { sent++; return "accepted"; };
    assert.equal(await submitEmailWithGuard("org-a", ["A@example.test", " a@example.test "], lookup, submit), "accepted");
    blocked = true;
    const result = await submitEmailWithGuard("org-a", ["a@example.test"], lookup, submit);
    assert.equal(sent, 1);
    assert.equal(checks, 2);
    if (typeof result !== "string") assert.equal(result.header.resultCode, EMAIL_SEND_BLOCKED);
});
test("UX-135 막힌 주소를 모두 결과에 담되 외부 응답 문구에는 주소를 넣지 않는다", async () => {
    const { checkEmailSubmission } = await import("./email-send-guard");
    const blocked = new Set(["a@example.test", "c@example.test"]);
    const decision = await checkEmailSubmission("org-a", ["A@example.test", "b@example.test", "c@example.test"], async (_o, email) => blocked.has(email));
    assert.equal(decision.allowed, false);
    if (decision.allowed) return;
    assert.deepEqual(decision.blockedRecipients, ["a@example.test", "c@example.test"]);
    assert.equal(decision.rejection.header.resultCode, EMAIL_SEND_BLOCKED);
    assert.equal(decision.rejection.header.resultMessage.includes("@"), false);
    const external = await submitEmailWithGuard("org-a", ["a@example.test"], async () => true, async () => "sent");
    assert.equal(JSON.stringify(external).includes("a@example.test"), false);
});
