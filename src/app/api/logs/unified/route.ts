import { kstDateFilter } from "@/lib/tracker/date-range";
import { isExactEmailSearch } from "@/lib/send-log-search";
import { openSignalsForSendLogs, EMPTY_OPEN_SIGNAL } from "@/lib/email-open-signals";
import { clickSignalsForSendLogs, EMPTY_CLICK_SIGNAL } from "@/lib/email-click-signals";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";
import { getUserFromNextRequest } from "@/lib/auth";

export async function GET(req: NextRequest) {
    const user = getUserFromNextRequest(req);
    if (!user) {
        return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    }

    try {
        const searchParams = req.nextUrl.searchParams;
        const page = Math.max(1, Number(searchParams.get("page")) || 1);
        const pageSize = Math.min(100, Math.max(1, Number(searchParams.get("pageSize")) || 50));
        const offset = (page - 1) * pageSize;
        const channel = searchParams.get("channel") || "";
        const status = searchParams.get("status") || "";
        const triggerType = searchParams.get("triggerType") || "";
        // 날짜는 KST 하루 경계로 자른다 — 서버·DB 세션 시간대와 무관
        const dates = kstDateFilter(searchParams.get("startDate"), searchParams.get("endDate"));
        if (!dates.ok) {
            return NextResponse.json({ success: false, error: dates.error }, { status: 400 });
        }
        const { fromIso, toIso } = dates;
        const recordId = searchParams.get("recordId") ? Number(searchParams.get("recordId")) : null;
        const search = searchParams.get("search") || "";
        const isExactSearch = isExactEmailSearch(search);
        if (isExactSearch && channel === "alimtalk") {
            return NextResponse.json({ success: true, data: [], total: 0, page, pageSize, totalPages: 0 });
        }

        function buildSubquery(
            type: "alimtalk" | "email",
            orgId: string,
        ) {
            const table = type === "alimtalk" ? "alimtalk_send_logs" : "email_send_logs";
            const recipientCol = type === "alimtalk" ? "recipient_no" : "recipient_email";
            const titleCol = type === "alimtalk" ? "template_name" : "subject";

            let q = sql`
                SELECT id, ${sql.raw(`'${type}'`)}::text as channel,
                       org_id as "orgId", partition_id as "partitionId", record_id as "recordId",
                       ${sql.raw(recipientCol)} as recipient, ${sql.raw(titleCol)} as title,
                       status, trigger_type as "triggerType", result_message as "resultMessage",
                       sent_by as "sentBy", sent_at as "sentAt", completed_at as "completedAt"
                FROM ${sql.raw(table)}
                WHERE org_id = ${orgId}
            `;

            if (status) q = sql`${q} AND status = ${status}`;
            if (triggerType) q = sql`${q} AND trigger_type = ${triggerType}`;
            if (fromIso) q = sql`${q} AND sent_at >= ${fromIso}::timestamptz`;
            if (toIso) q = sql`${q} AND sent_at <= ${toIso}::timestamptz`;
            if (recordId) q = sql`${q} AND record_id = ${recordId}`;
            if (isExactSearch) {
                q = sql`${q} AND lower(recipient_email) = lower(${search.trim()})`;
            } else if (search) {
                const like = `%${search}%`;
                q = sql`${q} AND (${sql.raw(recipientCol)} ILIKE ${like} OR ${sql.raw(titleCol)} ILIKE ${like})`;
            }

            return q;
        }

        let unionQuery;

        if (isExactSearch) {
            unionQuery = buildSubquery("email", user.orgId);
        } else if (channel === "alimtalk") {
            unionQuery = buildSubquery("alimtalk", user.orgId);
        } else if (channel === "email") {
            unionQuery = buildSubquery("email", user.orgId);
        } else {
            const qa = buildSubquery("alimtalk", user.orgId);
            const qe = buildSubquery("email", user.orgId);
            unionQuery = sql`(${qa}) UNION ALL (${qe})`;
        }

        const countQuery = sql`SELECT count(*)::int as count FROM (${unionQuery}) t`;
        const dataQuery = sql`SELECT * FROM (${unionQuery}) t ORDER BY "sentAt" DESC LIMIT ${pageSize} OFFSET ${offset}`;

        const [countResult] = await db.execute(countQuery) as { count: number }[];
        const total = countResult.count;
        type UnifiedRow = Record<string, unknown> & { id: number; channel: "alimtalk" | "email" };
        const logs = (await db.execute(dataQuery)) as unknown as UnifiedRow[];
        // 정렬 전 모든 줄을 집계하지 않도록 현재 페이지의 이메일에만 신호를 붙인다.
        const logIds = logs.filter((log) => log.channel === "email").map((log) => log.id);
        const [signals, openSignals] = await Promise.all([
            clickSignalsForSendLogs(user.orgId, logIds),
            openSignalsForSendLogs(user.orgId, logIds),
        ]);
        const data = logs.map((log) =>
            log.channel === "email"
                ? { ...log, ...(signals.get(log.id) ?? EMPTY_CLICK_SIGNAL), ...(openSignals.get(log.id) ?? EMPTY_OPEN_SIGNAL) }
                : { ...log, clickCount: 0 },
        );

        return NextResponse.json({
            success: true,
            data,
            total,
            page,
            pageSize,
            totalPages: Math.ceil(total / pageSize),
        });
    } catch (error) {
        console.error("Unified logs error:", error);
        return NextResponse.json({ success: false, error: "서버 오류가 발생했습니다." }, { status: 500 });
    }
}
