import { NextRequest, NextResponse } from "next/server";
import { db, partitions, folders, workspaces } from "@/lib/db";
import { eq, inArray } from "drizzle-orm";
import { getApiTokenFromNextRequest, resolveApiToken, tokenScopeCovers } from "@/lib/auth";
import type { ApiTokenInfo } from "@/lib/auth";

// GET /api/v1/partitions — 토큰 scope에 해당하는 파티션 목록 반환
export async function GET(req: NextRequest) {
    const tokenStr = getApiTokenFromNextRequest(req);
    if (!tokenStr) {
        return NextResponse.json({ success: false, error: "API 토큰이 없거나 올바르지 않습니다." }, { status: 401 });
    }
    const tokenInfo: ApiTokenInfo | null = await resolveApiToken(tokenStr);
    if (!tokenInfo) {
        return NextResponse.json({ success: false, error: "API 토큰이 없거나 올바르지 않습니다." }, { status: 401 });
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

        // scope 기반 필터링 — 목록 쿼리가 이미 orgId로 걸러졌으므로 org 스코프는 전부 통과
        const accessible = allPartitions.filter((p) => tokenScopeCovers(tokenInfo.scopes, p, "read"));

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
        return NextResponse.json({ success: false, error: "서버 오류가 발생했습니다." }, { status: 500 });
    }
}
