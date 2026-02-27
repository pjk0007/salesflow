import { NextRequest, NextResponse } from "next/server";
import { db, emailTemplateLinks, partitions, workspaces } from "@/lib/db";
import { eq, and } from "drizzle-orm";
import { getUserFromNextRequest } from "@/lib/auth";

export async function PUT(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const user = getUserFromNextRequest(req);
    if (!user) {
        return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    }

    const { id: idStr } = await params;
    const id = Number(idStr);
    if (!id) {
        return NextResponse.json({ success: false, error: "유효하지 않은 ID입니다." }, { status: 400 });
    }

    // 소유권 확인
    const [link] = await db
        .select()
        .from(emailTemplateLinks)
        .innerJoin(partitions, eq(partitions.id, emailTemplateLinks.partitionId))
        .innerJoin(workspaces, eq(workspaces.id, partitions.workspaceId))
        .where(and(eq(emailTemplateLinks.id, id), eq(workspaces.orgId, user.orgId)))
        .limit(1);

    if (!link) {
        return NextResponse.json({ success: false, error: "연결을 찾을 수 없습니다." }, { status: 404 });
    }

    try {
        const { name, recipientField, variableMappings, isActive, triggerType, triggerCondition, repeatConfig } = await req.json();

        const updateData: Record<string, unknown> = { updatedAt: new Date() };
        if (name !== undefined) updateData.name = name;
        if (recipientField !== undefined) updateData.recipientField = recipientField;
        if (variableMappings !== undefined) updateData.variableMappings = variableMappings;
        if (isActive !== undefined) updateData.isActive = isActive;
        if (triggerType !== undefined) updateData.triggerType = triggerType;
        if (triggerCondition !== undefined) updateData.triggerCondition = triggerCondition;
        if (repeatConfig !== undefined) updateData.repeatConfig = repeatConfig;

        const [updated] = await db
            .update(emailTemplateLinks)
            .set(updateData)
            .where(eq(emailTemplateLinks.id, id))
            .returning();

        return NextResponse.json({ success: true, data: updated });
    } catch (error) {
        console.error("Email template link update error:", error);
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

    const { id: idStr } = await params;
    const id = Number(idStr);
    if (!id) {
        return NextResponse.json({ success: false, error: "유효하지 않은 ID입니다." }, { status: 400 });
    }

    // 소유권 확인
    const [link] = await db
        .select()
        .from(emailTemplateLinks)
        .innerJoin(partitions, eq(partitions.id, emailTemplateLinks.partitionId))
        .innerJoin(workspaces, eq(workspaces.id, partitions.workspaceId))
        .where(and(eq(emailTemplateLinks.id, id), eq(workspaces.orgId, user.orgId)))
        .limit(1);

    if (!link) {
        return NextResponse.json({ success: false, error: "연결을 찾을 수 없습니다." }, { status: 404 });
    }

    try {
        await db.delete(emailTemplateLinks).where(eq(emailTemplateLinks.id, id));
        return NextResponse.json({ success: true });
    } catch (error) {
        console.error("Email template link delete error:", error);
        return NextResponse.json({ success: false, error: "서버 오류가 발생했습니다." }, { status: 500 });
    }
}
