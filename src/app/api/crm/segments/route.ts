import { NextRequest, NextResponse } from "next/server";
import { getUserFromNextRequest } from "@/lib/auth";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

function getReadonlyDb() {
    const url = process.env.READONLY_DATABASE_URL;
    if (!url) throw new Error("READONLY_DATABASE_URL이 설정되지 않았습니다.");
    const client = postgres(url, { max: 3 });
    return drizzle(client);
}

export async function POST(req: NextRequest) {
    const user = getUserFromNextRequest(req);
    if (!user) {
        return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    }

    const body = await req.json();
    const { workspaceId, startDate, endDate, filters } = body as {
        workspaceId?: number;
        startDate: string;
        endDate: string;
        filters: {
            minDuration?: number;
            minPages?: number;
            minVisits?: number;
            pagePathContains?: string;
            eventType?: string;
            eventNamePattern?: string;
            hasClicked?: boolean;
            stage?: string;
        };
    };

    if (!startDate || !endDate) {
        return NextResponse.json({ success: false, error: "startDate, endDate가 필요합니다." }, { status: 400 });
    }

    const readonlyDb = getReadonlyDb();
    const fromDate = `${startDate}T00:00:00+09:00`;
    const toDate = `${endDate}T23:59:59+09:00`;

    // 동적 WHERE 조건 생성
    const conditions: string[] = [
        `ts.site_id IN (SELECT id FROM tracker_sites WHERE workspace_id IN (SELECT id FROM workspaces WHERE org_id = '${user.orgId}'))`
    ];
    const havingConditions: string[] = [];

    if (workspaceId) {
        conditions.push(`ts.site_id IN (SELECT id FROM tracker_sites WHERE workspace_id = ${Number(workspaceId)})`);
    }

    conditions.push(`ts.started_at >= '${fromDate}'`);
    conditions.push(`ts.started_at <= '${toDate}'`);

    if (filters.minDuration) {
        havingConditions.push(`max(ts.duration) >= ${Number(filters.minDuration)}`);
    }
    if (filters.minPages) {
        havingConditions.push(`sum(ts.page_count) >= ${Number(filters.minPages)}`);
    }
    if (filters.minVisits) {
        havingConditions.push(`count(distinct ts.id) >= ${Number(filters.minVisits)}`);
    }

    // 이벤트 기반 필터를 위한 서브쿼리
    let eventJoin = "";
    if (filters.pagePathContains || filters.eventType || filters.eventNamePattern) {
        const eventConditions: string[] = [];
        if (filters.pagePathContains) {
            const safePath = filters.pagePathContains.replace(/'/g, "''");
            eventConditions.push(`ev.page_url ILIKE '%${safePath}%'`);
        }
        if (filters.eventType) {
            const safeType = filters.eventType.replace(/'/g, "''");
            eventConditions.push(`ev.event_type = '${safeType}'`);
        }
        if (filters.eventNamePattern) {
            const safePattern = filters.eventNamePattern.replace(/'/g, "''");
            eventConditions.push(`ev.event_name ~* '${safePattern}'`);
        }
        eventJoin = `AND tv.id IN (
            SELECT DISTINCT ev.visitor_id FROM tracker_events ev
            WHERE ev.occurred_at >= '${fromDate}' AND ev.occurred_at <= '${toDate}'
            ${eventConditions.length ? "AND " + eventConditions.join(" AND ") : ""}
        )`;
    }

    // 클릭(이메일에서 온 사람) 필터
    let clickJoin = "";
    if (filters.hasClicked === true) {
        clickJoin = `AND ts.click_id IS NOT NULL`;
    }

    // 여정 단계 필터
    let stageJoin = "";
    if (filters.stage) {
        const safeStage = filters.stage.replace(/'/g, "''");
        stageJoin = `AND tv.id IN (
            SELECT vrl.visitor_id FROM visitor_record_links vrl
            JOIN customer_journey_alerts cja ON cja.record_id = vrl.record_id
            WHERE cja.stage = '${safeStage}' AND cja.org_id = '${user.orgId}'
        )`;
    }

    const query = `
        SELECT
            tv.id as visitor_id,
            tv.email,
            tv.name,
            tv.total_visits,
            tv.total_pageviews,
            tv.last_seen_at,
            tv.record_id,
            r.integrated_code,
            r.data as record_data,
            w.name as workspace_name,
            max(ts.duration) as max_duration,
            sum(ts.page_count) as total_pages,
            count(distinct ts.id) as session_count
        FROM tracker_visitors tv
        JOIN tracker_sessions ts ON ts.visitor_id = tv.id
        JOIN tracker_sites site ON site.id = ts.site_id
        JOIN workspaces w ON w.id = site.workspace_id
        LEFT JOIN records r ON r.id = tv.record_id
        WHERE ${conditions.join(" AND ")}
        ${eventJoin}
        ${clickJoin}
        ${stageJoin}
        GROUP BY tv.id, tv.email, tv.name, tv.total_visits, tv.total_pageviews,
                 tv.last_seen_at, tv.record_id, r.integrated_code, r.data, w.name
        ${havingConditions.length ? "HAVING " + havingConditions.join(" AND ") : ""}
        ORDER BY max(ts.duration) DESC
        LIMIT 200
    `;

    try {
        const readonlyClient = postgres(process.env.READONLY_DATABASE_URL!, { max: 3 });
        const results = await readonlyClient.unsafe(query);
        await readonlyClient.end();

        const data = results.map((row: Record<string, unknown>) => ({
            visitorId: row.visitor_id,
            email: row.email,
            name: row.name,
            totalVisits: row.total_visits,
            totalPageviews: row.total_pageviews,
            lastSeenAt: row.last_seen_at,
            recordId: row.record_id,
            integratedCode: row.integrated_code,
            recordData: row.record_data,
            workspaceName: row.workspace_name,
            maxDuration: row.max_duration,
            totalPages: row.total_pages,
            sessionCount: row.session_count,
        }));

        return NextResponse.json({ success: true, data, total: data.length });
    } catch (error) {
        console.error("Segment query error:", error);
        return NextResponse.json({ success: false, error: "세그먼트 조회 중 오류가 발생했습니다." }, { status: 500 });
    }
}
