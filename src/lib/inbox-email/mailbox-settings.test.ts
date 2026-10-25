import test from "node:test";
import assert from "node:assert/strict";
// 실제 DB에 접속하지 않는다 — 메모리 PGlite에 표 모양만 만들고(마이그레이션 미적용) 메일함 설정 질의를 실행한다.
process.env.DATABASE_URL ??= "postgresql://test:test@127.0.0.1:1/test";
process.env.JWT_SECRET ??= "fx-mailbox-settings-test-only-not-a-real-secret";

const ORG = "00000000-0000-4000-8000-00000000e001";
const OTHER_ORG = "00000000-0000-4000-8000-00000000e002";
const USER = "00000000-0000-4000-8000-00000000e003";
const BASE = "00000000-0000-4000-8000-00000000b001";
const BIZ = "00000000-0000-4000-8000-00000000b002";
const BIZ2 = "00000000-0000-4000-8000-00000000b003";
const FOREIGN = "00000000-0000-4000-8000-00000000b004";
const actor = { orgId: ORG, userId: USER, name: "가상 관리자", role: "owner" };

async function setup() {
    const schema = await import("../db/schema");
    const { openPglite, insertRow } = await import("../db/pglite-harness.test-helper");
    const { drizzle } = await import("drizzle-orm/pglite");
    const pg = await openPglite([
        schema.workspaces, schema.users, schema.organizationMembers,
        schema.inboxMailboxes, schema.inboxGoogleConnections, schema.inboxGoogleSyncJobs,
        schema.inboxEmailDeliveries, schema.inboxAuditEvents, schema.inboxGoogleOauthStates,
    ]);
    await insertRow(pg, "workspaces", { id: 1, org_id: ORG, name: "기본 사업" });
    await insertRow(pg, "workspaces", { id: 2, org_id: ORG, name: "다른 사업" });
    await insertRow(pg, "workspaces", { id: 9, org_id: OTHER_ORG, name: "다른 조직 사업" });
    await insertRow(pg, "users", { id: USER, email: "admin@example.test", password: "x", name: "가상 관리자", is_active: 1 });
    await insertRow(pg, "organization_members", { organization_id: ORG, user_id: USER, role: "owner" });
    const box = (id: string, orgId: string, workspaceId: number, address: string, googleAccount: string | null) =>
        insertRow(pg, "inbox_mailboxes", { id, org_id: orgId, workspace_id: workspaceId, channel_id: 1, address, google_account: googleAccount, name: `메일함 ${address}` });
    await box(BASE, ORG, 1, "account@example.test", null);
    await box(BIZ, ORG, 1, "biz@example.test", "account@example.test");
    await box(BIZ2, ORG, 2, "biz2@example.test", "account@example.test");
    await box(FOREIGN, OTHER_ORG, 9, "foreign@example.test", "account@example.test");
    const db = drizzle(pg, { schema });
    return { pg, db };
}
let messageSeq = 0;
const delivery = (id: string, state: string) => ({
    id, mailbox_id: BASE, message_id: ++messageSeq, mailbox_version: 1, recipient: "lead@example.test",
    subject: "문의", provider_thread_id: "t", rfc_message_id: `<${id}@example.test>`, in_reply_to: "<a@example.test>", state,
});

test("UX-133 기본 메일함에 같은 조직의 연결 사업 메일함 수만 내려준다(다른 조직·주소 미노출)", async () => {
    const { pg, db } = await setup();
    try {
        const { listMailboxes } = await import("./repository");
        const rows = await listMailboxes(actor, 1, db as never);
        const base = rows.find((r) => r.id === BASE)!;
        const biz = rows.find((r) => r.id === BIZ)!;
        assert.equal(base.aliasMailboxCount, 2, "같은 조직의 두 사업 메일함만 센다");
        assert.equal(biz.aliasMailboxCount, 0);
        assert.equal(rows.length, 2, "요청한 사업의 메일함만");
        assert.equal(JSON.stringify(rows).includes("biz2@example.test"), false, "다른 사업 주소를 내리지 않는다");
    } finally { await pg.close(); }
});

