import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { adLeadIntegrations, adAccounts, partitions } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { getUserFromNextRequest } from "@/lib/auth";

export async function GET(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const user = getUserFromNextRequest(req);
    if (!user) {
        return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    }

    const { id } = await params;
    const integrationId = Number(id);

    try {
        const [integration] = await db
            .select({
                id: adLeadIntegrations.id,
                orgId: adLeadIntegrations.orgId,
                adAccountId: adLeadIntegrations.adAccountId,
                name: adLeadIntegrations.name,
                platform: adLeadIntegrations.platform,
                partitionId: adLeadIntegrations.partitionId,
                formId: adLeadIntegrations.formId,
                formName: adLeadIntegrations.formName,
                fieldMappings: adLeadIntegrations.fieldMappings,
                defaultValues: adLeadIntegrations.defaultValues,
                isActive: adLeadIntegrations.isActive,
                createdBy: adLeadIntegrations.createdBy,
                createdAt: adLeadIntegrations.createdAt,
                updatedAt: adLeadIntegrations.updatedAt,
                adAccountName: adAccounts.name,
                partitionName: partitions.name,
            })
            .from(adLeadIntegrations)
            .leftJoin(adAccounts, eq(adLeadIntegrations.adAccountId, adAccounts.id))
            .leftJoin(partitions, eq(adLeadIntegrations.partitionId, partitions.id))
            .where(and(eq(adLeadIntegrations.id, integrationId), eq(adLeadIntegrations.orgId, user.orgId)));

        if (!integration) {
            return NextResponse.json({ success: false, error: "연동 설정을 찾을 수 없습니다." }, { status: 404 });
        }

        return NextResponse.json({ success: true, data: integration });
    } catch (error) {
        console.error("Ad lead integration detail error:", error);
        return NextResponse.json({ success: false, error: "서버 오류가 발생했습니다." }, { status: 500 });
    }
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
    const integrationId = Number(id);
    const body = await req.json();

    try {
        const [existing] = await db
            .select({ id: adLeadIntegrations.id })
            .from(adLeadIntegrations)
            .where(and(eq(adLeadIntegrations.id, integrationId), eq(adLeadIntegrations.orgId, user.orgId)));

        if (!existing) {
            return NextResponse.json({ success: false, error: "연동 설정을 찾을 수 없습니다." }, { status: 404 });
        }

        const updateData: Record<string, unknown> = { updatedAt: new Date() };

        if (body.name?.trim()) {
            updateData.name = body.name.trim();
        }
        if (body.partitionId !== undefined) {
            updateData.partitionId = body.partitionId;
        }
        if (body.fieldMappings !== undefined) {
            updateData.fieldMappings = body.fieldMappings;
        }
        if (body.defaultValues !== undefined) {
            updateData.defaultValues = body.defaultValues;
        }
        if (body.isActive !== undefined) {
            updateData.isActive = body.isActive;
        }

        const [updated] = await db
            .update(adLeadIntegrations)
            .set(updateData)
            .where(eq(adLeadIntegrations.id, integrationId))
            .returning();

        return NextResponse.json({ success: true, data: updated });
    } catch (error) {
        console.error("Ad lead integration update error:", error);
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
    const integrationId = Number(id);

    try {
        const [existing] = await db
            .select({ id: adLeadIntegrations.id })
            .from(adLeadIntegrations)
            .where(and(eq(adLeadIntegrations.id, integrationId), eq(adLeadIntegrations.orgId, user.orgId)));

        if (!existing) {
            return NextResponse.json({ success: false, error: "연동 설정을 찾을 수 없습니다." }, { status: 404 });
        }

        await db
            .delete(adLeadIntegrations)
            .where(eq(adLeadIntegrations.id, integrationId));

        return NextResponse.json({ success: true, data: { id: integrationId } });
    } catch (error) {
        console.error("Ad lead integration delete error:", error);
        return NextResponse.json({ success: false, error: "서버 오류가 발생했습니다." }, { status: 500 });
    }
}
