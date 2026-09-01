import { NextRequest, NextResponse } from "next/server";
import { db, partitions, workspaces } from "@/lib/db";
import { eq } from "drizzle-orm";
import { getUserFromNextRequest } from "@/lib/auth";
import { filterAccessiblePartitions, loadOrgScopes } from "@/lib/partition-access";

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
                folderId: partitions.folderId,
                workspaceId: partitions.workspaceId,
                workspaceName: workspaces.name,
            })
            .from(partitions)
            .innerJoin(workspaces, eq(workspaces.id, partitions.workspaceId))
            .where(eq(workspaces.orgId, user.orgId))
            .orderBy(workspaces.name, partitions.name);

        if (user.role !== "member") {
            return NextResponse.json({ success: true, data: result });
        }

        // 조직 scope를 한 번만 읽어 메모리에서 거른다 (파티션 수와 무관하게 쿼리 1회)
        const orgScopes = await loadOrgScopes(user.orgId);
        const visible = filterAccessiblePartitions({
            user,
            partitions: result,
            permission: "read",
            orgScopes,
        });

        return NextResponse.json({ success: true, data: visible });
    } catch (error) {
        console.error("All partitions fetch error:", error);
        return NextResponse.json({ success: false, error: "서버 오류가 발생했습니다." }, { status: 500 });
    }
}