test("UX-130 보내는 이름만 바꾸면 대기 답장을 취소하지 않고 감사 기록을 남긴다", async () => {
    const { pg, db } = await setup();
    try {
        const { insertRow } = await import("../db/pglite-harness.test-helper");
        await insertRow(pg, "inbox_email_deliveries", delivery("00000000-0000-4000-8000-0000000000d1", "queued"));
        const { changeMailbox } = await import("./repository");
        const renamed = await changeMailbox(actor, BASE, { version: 1, enabled: false, name: "support" }, db as never);
        assert.equal(renamed.name, "support");
        assert.equal(renamed.version, 1, "버전을 올리지 않아 대기 답장이 유지된다");
        const { rows: deliveries } = await pg.query<{ state: string }>("SELECT state FROM inbox_email_deliveries");
        assert.equal(deliveries[0].state, "queued");
        const { rows: audit } = await pg.query<{ changes: { name: { before: string; after: string } } }>("SELECT changes FROM inbox_audit_events");
        assert.deepEqual(audit[0].changes.name, { before: "메일함 account@example.test", after: "support" });
        await assert.rejects(changeMailbox(actor, BASE, { version: 0, enabled: false, name: "x" }, db as never));
        await assert.rejects(changeMailbox(actor, BASE, { version: 2, enabled: false, name: "x" }, db as never), /메일함 설정이 변경됐습니다/);
        await assert.rejects(changeMailbox(actor, BASE, { version: 1, enabled: false, name: "a\nb" }, db as never));
    } finally { await pg.close(); }
});

test("UX-129·131 연결 상태에 대기 답장 수와 실패 사유별 건수를 담고, 다시 가져오기는 일시 사유만", async () => {
    const { pg, db } = await setup();
    try {
        const { insertRow } = await import("../db/pglite-harness.test-helper");
        await insertRow(pg, "inbox_google_connections", { mailbox_id: BASE, version: 3, status: "connected", client_id: "c" });
        for (const [id, state] of [["e1", "queued"], ["e2", "leased"], ["e3", "sending"], ["e4", "cancelled"]])
            await insertRow(pg, "inbox_email_deliveries", delivery(`00000000-0000-4000-8000-0000000000${id}`, state));
        const job = (n: number, state: string, reason: string | null) =>
            insertRow(pg, "inbox_google_sync_jobs", { mailbox_id: BASE, connection_version: 3, provider_message_id: `m${n}`, state, reason_code: reason });
        await job(1, "failed", "invalid_source");
        await job(2, "failed", "transient");
        await job(3, "failed", "rate_limited");
        await job(4, "failed", "intake_rejected");
        await job(5, "done", null);
        const { googleConnectionStatus, retryGoogleJobs } = await import("./google-connection");
        const status = await googleConnectionStatus(actor, BASE, db as never);
        assert.equal(status.pendingReplies, 2, "queued·leased만 취소 대상");
        assert.deepEqual(
            Object.fromEntries(status.failedReasons.map((r) => [r.reasonCode, r.count])),
            { invalid_source: 1, transient: 1, rate_limited: 1, intake_rejected: 1 },
        );
        const result = await retryGoogleJobs(actor, BASE, db as never);
        assert.deepEqual(result, { retried: 2, permanent: 2 });
        const { rows } = await pg.query<{ provider_message_id: string; state: string }>("SELECT provider_message_id, state FROM inbox_google_sync_jobs ORDER BY provider_message_id");
        assert.deepEqual(rows.map((r) => r.state), ["failed", "pending", "pending", "failed", "done"]);
    } finally { await pg.close(); }
});

const cfg = { clientId: "fake-client", clientSecret: "fake-secret", redirectUri: "http://localhost/api/email-google/callback", encryptionKey: "fx-test-key" };
const STATE = "s".repeat(48), COOKIE = "c".repeat(43);
async function seedState(pg: import("@electric-sql/pglite").PGlite) {
    const { insertRow } = await import("../db/pglite-harness.test-helper");
    const { googleHash, sealGoogleValue } = await import("./google-config");
    const hash = googleHash(STATE);
    await insertRow(pg, "inbox_google_oauth_states", {
        state_hash: hash, mailbox_id: BASE, org_id: ORG, actor_id: USER, mailbox_version: 1,
        cookie_hash: googleHash(COOKIE), verifier_cipher: sealGoogleValue("verifier", `oauth:${hash}`, cfg),
        since: new Date("2026-10-01T00:00:00Z"), expires_at: new Date(Date.now() + 600000),
    });
}

