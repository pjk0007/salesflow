/* eslint-disable @typescript-eslint/no-require-imports -- 가상 DB에서만 자동 처리 범위 검수 */
const assert = require("node:assert/strict"),
    { randomUUID } = require("node:crypto");
const { runAiCheck } = require("./check-customer-ai.cjs");

runAiCheck(async ({ db, pg }) => {
    const { customerAiJobs: jobs } = require("../src/lib/db/schema.ts");
    const { eq, inArray } = require("drizzle-orm");
    const { processSupportQueue } = require("../src/lib/customer-ai/worker.ts");
    const before = process.env.CUSTOMER_AI_WORKSPACES;
    try {
        // The fixture owns this entire in-memory database. Clear its unfinished
        // examples before testing queue ordering; no production connection exists.
        await db
            .update(jobs)
            .set({ state: "cancelled" })
            .where(inArray(jobs.state, ["queued", "generating"]));
        const [example] = await db.select().from(jobs).limit(1);
        assert(example);
        const skippedId = randomUUID(),
            selectedId = randomUUID();
        const now = new Date();
        const sample = (id, workspaceId, offset) => ({
            ...example,
            id,
            clientId: randomUUID(),
            workspaceId,
            state: "queued",
            mode: "reply",
            requestedBy: null,
            settingsVersion: -1,
            attempts: 0,
            leaseId: null,
            leaseUntil: null,
            eligibleAt: new Date(now.getTime() + offset),
            sentBy: null,
            sentMessageId: null,
        });
        await db
            .insert(jobs)
            .values([
                sample(skippedId, 10, -120000),
                sample(selectedId, 8, -60000),
            ]);
        const deps = {
            now: () => now,
            quota: async () => true,
            call: async () => {
                throw Error("stale jobs must not call the model");
            },
        };
        process.env.CUSTOMER_AI_WORKSPACES = "8,9";
        assert.equal(
            (await processSupportQueue({ exec: db, deps })).processed,
            1,
        );
        const [skipped] = await db
            .select()
            .from(jobs)
            .where(eq(jobs.id, skippedId));
        const [selected] = await db
            .select()
            .from(jobs)
            .where(eq(jobs.id, selectedId));
        assert.equal(skipped.state, "queued");
        assert.equal(selected.state, "stale");
        assert.equal(
            (await processSupportQueue({ exec: db, deps })).processed,
            0,
        );
        process.env.CUSTOMER_AI_WORKSPACES = "8,all";
        assert.equal(
            (await processSupportQueue({ exec: db, deps })).processed,
            0,
        );
        console.log(
            "PASS scoped queue: older unapproved business skipped; obsolete job discarded; invalid scope disabled",
        );
    } finally {
        if (before === undefined) delete process.env.CUSTOMER_AI_WORKSPACES;
        else process.env.CUSTOMER_AI_WORKSPACES = before;
        await pg.close();
    }
}).catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
