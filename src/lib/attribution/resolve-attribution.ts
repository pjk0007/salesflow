import { db } from "@/lib/db";
import { emailClickLogs, emailSendLogs } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { cleanCampaignValue, type AttributionParams } from "./parse-params";

/**
 * 레코드에 기록할 유입 출처. 메타 광고 리드와 같은 키를 쓴다
 * (webhooks/meta/route.ts:223-225) — 기존 "광고" 컬럼이 그대로 그린다.
 */
export type AttributionResult = {
    campaignName?: string;
    adName?: string;
};

/**
 * sendb_cid로 발송 건을 역추적해 캠페인 출처를 만든다.
 *
 * sendb_cid가 1순위다. UTM은 캠페인까지만 알려주지만 sendb_cid는
 * 발송 건 → 수신자 개인까지 특정한다.
 */
export async function resolveAttribution(
    params: AttributionParams,
): Promise<AttributionResult> {
    const result: AttributionResult = {};

    const campaign = params.utmCampaign
        ? cleanCampaignValue(params.utmCampaign)
        : undefined;
    if (campaign) result.campaignName = campaign;

    if (!params.clickId) return result;

    const [match] = await db
        .select({ subject: emailSendLogs.subject })
        .from(emailClickLogs)
        .innerJoin(emailSendLogs, eq(emailClickLogs.sendLogId, emailSendLogs.id))
        .where(eq(emailClickLogs.clickId, params.clickId))
        .limit(1);

    // 만료·위조 clickId면 조인이 비는데, UTM 폴백만 남기고 그대로 진행한다.
    if (match?.subject) result.adName = match.subject;

    return result;
}
