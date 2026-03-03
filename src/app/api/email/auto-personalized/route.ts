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
        const partitionId = Number(req.nextUrl.searchParams.get("partitionId"));
        if (!partitionId) {
            return NextResponse.json({ success: false, error: "partitionId는 필수입니다." }, { status: 400 });
        }

        // 소유권 확인
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
            .select({
                id: emailAutoPersonalizedLinks.id,
                orgId: emailAutoPersonalizedLinks.orgId,
                partitionId: emailAutoPersonalizedLinks.partitionId,
                productId: emailAutoPersonalizedLinks.productId,
                productName: products.name,
                recipientField: emailAutoPersonalizedLinks.recipientField,
                companyField: emailAutoPersonalizedLinks.companyField,
                prompt: emailAutoPersonalizedLinks.prompt,
                tone: emailAutoPersonalizedLinks.tone,
                triggerType: emailAutoPersonalizedLinks.triggerType,
                triggerCondition: emailAutoPersonalizedLinks.triggerCondition,
                autoResearch: emailAutoPersonalizedLinks.autoResearch,
                isActive: emailAutoPersonalizedLinks.isActive,
                createdAt: emailAutoPersonalizedLinks.createdAt,
                updatedAt: emailAutoPersonalizedLinks.updatedAt,
            })
            .from(emailAutoPersonalizedLinks)
            .leftJoin(products, eq(products.id, emailAutoPersonalizedLinks.productId))
            .where(eq(emailAutoPersonalizedLinks.partitionId, partitionId));

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
            partitionId,
            productId,
            recipientField,
            companyField,
            prompt,
            tone,
            triggerType = "on_create",
            triggerCondition,
            autoResearch = 1,
        } = await req.json();

        if (!partitionId || !recipientField || !companyField) {
            return NextResponse.json({
                success: false,
                error: "partitionId, recipientField, companyField는 필수입니다.",
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
                partitionId,
                productId: productId || null,
                recipientField,
                companyField,
                prompt: prompt || null,
                tone: tone || null,
                triggerType,
                triggerCondition: triggerCondition || null,
                autoResearch: autoResearch ?? 1,
            })
            .returning();

        return NextResponse.json({ success: true, data: created }, { status: 201 });
    } catch (error) {
        console.error("Auto personalized link create error:", error);
        return NextResponse.json({ success: false, error: "서버 오류가 발생했습니다." }, { status: 500 });
    }
}
