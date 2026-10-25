import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { adLeadLogs, adLeadIntegrations } from "@/lib/db/schema";
import { and, desc, eq } from "drizzle-orm";
import { getActiveUserFromNextRequest } from "@/lib/auth";
import { processMetaLead } from "@/lib/meta-lead-record";

/**
 * 실패한 Meta 리드 다시 처리 (UX-049) — 같은 leadgenId를 Meta에서 다시 읽어 웹훅과 같은 경로로 만든다.
 * 이미 성공·중복 처리된 리드는 processMetaLead가 건너뛰므로 여러 번 눌러도 레코드는 한 번만 생긴다.
 */
export async function POST(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const user = await getActiveUserFromNextRequest(req);
    if (!user) {
        return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    }
    if (user.role === "member") {
        return NextResponse.json({ success: false, error: "접근 권한이 없습니다." }, { status: 403 });
    }

    const logId = Number((await params).id);
    if (!Number.isSafeInteger(logId) || logId <= 0) {
        return NextResponse.json({ success: false, error: "로그 ID가 필요합니다." }, { status: 400 });
    }

    try {
        const [log] = await db
            .select({
                status: adLeadLogs.status,
                externalLeadId: adLeadLogs.externalLeadId,
                integrationId: adLeadLogs.integrationId,
                formId: adLeadIntegrations.formId,
                platform: adLeadIntegrations.platform,
                isActive: adLeadIntegrations.isActive,
            })
            .from(adLeadLogs)
            .innerJoin(adLeadIntegrations, eq(adLeadIntegrations.id, adLeadLogs.integrationId))
            .where(and(eq(adLeadLogs.id, logId), eq(adLeadIntegrations.orgId, user.orgId)));

        if (!log) {
            return NextResponse.json({ success: false, error: "로그를 찾을 수 없습니다." }, { status: 404 });
        }
        if (log.platform !== "meta" || !log.externalLeadId) {
            return NextResponse.json({ success: false, error: "다시 처리할 수 있는 Meta 리드가 아닙니다." }, { status: 400 });
        }
        if (log.status !== "failed") {
            return NextResponse.json({ success: false, error: "실패한 리드만 다시 처리할 수 있습니다." }, { status: 409 });
        }

        if (log.isActive !== 1) {
            return NextResponse.json({ success: false, error: "연동이 꺼져 있습니다. 연동을 켠 뒤 다시 처리해주세요." }, { status: 409 });
        }

        await processMetaLead(log.externalLeadId, log.formId, undefined, log.integrationId);

        // 처리 결과는 같은 리드의 가장 최근 로그다 (성공·중복·실패·건너뜀)
        const [latest] = await db
            .select({ id: adLeadLogs.id, status: adLeadLogs.status, recordId: adLeadLogs.recordId, errorMessage: adLeadLogs.errorMessage })
            .from(adLeadLogs)
            .where(and(eq(adLeadLogs.integrationId, log.integrationId), eq(adLeadLogs.externalLeadId, log.externalLeadId)))
            .orderBy(desc(adLeadLogs.createdAt), desc(adLeadLogs.id))
            .limit(1);

        return NextResponse.json({ success: true, data: latest ?? null });
    } catch (error) {
        console.error("Ad lead retry error:", error);
        return NextResponse.json({ success: false, error: "서버 오류가 발생했습니다." }, { status: 500 });
    }
}
