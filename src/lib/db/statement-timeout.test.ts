import test from "node:test";
import assert from "node:assert/strict";

test("풀 연결 기본 쿼리 시간 제한: 기본 60초, 숫자면 그 값, 0이면 끔, 잘못된 값은 기본", async () => {
    process.env.DATABASE_URL ??= "postgres://localhost:5432/unused";
    const { statementTimeoutMs } = await import("./index");
    assert.equal(statementTimeoutMs(undefined), 60_000);
    assert.equal(statementTimeoutMs(""), 60_000);
    assert.equal(statementTimeoutMs("30000"), 30_000);
    assert.equal(statementTimeoutMs("0"), 0);
    assert.equal(statementTimeoutMs("abc"), 60_000);
    assert.equal(statementTimeoutMs("-1"), 60_000);
    assert.equal(statementTimeoutMs("99999999"), 60_000);
});
