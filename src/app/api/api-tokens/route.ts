import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { db, apiTokens, apiTokenScopes, workspaces, folders, partitions } from "@/lib/db";
import { eq, and, desc } from "drizzle-orm";
import { getUserFromNextRequest } from "@/lib/auth";

export async function GET(req: NextRequest) {
    const user = getUserFromNextRequest(req);
    if (!user) {
        return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    }
    if (user.role !== "owner" && user.role !== "admin") {
        return NextResponse.json({ success: false, error: "권한이 없습니다." }, { status: 403 });
    }

    try {
        const tokens = await db
            .select()
            .from(apiTokens)
            .where(eq(apiTokens.orgId, user.orgId))
            .orderBy(desc(apiTokens.createdAt));

        const result = await Promise.all(
            tokens.map(async (t) => {
                const scopes = await db
                    .select()
                    .from(apiTokenScopes)
                    .where(eq(apiTokenScopes.tokenId, t.id));

                // scopeName 해석
                const scopesWithNames = await Promise.all(
                    scopes.map(async (s) => {
                        let scopeName = "";
                        if (s.scopeType === "workspace") {
                            const [ws] = await db.select({ name: workspaces.name }).from(workspaces).where(eq(workspaces.id, s.scopeId));
                            scopeName = ws?.name ?? "";
                        } else if (s.scopeType === "folder") {
                            const [f] = await db.select({ name: folders.name }).from(folders).where(eq(folders.id, s.scopeId));
                            scopeName = f?.name ?? "";
                        } else if (s.scopeType === "partition") {
                            const [p] = await db.select({ name: partitions.name }).from(partitions).where(eq(partitions.id, s.scopeId));
                            scopeName = p?.name ?? "";
                        }
                        return { ...s, scopeName };
                    })
                );

                return {
                    id: t.id,
                    name: t.name,
                    tokenPreview: t.token.slice(0, 8) + "...",
                    scopes: scopesWithNames,
                    lastUsedAt: t.lastUsedAt,
                    expiresAt: t.expiresAt,
                    isActive: t.isActive,
                    createdAt: t.createdAt,
                };
            })
        );

        return NextResponse.json({ success: true, data: result });
    } catch (error) {
        console.error("API tokens fetch error:", error);
        return NextResponse.json({ success: false, error: "서버 오류가 발생했습니다." }, { status: 500 });
    }
}

export async function POST(req: NextRequest) {
    const user = getUserFromNextRequest(req);
    if (!user) {
        return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    }
    if (user.role !== "owner" && user.role !== "admin") {
        return NextResponse.json({ success: false, error: "권한이 없습니다." }, { status: 403 });
    }

    try {
        const { name, expiresIn, scopes } = await req.json();

        if (!name || typeof name !== "string" || name.length > 100) {
            return NextResponse.json({ success: false, error: "토큰 이름은 1-100자여야 합니다." }, { status: 400 });
        }
        if (!scopes || !Array.isArray(scopes) || scopes.length === 0) {
            return NextResponse.json({ success: false, error: "권한 범위를 최소 1개 설정해야 합니다." }, { status: 400 });
        }

        // 스코프 유효성 검증
        for (const scope of scopes) {
            if (!["workspace", "folder", "partition"].includes(scope.scopeType)) {
                return NextResponse.json({ success: false, error: `유효하지 않은 범위 유형: ${scope.scopeType}` }, { status: 400 });
            }
            // scopeId가 해당 org에 속하는지 검증
            if (scope.scopeType === "workspace") {
                const [ws] = await db.select({ id: workspaces.id }).from(workspaces)
                    .where(and(eq(workspaces.id, scope.scopeId), eq(workspaces.orgId, user.orgId)));
                if (!ws) return NextResponse.json({ success: false, error: "워크스페이스를 찾을 수 없습니다." }, { status: 400 });
            } else if (scope.scopeType === "folder") {
                const [f] = await db.select({ id: folders.id }).from(folders)
                    .innerJoin(workspaces, eq(folders.workspaceId, workspaces.id))
                    .where(and(eq(folders.id, scope.scopeId), eq(workspaces.orgId, user.orgId)));
                if (!f) return NextResponse.json({ success: false, error: "폴더를 찾을 수 없습니다." }, { status: 400 });
            } else if (scope.scopeType === "partition") {
                const [p] = await db.select({ id: partitions.id }).from(partitions)
                    .innerJoin(workspaces, eq(partitions.workspaceId, workspaces.id))
                    .where(and(eq(partitions.id, scope.scopeId), eq(workspaces.orgId, user.orgId)));
                if (!p) return NextResponse.json({ success: false, error: "파티션을 찾을 수 없습니다." }, { status: 400 });
            }
        }

        // 토큰 생성
        const tokenStr = crypto.randomBytes(32).toString("hex");

        // 만료일 계산
        let expiresAt: Date | null = null;
        if (expiresIn === "30d") expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
        else if (expiresIn === "90d") expiresAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);
        else if (expiresIn === "1y") expiresAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);

        const result = await db.transaction(async (tx) => {
            const [newToken] = await tx
                .insert(apiTokens)
                .values({
                    orgId: user.orgId,
                    name,
                    token: tokenStr,
                    createdBy: user.userId,
                    expiresAt,
                })
                .returning();

            for (const scope of scopes) {
                await tx.insert(apiTokenScopes).values({
                    tokenId: newToken.id,
                    scopeType: scope.scopeType,
                    scopeId: scope.scopeId,
                    permissions: scope.permissions,
                });
            }

            return newToken;
        });

        return NextResponse.json({
            success: true,
            data: {
                id: result.id,
                name: result.name,
                token: tokenStr,
                expiresAt: result.expiresAt,
            },
        }, { status: 201 });
    } catch (error) {
        console.error("API token create error:", error);
        return NextResponse.json({ success: false, error: "서버 오류가 발생했습니다." }, { status: 500 });
    }
}
