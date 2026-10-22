/* eslint-disable @typescript-eslint/no-require-imports -- isolated PGlite and fake transports only */
// node --import tsx scripts/check-email-suppression-transport.cjs
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const path = require("node:path");
const Module = require("node:module");
const { runEmailCheck } = require("./check-inbox-email.cjs");

runEmailCheck(async (ctx) => {
    const { db, pg, actor, otherActor, repo, email, emailConversation, emailMailboxes } = ctx;
    const schema = require("../src/lib/db/schema.ts");
    const { eq } = require("drizzle-orm");
    const oldFetch = global.fetch;
    let providerCalls = 0;
    global.fetch = async (_url, init) => {
        providerCalls++;
        const payload = JSON.parse(init.body);
        return Response.json({ header: { isSuccessful: true, resultCode: 0, resultMessage: "fixture accepted" }, body: { data: {
            requestId: "fixture-request", results: payload.receiverList.map((r) => ({ receiveMailAddr: r.receiveMailAddr, resultCode: 0 })),
        } } });
    };
    try {
        // Bundle with a DB adapter: even ESM import caches cannot fall back to a real postgres client.
        global.__sendbSuppressionQaDb = { ...schema, db };
        const loadTransport = async (entry) => {
            const result = await require("esbuild").build({
                entryPoints: [path.resolve(__dirname, "..", entry)], bundle: true, write: false,
                platform: "node", format: "cjs", packages: "external",
                plugins: [{ name: "isolated-db", setup(build) {
                    build.onLoad({ filter: /[\\/]src[\\/]lib[\\/]db[\\/]index\.ts$/ }, () => ({
                        contents: "module.exports = global.__sendbSuppressionQaDb", loader: "js",
                    }));
                } }],
            });
            const compiled = new Module(path.join(__dirname, "suppression-fixture.cjs"), module);
            compiled.filename = path.join(__dirname, "suppression-fixture.cjs");
            compiled.paths = module.paths;
            compiled._compile(result.outputFiles[0].text, compiled.filename);
            return compiled.exports;
        };
        const { NhnEmailClient, getEmailClient } = await loadTransport("src/lib/nhn-email.ts");
        const { sendNotificationMail } = await loadTransport("src/lib/customer-messenger/transport.ts");
        const { EMAIL_SEND_BLOCKED, EMAIL_SEND_CHECK_FAILED, EMAIL_SEND_INVALID_CONTEXT } = require("../src/lib/email-send-guard.ts");
        const deny = (address, orgId = actor.orgId, workspaceId = 10) => db.insert(schema.emailUnsubscribes).values({ orgId, workspaceId, email: address });
        await db.insert(schema.emailConfigs).values([
            { orgId: actor.orgId, appKey: "fixture-key", secretKey: "fixture-secret", fromEmail: "sender@example.test" },
            { orgId: otherActor.orgId, appKey: "fixture-other", secretKey: "fixture-secret", fromEmail: "sender@example.test" },
        ]);
        await deny(" \tBLOCKED@EXAMPLE.TEST\u200b");
        const payload = (addresses) => ({ senderAddress: "sender@example.test", title: "가상 테스트", body: "가상", receiverList: addresses.map((receiveMailAddr) => ({ receiveMailAddr, receiveType: "MRT0" })) });
        const client = await getEmailClient(actor.orgId);
        assert.equal((await client.sendEachMail(payload(["ok@example.test", "blocked@example.test"]))).header.resultCode, EMAIL_SEND_BLOCKED);
        assert.equal(providerCalls, 0);
        assert.equal((await new NhnEmailClient("fixture", "fixture").sendEachMail(payload(["ok@example.test"]))).header.resultCode, EMAIL_SEND_INVALID_CONTEXT);
        assert.equal(providerCalls, 0);
        const other = await getEmailClient(otherActor.orgId);
        assert.equal((await other.sendEachMail(payload(["blocked@example.test"]))).header.isSuccessful, true);
        assert.equal(providerCalls, 1);
        await assert.rejects(sendNotificationMail({ orgId: actor.orgId, email: "blocked@example.test", name: "가상", subject: "가상", body: "가상" }, db), /notification_delivery_unconfirmed/);
        assert.equal(providerCalls, 1);
        console.log("PASS NHN cross-workspace suppression, organization isolation, mixed recipients, missing organization and notification transport");

        const { emailConversationContext } = require("../src/lib/inbox-email/outgoing.ts");
        const source = await emailConversationContext(db, emailConversation);
        const reply = (to, cc = []) => repo.sendAgentMessage(actor, emailConversation, {
            kind: "reply", body: "가상 발송 차단 검증", clientId: randomUUID(),
            emailReply: { mode: "custom", sourceMessageId: source.sourceMessageId, to, cc },
        }, db);
        await assert.rejects(reply(["ok@example.test"], ["blocked@example.test"]), (e) => e.status === 409);
        console.log("PASS Gmail queue refuses blocked Cc from another workspace");

        await reply(["later@example.test"]);
        const claimed = await email.claimEmail(actor, emailMailboxes.dh.id, db);
        assert.ok(claimed);
        await deny("later@example.test");
        await assert.rejects(email.changeEmailDelivery(actor, claimed.id, { action: "begin", leaseToken: claimed.leaseToken }, db), (e) => e.status === 409);
        const [cancelled] = await db.select().from(schema.inboxEmailDeliveries).where(eq(schema.inboxEmailDeliveries.id, claimed.id));
        assert.equal(cancelled.state, "cancelled");
        assert.equal(cancelled.errorCode, "email_unsubscribed");

        await reply(["queued@example.test"]);
        await deny("queued@example.test");
        assert.equal(await email.claimEmail(actor, emailMailboxes.dh.id, db), null);
        console.log("PASS Gmail claim and final begin recheck late unsubscribe and persist cancellation");

        await deny("foreign@example.test", otherActor.orgId, 9);
        await reply(["foreign@example.test"]);
        const foreign = await email.claimEmail(actor, emailMailboxes.dh.id, db);
        assert.equal(foreign.recipient, "foreign@example.test");
        await email.changeEmailDelivery(actor, foreign.id, { action: "cancel" }, db);
        console.log("PASS Gmail does not inherit another organization's suppression");

        const { deliverGmailReply } = require("../src/lib/inbox-email/gmail.ts");
        const { clearGmailTokenCache } = require("../src/lib/gmail-client.ts");
        clearGmailTokenCache();
        await reply(["during-prepare@example.test"]);
        let gmailSends = 0;
        const relay = {
            claimEmail: (id) => email.claimEmail(actor, id, db),
            changeEmailDelivery: async (id, action) => {
                if (action.action === "begin") await deny("during-prepare@example.test");
                return email.changeEmailDelivery(actor, id, action, db);
            },
        };
        const fakeGmail = async (url) => {
            const path = String(url);
            if (path.includes("oauth2")) return Response.json({ access_token: "fixture-token", expires_in: 3600 });
            if (path.endsWith("/profile")) return Response.json({ emailAddress: emailMailboxes.dh.address });
            if (path.endsWith("/messages/send")) { gmailSends++; return Response.json({ id: "fixture-message" }); }
            throw new Error("Unexpected network route");
        };
        await assert.rejects(deliverGmailReply(relay, emailMailboxes.dh.id, { clientId: "fixture", clientSecret: "fixture", refreshToken: "fixture" }, fakeGmail), (e) => e.status === 409);
        assert.equal(gmailSends, 0);
        console.log("PASS actual Gmail relay performs zero provider POSTs when final begin is denied");

        await pg.exec("ALTER TABLE email_unsubscribes RENAME TO unavailable_unsubscribes");
        assert.equal((await client.sendEachMail(payload(["ok@example.test"]))).header.resultCode, EMAIL_SEND_CHECK_FAILED);
        await assert.rejects(reply(["outage@example.test"]), (e) => e.status === 503);
        assert.equal(providerCalls, 1);
        await pg.exec("ALTER TABLE unavailable_unsubscribes RENAME TO email_unsubscribes");
        console.log("PASS NHN and Gmail fail closed during suppression database errors · real email/DB/network access 0");
    } finally {
        global.fetch = oldFetch;
        delete global.__sendbSuppressionQaDb;
    }
    await pg.close();
}).catch((error) => { console.error(error); process.exitCode = 1; });
