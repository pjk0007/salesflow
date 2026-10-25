import test from "node:test";
import assert from "node:assert/strict";
import { drizzle } from "drizzle-orm/pglite";
import { scheduledRegistrations } from "./db/schema";
import { openPglite } from "./db/pglite-harness.test-helper";
import { enqueueScheduledRows } from "./scheduled-registration-upload";

test("UX-077 2번째 배치 실패 시 첫 1,000행도 남지 않고 재업로드는 한 번만 적재된다", async () => {
    const pg = await openPglite([scheduledRegistrations]);
    try {
        const db = drizzle(pg);
        const rows = Array.from({ length: 1001 }, (_, index) => ({ orgId: "00000000-0000-4000-8000-000000000077", workspaceId: 1, partitionId: 1, data: { index } }));
        const invalid = rows.map((row, index) => index === 1000 ? { ...row, data: { index: BigInt(1) } } : row);
        const progress: number[] = [];
        await assert.rejects(enqueueScheduledRows(db as never, invalid, (n) => progress.push(n)));
        assert.deepEqual(progress, [1000]);
        assert.equal((await pg.query<{ n: number }>("SELECT count(*)::int AS n FROM scheduled_registrations")).rows[0].n, 0);
        assert.equal(await enqueueScheduledRows(db as never, rows, () => {}), 1001);
        assert.equal((await pg.query<{ n: number }>("SELECT count(*)::int AS n FROM scheduled_registrations")).rows[0].n, 1001);
    } finally { await pg.close(); }
});
