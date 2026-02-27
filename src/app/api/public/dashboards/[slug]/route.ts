import { NextRequest, NextResponse } from "next/server";
import { db, dashboards, dashboardWidgets } from "@/lib/db";
import { eq, and, asc } from "drizzle-orm";

export async function GET(
    req: NextRequest,
    { params }: { params: Promise<{ slug: string }> }
) {
    const { slug } = await params;
    if (!slug) {
        return NextResponse.json({ success: false, error: "slug가 필요합니다." }, { status: 400 });
    }

    try {
        const [dashboard] = await db
            .select()
            .from(dashboards)
            .where(and(eq(dashboards.slug, slug), eq(dashboards.isPublic, 1)));

        if (!dashboard) {
            return NextResponse.json({ success: false, error: "대시보드를 찾을 수 없습니다." }, { status: 404 });
        }

        const widgets = await db
            .select()
            .from(dashboardWidgets)
            .where(eq(dashboardWidgets.dashboardId, dashboard.id))
            .orderBy(asc(dashboardWidgets.layoutY), asc(dashboardWidgets.layoutX));

        return NextResponse.json({
            success: true,
            data: { ...dashboard, widgets },
        });
    } catch (error) {
        console.error("Public dashboard fetch error:", error);
        return NextResponse.json({ success: false, error: "서버 오류가 발생했습니다." }, { status: 500 });
    }
}
