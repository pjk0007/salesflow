import { NextRequest, NextResponse } from "next/server";
import { db, trackerSites } from "@/lib/db";
import { and, eq } from "drizzle-orm";
import { getUserFromNextRequest } from "@/lib/auth";
import { computeFunnelStages, selectFunnel } from "@/lib/tracker/funnel-context";
import { resolveRange } from "@/lib/tracker/date-range";

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
    const funnel = await selectFunnel(siteId, funnelIdParam ? Number(funnelIdParam) : null);

    // 기간
    const { fromYmd, toYmd } = resolveRange(sp.get("from"), sp.get("to"));

    // 세그먼트 필터
    const deviceParam = sp.get("device");
    const device = deviceParam && ["desktop", "mobile", "tablet"].includes(deviceParam) ? deviceParam : null;
    const channel = sp.get("channel");
    const channelModeRaw = sp.get("channelMode");
    const channelMode = (["all", "paid", "organic"] as const).includes(channelModeRaw as "all" | "paid" | "organic")
        ? (channelModeRaw as "all" | "paid" | "organic")
        : "all";

    const stages = await computeFunnelStages({
        siteId,
        excludePaths: (site.excludePaths ?? []) as string[],
        fromYmd,
        toYmd,
        device,
        channel,
        channelMode,
        funnel,
    });

    return NextResponse.json({
        success: true,
        data: {
            funnel: funnel ? { id: funnel.id, name: funnel.name, kind: funnel.kind } : { id: null, name: null, kind: null },
            range: { from: fromYmd, to: toYmd },
            stages,
        },
    });
}
