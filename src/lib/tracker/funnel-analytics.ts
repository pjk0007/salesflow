import { db } from "@/lib/db";
import { sql } from "drizzle-orm";
import type { FunnelStage, StageMatch } from "@/components/tracker/types/funnel";

interface StageContext {
    siteId: number;
    fromIso: string;
    toIso: string;
    // 의미있는 visitor 집합 (visit 단계). aggregateRange와 동일 조건.
    meaningfulVisitorIdsSql: ReturnType<typeof sql>;
}

// visitor가 거친 모든 record (대표 + N:M 링크 합집합)
function visitorRecordsAllCte() {
    return sql`
        WITH visitor_records_all AS (
            SELECT id AS visitor_id, record_id FROM tracker_visitors WHERE record_id IS NOT NULL
            UNION
            SELECT visitor_id, record_id FROM visitor_record_links
        )
    `;
}

// 한 단계의 visitor 수 (기간 내 첫 발생 기준, distinct visitor).
// visit/lead 자동 단계는 이 헬퍼 밖에서 별도 처리 (aggregateRange와 일치).
export async function countStageVisitors(
    ctx: StageContext,
    match: StageMatch,
): Promise<number> {
    if (match.type === "record_event") {
        const labelFilter = match.label
            ? sql`AND re.label = ${match.label}`
            : sql``;
        const [row] = (await db.execute(sql`
            ${visitorRecordsAllCte()}
            SELECT COUNT(DISTINCT vra.visitor_id)::int AS cnt
            FROM visitor_records_all vra
            JOIN record_events re ON re.record_id = vra.record_id
                AND re.type = ${match.eventType}
                ${labelFilter}
                AND re.occurred_at >= ${ctx.fromIso}
                AND re.occurred_at <= ${ctx.toIso}
            WHERE vra.visitor_id IN ${ctx.meaningfulVisitorIdsSql}
        `)) as unknown as Array<{ cnt: number }>;
        return row?.cnt ?? 0;
    }

    if (match.type === "record_field") {
        const [row] = (await db.execute(sql`
            ${visitorRecordsAllCte()}
            SELECT COUNT(DISTINCT vra.visitor_id)::int AS cnt
            FROM visitor_records_all vra
            JOIN records r ON r.id = vra.record_id
            WHERE vra.visitor_id IN ${ctx.meaningfulVisitorIdsSql}
              AND r.data->>${match.field} = ${match.value}
        `)) as unknown as Array<{ cnt: number }>;
        return row?.cnt ?? 0;
    }

    if (match.type === "page_url") {
        const prefix = match.pathPrefix + "%";
        const [row] = (await db.execute(sql`
            SELECT COUNT(DISTINCT ev.visitor_id)::int AS cnt
            FROM tracker_events ev
            WHERE ev.site_id = ${ctx.siteId}
              AND ev.event_type = 'PAGE_VIEW'
              AND ev.occurred_at >= ${ctx.fromIso}
              AND ev.occurred_at <= ${ctx.toIso}
              AND regexp_replace(split_part(ev.page_url, '?', 1), '^https?://[^/]+', '') LIKE ${prefix}
              AND ev.visitor_id IN ${ctx.meaningfulVisitorIdsSql}
        `)) as unknown as Array<{ cnt: number }>;
        return row?.cnt ?? 0;
    }

    return 0;
}

// 자동 단계 키
export const AUTO_STAGE_VISIT = "visit";
export const AUTO_STAGE_LEAD = "lead";

export function isAutoStageKey(key: string): boolean {
    return key === AUTO_STAGE_VISIT || key === AUTO_STAGE_LEAD;
}

// stages 배열 검증 — 자동 단계 키 충돌 방지
export function validateUserStages(stages: FunnelStage[]): string | null {
    for (const s of stages) {
        if (isAutoStageKey(s.key)) {
            return `자동 단계 키(${s.key})는 사용할 수 없습니다.`;
        }
    }
    const keys = stages.map((s) => s.key);
    if (new Set(keys).size !== keys.length) return "단계 key가 중복됩니다.";
    return null;
}
