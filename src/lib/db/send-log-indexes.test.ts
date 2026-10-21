import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { SEND_LOG_INDEXES } from "./send-log-indexes";

test("S2: 수신자 색인은 부팅 뒤 CONCURRENTLY·IF NOT EXISTS로 생성", () => {
    const indexes = SEND_LOG_INDEXES.filter(index => index.name === "email_send_logs_org_recipient_lower_idx");
    assert.equal(indexes.length, 1);
    assert.equal(indexes[0].ddl, 'CREATE INDEX CONCURRENTLY IF NOT EXISTS "email_send_logs_org_recipient_lower_idx" ON "email_send_logs" ("org_id", lower("recipient_email"))');
    const schema = readFileSync(new URL("./schema.ts", import.meta.url), "utf8");
    assert.ok(schema.includes('index("email_send_logs_org_recipient_lower_idx").on(table.orgId, sql`lower(${table.recipientEmail})`)'));
});
test("S2: 수신자 색인은 어느 마이그레이션 SQL에도 포함하지 않는다", () => {
    const migrations = new URL("../../../drizzle/", import.meta.url);
    for (const name of readdirSync(migrations).filter(name => name.endsWith(".sql"))) {
        const sql = readFileSync(new URL(name, migrations), "utf8");
        assert.equal(sql.includes("email_send_logs_org_recipient_lower_idx"), false, name);
    }
});
