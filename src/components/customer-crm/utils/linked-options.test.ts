import { test } from "node:test";
import assert from "node:assert/strict";
import { linkedOptions } from "./linked-options";

const archived = { id: "c1", name: "보관 고객 (가상)", archivedAt: "2026-10-25T00:00:00.000Z" };

test("불러온 목록에 있는 보관 고객은 저장된 이름으로 덮어쓰지 않아 보관 표시가 남는다", () => {
    const out = linkedOptions([archived], { id: "c1", name: "보관 고객 (가상)", archivedAt: undefined });
    assert.equal(out.length, 1);
    assert.equal(out[0].archivedAt, archived.archivedAt);
});

test("100건 밖 연결은 딜 응답의 보관 시각으로 채운다", () => {
    const out = linkedOptions([], { id: "c9", name: "100건 밖 고객 (가상)", archivedAt: "2026-10-24T00:00:00.000Z" });
    assert.deepEqual(out, [{ id: "c9", name: "100건 밖 고객 (가상)", archivedAt: "2026-10-24T00:00:00.000Z" }]);
});

test("연결이 없거나 이름이 없으면 목록을 그대로 둔다", () => {
    assert.equal(linkedOptions([archived], { id: null, name: null }).length, 1);
    assert.equal(linkedOptions([], { id: "c2", name: null }).length, 0);
});
