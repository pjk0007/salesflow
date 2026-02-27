import { NextRequest, NextResponse } from "next/server";
import { db, dashboards, dashboardWidgets, records, partitions } from "@/lib/db";
import { eq, and, sql, asc } from "drizzle-orm";
import { getUserFromNextRequest } from "@/lib/auth";
import type { DashboardFilter } from "@/lib/db/schema";

export async function GET(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id: idStr } = await params;
    const dashboardId = Number(idStr);
    if (!dashboardId) {
        return NextResponse.json({ success: false, error: "대시보드 ID가 필요합니다." }, { status: 400 });
    }

    try {
        // 대시보드 조회 (인증 or 공개)
        const user = getUserFromNextRequest(req);
        let dashboard;

        if (user) {
            [dashboard] = await db
                .select()
                .from(dashboards)
                .where(and(eq(dashboards.id, dashboardId), eq(dashboards.orgId, user.orgId)));
        } else {
            [dashboard] = await db
                .select()
                .from(dashboards)
                .where(and(eq(dashboards.id, dashboardId), eq(dashboards.isPublic, 1)));
        }

        if (!dashboard) {
            return NextResponse.json({ success: false, error: "대시보드를 찾을 수 없습니다." }, { status: 404 });
        }

        // 위젯 목록
        const widgets = await db
            .select()
            .from(dashboardWidgets)
            .where(eq(dashboardWidgets.dashboardId, dashboardId))
            .orderBy(asc(dashboardWidgets.layoutY), asc(dashboardWidgets.layoutX));

        // 파티션 범위: partitionIds 설정 시 해당 파티션만, 없으면 전체 워크스페이스
        let partitionIds: number[];
        if (dashboard.partitionIds && Array.isArray(dashboard.partitionIds) && dashboard.partitionIds.length > 0) {
            partitionIds = dashboard.partitionIds;
        } else {
            const partitionRows = await db
                .select({ id: partitions.id })
                .from(partitions)
                .where(eq(partitions.workspaceId, dashboard.workspaceId));
            partitionIds = partitionRows.map((p) => p.id);
        }

        if (partitionIds.length === 0) {
            const emptyData: Record<number, unknown> = {};
            for (const w of widgets) emptyData[w.id] = w.widgetType === "scorecard" ? { value: 0 } : [];
            return NextResponse.json({ success: true, data: emptyData });
        }

        const partitionIdList = partitionIds.join(",");

        // 각 위젯별 데이터 집계
        const widgetData: Record<number, unknown> = {};

        for (const widget of widgets) {
            const filterConditions = buildFilterSQL(
                dashboard.globalFilters,
                widget.widgetFilters
            );
            const whereClause = `partition_id IN (${partitionIdList})${filterConditions}`;

            if (widget.widgetType === "scorecard") {
                const agg = aggValueExpr(widget.dataColumn, widget.aggregation);

                const rows = await db.execute(
                    sql.raw(`SELECT ${agg} as value FROM records WHERE ${whereClause}`)
                ) as unknown as Record<string, unknown>[];
                widgetData[widget.id] = { value: Number(rows[0]?.value ?? 0) };
            } else if (widget.widgetType === "bar_stacked" && widget.stackByColumn) {
                const agg = aggValueExpr(widget.dataColumn, widget.aggregation);
                const groupLabel = groupLabelExpr(widget.groupByColumn!);
                const stackLabel = groupLabelExpr(widget.stackByColumn);

                const rows = await db.execute(
                    sql.raw(
                        `SELECT ${groupLabel} as label,
                                ${stackLabel} as stack,
                                ${agg} as value
                         FROM records WHERE ${whereClause}
                         GROUP BY ${groupLabel}, ${stackLabel}
                         ORDER BY label`
                    )
                ) as unknown as Record<string, unknown>[];
                widgetData[widget.id] = rows;
            } else {
                // bar, bar_horizontal, line, donut
                const groupCol = widget.groupByColumn || widget.dataColumn;
                const agg = aggValueExpr(widget.dataColumn, widget.aggregation);
                const groupLabel = groupLabelExpr(groupCol);

                const rows = await db.execute(
                    sql.raw(
                        `SELECT ${groupLabel} as label, ${agg} as value
                         FROM records WHERE ${whereClause}
                         GROUP BY ${groupLabel}
                         ORDER BY label`
                    )
                ) as unknown as Record<string, unknown>[];
                widgetData[widget.id] = rows;
            }
        }

        return NextResponse.json({ success: true, data: widgetData });
    } catch (error) {
        console.error("Dashboard data error:", error);
        return NextResponse.json({ success: false, error: "서버 오류가 발생했습니다." }, { status: 500 });
    }
}

