import { NextRequest, NextResponse } from "next/server";
import { db, emailTemplateLinks, partitions, workspaces } from "@/lib/db";
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
            .select()
            .from(emailTemplateLinks)
            .where(eq(emailTemplateLinks.partitionId, partitionId));

        return NextResponse.json({ success: true, data: links });
    } catch (error) {
        console.error("Email template links fetch error:", error);
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
            emailTemplateId,
            recipientField,
            variableMappings,
            triggerType = "manual",
            triggerCondition,
            repeatConfig,
        } = await req.json();

        if (!partitionId || !name || !emailTemplateId || !recipientField) {
            return NextResponse.json({
                success: false,
                error: "partitionId, name, emailTemplateId, recipientField는 필수입니다.",
            }, { status: 400 });
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

        const [created] = await db
            .insert(emailTemplateLinks)
            .values({
                partitionId,
                name,
                emailTemplateId,
                recipientField,
                variableMappings: variableMappings || null,
                triggerType,
                triggerCondition: triggerCondition || null,
                repeatConfig: repeatConfig || null,
                createdBy: user.userId,
            })
            .returning();

        return NextResponse.json({ success: true, data: created }, { status: 201 });
    } catch (error) {
        console.error("Email template link create error:", error);
        return NextResponse.json({ success: false, error: "서버 오류가 발생했습니다." }, { status: 500 });
    }
}
