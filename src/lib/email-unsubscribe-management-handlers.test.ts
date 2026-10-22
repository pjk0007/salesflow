import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { createUnsubscribeManagementHandlers } from "./email-unsubscribe-management-handlers";
import { parseUnsubscribeTarget } from "./email-unsubscribe-management-rules";
import type { UnsubscribeTarget } from "@/components/email/unsubscribes/types";

function fixture(role: string | null = "member") {
    const calls: Array<{ operation: string; orgId: string; input?: unknown }> = [];
    const handlers = createUnsubscribeManagementHandlers({
        authenticate: () => role ? { orgId: "org-current", role } : null,
        list: async (orgId, options) => { calls.push({ operation: "list", orgId, input: options }); return { items: [], totalCount: 0 }; },
        register: async (orgId, input) => { calls.push({ operation: "register", orgId, input }); },
        lookup: async (orgId, targets) => { calls.push({ operation: "lookup", orgId, input: targets }); return targets.map((target) => ({ ...target, status: target.kind === "email" ? "not_found" : "domain_empty", items: [], totalCount: 0 })); },
    });
    return { ...handlers, calls };
}

function request(body?: unknown, query = "", headers?: Record<string, string>) {
    return new NextRequest(`http://localhost/api/email/unsubscribes${query}`, body === undefined ? { headers } : { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
}

test("unauthenticated list, lookup and writes cannot reach data", async () => {
    const f = fixture(null);
    for (const response of [await f.GET(request()), await f.POST(request({ email: "person@example.com" })), await f.lookup(request({ targets: ["example.com"] }))]) assert.equal(response.status, 401);
    assert.deepEqual(f.calls, []);
});

test("members can list and look up only authenticated organization; query orgId is ignored", async () => {
    const f = fixture();
    const response = await f.GET(request(undefined, "?orgId=org-other&page=2&pageSize=10"));
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.data.canManage, false);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(f.calls[0], { operation: "list", orgId: "org-current", input: { page: 2, pageSize: 10, q: "" } });
    assert.equal((await f.lookup(request({ targets: ["PERSON@Example.com", "@example.org"] }))).status, 200);
    assert.equal(f.calls[1].orgId, "org-current");
    assert.deepEqual(f.calls[1].input, [{ query: "person@example.com", kind: "email" }, { query: "example.org", kind: "domain" }]);
});

test("member and unknown roles cannot register; admin/owner normalize exact addresses", async () => {
    for (const role of ["member", "unknown"]) {
        const f = fixture(role);
        assert.equal((await f.POST(request({ email: "person@example.com" }))).status, 403);
        assert.deepEqual(f.calls, []);
    }
    for (const role of ["admin", "owner"]) {
        const f = fixture(role);
        assert.equal((await f.POST(request({ email: "  Person@Example.com  ", reason: " Requested by customer " }))).status, 200);
        assert.deepEqual(f.calls, [{ operation: "register", orgId: "org-current", input: { email: "person@example.com", reason: "Requested by customer" } }]);
    }
});

test("manual registration rejects domains, injected organization/workspace and malformed JSON", async () => {
    const f = fixture("admin");
    for (const body of [{ email: "example.com" }, { email: "*@example.com" }, { email: "person@example.com", orgId: "other" }, { email: "person@example.com", workspaceId: 4 }, { email: "person@example.com", reason: "x".repeat(1001) }]) {
        assert.equal((await f.POST(request(body))).status, 400);
    }
    assert.equal((await f.POST(new NextRequest("http://localhost/api/email/unsubscribes", { method: "POST", body: "{" }))).status, 400);
    assert.deepEqual(f.calls, []);
});

test("org switch mismatches stop stale list, lookup and mutation requests", async () => {
    const f = fixture("admin");
    const headers = { "x-sendb-org-id": "org-previous" };
    assert.equal((await f.GET(request(undefined, "", headers))).status, 409);
    assert.equal((await f.lookup(request({ targets: ["example.com"] }, "", headers))).status, 409);
    assert.equal((await f.POST(request({ email: "person@example.com" }, "", headers))).status, 409);
    assert.deepEqual(f.calls, []);
});

test("lookup preserves domain semantics, deduplicates, and rejects URL/wildcard/oversized targets", async () => {
    const f = fixture();
    const response = await f.lookup(request({ targets: ["example.com", "@EXAMPLE.COM", "PERSON@EXAMPLE.COM"] }));
    const data = (await response.json()).data;
    assert.equal(data[0].status, "domain_empty");
    assert.equal(data[1].status, "not_found");
    assert.equal((f.calls[0].input as UnsubscribeTarget[]).length, 2);
    for (const targets of [[], ["https://example.com"], ["*.example.com"], ["bad@"], Array(51).fill("example.com")]) {
        assert.equal((await f.lookup(request({ targets }))).status, 400);
    }
    assert.equal(f.calls.length, 1);
});

test("pagination rejects invalid or excessive limits instead of reaching DB", async () => {
    const f = fixture();
    for (const query of ["?page=0", "?page=-1", "?page=Infinity", "?page=1.5", "?pageSize=101", "?pageSize=0", "?page=1000001", `?q=${"a".repeat(201)}`]) {
        assert.equal((await f.GET(request(undefined, query))).status, 400);
    }
    assert.deepEqual(f.calls, []);
});

test("domain parser does not infer parent or neighboring domains", () => {
    assert.deepEqual(parseUnsubscribeTarget("@Mail.Example.com"), { kind: "domain", query: "mail.example.com" });
    assert.deepEqual(parseUnsubscribeTarget("notexample.com"), { kind: "domain", query: "notexample.com" });
    assert.equal(parseUnsubscribeTarget("example.com.evil/"), null);
});
