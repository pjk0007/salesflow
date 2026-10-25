import test from "node:test";
import assert from "node:assert/strict";
import { installFakeDb, isolateEnv } from "../auth-fake-db.test-helper";

test("UX-086 직원 신규 등록은 기존 고객·회사와 연결을 덮어쓰지 않는다", async (t) => {
    isolateEnv(t);
    const { db } = await import("../db");
    const { upsertContact, upsertCompany } = await import("./repository");
    const orgId = "00000000-0000-4000-8000-000000000086";
    for (const [table, upsert] of [["crm_contacts", upsertContact], ["crm_companies", upsertCompany]] as const) {
        for (const source of ["staff", "api"] as const) await t.test(`${table}:${source}`, async (t) => {
            const { calls } = installFakeDb(t, db, (c) => c.table === "workspaces" ? [{ id: 1, orgId }]
                : c.table === table ? [{ id: "00000000-0000-4000-8000-000000000001", name: "보존할 이름", externalId: "existing", version: 2, archivedAt: new Date() }]
                : c.table === "crm_contact_companies" ? [{ companyId: "linked-company" }] : []);
            await assert.rejects(upsert(orgId, { workspaceId: 1, externalId: "existing", name: "덮어쓸 이름" }, false, db as never, { source }),
                (error: unknown) => error instanceof Error && "status" in error && error.status === (source === "staff" ? 409 : 403));
            assert.equal(calls.filter((c) => c.op === "insert" || c.op === "delete" || c.op === "update").length, 0);
        });
    }
});
