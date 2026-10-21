import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("B17·B18·B19: 0120은 제한 시간 내 멱등 DDL만 적용", () => {
    const flat = readFileSync("drizzle/0120_email_open_tracking.sql", "utf8").replace(/--[^\n]*/g, "").replace(/\s+/g, " ").trimStart();
    assert.ok(flat.startsWith("SET LOCAL lock_timeout = '5s';"));
    for (const expected of [
        'ALTER TABLE "email_send_logs" ADD COLUMN IF NOT EXISTS "open_tracked" boolean DEFAULT false NOT NULL;',
        'CREATE TABLE IF NOT EXISTS "email_open_logs"',
        '"send_log_id" integer NOT NULL REFERENCES "email_send_logs"("id") ON DELETE CASCADE',
        '"is_machine" boolean NOT NULL', '"machine_reason" varchar(16)', '"opened_at" timestamptz DEFAULT now() NOT NULL',
        'CREATE INDEX IF NOT EXISTS "email_open_logs_send_log_machine_idx" ON "email_open_logs" ("send_log_id", "is_machine");',
        'CREATE INDEX IF NOT EXISTS "email_open_logs_org_opened_idx" ON "email_open_logs" ("org_id", "opened_at");',
        'CREATE INDEX IF NOT EXISTS "email_click_logs_org_clicked_idx" ON "email_click_logs" ("org_id", "clicked_at");',
    ]) assert.ok(flat.includes(expected), expected);
    assert.ok(flat.indexOf("ALTER TABLE") < flat.indexOf("CREATE TABLE"));
    assert.doesNotMatch(flat, /UPDATE\s+"?email_send_logs|SET DEFAULT|CREATE INDEX[^;]*ON "email_send_logs"/i);
});
test("B19: journal의 0120은 하나뿐이고 가장 늦은 실행 시각이다", () => {
    const journal = JSON.parse(readFileSync("drizzle/meta/_journal.json", "utf8")) as { entries: { idx: number; tag: string; when: number; breakpoints: boolean }[] };
    const entries = journal.entries.filter(entry => entry.tag === "0120_email_open_tracking");
    assert.equal(entries.length, 1);
    assert.equal(entries[0].when, 1792605600000);
    assert.equal(entries[0].breakpoints, true);
    // drizzle은 마지막으로 적용된 시각보다 뒤인 것만 적용하므로 가장 늦어야 운영에서 돈다
    assert.equal(Math.max(...journal.entries.map(entry => entry.when)), entries[0].when);
    assert.equal(entries[0].idx, Math.max(...journal.entries.map(entry => entry.idx)));
});
