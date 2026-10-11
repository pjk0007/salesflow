/**
 * 중복 수신자·쿨다운 확인을 "NHN이 받아 간 발송"으로 (DESIGN-SND 6-6, SND-11).
 *
 * 배달 결과(SST3·SST5·SST7·SST8·반송 안내)로 status가 sent → failed로 바뀌면 status='sent'만 보는 중복 확인에서 그 기록이 빠진다.
 * 그러면 같은 주소가 다시 가져와졌을 때 하드 반송 주소에 AI 메일을 또 쓰고 보내고, 쿨다운도 풀린다
 * ("보류 → 풀기 → 같은 죽은 주소 재발송 → 보류" 고리). 그래서 중복·쿨다운은 status 대신 "NHN이 접수했나"를 본다:
 *   status = 'sent' OR (status = 'failed' AND request_id IS NOT NULL AND (nhn_status_code IS NOT NULL OR delivery_fail_source IS NOT NULL))
 * 보낼 때 거절(NHN이 받지 않음 — 결과 코드도 반송도 없는 failed)은 빠진다 — 지금처럼 다시 보낼 수 있다.
 *
 * 0075가 아직 없으면(칸이 없음 — 마이그레이션이 잠금 시간 초과로 미뤄진 경우) 예전 조건(status='sent')으로 돌아간다.
 * 그렇지 않으면 중복 확인 문장이 던져 모든 자동 발송이 실패한다. 칸이 있는지는 한 번 확인해 기억한다 (없으면 1분 뒤 다시).
 */
import { sql, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import { emailSendLogs } from "@/lib/db/schema";

const RECHECK_MS = 60 * 1000;
let ready: boolean | null = null;
let checkedAt = 0;
let inflight: Promise<boolean> | null = null;

async function checkColumns(): Promise<boolean> {
    try {
        const rows = (await db.execute(sql`
            SELECT count(*)::int AS n FROM information_schema.columns
            WHERE table_schema = current_schema() AND table_name = 'email_send_logs'
              AND column_name IN ('nhn_status_code', 'delivery_fail_source')
        `)) as unknown as Array<{ n: number }>;
        return Number(rows[0]?.n) === 2;
    } catch {
        return false;
    }
}

/** 0075의 배달 결과 칸이 있나 (있으면 끝까지 기억한다) */
export async function sendLogDeliveryColumnsReady(): Promise<boolean> {
    if (ready === true) return true;
    if (ready === false && Date.now() - checkedAt < RECHECK_MS) return false;
    if (!inflight) {
        inflight = checkColumns().then((ok) => {
            ready = ok;
            checkedAt = Date.now();
            inflight = null;
            return ok;
        });
    }
    return inflight;
}

/** 칸이 있을 때의 조건 — 화면·시험이 같은 모양을 보게 내보낸다 */
export function acceptedSendConditionSql(): SQL {
    return sql`(${emailSendLogs.status} = 'sent' OR (${emailSendLogs.status} = 'failed' AND ${emailSendLogs.requestId} IS NOT NULL AND (${emailSendLogs.nhnStatusCode} IS NOT NULL OR ${emailSendLogs.deliveryFailSource} IS NOT NULL)))`;
}

/** NHN이 받아 간 발송 (배달 결과와 상관없이). 중복 수신자 확인에 쓴다 */
export async function acceptedSendCondition(): Promise<SQL> {
    if (await sendLogDeliveryColumnsReady()) return acceptedSendConditionSql();
    return sql`${emailSendLogs.status} = 'sent'`;
}

/** 쿨다운: NHN이 받아 간 발송 + 지금 보내는 중(pending) */
export async function acceptedOrPendingCondition(): Promise<SQL> {
    if (await sendLogDeliveryColumnsReady()) {
        return sql`(${acceptedSendConditionSql()} OR ${emailSendLogs.status} = 'pending')`;
    }
    return sql`${emailSendLogs.status} IN ('sent', 'pending')`;
}
