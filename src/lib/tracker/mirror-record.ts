import { sql, eq, and } from "drizzle-orm";
import type { PgTransaction } from "drizzle-orm/pg-core";
import { records, trackerVisitors } from "@/lib/db/schema";

type Tx = PgTransaction<any, any, any>;

/**
 * tracker_visitors의 visitor를 records 테이블에 mirror (UPSERT).
 * 트래커 collect 호출 시 매번 호출되어 records 시스템에 동기화된 visitor 데이터를 유지.
 *
 * UPSERT 키: (partition_id, data->>'visitor_id')
 */
export async function mirrorVisitorToRecord(
    tx: Tx,
    input: {
        orgId: string;
        workspaceId: number;
        partitionId: number;
        visitor: typeof trackerVisitors.$inferSelect;
    },
): Promise<number> {
    const { orgId, workspaceId, partitionId, visitor } = input;

    const data = {
        tracker_visitor_id: visitor.visitorId,
        tracker_email: visitor.email,
        tracker_name: visitor.name,
        tracker_first_seen: visitor.firstSeenAt,
        tracker_last_seen: visitor.lastSeenAt,
        tracker_total_visits: visitor.totalVisits,
        tracker_total_pageviews: visitor.totalPageviews,
        tracker_total_events: visitor.totalEvents,
        tracker_device_type: visitor.deviceType,
        tracker_browser: visitor.browser,
        tracker_os: visitor.os,
        tracker_first_utm_source: visitor.firstUtmSource,
        tracker_first_utm_medium: visitor.firstUtmMedium,
        tracker_first_utm_campaign: visitor.firstUtmCampaign,
        tracker_last_utm_source: visitor.lastUtmSource,
        tracker_last_utm_medium: visitor.lastUtmMedium,
        tracker_last_utm_campaign: visitor.lastUtmCampaign,
        tracker_last_page: visitor.lastPage,
        tracker_last_event: visitor.lastEvent,
        tracker_last_event_at: visitor.lastEventAt,
    };

    // 기존 mirror record 조회
    const existing = (await tx.execute(sql`
        SELECT id FROM records
        WHERE partition_id = ${partitionId}
          AND data->>'tracker_visitor_id' = ${visitor.visitorId}
        LIMIT 1
    `)) as unknown as Array<{ id: number }>;

    if (existing[0]) {
        const recordId = existing[0].id;
        await tx
            .update(records)
            .set({ data, updatedAt: new Date() })
            .where(eq(records.id, recordId));
        return recordId;
    }

    const [created] = await tx
        .insert(records)
        .values({
            orgId,
            workspaceId,
            partitionId,
            data,
        })
        .returning({ id: records.id });
    return created.id;
}
