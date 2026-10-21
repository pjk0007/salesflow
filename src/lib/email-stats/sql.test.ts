import test from "node:test";
import assert from "node:assert/strict";
import { sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { HEALTH_CATEGORY_SQL } from "../sender-health-rules";
import { rollupSql } from "./sql";
import { referenceSql } from "./reference-sql";
const org = "00000000-0000-4000-8000-000000000001";
const range = { from: "2026-10-01", to: "2026-10-21" };
test("B4·B13: 집계 SQL은 기존 판정과 매개변수, 다섯 묶음 및 diff를 사용", () => {
    const query = new PgDialect().sqlToQuery(rollupSql(org, range, sql`(ACCEPTED_MARK)`));
    assert.ok(query.sql.includes("email_send_logs.open_tracked AND email_send_logs.status = 'sent'"));
    assert.ok(query.sql.includes("(ACCEPTED_MARK)"));
    assert.ok(query.sql.includes(HEALTH_CATEGORY_SQL));
    for (const part of ["GROUPING SETS", "(stat_date, workspace_id)", "(stat_date, workspace_id, campaign_kind, campaign_id, step_index)", "(stat_date, workspace_id, partition_id)", "(stat_date, workspace_id, sender_profile_id, sender_domain)", "(stat_date, workspace_id, trigger_type)", "ON CONFLICT ON CONSTRAINT email_stats_daily_pkey", "changed AS", "del AS", "LIKE 'test%'", "= 'journey_demo'", "IN ('demo','cancelled')"])
        assert.ok(query.sql.includes(part), part);
    for (const param of [org, range.from, range.to, "2026-10-01T00:00:00+09:00", "2026-10-22T00:00:00+09:00"]) {
        assert.ok(query.params.includes(param)); assert.ok(!query.sql.includes(param));
    }
});
test("B4: 참조 SQL은 집계·귀속 표 없이 원본 사슬을 읽는다", () => {
    const query = new PgDialect().sqlToQuery(referenceSql(org, range, sql`(ACCEPTED_MARK)`));
    assert.doesNotMatch(query.sql, /email_stats_(daily|send_attr)/);
    assert.match(query.sql, /WITH RECURSIVE/);
    assert.ok(query.params.includes(org));
});
