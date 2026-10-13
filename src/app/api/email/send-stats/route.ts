import { NextRequest, NextResponse } from "next/server";
import { getUserFromNextRequest } from "@/lib/auth";
import { emailSendLogs, emailClickLogs, partitions, workspaces } from "@/lib/db/schema";
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

    const conditions = [
        eq(emailSendLogs.orgId, user.orgId),
        gte(emailSendLogs.sentAt, new Date(`${startDate}T00:00:00+09:00`)),
        lte(emailSendLogs.sentAt, new Date(`${endDate}T23:59:59+09:00`)),
    ];

    const rows = await readonlyDb
        .select({
            workspaceId: workspaces.id,
            workspaceName: workspaces.name,
            partitionId: partitions.id,
            partitionName: partitions.name,
            date: sql<string>`to_char(${emailSendLogs.sentAt} AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD')`,
            totalCount: sql<number>`count(*)::int`,
            sentCount: sql<number>`count(*) filter (where ${emailSendLogs.status} = 'sent')::int`,
            clickCount: sql<number>`count(distinct ${emailClickLogs.sendLogId})::int`,
        })
        .from(emailSendLogs)
        .innerJoin(partitions, eq(emailSendLogs.partitionId, partitions.id))
        .innerJoin(workspaces, eq(partitions.workspaceId, workspaces.id))
        .leftJoin(emailClickLogs, eq(emailSendLogs.id, emailClickLogs.sendLogId))
        .where(and(...conditions))
        .groupBy(workspaces.id, workspaces.name, partitions.id, partitions.name, sql`to_char(${emailSendLogs.sentAt} AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD')`)
        .orderBy(workspaces.name, sql`to_char(${emailSendLogs.sentAt} AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD')`, partitions.name);

    return NextResponse.json({ success: true, data: rows });
}
