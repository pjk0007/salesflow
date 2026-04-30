import { NextRequest, NextResponse } from "next/server";
import { db, emailAutoPersonalizedLinks, products, partitions, workspaces } from "@/lib/db";
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

    try {
        const { id } = await params;
        const linkId = Number(id);

        // 소유권 확인
        const [existing] = await db
            .select()
            .from(emailAutoPersonalizedLinks)
            .where(and(eq(emailAutoPersonalizedLinks.id, linkId), eq(emailAutoPersonalizedLinks.orgId, user.orgId)))
            .limit(1);

        if (!existing) {
            return NextResponse.json({ success: false, error: "규칙을 찾을 수 없습니다." }, { status: 404 });
        }

        const body = await req.json();
        const {
            name,
            partitionId,
            productId,
            recipientField,
            companyField,
            prompt,
            tone,
            format,
            triggerType,
            triggerCondition,
            autoResearch,
            useSignaturePersona,
            isActive,
            isDraft,
            followupConfig,
            preventDuplicate,
            senderProfileId,
            signatureId,
        } = body;

        // 제품 변경 시 소유권 확인
        if (productId !== undefined && productId !== null) {
            const [product] = await db
                .select()
                .from(products)
                .where(and(eq(products.id, productId), eq(products.orgId, user.orgId)))
                .limit(1);
            if (!product) {
                return NextResponse.json({ success: false, error: "제품을 찾을 수 없습니다." }, { status: 404 });
            }
        }

        // 파티션 변경 시 소유권 확인 (워크스페이스 → 조직)
        if (partitionId !== undefined && partitionId !== existing.partitionId) {
            const [access] = await db
                .select({ partitionId: partitions.id })
                .from(partitions)
                .innerJoin(workspaces, eq(partitions.workspaceId, workspaces.id))
                .where(and(eq(partitions.id, Number(partitionId)), eq(workspaces.orgId, user.orgId)))
                .limit(1);
            if (!access) {
                return NextResponse.json({ success: false, error: "파티션을 찾을 수 없습니다." }, { status: 404 });
            }
        }

        const updateData: Record<string, unknown> = { updatedAt: new Date() };
        if (name !== undefined) updateData.name = name || null;
        if (partitionId !== undefined) updateData.partitionId = Number(partitionId);
        if (productId !== undefined) updateData.productId = productId;
        if (recipientField !== undefined) updateData.recipientField = recipientField;
        if (companyField !== undefined) updateData.companyField = companyField;
        if (prompt !== undefined) updateData.prompt = prompt || null;
        if (tone !== undefined) updateData.tone = tone || null;
        if (format !== undefined) updateData.format = format || "plain";
        if (triggerType !== undefined) updateData.triggerType = triggerType;
        if (triggerCondition !== undefined) updateData.triggerCondition = triggerCondition || null;
        if (autoResearch !== undefined) updateData.autoResearch = autoResearch;
        if (useSignaturePersona !== undefined) updateData.useSignaturePersona = useSignaturePersona;
        if (isActive !== undefined) updateData.isActive = isActive;
        if (isDraft !== undefined) {
            updateData.isDraft = isDraft ? 1 : 0;
            // draft 전환 시 자동 비활성화, draft 해제 시는 isActive를 명시적으로 받지 않으면 1로
            if (isDraft) updateData.isActive = 0;
            else if (isActive === undefined) updateData.isActive = 1;
        }
        if (followupConfig !== undefined) updateData.followupConfig = followupConfig;
        if (preventDuplicate !== undefined) updateData.preventDuplicate = preventDuplicate ? 1 : 0;
        if (senderProfileId !== undefined) updateData.senderProfileId = senderProfileId || null;
        if (signatureId !== undefined) updateData.signatureId = signatureId || null;

        const [updated] = await db
            .update(emailAutoPersonalizedLinks)
            .set(updateData)
            .where(eq(emailAutoPersonalizedLinks.id, linkId))
            .returning();

        return NextResponse.json({ success: true, data: updated });
    } catch (error) {
        console.error("Auto personalized link update error:", error);
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

    try {
        const { id } = await params;
        const linkId = Number(id);

        // 소유권 확인
        const [existing] = await db
            .select()
            .from(emailAutoPersonalizedLinks)
            .where(and(eq(emailAutoPersonalizedLinks.id, linkId), eq(emailAutoPersonalizedLinks.orgId, user.orgId)))
            .limit(1);

        if (!existing) {
            return NextResponse.json({ success: false, error: "규칙을 찾을 수 없습니다." }, { status: 404 });
        }

        await db
            .delete(emailAutoPersonalizedLinks)
            .where(eq(emailAutoPersonalizedLinks.id, linkId));

        return NextResponse.json({ success: true, message: "규칙이 삭제되었습니다." });
    } catch (error) {
        console.error("Auto personalized link delete error:", error);
        return NextResponse.json({ success: false, error: "서버 오류가 발생했습니다." }, { status: 500 });
    }
}
