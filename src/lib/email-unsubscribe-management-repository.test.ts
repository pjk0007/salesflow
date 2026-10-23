import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { createUnsubscribeManagementRepository } from "./email-unsubscribe-management-repository";
import { parseUnsubscribeTarget } from "./email-unsubscribe-management-rules";
import { EMAIL_TRIM_CHARS } from "./deep-visitor-alert-rules";

test("real SQL isolates organizations, matches normalized exact domains, and paginates source records", async () => {
    const pg = new PGlite();
    try {
        await pg.exec(`CREATE TABLE workspaces (id integer PRIMARY KEY, org_id uuid NOT NULL, name text NOT NULL);
            CREATE TABLE email_unsubscribes (id serial PRIMARY KEY, org_id uuid NOT NULL, workspace_id integer, email text NOT NULL, source text NOT NULL DEFAULT 'link', reason text, unsubscribed_at timestamptz NOT NULL DEFAULT now());`);
        const org = "00000000-0000-4000-8000-000000000001", other = "00000000-0000-4000-8000-000000000002";
        await pg.query("INSERT INTO workspaces VALUES (1, $1, '사업 A'), (2, $1, '사업 B'), (3, $2, '비공개 사업')", [org, other]);
        const rows = [
            [org, 1, `${EMAIL_TRIM_CHARS}Person@EXAMPLE.COM${EMAIL_TRIM_CHARS}`, "link"],
            [org, 2, "person@example.com", "one_click"],
            [org, null, "admin@example.com", "manual"],
            [org, 1, "a@sub.example.com", "link"],
            [org, 1, "a@notexample.com", "link"],
            [org, 1, "a@example.com.evil", "link"],
            [other, 3, "private@example.com", "link"],
            // A historical mismatched source FK must not disclose the other organization's name.
            [org, 3, "legacy@example.org", "link"],
        ];
        for (const row of rows) await pg.query("INSERT INTO email_unsubscribes(org_id,workspace_id,email,source) VALUES ($1,$2,$3,$4)", row);
        const repository = createUnsubscribeManagementRepository(drizzle(pg) as unknown as Parameters<typeof createUnsubscribeManagementRepository>[0]);
        const list = await repository.list(org, { page: 1, pageSize: 2, q: "" });
        assert.equal(list.totalCount, 7);
        assert.equal(list.items.length, 2);
        assert.equal(list.items[0].email, "legacy@example.org");
        assert.equal(list.items[0].workspaceName, null);
        assert.ok(list.items.every((item) => item.email !== "private@example.com"));
        const [exact, domain, notFound] = await repository.lookup(org, [parseUnsubscribeTarget(`${EMAIL_TRIM_CHARS}PERSON@example.com${EMAIL_TRIM_CHARS}`)!, { query: "example.com", kind: "domain" }, { query: "private@example.com", kind: "email" }]);
        assert.equal(exact.status, "blocked");
        assert.equal(exact.totalCount, 2);
        assert.ok(exact.items.every((item) => item.email === "person@example.com"));
        assert.deepEqual(new Set(exact.items.map((item) => item.workspaceName)), new Set(["사업 A", "사업 B"]));
        assert.equal(domain.status, "domain_matches");
        assert.equal(domain.totalCount, 3);
        assert.deepEqual(new Set(domain.items.map((item) => item.email)), new Set(["person@example.com", "admin@example.com"]));
        assert.equal(notFound.status, "not_found");
        assert.equal(notFound.totalCount, 0);
        const allForDomain = await repository.list(org, { page: 1, pageSize: 20, q: "example.com" });
        assert.equal(allForDomain.totalCount, 3);
        const literalSearch = await repository.list(org, { page: 1, pageSize: 20, q: "%" });
        assert.equal(literalSearch.totalCount, 0);
        await pg.query("INSERT INTO email_unsubscribes(org_id,email,source) SELECT $1, 'person' || n || '@large.example', 'manual' FROM generate_series(1,55) n", [org]);
        const [large] = await repository.lookup(org, [{ kind: "domain", query: "large.example" }]);
        assert.equal(large.totalCount, 55);
        assert.equal(large.items.length, 50);
    } finally {
        await pg.close();
    }
});
