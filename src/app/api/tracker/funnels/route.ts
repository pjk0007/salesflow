import { NextRequest, NextResponse } from "next/server";
import { db, trackerSites, trackerFunnels } from "@/lib/db";
import { and, eq, desc } from "drizzle-orm";
import { getUserFromNextRequest } from "@/lib/auth";
import { funnelCreateSchema } from "@/lib/tracker/funnel-validations";
import { validateUserStages } from "@/lib/tracker/funnel-analytics";

// GET /api/tracker/funnels?siteId=N — 사이트의 퍼널 목록
export async function GET(req: NextRequest) {
    const user = getUserFromNextRequest(req);
    if (!user) return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });

    const siteId = Number(req.nextUrl.searchParams.get("siteId"));
    if (!siteId) return NextResponse.json({ success: false, error: "siteId가 필요합니다." }, { status: 400 });

    const [site] = await db.select().from(trackerSites)
        .where(and(eq(trackerSites.id, siteId), eq(trackerSites.orgId, user.orgId)));
    if (!site) return NextResponse.json({ success: false, error: "트래커를 찾을 수 없습니다." }, { status: 404 });

    const rows = await db.select().from(trackerFunnels)
        .where(eq(trackerFunnels.siteId, siteId))
        .orderBy(desc(trackerFunnels.isDefault), desc(trackerFunnels.createdAt));

    return NextResponse.json({ success: true, data: rows });
}

// POST /api/tracker/funnels — 신규 퍼널 생성
export async function POST(req: NextRequest) {
    const user = getUserFromNextRequest(req);
    if (!user) return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    if (user.role === "member") return NextResponse.json({ success: false, error: "권한이 없습니다." }, { status: 403 });

    const body = await req.json().catch(() => null);
    const parsed = funnelCreateSchema.safeParse(body);
    if (!parsed.success) {
        return NextResponse.json({ success: false, error: parsed.error.issues[0]?.message ?? "잘못된 요청" }, { status: 400 });
    }

    const [site] = await db.select().from(trackerSites)
        .where(and(eq(trackerSites.id, parsed.data.siteId), eq(trackerSites.orgId, user.orgId)));
    if (!site) return NextResponse.json({ success: false, error: "트래커를 찾을 수 없습니다." }, { status: 404 });

    const stageErr = validateUserStages(parsed.data.stages);
    if (stageErr) return NextResponse.json({ success: false, error: stageErr }, { status: 400 });

    const [created] = await db.insert(trackerFunnels).values({
        orgId: user.orgId,
        siteId: parsed.data.siteId,
        name: parsed.data.name,
        stages: parsed.data.stages,
        isDefault: parsed.data.isDefault ? 1 : 0,
    }).returning();

    // isDefault=1로 만들었으면 같은 사이트의 다른 퍼널 isDefault=0
    if (parsed.data.isDefault) {
        await db.update(trackerFunnels)
            .set({ isDefault: 0 })
            .where(and(eq(trackerFunnels.siteId, parsed.data.siteId), eq(trackerFunnels.isDefault, 1)))
            .returning();
        await db.update(trackerFunnels).set({ isDefault: 1 }).where(eq(trackerFunnels.id, created.id));
    }

    return NextResponse.json({ success: true, data: created }, { status: 201 });
}
