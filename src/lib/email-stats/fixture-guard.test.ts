import test from "node:test";
import assert from "node:assert/strict";
import type postgres from "postgres";
import { fixture } from "./db-fixture.test-helper";

test("fixture는 실제 접속 DB를 확인한 뒤에만 쓰기를 시작한다", async () => {
    let attemptedWrite = false;
    const conn = Object.assign(async () => [{ name: "other_database" }], {
        unsafe: async () => { attemptedWrite = true; throw new Error("write attempted"); },
    }) as unknown as postgres.Sql;
    await assert.rejects(fixture(conn), /sendb_email_stats_qa/);
    assert.equal(attemptedWrite, false);
});
