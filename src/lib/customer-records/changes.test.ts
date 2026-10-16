import { test } from "node:test";
import assert from "node:assert/strict";
import { customerChanges } from "./changes";
test("고객 변경은 속성 삭제와 명시적 빈 값을 구분한다", () => {
    const changes = customerChanges(
        { attributes: { removed: null, kept: false } },
        { attributes: { added: null, kept: false } },
    );
    assert.deepEqual(changes['attributes["removed"]'], {
        before: null,
        after: null,
        beforePresent: true,
        afterPresent: false,
    });
    assert.deepEqual(changes['attributes["added"]'], {
        before: null,
        after: null,
        beforePresent: false,
        afterPresent: true,
    });
    assert.equal('attributes["kept"]' in changes, false);
});
test("관계·객체 키 순서는 변경으로 기록하지 않는다", () => {
    assert.deepEqual(
        customerChanges(
            { companyIds: ["a", "b"], attributes: { info: { a: 1, b: 0 } } },
            { companyIds: ["b", "a"], attributes: { info: { b: 0, a: 1 } } },
        ),
        {},
    );
});
test("버전·저장 시각만 다르면 고객 필드 감사가 생기지 않는다", () => {
    assert.deepEqual(
        customerChanges(
            { version: 1, updatedAt: "old", name: "고객" },
            { version: 2, updatedAt: "new", name: "고객" },
        ),
        {},
    );
});
test("점·괄호가 있는 속성 이름을 서로 다른 경로로 보존한다", () => {
    const changes = customerChanges(
        { attributes: {} },
        { attributes: { "a.b": 1, 'a["b"]': false } },
    );
    assert.deepEqual(Object.keys(changes), [
        'attributes["a.b"]',
        'attributes["a[\\\"b\\\"]"]',
    ]);
});
