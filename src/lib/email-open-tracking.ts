import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { emailOpenLogs } from "@/lib/db/schema";
import { machineOpenReason, OPEN_WRITE_CONCURRENCY, shouldStoreOpen, shouldLogDroppedOpens } from "@/lib/email-open-rules";
import { pgErrorOf } from "@/lib/email-reply-rules";

export interface OpenHit { sendLogId: number; openedAt: Date; ip: string | null; userAgent: string | null }

/** 저장한 경우 true. 동시 기록 때문에 상한을 최대 OPEN_WRITE_CONCURRENCY - 1만큼 넘을 수 있다. */
export async function recordOpen(hit: OpenHit): Promise<boolean> {
    const userAgent = hit.userAgent ? hit.userAgent.slice(0, 512) : null;
    const rows = await db.execute(sql`
        SELECT s.org_id AS "orgId", s.sent_at AS "sentAt", s.open_tracked AS "openTracked",
               (SELECT count(*)::int FROM email_open_logs o WHERE o.send_log_id = s.id AND o.is_machine = false) AS "storedHuman",
               (SELECT count(*)::int FROM email_open_logs o WHERE o.send_log_id = s.id AND o.is_machine = true) AS "storedMachine"
        FROM email_send_logs s
        WHERE s.id = ${hit.sendLogId}
    `) as unknown as Array<{ orgId: string; sentAt: string | Date; openTracked: boolean; storedHuman: number; storedMachine: number }>;
    const row = rows[0];
    if (!row) return false;
    const reason = machineOpenReason({ userAgent, sentAt: new Date(row.sentAt), openedAt: hit.openedAt });
    if (!shouldStoreOpen({ openTracked: row.openTracked === true, isMachine: reason !== null, storedHuman: row.storedHuman, storedMachine: row.storedMachine })) return false;
    await db.insert(emailOpenLogs).values({
        orgId: row.orgId, sendLogId: hit.sendLogId, openedAt: hit.openedAt,
        ip: hit.ip, userAgent, isMachine: reason !== null, machineReason: reason,
    });
    return true;
}

let inFlight = 0;
let droppedOpens = 0;
let lastDropLogAt = Date.now();
/** 동시 상한을 넘는 요청은 버리고, 실패는 SQLSTATE만 남기며 전파하지 않는다. */
export async function recordOpenSafely(hit: OpenHit): Promise<void> {
    if (inFlight >= OPEN_WRITE_CONCURRENCY) {
        droppedOpens++;
        const now = Date.now();
        if (shouldLogDroppedOpens(droppedOpens, lastDropLogAt, now)) {
            console.warn(`[open-pixel] 동시 상한으로 버린 오픈 ${droppedOpens}건 (최근 60초 누계)`);
            droppedOpens = 0;
            lastDropLogAt = now;
        }
        return;
    }
    inFlight++;
    try {
        await recordOpen(hit);
    } catch (e) {
        console.error(`[open-pixel] 오픈 기록 실패 (send_log ${hit.sendLogId}): ${pgErrorOf(e)?.code ?? "unknown"}`);
    } finally {
        inFlight--;
    }
}
