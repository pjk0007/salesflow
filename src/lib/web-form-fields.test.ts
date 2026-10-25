import test from "node:test";
import assert from "node:assert/strict";
import { drizzle } from "drizzle-orm/pglite";
import { webFormFields } from "./db/schema";
import { openPglite } from "./db/pglite-harness.test-helper";
import { saveWebFormFields } from "./web-form-fields";

test("UX-044 질문 수정·재정렬은 ID를 보존하고 추가·삭제·실패 롤백을 분리한다", async () => {
    const pg = await openPglite([webFormFields]);
    try {
        const db = drizzle(pg);
        const save = (formId: number, input: unknown) => db.transaction((tx) => saveWebFormFields(tx as never, formId, input));
        const first = await save(1, [{ label: "이름" }, { label: "전화" }]);
        const reordered = await save(1, [{ ...first[1], label: "휴대전화" }, first[0], { label: "메모" }]);
        assert.deepEqual(reordered.slice(0, 2).map((f) => f.id), [first[1].id, first[0].id]);
        assert.equal(reordered[0].label, "휴대전화");
        const before = await db.select().from(webFormFields);
        await assert.rejects(save(2, [{ ...first[0], label: "다른 폼 침범" }]));
        await assert.rejects(save(1, [first[0], first[0]]));
        await assert.rejects(save(1, [{ label: "" }]));
        await assert.rejects(db.transaction(async (tx) => {
            await saveWebFormFields(tx as never, 1, [{ label: "변경" }]);
            throw new Error("저장 후 실패");
        }));
        assert.deepEqual(await db.select().from(webFormFields), before);
        const removed = await save(1, [reordered[0]]);
        assert.deepEqual(removed.map((f) => f.id), [first[1].id]);
    } finally { await pg.close(); }
});
