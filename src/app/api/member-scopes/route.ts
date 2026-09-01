import { NextRequest, NextResponse } from "next/server";
import { db, memberScopes, users, workspaces, folders, partitions } from "@/lib/db";
import { eq, and } from "drizzle-orm";
import { requireAdmin } from "@/lib/auth-admin";
import {
    validateMemberScopes,
    validateScopeTarget,
    type MemberScopeInput,
} from "@/lib/partition-access";

/** scope 대상 이름을 한 번의 조회로 붙인다 (건별 조회 N+1 회피). */
async function buildScopeNameMap(orgId: string) {
    const [wsList, folderList, partitionList] = await Promise.all([
        db.select({ id: workspaces.id, name: workspaces.name }).from(workspaces).where(eq(workspaces.orgId, orgId)),
        db
            .select({ id: folders.id, name: folders.name })
            .from(folders)
            .innerJoin(workspaces, eq(folders.workspaceId, workspaces.id))
            .where(eq(workspaces.orgId, orgId)),
        db
            .select({ id: partitions.id, name: partitions.name })
            .from(partitions)
            .innerJoin(workspaces, eq(partitions.workspaceId, workspaces.id))
            .where(eq(workspaces.orgId, orgId)),
    ]);

    return {
        workspace: new Map(wsList.map((w) => [w.id, w.name])),
        folder: new Map(folderList.map((f) => [f.id, f.name])),
        partition: new Map(partitionList.map((p) => [p.id, p.name])),
    };
}

function resolveScopeName(
    scopeType: string,
    scopeId: number,
    maps: Awaited<ReturnType<typeof buildScopeNameMap>>
): string {
    if (scopeType === "org") return "조직 전체";
    if (scopeType === "workspace") return maps.workspace.get(scopeId) ?? "(삭제된 워크스페이스)";
    if (scopeType === "folder") return maps.folder.get(scopeId) ?? "(삭제된 폴더)";
    if (scopeType === "partition") return maps.partition.get(scopeId) ?? "(삭제된 파티션)";
    return "(알 수 없음)";
}

export async function GET(req: NextRequest) {
    const auth = await requireAdmin(req);
    if (!auth.ok) {
        return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
    }
    const user = auth.user;

    try {
        const targetUserId = req.nextUrl.searchParams.get("userId");

        const rows = await db
            .select({
                id: memberScopes.id,
                userId: memberScopes.userId,
                userName: users.name,
                userEmail: users.email,
                scopeType: memberScopes.scopeType,
                scopeId: memberScopes.scopeId,
                permissions: memberScopes.permissions,
                createdAt: memberScopes.createdAt,
            })
            .from(memberScopes)
            .innerJoin(users, eq(users.id, memberScopes.userId))
            .where(
                targetUserId
                    ? and(eq(memberScopes.orgId, user.orgId), eq(memberScopes.userId, targetUserId))
                    : eq(memberScopes.orgId, user.orgId)
            );

        const maps = await buildScopeNameMap(user.orgId);
        const data = rows.map((row) => ({
            ...row,
            scopeName: resolveScopeName(row.scopeType, row.scopeId, maps),
        }));

        return NextResponse.json({ success: true, data });
    } catch (error) {
        console.error("Member scopes fetch error:", error);
        return NextResponse.json({ success: false, error: "서버 오류가 발생했습니다." }, { status: 500 });
    }
}

export async function POST(req: NextRequest) {
    const auth = await requireAdmin(req);
    if (!auth.ok) {
        return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
    }
    const user = auth.user;

    try {
        const body = await req.json();
        const targetUserId: unknown = body?.userId;
        const requested: unknown = body?.scopes;

        if (typeof targetUserId !== "string" || !targetUserId) {
            return NextResponse.json({ success: false, error: "대상 사용자가 필요합니다." }, { status: 400 });
        }
        if (!Array.isArray(requested)) {
            return NextResponse.json({ success: false, error: "권한 범위가 필요합니다." }, { status: 400 });
        }

        const target = await validateScopeTarget(targetUserId, user.orgId);
        if (!target.ok) {
            return NextResponse.json({ success: false, error: target.error }, { status: 400 });
        }

        const validated = await validateMemberScopes(requested as MemberScopeInput[], user.orgId);
        if (!validated.ok) {
            return NextResponse.json({ success: false, error: validated.error }, { status: 400 });
        }

        const now = new Date();
        // 권한은 부분 적용이 가장 위험하다 — 중간 실패 시 전부 롤백한다
        await db.transaction(async (tx) => {
            for (const scope of validated.scopes) {
                await tx
                    .insert(memberScopes)
                    .values({
                        orgId: user.orgId,
                        userId: targetUserId,
                        scopeType: scope.scopeType,
                        scopeId: scope.scopeId,
                        permissions: scope.permissions,
                        grantedBy: user.userId,
                    })
                    .onConflictDoUpdate({
                        target: [
                            memberScopes.orgId,
                            memberScopes.userId,
                            memberScopes.scopeType,
                            memberScopes.scopeId,
                        ],
                        set: { permissions: scope.permissions, grantedBy: user.userId, updatedAt: now },
                    });
            }
        });

        return NextResponse.json(
            { success: true, data: { granted: validated.scopes.length } },
            { status: 201 }
        );
    } catch (error) {
        console.error("Member scope grant error:", error);
        return NextResponse.json({ success: false, error: "서버 오류가 발생했습니다." }, { status: 500 });
    }
}
