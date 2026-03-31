import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { adAccounts, adPlatforms } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { getUserFromNextRequest } from "@/lib/auth";

export async function PATCH(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const user = getUserFromNextRequest(req);
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
            updateData.workspaceId = body.workspaceId;
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
