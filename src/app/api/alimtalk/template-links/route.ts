import { NextRequest, NextResponse } from "next/server";
import { db, alimtalkTemplateLinks, partitions, workspaces } from "@/lib/db";
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

        // 파티션 소유권 확인
        const [partition] = await db
            .select({ id: partitions.id })
            .from(partitions)
            .innerJoin(workspaces, eq(workspaces.id, partitions.workspaceId))
            .where(and(eq(partitions.id, partitionId), eq(workspaces.orgId, user.orgId)))
            .limit(1);

        if (!partition) {
            return NextResponse.json({ success: false, error: "접근 권한이 없습니다." }, { status: 403 });
        }

        const links = await db
            .select()
            .from(alimtalkTemplateLinks)
            .where(eq(alimtalkTemplateLinks.partitionId, partitionId))
            .orderBy(alimtalkTemplateLinks.createdAt);

        return NextResponse.json({ success: true, data: links });
    } catch (error) {
        console.error("Template links list error:", error);
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
            name,
            senderKey,
            templateCode,
            templateName,
            recipientField,
            variableMappings,
            triggerType = "manual",
            triggerCondition,
            repeatConfig,
        } = await req.json();

        if (!partitionId || !name || !senderKey || !templateCode || !recipientField) {
            return NextResponse.json({
                success: false,
                error: "partitionId, name, senderKey, templateCode, recipientField는 필수입니다.",
            }, { status: 400 });
        }

        // 파티션 소유권 확인
        const [partition] = await db
            .select({ id: partitions.id })
            .from(partitions)
            .innerJoin(workspaces, eq(workspaces.id, partitions.workspaceId))
            .where(and(eq(partitions.id, partitionId), eq(workspaces.orgId, user.orgId)))
            .limit(1);

        if (!partition) {
            return NextResponse.json({ success: false, error: "접근 권한이 없습니다." }, { status: 403 });
        }

        const [created] = await db
            .insert(alimtalkTemplateLinks)
            .values({
                partitionId,
                name,
                senderKey,
                templateCode,
                templateName: templateName || null,
                recipientField,
                variableMappings: variableMappings || null,
                triggerType,
                triggerCondition: triggerCondition || null,
                repeatConfig: repeatConfig || null,
                createdBy: user.userId,
            })
            .returning({ id: alimtalkTemplateLinks.id });

        return NextResponse.json({ success: true, data: { id: created.id } }, { status: 201 });
    } catch (error) {
        console.error("Template link create error:", error);
        return NextResponse.json({ success: false, error: "서버 오류가 발생했습니다." }, { status: 500 });
    }
}
