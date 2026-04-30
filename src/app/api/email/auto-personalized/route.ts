import { NextRequest, NextResponse } from "next/server";
import { db, emailAutoPersonalizedLinks, partitions, workspaces, products } from "@/lib/db";
import { eq, and } from "drizzle-orm";
import { getUserFromNextRequest } from "@/lib/auth";

export async function GET(req: NextRequest) {
    const user = getUserFromNextRequest(req);
    if (!user) {
        return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    }

    try {
        const partitionIdParam = req.nextUrl.searchParams.get("partitionId");
        const partitionId = partitionIdParam ? Number(partitionIdParam) : null;

        const selectFields = {
            id: emailAutoPersonalizedLinks.id,
            orgId: emailAutoPersonalizedLinks.orgId,
            name: emailAutoPersonalizedLinks.name,
            partitionId: emailAutoPersonalizedLinks.partitionId,
            productId: emailAutoPersonalizedLinks.productId,
            productName: products.name,
            recipientField: emailAutoPersonalizedLinks.recipientField,
            companyField: emailAutoPersonalizedLinks.companyField,
            prompt: emailAutoPersonalizedLinks.prompt,
            tone: emailAutoPersonalizedLinks.tone,
            format: emailAutoPersonalizedLinks.format,
            triggerType: emailAutoPersonalizedLinks.triggerType,
            triggerCondition: emailAutoPersonalizedLinks.triggerCondition,
            autoResearch: emailAutoPersonalizedLinks.autoResearch,
            useSignaturePersona: emailAutoPersonalizedLinks.useSignaturePersona,
            followupConfig: emailAutoPersonalizedLinks.followupConfig,
            preventDuplicate: emailAutoPersonalizedLinks.preventDuplicate,
            isActive: emailAutoPersonalizedLinks.isActive,
            isDraft: emailAutoPersonalizedLinks.isDraft,
            createdAt: emailAutoPersonalizedLinks.createdAt,
            updatedAt: emailAutoPersonalizedLinks.updatedAt,
        };

        if (partitionId) {
            const [partition] = await db
                .select()
                .from(partitions)
                .innerJoin(workspaces, eq(workspaces.id, partitions.workspaceId))
                .where(and(eq(partitions.id, partitionId), eq(workspaces.orgId, user.orgId)))
                .limit(1);

            if (!partition) {
                return NextResponse.json({ success: false, error: "파티션을 찾을 수 없습니다." }, { status: 404 });
            }

            const links = await db
                .select(selectFields)
                .from(emailAutoPersonalizedLinks)
                .leftJoin(products, eq(products.id, emailAutoPersonalizedLinks.productId))
                .where(eq(emailAutoPersonalizedLinks.partitionId, partitionId));

            return NextResponse.json({ success: true, data: links });
        }

        // 전체 조회
        const links = await db
            .select({ ...selectFields, partitionName: partitions.name })
            .from(emailAutoPersonalizedLinks)
            .leftJoin(products, eq(products.id, emailAutoPersonalizedLinks.productId))
            .innerJoin(partitions, eq(partitions.id, emailAutoPersonalizedLinks.partitionId))
            .innerJoin(workspaces, eq(workspaces.id, partitions.workspaceId))
            .where(eq(workspaces.orgId, user.orgId));

        return NextResponse.json({ success: true, data: links });
    } catch (error) {
        console.error("Auto personalized links fetch error:", error);
        return NextResponse.json({ success: false, error: "서버 오류가 발생했습니다." }, { status: 500 });
    }
}

export async function POST(req: NextRequest) {
    const user = getUserFromNextRequest(req);
    if (!user) {
        return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    }

    try {
        const {
            name,
            partitionId,
            productId,
            recipientField,
            companyField,
            prompt,
            tone,
            format = "plain",
            triggerType = "on_create",
            triggerCondition,
            autoResearch = 1,
            useSignaturePersona = 0,
            followupConfig,
            isActive,
            isDraft,
            preventDuplicate = 0,
            senderProfileId,
            signatureId,
        } = await req.json();

        const isDraftFlag = isDraft ? 1 : 0;

        if (!partitionId) {
            return NextResponse.json({
                success: false,
                error: "partitionId는 필수입니다.",
            }, { status: 400 });
        }

        // draft가 아닐 때만 필수 필드 검증
        if (!isDraftFlag && (!recipientField || !companyField)) {
            return NextResponse.json({
                success: false,
                error: "recipientField, companyField는 필수입니다.",
            }, { status: 400 });
        }

        // 파티션 소유권 확인
        const [partition] = await db
            .select()
            .from(partitions)
            .innerJoin(workspaces, eq(workspaces.id, partitions.workspaceId))
            .where(and(eq(partitions.id, partitionId), eq(workspaces.orgId, user.orgId)))
            .limit(1);

        if (!partition) {
            return NextResponse.json({ success: false, error: "파티션을 찾을 수 없습니다." }, { status: 404 });
        }

        // 제품 소유권 확인
        if (productId) {
            const [product] = await db
                .select()
                .from(products)
                .where(and(eq(products.id, productId), eq(products.orgId, user.orgId)))
                .limit(1);
            if (!product) {
                return NextResponse.json({ success: false, error: "제품을 찾을 수 없습니다." }, { status: 404 });
            }
        }

        const [created] = await db
            .insert(emailAutoPersonalizedLinks)
            .values({
                orgId: user.orgId,
                name: name || null,
                partitionId,
                productId: productId || null,
                recipientField: recipientField || "",
                companyField: companyField || "",
                prompt: prompt || null,
                tone: tone || null,
                format: format || "plain",
                triggerType,
                triggerCondition: triggerCondition || null,
                autoResearch: autoResearch ?? 1,
                useSignaturePersona: useSignaturePersona ?? 0,
                followupConfig: followupConfig || null,
                // draft는 자동으로 isActive=0
                isActive: isDraftFlag ? 0 : (isActive ?? 1),
                isDraft: isDraftFlag,
                preventDuplicate: preventDuplicate ? 1 : 0,
                senderProfileId: senderProfileId || null,
                signatureId: signatureId || null,
            })
            .returning();

        return NextResponse.json({ success: true, data: created }, { status: 201 });
    } catch (error) {
        console.error("Auto personalized link create error:", error);
        return NextResponse.json({ success: false, error: "서버 오류가 발생했습니다." }, { status: 500 });
    }
}