test("UX-128 승인 실패는 사유 코드와 관리 권한을 확인한 상담함만 돌려준다", async () => {
    const { pg, db } = await setup();
    try {
        await seedState(pg);
        const { finishGoogleConnection, GoogleConnectionFailure } = await import("./google-connection");
        const { callbackFailureQuery } = await import("./google-routes");
        const requests: string[] = [];
        const fetchImpl = (async (url: string) => {
            requests.push(String(url));
            return new Response(JSON.stringify({ access_token: "a", refresh_token: "r", scope: "https://www.googleapis.com/auth/gmail.readonly" }), { status: 200 });
        }) as unknown as typeof fetch;
        const error = await finishGoogleConnection(actor, { state: STATE, cookie: COOKIE, code: "code" }, db as never, cfg, fetchImpl).catch((e) => e);
        assert.ok(error instanceof GoogleConnectionFailure);
        assert.equal(error.code, "scope");
        assert.equal(error.channelId, 1);
        assert.equal(callbackFailureQuery(error), "channelId=1&emailConnection=scope");
        assert.equal(requests.length, 1, "권한 부족이면 Gmail 프로필을 읽지 않는다");
        const { rows } = await pg.query<{ enabled: boolean; version: number }>("SELECT enabled, version FROM inbox_mailboxes WHERE id = $1", [BASE]);
        assert.deepEqual(rows[0], { enabled: false, version: 1 }, "실패하면 메일함을 바꾸지 않는다");
        // 이미 쓴 요청·다른 브라우저 쿠키는 상담함을 알려주지 않는다.
        const again = await finishGoogleConnection(actor, { state: STATE, cookie: COOKIE, code: "code" }, db as never, cfg, fetchImpl).catch((e) => e);
        assert.equal(again.code, "expired");
        assert.equal(again.channelId, undefined);
        assert.equal(callbackFailureQuery(again), "emailConnection=expired");
    } finally { await pg.close(); }
});

test("UX-128 콜백 실패 코드: 권한 오류와 그 밖의 오류", async () => {
    const { callbackFailureQuery } = await import("./google-routes");
    const { InboxError } = await import("../inbox/errors");
    assert.equal(callbackFailureQuery(new InboxError("권한", 403)), "emailConnection=permission");
    assert.equal(callbackFailureQuery(new Error("x")), "emailConnection=failed");
});

test("UX-134 결과 확인 필요 답장은 보낸 메일에서 찾았을 때만 접수됨으로 바꾼다", async () => {
    const { pg, db } = await setup();
    try {
        const { insertRow } = await import("../db/pglite-harness.test-helper");
        const lease = "00000000-0000-4000-8000-0000000000aa";
        await insertRow(pg, "inbox_email_deliveries", { ...delivery("00000000-0000-4000-8000-0000000000f1", "uncertain"), lease_token: lease });
        await insertRow(pg, "inbox_email_deliveries", { ...delivery("00000000-0000-4000-8000-0000000000f2", "uncertain"), lease_token: lease });
        await insertRow(pg, "inbox_email_deliveries", { ...delivery("00000000-0000-4000-8000-0000000000f3", "uncertain"), lease_token: lease, created_at: new Date(Date.now() - 4 * 86400000) });
        await insertRow(pg, "inbox_email_deliveries", { ...delivery("00000000-0000-4000-8000-0000000000f4", "queued"), lease_token: lease });
        const { clearGmailTokenCache } = await import("../gmail-client");
        clearGmailTokenCache();
        const searched: string[] = [];
        const fetchImpl = (async (url: string) => {
            const u = new URL(String(url));
            if (u.hostname === "oauth2.googleapis.com") return new Response(JSON.stringify({ access_token: "a", expires_in: 3600 }), { status: 200 });
            const q = u.searchParams.get("q") ?? "";
            searched.push(q);
            return new Response(JSON.stringify(q.includes("0000000000f1") ? { messages: [{ id: "sentMsg1" }] } : {}), { status: 200 });
        }) as unknown as typeof fetch;
        const changes: unknown[] = [];
        const { confirmUncertainReplies } = await import("./google-worker");
        const confirmed = await confirmUncertainReplies(
            { box: { id: BASE } as never },
            { changeEmailDelivery: async (id: string, input: unknown) => { changes.push({ id, input }); return {} as never; } },
            { clientId: "c", clientSecret: "s", refreshToken: "r" }, db as never, new Date(), fetchImpl,
        );
        assert.equal(confirmed, 1);
        assert.deepEqual(changes, [{ id: "00000000-0000-4000-8000-0000000000f1", input: { action: "sent", leaseToken: lease, providerMessageId: "sentMsg1" } }]);
        assert.equal(searched.length, 2, "3일 지난 건·대기 건은 조회하지 않는다");
        assert.ok(searched.every((q) => q.startsWith("rfc822msgid:") && q.endsWith(" in:sent")));
    } finally { await pg.close(); }
});
