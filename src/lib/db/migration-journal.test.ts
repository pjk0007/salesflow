import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";
const { validateJournal } = createRequire(import.meta.url)("../../../scripts/copy-runtime-migrations.cjs");

test("운영 빌드는 같은 시각의 서로 다른 분기 마이그레이션을 거절한다", () => {
    const entries = [
        { idx: 0, when: 1775100000000, tag: "0088_template_link_sender_pool" },
        { idx: 1, when: 1775100000000, tag: "0088_customer_inbox" },
    ];
    assert.throws(() => validateJournal({ entries }), /충돌/);
    entries[1].when++;
    assert.doesNotThrow(() => validateJournal({ entries }));
});

test("운영 빌드는 번호 중복과 적용 시각 역전을 거절한다", () => {
    assert.throws(() => validateJournal({ entries: [{ idx: 1, when: 1, tag: "0000_first" }] }), /충돌/);
    assert.throws(() => validateJournal({ entries: [
        { idx: 0, when: 2, tag: "0000_first" }, { idx: 1, when: 1, tag: "0001_second" },
    ] }), /충돌/);
});
