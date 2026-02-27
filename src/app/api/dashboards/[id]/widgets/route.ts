import { NextRequest, NextResponse } from "next/server";
import { db, dashboards, dashboardWidgets } from "@/lib/db";
import { eq, and, asc } from "drizzle-orm";
import { getUserFromNextRequest } from "@/lib/auth";

async function verifyDashboard(dashboardId: number, orgId: string) {
    const [dashboard] = await db
        .select()
        .from(dashboards)
        .where(and(eq(dashboards.id, dashboardId), eq(dashboards.orgId, orgId)));
    return dashboard ?? null;
}

export async function GET(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const user = getUserFromNextRequest(req);
    if (!user) {
        return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    }

    const { id: idStr } = await params;
    const dashboardId = Number(idStr);
    if (!dashboardId) {
        return NextResponse.json({ success: false, error: "대시보드 ID가 필요합니다." }, { status: 400 });
    }

    try {
        const dashboard = await verifyDashboard(dashboardId, user.orgId);
        if (!dashboard) {
            return NextResponse.json({ success: false, error: "대시보드를 찾을 수 없습니다." }, { status: 404 });
        }

        const widgets = await db
            .select()
            .from(dashboardWidgets)
            .where(eq(dashboardWidgets.dashboardId, dashboardId))
            .orderBy(asc(dashboardWidgets.layoutY), asc(dashboardWidgets.layoutX));

        return NextResponse.json({ success: true, data: widgets });
    } catch (error) {
        console.error("Widgets fetch error:", error);
        return NextResponse.json({ success: false, error: "서버 오류가 발생했습니다." }, { status: 500 });
    }
}

export async function POST(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const user = getUserFromNextRequest(req);
    if (!user) {
        return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    }

    const { id: idStr } = await params;
    const dashboardId = Number(idStr);
    if (!dashboardId) {
        return NextResponse.json({ success: false, error: "대시보드 ID가 필요합니다." }, { status: 400 });
    }

    const { title, widgetType, dataColumn, aggregation, groupByColumn, stackByColumn, widgetFilters } = await req.json();
    if (!title || !widgetType || !dataColumn) {
        return NextResponse.json({ success: false, error: "필수 항목이 누락되었습니다." }, { status: 400 });
    }

    try {
        const dashboard = await verifyDashboard(dashboardId, user.orgId);
        if (!dashboard) {
            return NextResponse.json({ success: false, error: "대시보드를 찾을 수 없습니다." }, { status: 404 });
        }

        const [widget] = await db
            .insert(dashboardWidgets)
            .values({
                dashboardId,
                title,
                widgetType,
                dataColumn,
                aggregation: aggregation || "count",
                groupByColumn: groupByColumn || null,
                stackByColumn: stackByColumn || null,
                widgetFilters: widgetFilters || null,
            })
            .returning();

        return NextResponse.json({ success: true, data: widget }, { status: 201 });
    } catch (error) {
        console.error("Widget create error:", error);
        return NextResponse.json({ success: false, error: "서버 오류가 발생했습니다." }, { status: 500 });
    }
}

export async function PUT(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const user = getUserFromNextRequest(req);
    if (!user) {
        return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    }

    const { id: idStr } = await params;
    const dashboardId = Number(idStr);
    if (!dashboardId) {
        return NextResponse.json({ success: false, error: "대시보드 ID가 필요합니다." }, { status: 400 });
    }

    const { widgets } = await req.json();
    if (!Array.isArray(widgets)) {
        return NextResponse.json({ success: false, error: "위젯 배열이 필요합니다." }, { status: 400 });
    }

    try {
        const dashboard = await verifyDashboard(dashboardId, user.orgId);
        if (!dashboard) {
            return NextResponse.json({ success: false, error: "대시보드를 찾을 수 없습니다." }, { status: 404 });
        }

        // 각 위젯 레이아웃 업데이트
        for (const w of widgets) {
            if (!w.id) continue;
            await db
                .update(dashboardWidgets)
                .set({
                    ...(w.title !== undefined && { title: w.title }),
                    ...(w.widgetType !== undefined && { widgetType: w.widgetType }),
                    ...(w.dataColumn !== undefined && { dataColumn: w.dataColumn }),
                    ...(w.aggregation !== undefined && { aggregation: w.aggregation }),
                    ...(w.groupByColumn !== undefined && { groupByColumn: w.groupByColumn }),
                    ...(w.stackByColumn !== undefined && { stackByColumn: w.stackByColumn }),
                    ...(w.widgetFilters !== undefined && { widgetFilters: w.widgetFilters }),
                    ...(w.layoutX !== undefined && { layoutX: w.layoutX }),
                    ...(w.layoutY !== undefined && { layoutY: w.layoutY }),
                    ...(w.layoutW !== undefined && { layoutW: w.layoutW }),
                    ...(w.layoutH !== undefined && { layoutH: w.layoutH }),
                    updatedAt: new Date(),
                })
                .where(
                    and(
                        eq(dashboardWidgets.id, w.id),
                        eq(dashboardWidgets.dashboardId, dashboardId)
                    )
                );
        }

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error("Widgets update error:", error);
        return NextResponse.json({ success: false, error: "서버 오류가 발생했습니다." }, { status: 500 });
    }
}
