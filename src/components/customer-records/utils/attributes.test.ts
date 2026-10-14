import { test } from "node:test";
import assert from "node:assert/strict";
import { attributeRows, parseAttributeRows } from "./attributes";
test("고객 속성 편집은 0·false·빈 값·중첩 배열의 자료형을 보존한다", () => {
    const value = {
        name: "샘플",
        amount: 0,
        flag: false,
        empty: null,
        nested: { x: [1, false, null] },
    };
    assert.deepEqual(parseAttributeRows(attributeRows(value)), {
        value,
        error: "",
    });
});
test("공백 정리 뒤 중복된 속성 이름은 덮어쓰지 않는다", () => {
    const rows = attributeRows({ tier: "A", other: "B" });
    rows[1].key = " tier ";
    assert.match(parseAttributeRows(rows).error, /중복/);
});
test("빈 숫자·무한대·숫자가 아닌 입력을 거절한다", () => {
    for (const value of ["", "NaN", "1e999"]) {
        const rows = attributeRows({ score: 1 });
        rows[0].value = value;
        assert.match(parseAttributeRows(rows).error, /숫자/);
    }
});
test("잘못된 JSON을 빈 속성으로 저장하지 않는다", () => {
    const rows = attributeRows({ nested: {} });
    rows[0].value = "{";
    assert.match(parseAttributeRows(rows).error, /JSON/);
});
test("속성을 제거해도 나머지 값과 특수 키는 보존한다", () => {
    const value = JSON.parse(
        '{"__proto__":{"marker":"safe"},"keep":0,"remove":"x"}',
    );
    const parsed = parseAttributeRows(
        attributeRows(value).filter((row) => row.key !== "remove"),
    );
    assert.equal(parsed.error, "");
    assert.equal(Object.getPrototypeOf(parsed.value), Object.prototype);
    assert.equal(Object.hasOwn(parsed.value, "__proto__"), true);
    assert.equal(parsed.value.keep, 0);
    assert.equal(Object.hasOwn(parsed.value, "remove"), false);
});
test("합계 크기 제한과 빈 속성 이름을 검사한다", () => {
    assert.match(
        parseAttributeRows(attributeRows({ large: "x".repeat(12000) })).error,
        /12,000/,
    );
    const rows = attributeRows({ name: "x" });
    rows[0].key = " ";
    assert.match(parseAttributeRows(rows).error, /이름/);
});
