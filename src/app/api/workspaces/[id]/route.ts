import { NextRequest, NextResponse } from "next/server";
import { db, workspaces, partitions, records } from "@/lib/db";
import { eq, and, count } from "drizzle-orm";
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
            .select()
            .from(workspaces)
            .where(and(eq(workspaces.id, workspaceId), eq(workspaces.orgId, user.orgId)));

        if (!ws) {
            return NextResponse.json({ success: false, error: "워크스페이스를 찾을 수 없습니다." }, { status: 404 });
        }

        const [partitionResult] = await db
            .select({ count: count() })
            .from(partitions)
            .where(eq(partitions.workspaceId, workspaceId));

        const [recordResult] = await db
            .select({ count: count() })
            .from(records)
            .where(eq(records.workspaceId, workspaceId));

        return NextResponse.json({
            success: true,
            data: {
                partitionCount: partitionResult.count,
                recordCount: recordResult.count,
            },
        });
    } catch (error) {
        console.error("Workspace stats error:", error);
        return NextResponse.json({ success: false, error: "서버 오류가 발생했습니다." }, { status: 500 });
    }
}

export async function DELETE(
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
        // 같은 조직의 워크스페이스인지 확인
        const [ws] = await db
            .select()
            .from(workspaces)
            .where(and(eq(workspaces.id, workspaceId), eq(workspaces.orgId, user.orgId)));

        if (!ws) {
            return NextResponse.json({ success: false, error: "워크스페이스를 찾을 수 없습니다." }, { status: 404 });
        }

        // 최소 1개 워크스페이스 유지
        const [wsCount] = await db
            .select({ count: count() })
            .from(workspaces)
            .where(eq(workspaces.orgId, user.orgId));

        if (wsCount.count <= 1) {
            return NextResponse.json({ success: false, error: "마지막 워크스페이스는 삭제할 수 없습니다." }, { status: 400 });
        }

        await db.delete(workspaces).where(eq(workspaces.id, workspaceId));

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error("Workspace delete error:", error);
        return NextResponse.json({ success: false, error: "서버 오류가 발생했습니다." }, { status: 500 });
    }
}
