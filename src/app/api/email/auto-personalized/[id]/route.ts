import { NextRequest, NextResponse } from "next/server";
import { db, emailAutoPersonalizedLinks, products } from "@/lib/db";
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

        const updateData: Record<string, unknown> = { updatedAt: new Date() };
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
