import { NextRequest, NextResponse } from "next/server";
import { db, trackerSites, trackerFunnels } from "@/lib/db";
import { and, eq, ne } from "drizzle-orm";
import { getUserFromNextRequest } from "@/lib/auth";
import { funnelUpdateSchema } from "@/lib/tracker/funnel-validations";
import { validateUserStages } from "@/lib/tracker/funnel-analytics";

async function loadFunnel(funnelId: number, orgId: string) {
    const [funnel] = await db.select().from(trackerFunnels).where(eq(trackerFunnels.id, funnelId));
    if (!funnel || funnel.orgId !== orgId) return null;
    return funnel;
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const user = getUserFromNextRequest(req);
    if (!user) return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    const { id } = await params;
    const funnel = await loadFunnel(Number(id), user.orgId);
    if (!funnel) return NextResponse.json({ success: false, error: "퍼널을 찾을 수 없습니다." }, { status: 404 });
    return NextResponse.json({ success: true, data: funnel });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const user = getUserFromNextRequest(req);
    if (!user) return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    if (user.role === "member") return NextResponse.json({ success: false, error: "권한이 없습니다." }, { status: 403 });

    const { id } = await params;
    const funnelId = Number(id);
    const funnel = await loadFunnel(funnelId, user.orgId);
    if (!funnel) return NextResponse.json({ success: false, error: "퍼널을 찾을 수 없습니다." }, { status: 404 });

    const body = await req.json().catch(() => null);
    const parsed = funnelUpdateSchema.safeParse(body);
    if (!parsed.success) {
        return NextResponse.json({ success: false, error: parsed.error.issues[0]?.message ?? "잘못된 요청" }, { status: 400 });
    }

    if (parsed.data.stages) {
        const stageErr = validateUserStages(parsed.data.stages);
        if (stageErr) return NextResponse.json({ success: false, error: stageErr }, { status: 400 });
    }

    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (parsed.data.name !== undefined) updates.name = parsed.data.name;
    if (parsed.data.kind !== undefined) updates.kind = parsed.data.kind;
    if (parsed.data.stages !== undefined) updates.stages = parsed.data.stages;
    if (parsed.data.isDefault !== undefined) updates.isDefault = parsed.data.isDefault ? 1 : 0;

    // isDefault=1로 바뀌면 같은 사이트 다른 퍼널 isDefault=0
    if (parsed.data.isDefault) {
        await db.update(trackerFunnels)
            .set({ isDefault: 0 })
            .where(and(eq(trackerFunnels.siteId, funnel.siteId), ne(trackerFunnels.id, funnelId)));
    }

    const [updated] = await db.update(trackerFunnels).set(updates).where(eq(trackerFunnels.id, funnelId)).returning();
    return NextResponse.json({ success: true, data: updated });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const user = getUserFromNextRequest(req);
    if (!user) return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    if (user.role === "member") return NextResponse.json({ success: false, error: "권한이 없습니다." }, { status: 403 });

    const { id } = await params;
    const funnelId = Number(id);

    // 사이트 격리 확인
    const [funnel] = await db.select({ orgId: trackerFunnels.orgId, siteId: trackerFunnels.siteId })
        .from(trackerFunnels).where(eq(trackerFunnels.id, funnelId));
    if (!funnel) return NextResponse.json({ success: false, error: "퍼널을 찾을 수 없습니다." }, { status: 404 });
    const [site] = await db.select().from(trackerSites)
        .where(and(eq(trackerSites.id, funnel.siteId), eq(trackerSites.orgId, user.orgId)));
    if (!site) return NextResponse.json({ success: false, error: "권한이 없습니다." }, { status: 403 });

    await db.delete(trackerFunnels).where(eq(trackerFunnels.id, funnelId));
    return NextResponse.json({ success: true });
}