function sanitize(col: string): string {
    return col.replace(/[^a-zA-Z0-9_]/g, "");
}

// 시스템 컬럼 매핑: _sys:registeredAt → registered_at (실제 DB 컬럼)
const SYS_COL_MAP: Record<string, string> = {
    "_sys:registeredAt": "registered_at",
    "_sys:createdAt": "created_at",
    "_sys:updatedAt": "updated_at",
};

function isSystemCol(col: string): boolean {
    return col.startsWith("_sys:");
}

// 컬럼을 SQL 표현식으로 변환 (시스템 컬럼은 테이블 컬럼, 일반은 data->>'...')
function colExpr(col: string): string {
    if (isSystemCol(col)) {
        return SYS_COL_MAP[col] || sanitize(col);
    }
    return `data->>'${sanitize(col)}'`;
}

// 그룹 기준용 라벨 표현식 (날짜 컬럼은 YYYY-MM-DD로 포맷)
function groupLabelExpr(col: string): string {
    if (isSystemCol(col)) {
        const dbCol = SYS_COL_MAP[col] || sanitize(col);
        return `TO_CHAR(${dbCol}, 'YYYY-MM-DD')`;
    }
    return `data->>'${sanitize(col)}'`;
}

// 집계 대상 표현식 (SUM/AVG용 — 시스템 컬럼은 EXTRACT(EPOCH), 일반은 ::numeric)
function aggValueExpr(col: string, agg: string): string {
    if (agg === "count") return "COUNT(*)";
    if (isSystemCol(col)) {
        // 날짜 컬럼에 SUM/AVG는 의미 없지만, 에러 방지
        return "COUNT(*)";
    }
    const cast = `(data->>'${sanitize(col)}')::numeric`;
    return agg === "sum"
        ? `COALESCE(SUM(${cast}), 0)`
        : `COALESCE(AVG(${cast}), 0)`;
}

function buildFilterSQL(
    globalFilters?: DashboardFilter[] | null,
    widgetFilters?: DashboardFilter[] | null
): string {
    const all = [...(globalFilters || []), ...(widgetFilters || [])];
    if (all.length === 0) return "";

    const parts: string[] = [];
    for (const f of all) {
        const col = sanitize(f.field);
        const val = f.value.replace(/'/g, "''");
        switch (f.operator) {
            case "eq":
                parts.push(`data->>'${col}' = '${val}'`);
                break;
            case "ne":
                parts.push(`data->>'${col}' != '${val}'`);
                break;
            case "gt":
                parts.push(`(data->>'${col}')::numeric > ${Number(val)}`);
                break;
            case "gte":
                parts.push(`(data->>'${col}')::numeric >= ${Number(val)}`);
                break;
            case "lt":
                parts.push(`(data->>'${col}')::numeric < ${Number(val)}`);
                break;
            case "lte":
                parts.push(`(data->>'${col}')::numeric <= ${Number(val)}`);
                break;
            case "like":
                parts.push(`data->>'${col}' ILIKE '%${val}%'`);
                break;
            case "in":
                const vals = val.split(",").map((v) => `'${v.trim().replace(/'/g, "''")}'`);
                parts.push(`data->>'${col}' IN (${vals.join(",")})`);
                break;
        }
    }
    return parts.length > 0 ? ` AND ${parts.join(" AND ")}` : "";
}
