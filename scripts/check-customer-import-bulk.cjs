/* eslint-disable @typescript-eslint/no-require-imports -- 로컬 PostgreSQL의 허구 대용량 이전 원자성 검사 */
const assert = require("node:assert/strict");
const { runPostgresPlatformCheck } = require("./customer-platform-test-postgres.cjs");
runPostgresPlatformCheck(async ctx => {
    const repo = require("../src/lib/customer-imports/repository.ts");
    const { sourceExternalId } = require("../src/lib/customer-imports/rules.ts");
    const s = require("../src/lib/db/schema.ts");
    const { and, eq } = require("drizzle-orm");
    const namespace = "fictional-bulk-atomic";
    const contacts = Array.from({ length: 261 }, (_, index) => ({ id: `row-${String(index).padStart(3, "0")}`, name: `허구 이전 ${index}` }));
    let job = await repo.previewImport(ctx.actor, { workspaceId: 8, source: "portable", namespace, format: "json", content: JSON.stringify({ contacts }) }, ctx.db);
    assert.equal(job.errors.length, 0);
    job = await repo.changeImport(ctx.actor, job.id, { action: "start", version: job.version, fingerprint: job.fingerprint, acknowledge: true }, ctx.db);
    for (const batchSize of [0, 251, 1.5]) await assert.rejects(repo.stepImport(ctx.actor, job.id, { cursor: 0 }, ctx.db, batchSize));
    job = await repo.stepImport(ctx.actor, job.id, { cursor: 0 }, ctx.db, 250);
    assert.equal(job.cursor, 250); assert.equal(job.state, "running");
    await ctx.platform.upsertContact(ctx.actor.orgId, { workspaceId: 8, externalId: sourceExternalId("portable", namespace, "contacts", "row-258"), name: "허구 직원이 먼저 추가한 고객" }, true, ctx.db);
    job = await repo.stepImport(ctx.actor, job.id, { cursor: 250 }, ctx.db, 250);
    assert.equal(job.state, "failed"); assert.equal(job.cursor, 250);
    const rows = await ctx.db.select().from(s.customerImportObjects).where(and(eq(s.customerImportObjects.workspaceId, 8), eq(s.customerImportObjects.namespace, namespace)));
    assert.equal(rows.length, 250); assert.equal(rows.some(row => row.sourceId === "row-250"), false);
    const manual = await ctx.db.select().from(s.crmContacts).where(eq(s.crmContacts.externalId, sourceExternalId("portable", namespace, "contacts", "row-258")));
    assert.equal(manual[0].name, "허구 직원이 먼저 추가한 고객");
    console.log("PASS 대용량 이전: 250행 커서·범위 제한·중간 충돌 묶음 전체 롤백·직원 자료 보존");
}).catch(error => { console.error(error); process.exitCode = 1; });
