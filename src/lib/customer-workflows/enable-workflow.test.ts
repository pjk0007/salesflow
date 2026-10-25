// UX-099·101 — 중단한 자동화를 같은 게시 버전으로 다시 켜는 조건, 목록의 게시자 권한 표시(가상 db, SQL 실행 없음).
import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { installFakeDb, isolateEnv, isMembershipLookup, type FakeCall } from "../auth-fake-db.test-helper";

const ORG = "00000000-0000-4000-8000-000000000099";
const WF = "00000000-0000-4000-8000-0000000000f1";
const REV = "00000000-0000-4000-8000-0000000000f2";
const actor = { orgId: ORG, userId: "00000000-0000-4000-8000-000000000001", name: "가상 관리자", role: "admin" } as never;

async function setup(t: TestContext, opts: { enabled?: boolean; version?: number; preview?: boolean; published?: boolean; active?: number; activeRevisionId?: string | null }) {
    isolateEnv(t);
    const { db } = await import("../db");
    const repo = await import("./repository");
    const workflow = { id: WF, orgId: ORG, workspaceId: 8, name: "가상", version: opts.version ?? 3, generation: 5, enabled: opts.enabled ?? false, activeRevisionId: opts.activeRevisionId === undefined ? REV : opts.activeRevisionId, updatedAt: new Date() };
    const revision = { id: REV, workflowId: WF, fingerprint: "fp", publishedAt: opts.published === false ? null : new Date(), publishedBy: "u", definition: { trigger: { types: ["contact.created"] }, steps: [] } };
    const { calls } = installFakeDb(t, db, (c: FakeCall) => {
        if (isMembershipLookup(c)) return [{ role: "admin", tokenVersion: 0, isSuperAdmin: 0 }];
        if (c.table === "workspaces") return [{ id: 8 }];
        if (c.op === "select" && c.table === "customer_workflows")
            return c.sql.includes('"enabled" =') ? Array.from({ length: opts.active ?? 0 }, (_, i) => ({ id: `w${i}` })) : [workflow];
        if (c.op === "select" && c.table === "customer_workflow_revisions") return [revision];
        if (c.op === "select" && c.table === "customer_workflow_previews") return opts.preview === false ? [] : [{ id: "p1" }];
        return [];
    });
    const writes = () => calls.filter((c) => c.op !== "select");
    return { repo, calls, writes };
}

test("UX-099 다시 켜기: 게시 때 통과한 모의 실행이 있으면 같은 버전으로 켜고 감사에 남긴다", async (t) => {
    const { repo, writes } = await setup(t, {});
    assert.deepEqual(await repo.enableWorkflow(actor, WF, 3), { enabled: true });
    const update = writes().find((c) => c.op === "update" && c.table === "customer_workflows");
    assert.ok(update);
    assert.equal((update.set as { enabled: boolean }).enabled, true);
    assert.equal((update.set as { generation: number }).generation, 6);
    // 중단 때 취소한 실행은 되살리지 않는다
    assert.equal(writes().some((c) => c.table === "customer_workflow_runs"), false);
    const audit = writes().find((c) => c.op === "insert" && c.table === "customer_workflow_audit");
    assert.equal((audit?.values as { action: string }).action, "enabled");
});

test("UX-099 다시 켜기 거절: 버전 변경·이미 켜짐·게시 버전 없음·모의 실행 없음·활성 100개", async (t) => {
    for (const [name, opts, version, status] of [
        ["버전 변경", {}, 2, 409],
        ["이미 켜짐", { enabled: true }, 3, 409],
        ["게시 버전 없음", { activeRevisionId: null }, 3, 409],
        ["모의 실행 없음", { preview: false }, 3, 409],
        ["게시 기록 없음", { published: false }, 3, 409],
        ["활성 100개", { active: 100 }, 3, 400],
    ] as const) {
        await t.test(name, async (t) => {
            const { repo, writes } = await setup(t, opts);
            await assert.rejects(repo.enableWorkflow(actor, WF, version), (e: unknown) => (e as { status?: number }).status === status);
            assert.equal(writes().length, 0);
        });
    }
});

test("UX-101 게시자 권한 조건: 게시 버전의 게시자가 활성 계정·멤버십·사업 운영 관리 권한을 가질 때만 참", async (t) => {
    isolateEnv(t);
    const { publisherCanManage } = await import("./repository");
    const { PgDialect } = await import("drizzle-orm/pg-core");
    const query = new PgDialect().sqlToQuery(publisherCanManage(ORG));
    assert.match(query.sql, /"customer_workflows"\."active_revision_id" IS NULL OR EXISTS/);
    assert.match(query.sql, /"customer_workflow_revisions"\."published_by"/);
    assert.match(query.sql, /cau\.is_active=1/);
    assert.match(query.sql, /cag\.role IN \('manager'\)/);
    assert.ok(query.params.includes(ORG));
});
