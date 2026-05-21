import { db, visitorRecordLinks } from "@/lib/db";

/**
 * visitor ↔ record 링크를 누적(upsert)한다.
 * unique(visitor_id, record_id) 충돌 시 무시 — 멱등.
 * 신뢰 키(click_id / matchField / email)로 매칭됐을 때만 호출할 것 (phone 제외).
 */
export async function linkVisitorRecord(args: {
    orgId: string;
    visitorId: number;
    recordId: number;
    source: string;
}): Promise<void> {
    await db
        .insert(visitorRecordLinks)
        .values(args)
        .onConflictDoNothing({
            target: [visitorRecordLinks.visitorId, visitorRecordLinks.recordId],
        });
}
