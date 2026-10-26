import { sql } from "drizzle-orm";
import type { EmailSendLog } from "../db/schema";

export type ScopedEmailLog = Pick<EmailSendLog,
    "id" | "recipientEmail" | "subject" | "status" | "triggerType" | "sentAt" | "partitionId" | "recordId">;

/** Read each authorized partition's top K before the global merge, instead of
 * scanning the organization's newest rows until a sparse partition matches.
 * Keeping K=offset+pageSize per partition preserves global pagination. */
export function scopedEmailLogsQuery(orgId: string, partitionIds: number[], page: number, pageSize: number, status?: string) {
    const offset = (page - 1) * pageSize;
    const take = offset + pageSize;
    return sql`
        SELECT log.id, log.recipient_email AS "recipientEmail", log.subject, log.status,
               log.trigger_type AS "triggerType", log.sent_at AS "sentAt",
               log.partition_id AS "partitionId", log.record_id AS "recordId"
        FROM (SELECT DISTINCT unnest(${sql.param(partitionIds)}::int[]) AS id) scope
        CROSS JOIN LATERAL (
            SELECT id, recipient_email, subject, status, trigger_type, sent_at, partition_id, record_id
            FROM email_send_logs
            WHERE org_id = ${orgId}::uuid AND partition_id = scope.id
              ${status ? sql`AND status = ${status}` : sql``}
            ORDER BY sent_at DESC, id DESC
            LIMIT ${take}
        ) log
        ORDER BY log.sent_at DESC, log.id DESC
        LIMIT ${pageSize} OFFSET ${offset}
    `;
}
