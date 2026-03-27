import { NextRequest, NextResponse } from "next/server";
import { db, fieldTypes, workspaces, partitions } from "@/lib/db";
import { eq, and, or } from "drizzle-orm";
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
    const typeId = Number(id);

    const [existing] = await db
        .select()
        .from(fieldTypes)
        .where(and(eq(fieldTypes.id, typeId), eq(fieldTypes.orgId, user.orgId)));

    if (!existing) {
        return NextResponse.json({ success: false, error: "타입을 찾을 수 없습니다." }, { status: 404 });
    }

    const { name, description, icon } = await req.json();
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (name !== undefined) updates.name = name.trim();
    if (description !== undefined) updates.description = description?.trim() || null;
    if (icon !== undefined) updates.icon = icon || null;

    try {
        await db.update(fieldTypes).set(updates).where(eq(fieldTypes.id, typeId));
        return NextResponse.json({ success: true });
    } catch (error: unknown) {
        if (error instanceof Error && error.message?.includes("unique")) {
            return NextResponse.json({ success: false, error: "이미 존재하는 타입 이름입니다." }, { status: 409 });
        }
        console.error("Field type update error:", error);
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
    const typeId = Number(id);

    const [existing] = await db
        .select()
        .from(fieldTypes)
        .where(and(eq(fieldTypes.id, typeId), eq(fieldTypes.orgId, user.orgId)));

    if (!existing) {
        return NextResponse.json({ success: false, error: "타입을 찾을 수 없습니다." }, { status: 404 });
    }

    // 사용 중인지 확인
    const usedByWorkspaces = await db
        .select({ id: workspaces.id, name: workspaces.name })
        .from(workspaces)
        .where(eq(workspaces.defaultFieldTypeId, typeId));

    const usedByPartitions = await db
        .select({ id: partitions.id, name: partitions.name })
        .from(partitions)
        .where(eq(partitions.fieldTypeId, typeId));

    if (usedByWorkspaces.length > 0 || usedByPartitions.length > 0) {
        return NextResponse.json({
            success: false,
            error: "사용 중인 타입은 삭제할 수 없습니다.",
            usedBy: {
                workspaces: usedByWorkspaces,
                partitions: usedByPartitions,
            },
        }, { status: 400 });
    }

    await db.delete(fieldTypes).where(eq(fieldTypes.id, typeId));
    return NextResponse.json({ success: true });
}
