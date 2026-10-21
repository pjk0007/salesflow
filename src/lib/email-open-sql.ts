import { sql, type SQL } from "drizzle-orm";

/** 바깥 쿼리에서 발송 행을 가리키는 닫힌 이름만 받는다. */
export type SendLogRef = "email_send_logs" | "f";
export function openBaseSql(ref: SendLogRef): SQL {
    return sql`${sql.raw(ref)}.open_tracked AND ${sql.raw(ref)}.status = 'sent'`;
}
/** 바깥 쿼리와 같은 조직·기간 시작을 넘긴다. */
export interface OpenScope { orgId: string; since: Date | string }

export function openedSendSql(ref: SendLogRef, scope: OpenScope): SQL {
    const name = sql.raw(ref);
    const since = scope.since instanceof Date ? scope.since.toISOString() : scope.since;
    return sql`(${openBaseSql(ref)}) AND (${name}.id IN (SELECT o.send_log_id FROM email_open_logs o WHERE o.org_id = ${scope.orgId}::uuid AND o.is_machine = false AND o.opened_at >= ${since}::timestamptz) OR ${name}.id IN (SELECT c.send_log_id FROM email_click_logs c WHERE c.org_id = ${scope.orgId}::uuid AND c.is_bot = false AND c.clicked_at >= ${since}::timestamptz))`;
}
