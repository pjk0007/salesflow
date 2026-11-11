import { sql } from "drizzle-orm";
import { memos, records } from "@/lib/db";

/** 중요 탭에서 빼는 상태 — 이미 끝난 리드 */
export const IMPORTANT_EXCLUDED_STATUSES = ["종료", "전환"];

/**
 * 리드 관리 "중요" 조건 (한국 시간 기준)
 * - 다음 연락일(data.nextContactAt)이 오늘인 리드
 * - 다음 연락일이 지났는데 그 날 이후 남긴 댓글이 없는 리드
 * 종료·전환 상태는 뺀다. 다음 연락일은 댓글에서 정하거나 칸에 직접 넣는다.
 */
export function importantLeadCondition() {
    const next = sql`(${records.data}->>'nextContactAt')`;
    const nextDate = sql`((${next})::timestamptz AT TIME ZONE 'Asia/Seoul')::date`;
    const today = sql`(now() AT TIME ZONE 'Asia/Seoul')::date`;
    const excluded = sql.join(IMPORTANT_EXCLUDED_STATUSES.map((s) => sql`${s}`), sql`, `);
    return sql`(
        coalesce(${records.data}->>'status', '') NOT IN (${excluded})
        AND ${next} ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
        AND (
            ${nextDate} = ${today}
            OR (
                ${nextDate} < ${today}
                AND NOT EXISTS (
                    SELECT 1 FROM ${memos}
                    WHERE ${memos.recordId} = ${records.id}
                      AND (${memos.createdAt} AT TIME ZONE 'Asia/Seoul')::date >= ${nextDate}
                )
            )
        )
    )`;
}
