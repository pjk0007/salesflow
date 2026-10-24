import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { adAccounts, adPlatforms, workspaces } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { getActiveUserFromNextRequest } from "@/lib/auth";

export async function PATCH(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const user = await getActiveUserFromNextRequest(req);
    if (!user) {
        return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    }
    if (user.role === "member") {
        return NextResponse.json({ success: false, error: "접근 권한이 없습니다." }, { status: 403 });
    }

    const { id } = await params;
    const accountId = Number(id);
    const body = await req.json();

    try {
        // Verify org ownership through adPlatforms join
        const [existing] = await db
            .select({ id: adAccounts.id })
            .from(adAccounts)
            .innerJoin(adPlatforms, eq(adAccounts.adPlatformId, adPlatforms.id))
            .where(and(eq(adAccounts.id, accountId), eq(adPlatforms.orgId, user.orgId)));

        if (!existing) {
            return NextResponse.json({ success: false, error: "광고 계정을 찾을 수 없습니다." }, { status: 404 });
        }

        const updateData: Record<string, unknown> = { updatedAt: new Date() };

        if (body.workspaceId !== undefined) {
            // 연결 해제(null) 말고는 내 조직의 워크스페이스인지 확인한다
            if (body.workspaceId !== null) {
                const [ws] = await db
                    .select({ id: workspaces.id })
                    .from(workspaces)
                    .where(and(eq(workspaces.id, Number(body.workspaceId)), eq(workspaces.orgId, user.orgId)));
                if (!ws) {
                    return NextResponse.json({ success: false, error: "워크스페이스를 찾을 수 없습니다." }, { status: 404 });
                }
                updateData.workspaceId = ws.id;
            } else {
                updateData.workspaceId = null;
            }
        }
        if (body.name?.trim()) {
            updateData.name = body.name.trim();
        }

        const [updated] = await db
            .update(adAccounts)
            .set(updateData)
            .where(eq(adAccounts.id, accountId))
            .returning();

        return NextResponse.json({ success: true, data: updated });
    } catch (error) {
        console.error("Ad account update error:", error);
        return NextResponse.json({ success: false, error: "서버 오류가 발생했습니다." }, { status: 500 });
    }
}
