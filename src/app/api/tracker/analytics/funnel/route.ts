import { NextRequest, NextResponse } from "next/server";
import { db, trackerSites, trackerFunnels } from "@/lib/db";
import { and, eq, sql, desc } from "drizzle-orm";
import { getUserFromNextRequest } from "@/lib/auth";
import { countStageVisitors, AUTO_STAGE_VISIT, AUTO_STAGE_LEAD } from "@/lib/tracker/funnel-analytics";
import { getSessionIdsByChannel } from "@/lib/tracker/session-filter";
import type { FunnelStageResult } from "@/components/tracker/types/funnel";

const DAY_MS = 24 * 60 * 60 * 1000;

function rangeBounds(fromYmd: string, toYmd: string) {
    return {
        fromIso: `${fromYmd}T00:00:00+09:00`,
        toIso: `${toYmd}T23:59:59.999+09:00`,
    };
}

function notExcludedExpr(excludes: string[]) {
    if (excludes.length === 0) return sql`TRUE`;
    return sql`NOT (${sql.join(excludes.map((p) => sql`regexp_replace(split_part(page_url, '?', 1), '^https?://[^/]+', '') LIKE ${p + "%"}`), sql` OR `)})`;
}

function deviceFilterSql(device: string | null, alias = "tv") {
    return device ? sql.raw(`AND ${alias}.device_type = '${device.replace(/'/g, "")}'`) : sql``;
}
function sessionInFilterSql(ids: number[] | null, col: string) {
    if (ids === null) return sql``;
    if (ids.length === 0) return sql.raw(`AND FALSE`);
    return sql`AND ${sql.raw(col)} IN (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})`;
}

export async function GET(req: NextRequest) {
    const user = getUserFromNextRequest(req);
    if (!user) return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });

    const sp = req.nextUrl.searchParams;
    const siteId = Number(sp.get("siteId"));
    if (!siteId) return NextResponse.json({ success: false, error: "siteId가 필요합니다." }, { status: 400 });

    const [site] = await db.select().from(trackerSites)
        .where(and(eq(trackerSites.id, siteId), eq(trackerSites.orgId, user.orgId)));
    if (!site) return NextResponse.json({ success: false, error: "트래커를 찾을 수 없습니다." }, { status: 404 });

    // 퍼널 선택: funnelId 지정 / 또는 사이트의 is_default
    const funnelIdParam = sp.get("funnelId");
    let funnel:
        | { id: number; name: string; stages: { key: string; label: string; match: import("@/components/tracker/types/funnel").StageMatch }[] }
        | null = null;
    if (funnelIdParam) {
        const [f] = await db.select().from(trackerFunnels)
            .where(and(eq(trackerFunnels.id, Number(funnelIdParam)), eq(trackerFunnels.siteId, siteId)));
        if (f) funnel = { id: f.id, name: f.name, stages: f.stages };
    } else {
        const [f] = await db.select().from(trackerFunnels)
            .where(and(eq(trackerFunnels.siteId, siteId), eq(trackerFunnels.isDefault, 1)))
            .orderBy(desc(trackerFunnels.createdAt))
            .limit(1);
        if (f) funnel = { id: f.id, name: f.name, stages: f.stages };
    }

    // 기간
    const today = new Date();
    const ymd = (d: Date) => d.toISOString().slice(0, 10);
    const fromYmd = sp.get("from") ?? ymd(new Date(today.getTime() - 30 * DAY_MS));
    const toYmd = sp.get("to") ?? ymd(today);
    const { fromIso, toIso } = rangeBounds(fromYmd, toYmd);

    // 세그먼트 필터
    const deviceParam = sp.get("device");
    const device = deviceParam && ["desktop", "mobile", "tablet"].includes(deviceParam) ? deviceParam : null;
    const channel = sp.get("channel");
    const sessionIds = await getSessionIdsByChannel({ siteId, fromIso, toIso, channel });

    const excludes = (site.excludePaths ?? []) as string[];
    const devFilterTv = deviceFilterSql(device, "tv");
    const sessFilterEv = sessionInFilterSql(sessionIds, "ev.session_id");
    const notExcluded = notExcludedExpr(excludes);

    // 1단(visit) 후보 집합 — aggregateRange와 동일 정의
    const meaningfulVisitorIdsSql = sql`(
        SELECT DISTINCT tv.id
        FROM tracker_visitors tv
        JOIN tracker_events ev ON ev.visitor_id = tv.id
        WHERE tv.site_id = ${siteId}
          AND tv.first_seen_at >= ${fromIso} AND tv.first_seen_at <= ${toIso}
          AND ev.event_type = 'PAGE_VIEW'
          AND ev.occurred_at >= ${fromIso} AND ev.occurred_at <= ${toIso}
          AND ${notExcluded}
          ${devFilterTv}
          ${sessFilterEv}
    )`;

    // visit/lead 자동 단계 카운트
    const [vRow] = (await db.execute(sql`
        SELECT
            COUNT(*)::int AS visitors,
            COUNT(*) FILTER (WHERE
                record_id IS NOT NULL
                OR EXISTS (SELECT 1 FROM visitor_record_links vrl WHERE vrl.visitor_id = tracker_visitors.id)
            )::int AS leads
        FROM tracker_visitors
        WHERE id IN ${meaningfulVisitorIdsSql}
    `)) as unknown as Array<{ visitors: number; leads: number }>;

    const stages: FunnelStageResult[] = [
        { key: AUTO_STAGE_VISIT, label: "방문", visitors: vRow.visitors, isAuto: true },
        { key: AUTO_STAGE_LEAD, label: "리드", visitors: vRow.leads, isAuto: true },
    ];

    // 사용자 정의 단계
    if (funnel) {
        for (const stage of funnel.stages) {
            const count = await countStageVisitors(
                { siteId, fromIso, toIso, meaningfulVisitorIdsSql },
                stage.match,
            );
            stages.push({ key: stage.key, label: stage.label, visitors: count });
        }
    }

    return NextResponse.json({
        success: true,
        data: {
            funnel: funnel ? { id: funnel.id, name: funnel.name } : { id: null, name: null },
            range: { from: fromYmd, to: toYmd },
            stages,
        },
    });
}
