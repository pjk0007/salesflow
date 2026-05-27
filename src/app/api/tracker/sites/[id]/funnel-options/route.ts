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
 * - selectFields: [{ key, label, options[] }] — record select 필드 + 그 필드의 옵션 값들
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

    // 1) 이벤트 타입+라벨: 그 workspace의 record_events에서 추출
    const eventRows = (await db.execute(sql`
        SELECT re.type, re.label, COUNT(*)::int AS cnt
        FROM record_events re
        JOIN records r ON r.id = re.record_id
        WHERE r.workspace_id = ${site.workspaceId}
        GROUP BY 1, 2
        ORDER BY 1, 3 DESC
    `)) as unknown as Array<{ type: string; label: string; cnt: number }>;

    const eventTypesMap = new Map<string, string[]>();
    for (const r of eventRows) {
        const arr = eventTypesMap.get(r.type) ?? [];
        if (r.label && !arr.includes(r.label)) arr.push(r.label);
        eventTypesMap.set(r.type, arr);
    }
    const eventTypes = [...eventTypesMap.entries()].map(([type, labels]) => ({ type, labels }));

    // 2) select 필드 + 옵션 — 워크스페이스의 추적이력 있는 select 필드들
    // partition의 field_type_id 우선
    const partitionRows = await db.select({ ftId: partitions.fieldTypeId })
        .from(partitions).where(eq(partitions.workspaceId, site.workspaceId));
    const fieldTypeIds = partitionRows.map((p) => p.ftId).filter((v): v is number => v != null);

    let selectFields: Array<{ key: string; label: string; options: string[] }> = [];
    if (fieldTypeIds.length) {
        const fields = await db.select({
            key: fieldDefinitions.key,
            label: fieldDefinitions.label,
            options: fieldDefinitions.options,
        })
            .from(fieldDefinitions)
            .where(and(
                inArray(fieldDefinitions.fieldTypeId, fieldTypeIds),
                eq(fieldDefinitions.fieldType, "select"),
            ));
        // 중복 key 제거 + 옵션 정규화
        const seen = new Set<string>();
        for (const f of fields) {
            if (seen.has(f.key)) continue;
            seen.add(f.key);
            const opts = Array.isArray(f.options) ? (f.options as string[]).filter((v) => typeof v === "string") : [];
            selectFields.push({ key: f.key, label: f.label, options: opts });
        }
    }

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

    return NextResponse.json({
        success: true,
        data: { eventTypes, selectFields, popularPaths },
    });
}
