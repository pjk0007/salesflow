import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { adAccounts, adPlatforms, workspaces } from "@/lib/db/schema";
import { eq, and, desc } from "drizzle-orm";
import { getUserFromNextRequest } from "@/lib/auth";

export async function GET(req: NextRequest) {
    const user = getUserFromNextRequest(req);
    if (!user) {
        return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const platformId = searchParams.get("platformId");
    const workspaceId = searchParams.get("workspaceId");

    try {
        const conditions = [eq(adPlatforms.orgId, user.orgId)];

        if (platformId) {
            conditions.push(eq(adAccounts.adPlatformId, Number(platformId)));
        }
        if (workspaceId) {
            conditions.push(eq(adAccounts.workspaceId, Number(workspaceId)));
        }

        const accounts = await db
            .select({
                id: adAccounts.id,
                adPlatformId: adAccounts.adPlatformId,
                workspaceId: adAccounts.workspaceId,
                externalAccountId: adAccounts.externalAccountId,
                name: adAccounts.name,
                currency: adAccounts.currency,
                status: adAccounts.status,
                metadata: adAccounts.metadata,
                lastSyncAt: adAccounts.lastSyncAt,
                createdAt: adAccounts.createdAt,
                updatedAt: adAccounts.updatedAt,
                platformName: adPlatforms.name,
                platform: adPlatforms.platform,
                workspaceName: workspaces.name,
            })
            .from(adAccounts)
            .innerJoin(adPlatforms, eq(adAccounts.adPlatformId, adPlatforms.id))
            .leftJoin(workspaces, eq(adAccounts.workspaceId, workspaces.id))
            .where(and(...conditions))
            .orderBy(desc(adAccounts.createdAt));

        return NextResponse.json({ success: true, data: accounts });
    } catch (error) {
        console.error("Ad accounts list error:", error);
        return NextResponse.json({ success: false, error: "서버 오류가 발생했습니다." }, { status: 500 });
    }
}
