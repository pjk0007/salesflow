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
test("발송 중복 확인·레코드별 조회 색인은 부팅 뒤 CONCURRENTLY로 만들고 schema.ts와 이름이 같다", () => {
    const expected: Record<string, [string, string]> = {
        email_send_logs_partition_recipient_idx: [
            'CREATE INDEX CONCURRENTLY IF NOT EXISTS "email_send_logs_partition_recipient_idx" ON "email_send_logs" ("partition_id", "recipient_email")',
            'index("email_send_logs_partition_recipient_idx").on(table.partitionId, table.recipientEmail)',
        ],
        email_send_logs_template_link_recipient_idx: [
            'CREATE INDEX CONCURRENTLY IF NOT EXISTS "email_send_logs_template_link_recipient_idx" ON "email_send_logs" ("template_link_id", "recipient_email") WHERE "template_link_id" IS NOT NULL',
            'index("email_send_logs_template_link_recipient_idx").on(table.templateLinkId, table.recipientEmail).where(sql`template_link_id IS NOT NULL`)',
        ],
        email_send_logs_record_idx: [
            'CREATE INDEX CONCURRENTLY IF NOT EXISTS "email_send_logs_record_idx" ON "email_send_logs" ("record_id") WHERE "record_id" IS NOT NULL',
            'index("email_send_logs_record_idx").on(table.recordId).where(sql`record_id IS NOT NULL`)',
        ],
    };
    const schema = readFileSync(new URL("./schema.ts", import.meta.url), "utf8");
    for (const [name, [ddl, declaration]] of Object.entries(expected)) {
        const indexes = SEND_LOG_INDEXES.filter(index => index.name === name);
        assert.equal(indexes.length, 1, name);
        assert.equal(indexes[0].ddl, ddl);
        assert.ok(schema.includes(declaration), name);
    }
});
test("S2: 수신자 색인은 어느 마이그레이션 SQL에도 포함하지 않는다", () => {
    const migrations = new URL("../../../drizzle/", import.meta.url);
    for (const name of readdirSync(migrations).filter(name => name.endsWith(".sql"))) {
        const sql = readFileSync(new URL(name, migrations), "utf8");
        assert.equal(sql.includes("email_send_logs_org_recipient_lower_idx"), false, name);
    }
});

test("T6: records email index has exact DDL, schema declaration and no migration", () => {
    const name = "records_workspace_email_norm_idx";
    const indexes = SEND_LOG_INDEXES.filter(index => index.name === name);
    assert.equal(indexes.length, 1);
    assert.equal(indexes[0].ddl, `CREATE INDEX CONCURRENTLY IF NOT EXISTS "records_workspace_email_norm_idx" ON "records" ("workspace_id", (left(lower(btrim("data"->>'email', chr(32)||chr(9)||chr(10)||chr(11)||chr(12)||chr(13)||chr(160)||chr(12288)||chr(65279)||chr(8203))), 200)))`);
    const schema = readFileSync(new URL("./schema.ts", import.meta.url), "utf8");
    assert.ok(schema.includes(`emailNormIdx: index("records_workspace_email_norm_idx").on(table.workspaceId, sql.raw(recordEmailIndexKeySql('"data"'))),`));
    const migrations = new URL("../../../drizzle/", import.meta.url);
    for (const file of readdirSync(migrations).filter(file => file.endsWith(".sql"))) {
        assert.equal(readFileSync(new URL(file, migrations), "utf8").includes(name), false, file);
    }
});
