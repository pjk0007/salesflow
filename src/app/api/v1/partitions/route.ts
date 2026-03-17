import { NextRequest, NextResponse } from "next/server";
import { db, partitions, folders, workspaces } from "@/lib/db";
import { eq, and, inArray } from "drizzle-orm";
import { getApiTokenFromNextRequest, resolveApiToken } from "@/lib/auth";
import type { ApiTokenInfo } from "@/lib/auth";

// GET /api/v1/partitions — 토큰 scope에 해당하는 파티션 목록 반환
export async function GET(req: NextRequest) {
    const tokenStr = getApiTokenFromNextRequest(req);
    if (!tokenStr) {
        return NextResponse.json({ success: false, error: "Invalid or missing API token." }, { status: 401 });
    }
    const tokenInfo: ApiTokenInfo | null = await resolveApiToken(tokenStr);
    if (!tokenInfo) {
        return NextResponse.json({ success: false, error: "Invalid or missing API token." }, { status: 401 });
    }

    try {
        // 조직 내 모든 파티션 조회
        const allPartitions = await db
            .select({
                id: partitions.id,
                name: partitions.name,
                workspaceId: partitions.workspaceId,
                workspaceName: workspaces.name,
                folderId: partitions.folderId,
            })
            .from(partitions)
            .innerJoin(workspaces, eq(partitions.workspaceId, workspaces.id))
            .where(eq(workspaces.orgId, tokenInfo.orgId))
            .orderBy(partitions.workspaceId, partitions.displayOrder);

        // 폴더명 조회 (필요한 경우)
        const folderIds = [...new Set(allPartitions.map((p) => p.folderId).filter(Boolean))] as number[];
        const folderMap = new Map<number, string>();
        if (folderIds.length > 0) {
            const folderRows = await db
                .select({ id: folders.id, name: folders.name })
                .from(folders)
                .where(inArray(folders.id, folderIds));
            for (const f of folderRows) {
                folderMap.set(f.id, f.name);
            }
        }

        // scope 기반 필터링
        const accessible = allPartitions.filter((p) => {
            for (const scope of tokenInfo.scopes) {
                if (!scope.permissions.read) continue;
                if (scope.scopeType === "partition" && scope.scopeId === p.id) return true;
                if (scope.scopeType === "folder" && p.folderId === scope.scopeId) return true;
                if (scope.scopeType === "workspace" && p.workspaceId === scope.scopeId) return true;
            }
            return false;
        });

        const data = accessible.map((p) => ({
            id: p.id,
            name: p.name,
            workspaceId: p.workspaceId,
            workspaceName: p.workspaceName,
            folderId: p.folderId,
            folderName: p.folderId ? folderMap.get(p.folderId) ?? null : null,
        }));

        return NextResponse.json({ success: true, data });
    } catch (error) {
        console.error("External partitions fetch error:", error);
        return NextResponse.json({ success: false, error: "Internal server error." }, { status: 500 });
    }
}
