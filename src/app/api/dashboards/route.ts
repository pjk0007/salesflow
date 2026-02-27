import { NextRequest, NextResponse } from "next/server";
import { db, dashboards } from "@/lib/db";
import { eq, and } from "drizzle-orm";
import { getUserFromNextRequest } from "@/lib/auth";
import { nanoid } from "nanoid";

export async function GET(req: NextRequest) {
    const user = getUserFromNextRequest(req);
    if (!user) {
        return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    }

    const workspaceIdStr = req.nextUrl.searchParams.get("workspaceId");
    const workspaceId = workspaceIdStr ? Number(workspaceIdStr) : undefined;

    try {
        const conditions = [eq(dashboards.orgId, user.orgId)];
        if (workspaceId) {
            conditions.push(eq(dashboards.workspaceId, workspaceId));
        }

        const data = await db
            .select()
            .from(dashboards)
            .where(and(...conditions))
            .orderBy(dashboards.createdAt);

        return NextResponse.json({ success: true, data });
    } catch (error) {
        console.error("Dashboards fetch error:", error);
        return NextResponse.json({ success: false, error: "서버 오류가 발생했습니다." }, { status: 500 });
    }
}

export async function POST(req: NextRequest) {
    const user = getUserFromNextRequest(req);
    if (!user) {
        return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    }

    const { name, workspaceId, description, partitionIds } = await req.json();
    if (!name || !workspaceId) {
        return NextResponse.json({ success: false, error: "필수 항목이 누락되었습니다." }, { status: 400 });
    }

    try {
        const slug = nanoid(8);

        const [dashboard] = await db
            .insert(dashboards)
            .values({
                orgId: user.orgId,
                workspaceId,
                name,
                slug,
                description: description || null,
                partitionIds: Array.isArray(partitionIds) ? partitionIds : null,
                createdBy: user.userId,
            })
            .returning();

        return NextResponse.json({ success: true, data: dashboard }, { status: 201 });
    } catch (error) {
        console.error("Dashboard create error:", error);
        return NextResponse.json({ success: false, error: "서버 오류가 발생했습니다." }, { status: 500 });
    }
}
