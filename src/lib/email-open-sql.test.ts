import test from "node:test";
import assert from "node:assert/strict";
import { PgDialect } from "drizzle-orm/pg-core";
import { openBaseSql, openedSendSql } from "./email-open-sql";

const dialect = new PgDialect();
const orgId = "11111111-1111-4111-8111-111111111111";

test("B25: 분모는 추적한 sent 발송", () => {
    const query = dialect.sqlToQuery(openBaseSql("f"));
    assert.equal(query.sql, "f.open_tracked AND f.status = 'sent'");
    assert.deepEqual(query.params, []);
});

for (const ref of ["email_send_logs", "f"] as const) {
    test(`B20: ${ref}의 사람 오픈·클릭 IN 하위 질의를 조직·시작 시각으로 제한`, () => {
        const since = "2026-10-21T00:00:00+09:00";
        const query = dialect.sqlToQuery(openedSendSql(ref, { orgId, since }));
        assert.equal(query.sql, `(${ref}.open_tracked AND ${ref}.status = 'sent') AND (${ref}.id IN (SELECT o.send_log_id FROM email_open_logs o WHERE o.org_id = $1::uuid AND o.is_machine = false AND o.opened_at >= $2::timestamptz) OR ${ref}.id IN (SELECT c.send_log_id FROM email_click_logs c WHERE c.org_id = $3::uuid AND c.is_bot = false AND c.clicked_at >= $4::timestamptz))`);
        assert.deepEqual(query.params, [orgId, since, orgId, since]);
    });
}

test("B20: Date는 ISO 문자열로 변환하고 조직·시각은 SQL에 삽입하지 않는다", () => {
    const since = new Date("2026-10-21T00:00:00+09:00");
    const query = dialect.sqlToQuery(openedSendSql("f", { orgId, since }));
    assert.deepEqual(query.params, [orgId, since.toISOString(), orgId, since.toISOString()]);
    assert.equal(query.sql.includes(orgId), false);
    assert.equal(query.sql.includes(since.toISOString()), false);
});
