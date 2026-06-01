import { NextRequest, NextResponse } from "next/server";
import { db, trackerSites, trackerFunnels, trackerSessions } from "@/lib/db";
import { and, eq, gte, lte, sql, desc } from "drizzle-orm";
import { getUserFromNextRequest } from "@/lib/auth";
import { getStageVisitorIds } from "@/lib/tracker/funnel-analytics";
import { classifyAdGroup, type AdGroup } from "@/components/journey/utils/ad-group";
import type { AdPerformanceRow } from "@/components/tracker/types/ad-performance";
import type { StageMatch } from "@/components/tracker/types/funnel";

const DAY_MS = 24 * 60 * 60 * 1000;

function rangeBounds(fromYmd: string, toYmd: string) {
    return {
        fromIso: `${fromYmd}T00:00:00+09:00`,
        toIso: `${toYmd}T23:59:59.999+09:00`,
    };
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

    // 전환 기준 퍼널 선택: funnelId 지정 / 또는 사이트 기본(is_default)
    const funnelIdParam = sp.get("funnelId");
    let funnel: { id: number; name: string; stages: { key: string; label: string; match: StageMatch }[] } | null = null;
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

    // 1) 기간 내 광고 세션 → 광고 그룹별 visitor 집합 (JS 분류)
    const sessions = await db
        .select({
            visitorId: trackerSessions.visitorId,
            referrer: trackerSessions.referrer,
            landingPage: trackerSessions.landingPage,
        })
        .from(trackerSessions)
        .where(and(
            eq(trackerSessions.siteId, siteId),
            gte(trackerSessions.startedAt, new Date(fromIso)),
            lte(trackerSessions.startedAt, new Date(toIso)),
        ));

    const groupMeta = new Map<string, AdGroup>();
    const visitorsByGroup = new Map<string, Set<number>>();
    for (const s of sessions) {
        if (s.visitorId == null) continue;
        const g = classifyAdGroup(s.referrer, s.landingPage);
        if (!g) continue;
        if (!groupMeta.has(g.key)) {
            groupMeta.set(g.key, g);
            visitorsByGroup.set(g.key, new Set());
        }
        visitorsByGroup.get(g.key)!.add(s.visitorId);
    }

    // 2) 전환 단계 도달 visitor 집합 — funnel 마지막 단계 기준.
    //    getStageVisitorIds 는 ctx.meaningfulVisitorIdsSql IN 절로 코호트를 거르는데,
    //    여기선 광고 visitor 전체를 모수로 보고 그 안에서 전환만 본다 (기간 제약은 광고 세션 기간으로 이미 적용).
    let convVisitors: Set<number> = new Set();
    let conversionLabel: string | null = null;
    const allAdVisitorIds = [...new Set([...visitorsByGroup.values()].flatMap((s) => [...s]))];
    if (funnel && funnel.stages.length > 0 && allAdVisitorIds.length > 0) {
        const lastStage = funnel.stages[funnel.stages.length - 1];
        conversionLabel = lastStage.label;
        const idsSql = sql`(${sql.join(allAdVisitorIds.map((i) => sql`${i}`), sql`, `)})`;
        convVisitors = await getStageVisitorIds(
            { siteId, meaningfulVisitorIdsSql: idsSql },
            lastStage.match,
        );
    }

    // 3) 그룹별 집계
    const rows: AdPerformanceRow[] = [...groupMeta.values()].map((g) => {
        const vs = visitorsByGroup.get(g.key)!;
        let conversions = 0;
        for (const v of vs) if (convVisitors.has(v)) conversions += 1;
        return {
            key: g.key,
            platform: g.platform,
            label: g.label,
            visitors: vs.size,
            conversions,
            conversionRate: vs.size ? conversions / vs.size : 0,
        };
    });

    // 방문자 많은 순 → 전환 많은 순
    rows.sort((a, b) => b.visitors - a.visitors || b.conversions - a.conversions);

    return NextResponse.json({
        success: true,
        data: {
            funnel: funnel ? { id: funnel.id, name: funnel.name, conversionLabel } : { id: null, name: null, conversionLabel: null },
            range: { from: fromYmd, to: toYmd },
            rows,
        },
    });
}
