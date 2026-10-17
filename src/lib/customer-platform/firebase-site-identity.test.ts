import test from "node:test";
import assert from "node:assert/strict";
import { firebaseSiteProvider, verifyFirebaseSiteMember } from "./firebase-site-identity";
import { InboxError } from "@/lib/inbox/errors";
const provider = { channelKey: "a".repeat(48), projectId: "designerhire", apiKey: "AIza" + "x".repeat(35) };
const now = new Date("2026-10-17T00:00:00Z"), seconds = now.getTime() / 1000;
const claims = { sub: "qa-member-A", aud: provider.projectId, iss: `https://securetoken.google.com/${provider.projectId}`,
    iat: seconds - 10, auth_time: seconds - 60, exp: seconds + 3600 };
const jwt = (changes = {}) => "eyJhbGciOiJSUzI1NiJ9." + Buffer.from(JSON.stringify({ ...claims, ...changes })).toString("base64url") + ".signature";
const status = (code: number) => (e: unknown) => e instanceof InboxError && e.status === code;
function google(options: { account?: object; role?: string; docStatus?: number; authStatus?: number; docName?: string } = {}) {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetcher: typeof fetch = async (url, init) => {
        calls.push({ url: String(url), init: init! });
        if (String(url).startsWith("https://identitytoolkit.googleapis.com/v1/accounts:lookup?key="))
            return new Response(JSON.stringify({ users: [{ localId: claims.sub, email: "QA@example.com", validSince: String(seconds - 600), ...options.account }] }), { status: options.authStatus ?? 200 });
        assert.match(String(url), /^https:\/\/firestore\.googleapis\.com\/v1\/projects\/designerhire\/databases\/\(default\)\/documents\/users\/qa-member-A\?/);
        return new Response(JSON.stringify({ name: options.docName ?? `projects/designerhire/databases/(default)/documents/users/${claims.sub}`, fields: {
            userType: { stringValue: options.role ?? "client" }, name: { stringValue: "검수 회원" },
            companyName: { stringValue: "가상 QA 회사" }, phone: { stringValue: "010-0000-0000" },
            email: { stringValue: "forged@profile.invalid" }, isInternal: { booleanValue: false },
            privateUserInfo: { stringValue: "must-never-leave" }, verifiedCustomerHistory: { booleanValue: true },
        } }), { status: options.docStatus ?? 200 });
    };
    return { calls, fetch: fetcher, now };
}
test("provider configuration binds exactly one channel; disabled/malformed/duplicate fails closed", () => {
    assert.deepEqual(firebaseSiteProvider(provider.channelKey, JSON.stringify([provider])), provider);
    for (const config of [undefined, "not-json", "[]", JSON.stringify([provider, provider]), JSON.stringify([{ ...provider, apiKey: "private-service-key" }])])
        assert.throws(() => firebaseSiteProvider(provider.channelKey, config ?? "[]"), status(503));
    assert.throws(() => firebaseSiteProvider("b".repeat(48), JSON.stringify([provider])), status(503));
});
test("Google verifies exact bearer token; Firestore reads only same UID using customer's token and field mask", async () => {
    for (const role of ["client", "partner"]) {
        const deps = google({ role }), token = jwt();
        const member = await verifyFirebaseSiteMember(provider, token, deps);
        assert.equal(member.externalId, claims.sub);
        assert.equal(member.email, "qa@example.com");
        assert.equal(member.attributes.siteMemberType, role);
        assert.equal("privateUserInfo" in member.attributes, false);
        assert.equal("verifiedCustomerHistory" in member.attributes, false);
        assert.equal("isInternal" in member, false); // preserve an existing staff-only flag
        assert.deepEqual(JSON.parse(String(deps.calls[0].init.body)), { idToken: token });
        assert.deepEqual(deps.calls[1].init.headers, { Authorization: `Bearer ${token}` });
        assert.equal(deps.calls.length, 2);
        for (const call of deps.calls) { assert.equal(call.init.redirect, "error"); assert.equal(call.init.cache, "no-store"); }
        assert.match(deps.calls[1].url, /mask.fieldPaths=userType/);
        assert.doesNotMatch(deps.calls[1].url, /privateUserInfo/);
    }
});
test("wrong project/issuer, expiry, future time, invalid UID/path and tenants reject before any remote read", async () => {
    for (const value of ["", "broken", jwt({ aud: "other-project" }), jwt({ iss: "evil.invalid" }), jwt({ exp: seconds }),
        jwt({ iat: seconds + 90 }), jwt({ auth_time: seconds + 90 }), jwt({ sub: "../other" }), jwt({ firebase: { tenant: "other" } })]) {
        const deps = google();
        await assert.rejects(verifyFirebaseSiteMember(provider, value, deps), status(401));
        assert.equal(deps.calls.length, 0);
    }
});
test("invalid signature, disabled, revoked and account mismatch never read profile", async () => {
    for (const options of [{ authStatus: 400 }, { account: { disabled: true } }, { account: { validSince: String(seconds) } }, { account: { localId: "qa-member-B" } }]) {
        const deps = google(options);
        await assert.rejects(verifyFirebaseSiteMember(provider, jwt(), deps), status(401));
        assert.equal(deps.calls.length, 1);
    }
});
test("Security Rules denial, missing profile and wrong document cannot issue identity; admin excluded", async () => {
    for (const options of [{ docStatus: 401 }, { docStatus: 403 }, { docStatus: 404 }])
        await assert.rejects(verifyFirebaseSiteMember(provider, jwt(), google(options)), status(401));
    await assert.rejects(verifyFirebaseSiteMember(provider, jwt(), google({ docName: "other-user" })), status(502));
    for (const role of ["admin", "unknown", ""]) await assert.rejects(verifyFirebaseSiteMember(provider, jwt(), google({ role })), status(403));
});
test("upstream failures are retryable and never echo tokens or provider bodies", async () => {
    for (const deps of [google({ authStatus: 503 }), google({ docStatus: 503 }),
        { now, fetch: (async () => { throw new Error("secret-token-provider-body"); }) as typeof fetch }]) {
        await assert.rejects(verifyFirebaseSiteMember(provider, jwt(), deps), (e: unknown) => status(502)(e) && !String(e).includes("secret-token"));
    }
});
test("social-login Base64 and other valid single-segment UIDs remain exact and cannot inject a Firestore path or query", async () => {
    for (const uid of ["kakao-123456", "naver-a+b==", "person@example.com", "member?mask.fieldPaths=private", "literal%2Fsegment"]) {
        let count = 0;
        const transport: typeof fetch = async (url, init) => {
            if (count++ === 0) {
                assert.equal(JSON.parse(String(init?.body)).idToken, jwt({ sub: uid }));
                return Response.json({ users: [{ localId: uid }] });
            }
            const parsed = new URL(String(url));
            assert.equal(parsed.pathname, `/v1/projects/designerhire/databases/(default)/documents/users/${encodeURIComponent(uid)}`);
            assert.deepEqual(parsed.searchParams.getAll("mask.fieldPaths"), ["name", "userType", "phone", "companyName", "isInternal"]);
            return Response.json({ name: `projects/designerhire/databases/(default)/documents/users/${uid}`, fields: { userType: { stringValue: "client" } } });
        };
        const member = await verifyFirebaseSiteMember(provider, jwt({ sub: uid }), { fetch: transport, now });
        assert.equal(member.externalId, uid);
    }
    for (const uid of ["..", ".", "other/path", " member", "member\n"])
        await assert.rejects(verifyFirebaseSiteMember(provider, jwt({ sub: uid }), google()), status(401));
});
