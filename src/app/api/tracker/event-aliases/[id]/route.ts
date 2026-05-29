import { NextRequest, NextResponse } from "next/server";
import { db, trackerSites, trackerEventAliases } from "@/lib/db";
import { and, eq } from "drizzle-orm";
import { getUserFromNextRequest } from "@/lib/auth";
import { eventAliasUpdateSchema } from "@/lib/tracker/event-alias-validations";

async function loadOwned(id: number, orgId: string) {
    const [row] = await db
        .select({
            alias: trackerEventAliases,
            site: trackerSites,
        })
        .from(trackerEventAliases)
        .innerJoin(trackerSites, eq(trackerSites.id, trackerEventAliases.siteId))
        .where(and(eq(trackerEventAliases.id, id), eq(trackerSites.orgId, orgId)));
    return row ?? null;
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const user = getUserFromNextRequest(req);
    if (!user) return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    if (user.role === "member") return NextResponse.json({ success: false, error: "권한이 없습니다." }, { status: 403 });

    const { id } = await params;
    const aliasId = Number(id);
    if (!aliasId) return NextResponse.json({ success: false, error: "잘못된 ID입니다." }, { status: 400 });

    const body = await req.json().catch(() => null);
    const parsed = eventAliasUpdateSchema.safeParse(body);
    if (!parsed.success) {
        return NextResponse.json({
            success: false,
            error: parsed.error.issues[0]?.message ?? "잘못된 요청입니다.",
        }, { status: 400 });
    }

    const owned = await loadOwned(aliasId, user.orgId);
    if (!owned) return NextResponse.json({ success: false, error: "별칭을 찾을 수 없습니다." }, { status: 404 });

    const [updated] = await db.update(trackerEventAliases)
        .set({ label: parsed.data.label, updatedAt: new Date() })
        .where(eq(trackerEventAliases.id, aliasId))
        .returning();

    return NextResponse.json({
        success: true,
        data: {
            id: updated.id,
            eventType: updated.eventType as "SECTION_VIEW" | "CLICK",
            eventName: updated.eventName,
            label: updated.label,
        },
    });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const user = getUserFromNextRequest(req);
    if (!user) return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    if (user.role === "member") return NextResponse.json({ success: false, error: "권한이 없습니다." }, { status: 403 });

    const { id } = await params;
    const aliasId = Number(id);
    if (!aliasId) return NextResponse.json({ success: false, error: "잘못된 ID입니다." }, { status: 400 });

    const owned = await loadOwned(aliasId, user.orgId);
    if (!owned) return NextResponse.json({ success: false, error: "별칭을 찾을 수 없습니다." }, { status: 404 });

    await db.delete(trackerEventAliases).where(eq(trackerEventAliases.id, aliasId));
    return NextResponse.json({ success: true });
}
