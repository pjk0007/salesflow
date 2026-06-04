import { NextRequest, NextResponse } from "next/server";
import { db, trackerSites, partitions, fieldDefinitions } from "@/lib/db";
import { and, eq, sql, inArray } from "drizzle-orm";
import { getUserFromNextRequest } from "@/lib/auth";

/**
 * 퍼널 단계 편집기에서 사용할 매칭 옵션들을 사이트 실제 데이터에서 추출.
 * 운영자가 raw text 입력 대신 드롭다운에서 고르게 하기 위함.
 *
 * 응답:
 * - eventTypes: [{ type, labels[] }] — record_events.type 별 label 목록
 *   (추적이력 ON된 select 필드의 옵션도 eventType으로 합쳐 노출)
 * - popularPaths: 인기 페이지 경로 TOP 10 (utm 제거)
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const user = getUserFromNextRequest(req);
    if (!user) return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });

    const { id } = await params;
    const siteId = Number(id);
    const [site] = await db.select().from(trackerSites)
        .where(and(eq(trackerSites.id, siteId), eq(trackerSites.orgId, user.orgId)));
    if (!site) return NextResponse.json({ success: false, error: "트래커를 찾을 수 없습니다." }, { status: 404 });

    // 1) 이벤트 타입+라벨:
    //    (a) 실제 발생한 record_events
    //    (b) 추적이력 ON된 select 필드의 options (아직 발생 안 했어도 미리 선택 가능)
    //    + 표준 이벤트 타입 (signup, consult 등 보편 가입/상담 이벤트)
    const eventRows = (await db.execute(sql`
        SELECT re.type, re.label, COUNT(*)::int AS cnt
        FROM record_events re
        JOIN records r ON r.id = re.record_id
        WHERE r.workspace_id = ${site.workspaceId}
        GROUP BY 1, 2
        ORDER BY 1, 3 DESC
    `)) as unknown as Array<{ type: string; label: string; cnt: number }>;

    const eventTypesMap = new Map<string, Set<string>>();
    // (a) 실제 발생 이벤트
    for (const r of eventRows) {
        const set = eventTypesMap.get(r.type) ?? new Set<string>();
        if (r.label) set.add(r.label);
        eventTypesMap.set(r.type, set);
    }

    // 2) select 필드 + 옵션 — 워크스페이스의 추적이력 있는 select 필드들
    // partition의 field_type_id 우선
    const partitionRows = await db.select({ ftId: partitions.fieldTypeId })
        .from(partitions).where(eq(partitions.workspaceId, site.workspaceId));
    const fieldTypeIds = partitionRows.map((p) => p.ftId).filter((v): v is number => v != null);

    if (fieldTypeIds.length) {
        const fields = await db.select({
            key: fieldDefinitions.key,
            options: fieldDefinitions.options,
            trackHistory: fieldDefinitions.trackHistory,
        })
            .from(fieldDefinitions)
            .where(and(
                inArray(fieldDefinitions.fieldTypeId, fieldTypeIds),
                eq(fieldDefinitions.fieldType, "select"),
            ));
        // (b) 추적이력 ON된 select 필드 → 행동 이벤트로 미리 노출
        // type = 필드 key, labels = 그 필드의 select options
        // (앞으로 변경이 발생하면 record_events에 동일 type으로 쌓임)
        const seen = new Set<string>();
        for (const f of fields) {
            if (seen.has(f.key)) continue;
            seen.add(f.key);
            if (f.trackHistory !== 1) continue;
            const opts = Array.isArray(f.options) ? (f.options as string[]).filter((v) => typeof v === "string") : [];
            const set = eventTypesMap.get(f.key) ?? new Set<string>();
            for (const opt of opts) set.add(opt);
            eventTypesMap.set(f.key, set);
        }
    }

    const eventTypes = [...eventTypesMap.entries()].map(([type, labels]) => ({
        type,
        labels: [...labels],
    }));

    // 3) 인기 페이지 — 최근 90일 PV TOP10 (excludePaths 적용)
    const excludes = (site.excludePaths ?? []) as string[];
    const excludeFilter = excludes.length
        ? sql`AND NOT (${sql.join(excludes.map((p) => sql`regexp_replace(split_part(page_url, '?', 1), '^https?://[^/]+', '') LIKE ${p + "%"}`), sql` OR `)})`
        : sql``;
    const pathRows = (await db.execute(sql`
        SELECT regexp_replace(split_part(page_url, '?', 1), '^https?://[^/]+', '') AS path,
               COUNT(*)::int AS cnt
        FROM tracker_events
        WHERE site_id = ${siteId}
          AND event_type = 'PAGE_VIEW'
          AND occurred_at >= now() - INTERVAL '90 days'
          AND page_url IS NOT NULL
          ${excludeFilter}
        GROUP BY 1
        ORDER BY cnt DESC
        LIMIT 10
    `)) as unknown as Array<{ path: string; cnt: number }>;
    const popularPaths = pathRows.map((r) => r.path).filter((p) => p && p !== "");

    // 4) CUSTOM 이벤트 목록 (custom_event 매칭용) + 라벨
    //    = 최근 90일 발생한 것 + 이벤트 라벨 카드에 등록된 CUSTOM alias(미발생 포함).
    //    "이벤트를 먼저 정의(라벨 카드) → 퍼널에서 골라쓰기"를 위해 등록분도 노출하고,
    //    퍼널 드롭다운에 한글 라벨을 같이 보여주려고 alias.label을 join.
    const customRows = (await db.execute(sql`
        WITH names AS (
            SELECT event_name FROM tracker_events
            WHERE site_id = ${siteId} AND event_type = 'CUSTOM' AND event_name IS NOT NULL
              AND occurred_at >= now() - INTERVAL '90 days'
            GROUP BY event_name
            UNION
            SELECT event_name FROM tracker_event_aliases
            WHERE site_id = ${siteId} AND event_type = 'CUSTOM'
        )
        SELECT n.event_name AS "eventName", a.label
        FROM names n
        LEFT JOIN tracker_event_aliases a
            ON a.site_id = ${siteId} AND a.event_type = 'CUSTOM' AND a.event_name = n.event_name
        ORDER BY n.event_name
        LIMIT 100
    `)) as unknown as Array<{ eventName: string; label: string | null }>;
    const customEvents = customRows
        .filter((r) => r.eventName && r.eventName !== "")
        .map((r) => ({ eventName: r.eventName, label: r.label ?? "" }));

    return NextResponse.json({
        success: true,
        data: { eventTypes, popularPaths, customEvents },
    });
}
