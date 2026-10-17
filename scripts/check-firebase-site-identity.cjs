/* eslint-disable @typescript-eslint/no-require-imports -- fictional users, owned loopback PostgreSQL, Google transport fixture only */
const assert = require("node:assert/strict");
const { runPostgresPlatformCheck } = require("./customer-platform-test-postgres.cjs");
runPostgresPlatformCheck(async ctx => {
    const { NextRequest } = require("next/server");
    const route = ctx.modules["messenger/[key]/site-identity"];
    const schema = require("../src/lib/db/schema.ts"), { eq } = require("drizzle-orm");
    const { verifyCustomerIdentity } = require("../src/lib/customer-platform/identity.ts");
    const key = ctx.channels.dh.publicKey, boKey = ctx.channels.bo.publicKey;
    const project = "fictional-designer", apiKey = "AIza" + "x".repeat(35);
    process.env.INBOX_FIREBASE_SITE_PROVIDERS = JSON.stringify([{ channelKey: key, projectId: project, apiKey }]);
    let googleCalls = 0;
    const previousFetch = global.fetch;
    global.fetch = async (url, options) => {
        googleCalls++;
        const token = String(url).includes("accounts:lookup") ? JSON.parse(options.body).idToken : new Headers(options.headers).get("authorization").slice(7);
        const uid = JSON.parse(Buffer.from(token.split(".")[1], "base64url")).sub;
        assert.ok(["qa-A", "qa-B"].includes(uid));
        if (String(url).startsWith("https://identitytoolkit.googleapis.com/v1/accounts:lookup?key="))
            return Response.json({ users: [{ localId: uid, validSince: "0" }] });
        assert.match(String(url), new RegExp("/users/" + uid + "\\?"));
        return Response.json({ name: `projects/${project}/databases/(default)/documents/users/${uid}`,
            fields: { name: { stringValue: "가상 " + uid }, userType: { stringValue: "client" } } });
    };
    const token = uid => { const now = Math.floor(Date.now() / 1000); return "e30." + Buffer.from(JSON.stringify({ sub: uid, aud: project, iss: `https://securetoken.google.com/${project}`, iat: now, auth_time: now - 1, exp: now + 3600 })).toString("base64url") + ".fictional"; };
    const call = (uid, channelKey = key, origin = "http://127.0.0.1:3122", method = "POST") => route[method](new NextRequest(`http://127.0.0.1:3120/api/messenger/${channelKey}/site-identity`, { method, headers: { Origin: origin, ...(uid ? { Authorization: `Bearer ${token(uid)}` } : {}) }, ...(method === "POST" ? { body: JSON.stringify({ contactId: ctx.contacts.dh.id, externalId: "forged", verifiedCustomerHistory: true }) } : {}) }), { params: Promise.resolve({ key: channelKey }) });
    try {
        assert.equal((await call(null)).status, 401);
        assert.equal((await call("qa-A", key, "https://other.invalid")).status, 403);
        assert.equal((await call("qa-A", boKey, "http://127.0.0.1:3123")).status, 503);
        assert.equal(googleCalls, 0);
        const preflight = await call(null, key, "http://127.0.0.1:3122", "OPTIONS");
        assert.equal(preflight.status, 200);
        assert.equal(preflight.headers.get("access-control-allow-origin"), "http://127.0.0.1:3122");
        const identity = async uid => { const response = await call(uid); const j = await response.json(); assert.equal(response.status, 200, JSON.stringify(j)); assert.equal(response.headers.get("cache-control"), "no-store"); assert.equal(j.data.channelKey, key); return j.data.identityToken; };
        const a = verifyCustomerIdentity(await identity("qa-A"), key), aAgain = verifyCustomerIdentity(await identity("qa-A"), key), b = verifyCustomerIdentity(await identity("qa-B"), key);
        assert.equal(a, aAgain); assert.notEqual(a, b); assert.notEqual(a, ctx.contacts.dh.id);
        for (const [id, uid] of [[a, "qa-A"], [b, "qa-B"]]) {
            const [contact] = await ctx.db.select().from(schema.crmContacts).where(eq(schema.crmContacts.id, id));
            assert.equal(contact.externalId, uid); assert.equal(contact.workspaceId, 8);
            assert.equal(contact.attributes.verifiedCustomerHistory, undefined);
        }
        assert.throws(() => verifyCustomerIdentity(require("../src/lib/customer-platform/identity.ts").issueCustomerIdentity(a, key).identityToken, boKey));
        console.log(JSON.stringify({ status: "passed", target: "fictional isolated PostgreSQL plus actual site-identity route", checks: ["cors-preflight", "wrong-origin-blocked", "channel-bound-provider", "missing-login-blocked", "body-impersonation-ignored", "same-uid-idempotent", "two-customers-separated", "cross-channel-token-rejected", "archive-not-promoted"], realGoogleRequests: 0, directProductionDbConnection: false }));
    } finally { global.fetch = previousFetch; delete process.env.INBOX_FIREBASE_SITE_PROVIDERS; }
}).catch(error => { console.error(error); process.exitCode = 1; });
