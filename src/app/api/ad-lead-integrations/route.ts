import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { adLeadIntegrations, adAccounts, adPlatforms, partitions } from "@/lib/db/schema";
import { eq, and, desc } from "drizzle-orm";
import { getUserFromNextRequest } from "@/lib/auth";

export async function GET(req: NextRequest) {
    const user = getUserFromNextRequest(req);
    if (!user) {
        return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const accountId = searchParams.get("accountId");

    try {
        const conditions = [eq(adLeadIntegrations.orgId, user.orgId)];

        if (accountId) {
            conditions.push(eq(adLeadIntegrations.adAccountId, Number(accountId)));
        }

        const integrations = await db
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
            .where(and(...conditions))
            .orderBy(desc(adLeadIntegrations.createdAt));

        return NextResponse.json({ success: true, data: integrations });
    } catch (error) {
        console.error("Ad lead integrations list error:", error);
        return NextResponse.json({ success: false, error: "서버 오류가 발생했습니다." }, { status: 500 });
    }
}

export async function POST(req: NextRequest) {
    const user = getUserFromNextRequest(req);
    if (!user) {
        return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    }
    if (user.role === "member") {
        return NextResponse.json({ success: false, error: "접근 권한이 없습니다." }, { status: 403 });
    }

    const { adAccountId, name, partitionId, formId, formName, fieldMappings, defaultValues } = await req.json();

    if (!adAccountId) {
        return NextResponse.json({ success: false, error: "광고 계정을 선택해주세요." }, { status: 400 });
    }
    if (!name?.trim()) {
        return NextResponse.json({ success: false, error: "연동 이름을 입력해주세요." }, { status: 400 });
    }
    if (!formId?.trim()) {
        return NextResponse.json({ success: false, error: "폼 ID를 입력해주세요." }, { status: 400 });
    }
    if (!fieldMappings || typeof fieldMappings !== "object") {
        return NextResponse.json({ success: false, error: "필드 매핑 정보를 입력해주세요." }, { status: 400 });
    }

    try {
        // Verify ad account ownership and get platform
        const [account] = await db
            .select({
                id: adAccounts.id,
                platform: adPlatforms.platform,
                orgId: adPlatforms.orgId,
            })
            .from(adAccounts)
            .innerJoin(adPlatforms, eq(adAccounts.adPlatformId, adPlatforms.id))
            .where(and(eq(adAccounts.id, Number(adAccountId)), eq(adPlatforms.orgId, user.orgId)));

        if (!account) {
            return NextResponse.json({ success: false, error: "광고 계정을 찾을 수 없습니다." }, { status: 404 });
        }

        const [created] = await db
            .insert(adLeadIntegrations)
            .values({
                orgId: user.orgId,
                adAccountId: Number(adAccountId),
                name: name.trim(),
                platform: account.platform,
                partitionId: partitionId ? Number(partitionId) : null,
                formId: formId.trim(),
                formName: formName?.trim() || null,
                fieldMappings,
                defaultValues: defaultValues || null,
                createdBy: user.userId,
            })
            .returning();

        return NextResponse.json({ success: true, data: created }, { status: 201 });
    } catch (error: unknown) {
        const errStr = String(error) + String((error as { cause?: unknown })?.cause || "");
        if (errStr.includes("unique") || errStr.includes("23505")) {
            return NextResponse.json({ success: false, error: "이미 동일한 광고 계정과 폼의 연동이 존재합니다. 기존 연동을 삭제 후 다시 시도하세요." }, { status: 409 });
        }
        console.error("Ad lead integration create error:", error);
        return NextResponse.json({ success: false, error: "서버 오류가 발생했습니다." }, { status: 500 });
    }
}
