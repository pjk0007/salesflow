import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { adLeadLogs, adLeadIntegrations } from "@/lib/db/schema";
import { eq, and, desc } from "drizzle-orm";
import { getUserFromNextRequest } from "@/lib/auth";

export async function GET(req: NextRequest) {
    const user = getUserFromNextRequest(req);
    if (!user) {
        return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const integrationId = searchParams.get("integrationId");
    const status = searchParams.get("status");

    try {
        const conditions = [eq(adLeadIntegrations.orgId, user.orgId)];

        if (integrationId) {
            conditions.push(eq(adLeadLogs.integrationId, Number(integrationId)));
        }
        if (status) {
            conditions.push(eq(adLeadLogs.status, status));
        }

        const logs = await db
            .select({
                id: adLeadLogs.id,
                integrationId: adLeadLogs.integrationId,
                externalLeadId: adLeadLogs.externalLeadId,
                recordId: adLeadLogs.recordId,
                rawData: adLeadLogs.rawData,
                status: adLeadLogs.status,
                errorMessage: adLeadLogs.errorMessage,
                processedAt: adLeadLogs.processedAt,
                createdAt: adLeadLogs.createdAt,
                integrationName: adLeadIntegrations.name,
            })
            .from(adLeadLogs)
            .innerJoin(adLeadIntegrations, eq(adLeadLogs.integrationId, adLeadIntegrations.id))
            .where(and(...conditions))
            .orderBy(desc(adLeadLogs.createdAt))
            .limit(100);

        return NextResponse.json({ success: true, data: logs });
    } catch (error) {
        console.error("Ad lead logs list error:", error);
        return NextResponse.json({ success: false, error: "서버 오류가 발생했습니다." }, { status: 500 });
    }
}
