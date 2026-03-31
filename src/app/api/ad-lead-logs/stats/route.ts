import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { adLeadLogs, adLeadIntegrations } from "@/lib/db/schema";
import { eq, and, count, sql } from "drizzle-orm";
import { getUserFromNextRequest } from "@/lib/auth";

export async function GET(req: NextRequest) {
    const user = getUserFromNextRequest(req);
    if (!user) {
        return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const integrationId = searchParams.get("integrationId");

    if (!integrationId) {
        return NextResponse.json({ success: false, error: "연동 ID가 필요합니다." }, { status: 400 });
    }

    try {
        // Verify org ownership
        const [integration] = await db
            .select({ id: adLeadIntegrations.id })
            .from(adLeadIntegrations)
            .where(and(
                eq(adLeadIntegrations.id, Number(integrationId)),
                eq(adLeadIntegrations.orgId, user.orgId)
            ));

        if (!integration) {
            return NextResponse.json({ success: false, error: "연동 설정을 찾을 수 없습니다." }, { status: 404 });
        }

        const [stats] = await db
            .select({
                total: count(),
                success: count(sql`CASE WHEN ${adLeadLogs.status} = 'success' THEN 1 END`),
                failed: count(sql`CASE WHEN ${adLeadLogs.status} = 'failed' THEN 1 END`),
                duplicate: count(sql`CASE WHEN ${adLeadLogs.status} = 'duplicate' THEN 1 END`),
                skipped: count(sql`CASE WHEN ${adLeadLogs.status} = 'skipped' THEN 1 END`),
            })
            .from(adLeadLogs)
            .where(eq(adLeadLogs.integrationId, Number(integrationId)));

        return NextResponse.json({
            success: true,
            data: {
                total: stats?.total ?? 0,
                success: stats?.success ?? 0,
                failed: stats?.failed ?? 0,
                duplicate: stats?.duplicate ?? 0,
                skipped: stats?.skipped ?? 0,
            },
        });
    } catch (error) {
        console.error("Ad lead logs stats error:", error);
        return NextResponse.json({ success: false, error: "서버 오류가 발생했습니다." }, { status: 500 });
    }
}
