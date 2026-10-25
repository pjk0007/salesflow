// UX-087·088 — CRM 목록이 새 항목 먼저/할 일 마감 순으로 정렬되고 '더 보기' 커서가 중복·누락 없이 이어지는지.
import { test } from "node:test";
import assert from "node:assert/strict";
import { installFakeDb, isolateEnv, isMembershipLookup, type FakeCall } from "../auth-fake-db.test-helper";

const ORG = "00000000-0000-4000-8000-000000000087";
const actor = { orgId: ORG, userId: "00000000-0000-4000-8000-000000000001", name: "가상", role: "admin" } as never;
const CURSOR = "00000000-0000-4000-8000-0000000000c1";

/** 메모리 행에 같은 비교식을 적용해 페이지 경계에서 중복·누락이 없는지 확인한다. */
function pageAfter<T extends { at: number; id: string }>(rows: T[], cursor: T | null, size: number) {
    const sorted = [...rows].sort((a, b) => b.at - a.at || (a.id < b.id ? 1 : -1));
    const after = cursor ? sorted.filter((r) => r.at < cursor.at || (r.at === cursor.at && r.id < cursor.id)) : sorted;
    return after.slice(0, size);
}

test("UX-087 (시각 desc, id desc) 커서는 같은 시각 묶음이 페이지 경계에 걸려도 중복·누락이 없다", async () => {
    const rows = Array.from({ length: 250 }, (_, i) => ({ at: Math.floor(i / 7), id: `id-${String((i * 37) % 250).padStart(3, "0")}` }));
    const seen: string[] = [];
    let cursor: (typeof rows)[number] | null = null;
    for (;;) {
        const page = pageAfter(rows, cursor, 100);
        seen.push(...page.map((r) => r.id));
        if (page.length < 100) break;
        cursor = page.at(-1)!;
    }
    assert.equal(seen.length, 250);
    assert.equal(new Set(seen).size, 250);

    const { newerFirstAfter, dueFirstAfter } = await import("./list-cursor");
    const { PgDialect } = await import("drizzle-orm/pg-core");
    const { crmContacts } = await import("../db/customer-platform-schema");
    const { crmTasks } = await import("../db/customer-sales-schema");
    const render = (s: unknown) => new PgDialect().sqlToQuery(s as never).sql;
    assert.equal(newerFirstAfter(crmContacts.createdAt, crmContacts.id, null), undefined);
    assert.match(render(newerFirstAfter(crmContacts.createdAt, crmContacts.id, { at: new Date(0), id: CURSOR })), /"created_at" < \$1 or \("crm_contacts"\."created_at" = \$2 and "crm_contacts"\."id" < \$3\)/);
    // 할 일: 마감 있는 커서 뒤에는 더 늦은 마감, 같은 마감의 큰 id, 마감 없음이 온다
    assert.match(render(dueFirstAfter(crmTasks.dueAt, crmTasks.id, { due: new Date(0), id: CURSOR })), /"due_at" > \$1 or .* or "crm_tasks"\."due_at" is null/);
    assert.match(render(dueFirstAfter(crmTasks.dueAt, crmTasks.id, { due: null, id: CURSOR })), /"due_at" is null and "crm_tasks"\."id" > \$1/);
});

test("UX-087 고객 목록은 커서 행을 같은 사업에서 다시 읽고, 없으면 404로 알린다", async (t) => {
    isolateEnv(t);
    const { db } = await import("../db");
    const { listPlatformObjects } = await import("./repository");
    const responder = (cursorRow: boolean) => (c: FakeCall) => {
        if (isMembershipLookup(c)) return [{ role: "admin", tokenVersion: 0, isSuperAdmin: 0 }];
        if (c.table === "workspaces") return [{ id: 8, name: "가상" }];
        if (c.table === "crm_contacts" && c.params.includes(CURSOR) && !c.sql.includes("created_at\" <")) return cursorRow ? [{ at: new Date(5), id: CURSOR }] : [];
        return [];
    };
    const ok = installFakeDb(t, db, responder(true));
    await listPlatformObjects(ORG, 8, "contacts", CURSOR, db as never);
    const list = ok.calls.filter((c) => c.table === "crm_contacts").at(-1)!;
    assert.match(list.sql, /"created_at" < \$\d+ or/);
    assert.ok(list.params.includes(ORG));
    t.mock.restoreAll();
    installFakeDb(t, db, responder(false));
    await assert.rejects(listPlatformObjects(ORG, 8, "contacts", CURSOR, db as never), (e: unknown) => (e as { status?: number }).status === 404);
    void actor;
});
