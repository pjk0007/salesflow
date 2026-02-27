import { NextRequest, NextResponse } from "next/server";
import { db, workspaces } from "@/lib/db";
import { eq, and } from "drizzle-orm";
import { getUserFromNextRequest } from "@/lib/auth";

export async function GET(
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
    const workspaceId = Number(id);
    if (!workspaceId || isNaN(workspaceId)) {
        return NextResponse.json({ success: false, error: "잘못된 워크스페이스 ID입니다." }, { status: 400 });
    }

    try {
        const [ws] = await db
            .select({
                id: workspaces.id,
                name: workspaces.name,
                description: workspaces.description,
                icon: workspaces.icon,
                codePrefix: workspaces.codePrefix,
                settings: workspaces.settings,
            })
            .from(workspaces)
            .where(and(eq(workspaces.id, workspaceId), eq(workspaces.orgId, user.orgId)));

        if (!ws) {
            return NextResponse.json({ success: false, error: "워크스페이스를 찾을 수 없습니다." }, { status: 404 });
        }

        return NextResponse.json({ success: true, data: ws });
    } catch (error) {
        console.error("Workspace settings fetch error:", error);
        return NextResponse.json({ success: false, error: "서버 오류가 발생했습니다." }, { status: 500 });
    }
}

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
    const workspaceId = Number(id);
    if (!workspaceId || isNaN(workspaceId)) {
        return NextResponse.json({ success: false, error: "잘못된 워크스페이스 ID입니다." }, { status: 400 });
    }

    try {
        const { name, description, icon, codePrefix } = await req.json();

        if (name !== undefined && !name.trim()) {
            return NextResponse.json({ success: false, error: "이름을 입력해주세요." }, { status: 400 });
        }

        // 같은 조직의 워크스페이스인지 확인
        const [existing] = await db
            .select()
            .from(workspaces)
            .where(and(eq(workspaces.id, workspaceId), eq(workspaces.orgId, user.orgId)));

        if (!existing) {
            return NextResponse.json({ success: false, error: "워크스페이스를 찾을 수 없습니다." }, { status: 404 });
        }

        const updateData: Record<string, unknown> = {
            updatedAt: new Date(),
        };

        if (name !== undefined) {
            updateData.name = name.trim();
        }
        if (description !== undefined) {
            updateData.description = description;
        }
        if (icon !== undefined) {
            updateData.icon = icon;
        }
        if (codePrefix !== undefined) {
            updateData.codePrefix = codePrefix;
        }

        const [updated] = await db
            .update(workspaces)
            .set(updateData)
            .where(eq(workspaces.id, workspaceId))
            .returning({
                id: workspaces.id,
                name: workspaces.name,
                description: workspaces.description,
                icon: workspaces.icon,
                codePrefix: workspaces.codePrefix,
                settings: workspaces.settings,
            });

        return NextResponse.json({ success: true, data: updated });
    } catch (error) {
        console.error("Workspace settings update error:", error);
        return NextResponse.json({ success: false, error: "서버 오류가 발생했습니다." }, { status: 500 });
    }
}
