import { NextRequest, NextResponse } from "next/server";
import { getUserFromNextRequest } from "@/lib/auth";
import postgres from "postgres";

interface ConditionInput {
    type: "duration" | "pages" | "visits" | "path" | "click" | "stage";
    value: string;
    value2?: string;
    operator?: "AND" | "OR";
}

function buildConditionSql(c: ConditionInput, fromDate: string, toDate: string, orgId: string): { where?: string; having?: string } {
    switch (c.type) {
        case "duration":
            return { having: `max(ts.duration) >= ${Number(c.value)}` };
        case "pages":
            return { having: `sum(ts.page_count) >= ${Number(c.value)}` };
        case "visits":
            return { having: `count(distinct ts.id) >= ${Number(c.value)}` };
        case "path": {
            const safePath = c.value.replace(/'/g, "''");
            if (c.value2) {
                const dur = Number(c.value2);
                return {
                    where: `tv.id IN (
                        SELECT DISTINCT ev.visitor_id FROM tracker_events ev
                        JOIN tracker_sessions s2 ON s2.id = ev.session_id AND s2.duration >= ${dur}
                        WHERE ev.page_url ILIKE '%${safePath}%'
                        AND ev.occurred_at >= '${fromDate}' AND ev.occurred_at <= '${toDate}'
                    )`,
                };
            }
            return {
                where: `tv.id IN (
                    SELECT DISTINCT ev.visitor_id FROM tracker_events ev
                    WHERE ev.page_url ILIKE '%${safePath}%'
                    AND ev.occurred_at >= '${fromDate}' AND ev.occurred_at <= '${toDate}'
                )`,
            };
        }
        case "click": {
            const safePattern = c.value.replace(/'/g, "''");
            return {
                where: `tv.id IN (
                    SELECT DISTINCT ev.visitor_id FROM tracker_events ev
                    WHERE ev.event_type = 'CLICK' AND ev.event_name ~* '${safePattern}'
                    AND ev.occurred_at >= '${fromDate}' AND ev.occurred_at <= '${toDate}'
                )`,
            };
        }
        case "stage": {
            const safeStage = c.value.replace(/'/g, "''");
            return {
                where: `tv.id IN (
                    SELECT vrl.visitor_id FROM visitor_record_links vrl
                    JOIN customer_journey_alerts cja ON cja.record_id = vrl.record_id
                    WHERE cja.stage = '${safeStage}' AND cja.org_id = '${orgId}'
                )`,
            };
        }
        default:
            return {};
    }
}

export async function POST(req: NextRequest) {
    const user = getUserFromNextRequest(req);
    if (!user) {
        return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    }

    const body = await req.json();
    const { workspaceId, startDate, endDate, conditions: inputConditions, hasClicked } = body as {
        workspaceId?: number;
        startDate: string;
        endDate: string;
        conditions: ConditionInput[];
        hasClicked?: boolean;
    };

    // 하위호환: 기존 filters 형태도 지원
    const filters = (body as { filters?: Record<string, unknown> }).filters;
    if (filters && (!inputConditions || inputConditions.length === 0)) {
        const converted: ConditionInput[] = [];
        if (filters.minDuration) converted.push({ type: "duration", value: String(filters.minDuration) });
        if (filters.minPages) converted.push({ type: "pages", value: String(filters.minPages) });
        if (filters.minVisits) converted.push({ type: "visits", value: String(filters.minVisits) });
        if (filters.pagePathContains) converted.push({ type: "path", value: String(filters.pagePathContains), value2: filters.pageMinDuration ? String(filters.pageMinDuration) : undefined });
        if (filters.eventNamePattern) converted.push({ type: "click", value: String(filters.eventNamePattern) });
        if (filters.stage) converted.push({ type: "stage", value: String(filters.stage) });
        return handleQuery(user.orgId, workspaceId, startDate, endDate, converted, filters.hasClicked === true);
    }

    return handleQuery(user.orgId, workspaceId, startDate, endDate, inputConditions ?? [], hasClicked === true);
}

async function handleQuery(
    orgId: string,
    workspaceId: number | undefined,
    startDate: string,
    endDate: string,
    conditions: ConditionInput[],
    hasClicked: boolean,
) {
    if (!startDate || !endDate) {
        return NextResponse.json({ success: false, error: "startDate, endDate가 필요합니다." }, { status: 400 });
    }

    const fromDate = `${startDate}T00:00:00+09:00`;
    const toDate = `${endDate}T23:59:59+09:00`;

    // 기본 조건 (항상 AND)
    const baseConditions: string[] = [
        `ts.site_id IN (SELECT id FROM tracker_sites WHERE workspace_id IN (SELECT id FROM workspaces WHERE org_id = '${orgId}'))`,
        `ts.started_at >= '${fromDate}'`,
        `ts.started_at <= '${toDate}'`,
    ];
    if (workspaceId) {
        baseConditions.push(`ts.site_id IN (SELECT id FROM tracker_sites WHERE workspace_id = ${Number(workspaceId)})`);
    }
    if (hasClicked) {
        baseConditions.push(`ts.click_id IS NOT NULL`);
    }

    // 사용자 조건을 WHERE / HAVING으로 분류하고 AND/OR 그룹핑
    const whereGroups: string[][] = [[]]; // AND 그룹 배열
    const havingGroups: string[][] = [[]];

    for (let i = 0; i < conditions.length; i++) {
        const c = conditions[i];
        if (!c.value) continue;
        const sql = buildConditionSql(c, fromDate, toDate, orgId);

        // 첫 조건이거나 AND면 현재 그룹에 추가, OR면 새 그룹 시작
        if (i > 0 && c.operator === "OR") {
            whereGroups.push([]);
            havingGroups.push([]);
        }

        const groupIdx = whereGroups.length - 1;
        if (sql.where) whereGroups[groupIdx].push(sql.where);
        if (sql.having) havingGroups[groupIdx].push(sql.having);
    }

    // AND 그룹 내부는 AND, 그룹 간은 OR
    const whereGroupSqls = whereGroups
        .map((g) => g.length > 0 ? (g.length === 1 ? g[0] : `(${g.join(" AND ")})`) : null)
        .filter(Boolean);
    const havingGroupSqls = havingGroups
        .map((g) => g.length > 0 ? (g.length === 1 ? g[0] : `(${g.join(" AND ")})`) : null)
        .filter(Boolean);

    const userWhere = whereGroupSqls.length > 0
        ? `AND (${whereGroupSqls.join(" OR ")})`
        : "";
    const userHaving = havingGroupSqls.length > 0
        ? `HAVING ${havingGroupSqls.join(" OR ")}`
        : "";

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
        WHERE ${baseConditions.join(" AND ")}
        ${userWhere}
        GROUP BY tv.id, tv.email, tv.name, tv.total_visits, tv.total_pageviews,
                 tv.last_seen_at, tv.record_id, r.integrated_code, r.data, w.name
        ${userHaving}
        ORDER BY max(ts.duration) DESC
        LIMIT 200
    `;

    try {
        const client = postgres(process.env.READONLY_DATABASE_URL!, { max: 3 });
        const results = await client.unsafe(query);
        await client.end();

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
