import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SEND_LOG_INDEXES } from "../db/send-log-indexes";
const read = (file: string) => readFileSync(new URL(`../../../${file}`, import.meta.url), "utf8");
test("B1: 0121은 다섯 새 집계 표와 작은 조직 FK만 만든다", () => {
    const flat = read("drizzle/0121_email_stats.sql").replace(/--[^\n]*/g, "").replace(/\s+/g, " ").trim();
    assert.ok(flat.startsWith("SET LOCAL lock_timeout = '5s';"));
    for (const name of ["email_stats_send_attr", "email_stats_daily", "email_stats_lead_days", "email_stats_state", "home_stats_daily"])
        assert.ok(flat.includes(`CREATE TABLE IF NOT EXISTS "${name}"`), name);
    assert.ok(flat.includes("CREATE INDEX IF NOT EXISTS \"email_stats_send_attr_org_date_idx\" ON \"email_stats_send_attr\" (\"org_id\", \"stat_date\")"));
    assert.ok(flat.includes("WITH (fillfactor = 80)"));
    assert.ok(flat.includes("\"manual_refreshed_at\" timestamptz"));
    assert.ok(flat.includes("\"home_stats_daily_pkey\" PRIMARY KEY (\"org_id\", \"stat_date\", \"source\", \"template_name\")"));
    assert.doesNotMatch(flat, /ALTER\s+TABLE|UPDATE\s|DROP\s|CREATE INDEX[^;]*ON "(?!email_stats_)|REFERENCES "(?!organizations")/i);
});
test("B1: 0121 journal은 유일하고 앞 번호보다 늦다", () => {
    const { entries } = JSON.parse(read("drizzle/meta/_journal.json")) as { entries: { idx: number; tag: string; when: number; breakpoints: boolean }[] };
    const matches = entries.filter(e => e.tag === "0121_email_stats");
    assert.equal(matches.length, 1);
    assert.deepEqual(matches[0], { idx: 122, version: "7", when: 1792692000000, tag: "0121_email_stats", breakpoints: true });
    assert.ok(entries.filter(e => e.tag < "0121").every(e => e.when < matches[0].when && e.idx < matches[0].idx));
});
test("B26: records 색인은 마이그레이션 밖에서 CONCURRENTLY 생성", () => {
    const entry = SEND_LOG_INDEXES.filter(e => e.name === "records_org_created_at_idx");
    assert.equal(entry.length, 1);
    assert.equal(entry[0].ddl, "CREATE INDEX CONCURRENTLY IF NOT EXISTS \"records_org_created_at_idx\" ON \"records\" (\"org_id\", \"created_at\")");
    assert.ok(read("src/lib/db/schema.ts").includes("index(\"records_org_created_at_idx\").on(table.orgId, table.createdAt)"));
});
