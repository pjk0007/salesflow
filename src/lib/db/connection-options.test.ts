import test from "node:test";
import assert from "node:assert/strict";
import { poolMax, statementTimeoutMs } from "./connection-options";

test("query timeout preserves the production fix and rejects malformed settings", () => {
    for (const value of ["", "abc", "-1", "1.5", "3600001", "99999999999999999"])
        assert.equal(statementTimeoutMs(value), 60_000, value);
    assert.equal(statementTimeoutMs(" 30000 "), 30_000);
    assert.equal(statementTimeoutMs("0"), 0); // Explicit administrator override only.
    assert.equal(statementTimeoutMs("3600000"), 3_600_000);
});

test("pool capacity rejects settings outside the existing supported range", () => {
    for (const value of ["", "0", "4", "201", "10.5", "no"]) assert.equal(poolMax(value), 20);
    assert.equal(poolMax("5"), 5);
    assert.equal(poolMax(" 40 "), 40);
});
