import { NextRequest, NextResponse } from "next/server";
import { db, fieldDefinitions, workspaces, partitions } from "@/lib/db";
import { eq, and } from "drizzle-orm";
import { getUserFromNextRequest } from "@/lib/auth";

async function verifyOwnership(fieldId: number, orgId: string) {
    const result = await db
        .select({ field: fieldDefinitions, wsOrgId: workspaces.orgId })
        .from(fieldDefinitions)
        .innerJoin(workspaces, eq(fieldDefinitions.workspaceId, workspaces.id))
        .where(and(eq(fieldDefinitions.id, fieldId), eq(workspaces.orgId, orgId)));
    return result[0] ?? null;
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
    const fieldId = Number(id);
    if (!fieldId || isNaN(fieldId)) {
        return NextResponse.json({ success: false, error: "잘못된 필드 ID입니다." }, { status: 400 });
    }

    const { label, category, isRequired, options, defaultWidth } = await req.json();

    try {
        const access = await verifyOwnership(fieldId, user.orgId);
        if (!access) {
            return NextResponse.json({ success: false, error: "필드를 찾을 수 없습니다." }, { status: 404 });
        }

        const updates: Record<string, unknown> = { updatedAt: new Date() };

        if (label !== undefined) {
            if (!label.trim()) {
                return NextResponse.json({ success: false, error: "라벨을 입력해주세요." }, { status: 400 });
            }
            updates.label = label.trim();
        }
        if (category !== undefined) {
            updates.category = category?.trim() || null;
        }
        if (isRequired !== undefined) {
            updates.isRequired = isRequired ? 1 : 0;
        }
        if (options !== undefined) {
            updates.options = Array.isArray(options) && options.length > 0 ? options : null;
        }
        if (defaultWidth !== undefined) {
            updates.defaultWidth = Math.max(40, Number(defaultWidth) || 120);
        }

        const [updated] = await db
            .update(fieldDefinitions)
            .set(updates)
            .where(eq(fieldDefinitions.id, fieldId))
            .returning({ id: fieldDefinitions.id, label: fieldDefinitions.label });

        return NextResponse.json({ success: true, data: updated });
    } catch (error) {
        console.error("Field update error:", error);
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
    const fieldId = Number(id);
    if (!fieldId || isNaN(fieldId)) {
        return NextResponse.json({ success: false, error: "잘못된 필드 ID입니다." }, { status: 400 });
    }

    try {
        const access = await verifyOwnership(fieldId, user.orgId);
        if (!access) {
            return NextResponse.json({ success: false, error: "필드를 찾을 수 없습니다." }, { status: 404 });
        }

        if (access.field.isSystem) {
            return NextResponse.json({ success: false, error: "시스템 필드는 삭제할 수 없습니다." }, { status: 400 });
        }

        const fieldKey = access.field.key;
        const workspaceId = access.field.workspaceId;

        await db.delete(fieldDefinitions).where(eq(fieldDefinitions.id, fieldId));

        // 파티션 visibleFields에서 삭제된 key 제거
        const partitionList = await db
            .select({ id: partitions.id, visibleFields: partitions.visibleFields })
            .from(partitions)
            .where(eq(partitions.workspaceId, workspaceId));

        for (const p of partitionList) {
            const currentFields = (p.visibleFields as string[]) || [];
            if (currentFields.includes(fieldKey)) {
                await db
                    .update(partitions)
                    .set({
                        visibleFields: currentFields.filter((k) => k !== fieldKey),
                        updatedAt: new Date(),
                    })
                    .where(eq(partitions.id, p.id));
            }
        }

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error("Field delete error:", error);
        return NextResponse.json({ success: false, error: "서버 오류가 발생했습니다." }, { status: 500 });
    }
}
