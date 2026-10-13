import { NextRequest, NextResponse } from "next/server";
import { getUserFromNextRequest } from "@/lib/auth";
import { emailSendLogs, emailClickLogs, emailAutoPersonalizedLinks, emailTemplateLinks, partitions, workspaces } from "@/lib/db/schema";
import { eq, and, gte, lte, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

function getReadonlyDb() {
    const url = process.env.READONLY_DATABASE_URL;
    if (!url) throw new Error("READONLY_DATABASE_URL이 설정되지 않았습니다.");
    const client = postgres(url, { max: 3 });
    return drizzle(client);
}

export async function GET(req: NextRequest) {
    const user = getUserFromNextRequest(req);
    if (!user) {
        return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const startDate = searchParams.get("startDate");
    const endDate = searchParams.get("endDate");

    if (!startDate || !endDate) {
        return NextResponse.json({ success: false, error: "startDate, endDate가 필요합니다." }, { status: 400 });
    }

    const readonlyDb = getReadonlyDb();

    const rows = await readonlyDb
        .select({
            workspaceId: workspaces.id,
            workspaceName: workspaces.name,
            ruleName: sql<string>`coalesce(${emailAutoPersonalizedLinks.name}, ${emailTemplateLinks.name}, '기타')`,
            ruleType: sql<string>`case when ${emailSendLogs.autoPersonalizedLinkId} is not null then 'ai' when ${emailSendLogs.templateLinkId} is not null then 'template' else 'other' end`,
            step: sql<string>`case when ${emailSendLogs.parentLogId} is null then '1차 발송' else '후속 발송' end`,
            totalCount: sql<number>`count(*)::int`,
            sentCount: sql<number>`count(*) filter (where ${emailSendLogs.status} = 'sent')::int`,
            clickCount: sql<number>`count(distinct ${emailClickLogs.sendLogId})::int`,
        })
        .from(emailSendLogs)
        .innerJoin(partitions, eq(emailSendLogs.partitionId, partitions.id))
        .innerJoin(workspaces, eq(partitions.workspaceId, workspaces.id))
        .leftJoin(emailAutoPersonalizedLinks, eq(emailSendLogs.autoPersonalizedLinkId, emailAutoPersonalizedLinks.id))
        .leftJoin(emailTemplateLinks, eq(emailSendLogs.templateLinkId, emailTemplateLinks.id))
        .leftJoin(emailClickLogs, eq(emailSendLogs.id, emailClickLogs.sendLogId))
        .where(and(
            eq(emailSendLogs.orgId, user.orgId),
            gte(emailSendLogs.sentAt, new Date(`${startDate}T00:00:00+09:00`)),
            lte(emailSendLogs.sentAt, new Date(`${endDate}T23:59:59+09:00`)),
        ))
        .groupBy(
            workspaces.id, workspaces.name,
            sql`coalesce(${emailAutoPersonalizedLinks.name}, ${emailTemplateLinks.name}, '기타')`,
            sql`case when ${emailSendLogs.autoPersonalizedLinkId} is not null then 'ai' when ${emailSendLogs.templateLinkId} is not null then 'template' else 'other' end`,
            sql`case when ${emailSendLogs.parentLogId} is null then '1차 발송' else '후속 발송' end`,
        )
        .orderBy(
            workspaces.name,
            sql`coalesce(${emailAutoPersonalizedLinks.name}, ${emailTemplateLinks.name}, '기타')`,
            sql`case when ${emailSendLogs.parentLogId} is null then '1차 발송' else '후속 발송' end`,
        );

    return NextResponse.json({ success: true, data: rows });
}
