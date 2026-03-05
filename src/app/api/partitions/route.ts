import { NextRequest, NextResponse } from "next/server";
import { db, partitions, folders, workspaces } from "@/lib/db";
import { eq } from "drizzle-orm";
import { getUserFromNextRequest } from "@/lib/auth";

// 조직 내 모든 파티션 조회 (워크스페이스명 포함)
export async function GET(req: NextRequest) {
    const user = getUserFromNextRequest(req);
    if (!user) {
        return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    }

    try {
        const result = await db
            .select({
                id: partitions.id,
                name: partitions.name,
                workspaceId: partitions.workspaceId,
                workspaceName: workspaces.name,
            })
            .from(partitions)
            .innerJoin(workspaces, eq(workspaces.id, partitions.workspaceId))
            .where(eq(workspaces.orgId, user.orgId))
            .orderBy(workspaces.name, partitions.name);

        return NextResponse.json({ success: true, data: result });
    } catch (error) {
        console.error("All partitions fetch error:", error);
        return NextResponse.json({ success: false, error: "서버 오류가 발생했습니다." }, { status: 500 });
    }
}
