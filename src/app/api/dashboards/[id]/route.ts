import { NextRequest, NextResponse } from "next/server";
import { db, dashboards, dashboardWidgets } from "@/lib/db";
import { eq, and, asc } from "drizzle-orm";
import { getUserFromNextRequest } from "@/lib/auth";

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
        const [dashboard] = await db
            .select()
            .from(dashboards)
            .where(and(eq(dashboards.id, dashboardId), eq(dashboards.orgId, user.orgId)));

        if (!dashboard) {
            return NextResponse.json({ success: false, error: "대시보드를 찾을 수 없습니다." }, { status: 404 });
        }

        const widgets = await db
            .select()
            .from(dashboardWidgets)
            .where(eq(dashboardWidgets.dashboardId, dashboardId))
            .orderBy(asc(dashboardWidgets.layoutY), asc(dashboardWidgets.layoutX));

        return NextResponse.json({
            success: true,
            data: { ...dashboard, widgets },
        });
    } catch (error) {
        console.error("Dashboard fetch error:", error);
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

    const { name, description, globalFilters, refreshInterval, isPublic, partitionIds } = await req.json();

    try {
        const [existing] = await db
            .select({ id: dashboards.id })
            .from(dashboards)
            .where(and(eq(dashboards.id, dashboardId), eq(dashboards.orgId, user.orgId)));

        if (!existing) {
            return NextResponse.json({ success: false, error: "대시보드를 찾을 수 없습니다." }, { status: 404 });
        }

        const [updated] = await db
            .update(dashboards)
            .set({
                ...(name !== undefined && { name }),
                ...(description !== undefined && { description }),
                ...(globalFilters !== undefined && { globalFilters }),
                ...(refreshInterval !== undefined && {
                    refreshInterval: Math.min(300, Math.max(30, refreshInterval)),
                }),
                ...(isPublic !== undefined && { isPublic }),
                ...(partitionIds !== undefined && { partitionIds: Array.isArray(partitionIds) ? partitionIds : null }),
                updatedAt: new Date(),
            })
            .where(eq(dashboards.id, dashboardId))
            .returning();

        return NextResponse.json({ success: true, data: updated });
    } catch (error) {
        console.error("Dashboard update error:", error);
        return NextResponse.json({ success: false, error: "서버 오류가 발생했습니다." }, { status: 500 });
    }
}

export async function DELETE(
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
        const [existing] = await db
            .select({ id: dashboards.id })
            .from(dashboards)
            .where(and(eq(dashboards.id, dashboardId), eq(dashboards.orgId, user.orgId)));

        if (!existing) {
            return NextResponse.json({ success: false, error: "대시보드를 찾을 수 없습니다." }, { status: 404 });
        }

        await db.delete(dashboards).where(eq(dashboards.id, dashboardId));

        return NextResponse.json({ success: true, message: "대시보드가 삭제되었습니다." });
    } catch (error) {
        console.error("Dashboard delete error:", error);
        return NextResponse.json({ success: false, error: "서버 오류가 발생했습니다." }, { status: 500 });
    }
}
