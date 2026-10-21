import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import type { OpenSignal } from "@/components/email/opens/types";

export const EMPTY_OPEN_SIGNAL: OpenSignal = { openCount: 0, machineOpenCount: 0, openTracked: false };

/** 요청한 id 중 같은 조직의 발송 모두를 담는다. 오픈이 없어도 추적 여부를 반환한다. */
export async function openSignalsForSendLogs(orgId: string, logIds: number[]): Promise<Map<number, OpenSignal>> {
    const out = new Map<number, OpenSignal>();
    if (logIds.length === 0) return out;
    const rows = await db.execute(sql`
        SELECT s.id AS "sendLogId", s.open_tracked AS "openTracked",
               count(o.id) FILTER (WHERE o.is_machine = false)::int AS "openCount",
               count(o.id) FILTER (WHERE o.is_machine = true)::int AS "machineOpenCount"
        FROM email_send_logs s
        LEFT JOIN email_open_logs o ON o.send_log_id = s.id AND o.org_id = s.org_id
        WHERE s.org_id = ${orgId}::uuid AND s.id = ANY(${sql.param(logIds)}::int[])
        GROUP BY s.id, s.open_tracked
    `) as unknown as Array<OpenSignal & { sendLogId: number }>;
    for (const row of rows) {
        out.set(row.sendLogId, { openCount: row.openCount, machineOpenCount: row.machineOpenCount, openTracked: row.openTracked === true });
    }
    return out;
}
