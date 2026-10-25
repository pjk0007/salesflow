import test from "node:test";
import assert from "node:assert/strict";

// UX-078 — 매일 등록 때 중복으로 건너뛴 큐 행은 'registered'가 아니라 'skipped'로 남는다.

test("splitPickedByOutcome: skippedRows 위치의 큐 id만 건너뜀, 나머지는 등록", async () => {
    process.env.DATABASE_URL ??= "postgres://fixture:fixture@127.0.0.1:1/fixture";
    const { splitPickedByOutcome } = await import("./scheduled-registration");
    assert.deepEqual(splitPickedByOutcome([101, 102, 103, 104], [1, 3]), { registeredIds: [101, 103], skippedIds: [102, 104] });
    assert.deepEqual(splitPickedByOutcome([101, 102], []), { registeredIds: [101, 102], skippedIds: [] });
    assert.deepEqual(splitPickedByOutcome([], []), { registeredIds: [], skippedIds: [] });
});
