import { NextRequest, NextResponse } from "next/server";
import { db, trackerSites } from "@/lib/db";
import { eq, and } from "drizzle-orm";
import { getUserFromNextRequest } from "@/lib/auth";
import { updateSiteSchema } from "@/lib/tracker/validations";

async function getSiteForUser(id: number, orgId: string) {
    const [site] = await db
        .select()
        .from(trackerSites)
        .where(and(eq(trackerSites.id, id), eq(trackerSites.orgId, orgId)));
    return site ?? null;
}

export async function GET(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> },
) {
    const user = getUserFromNextRequest(req);
    if (!user) {
        return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    }
    const { id } = await params;
    const site = await getSiteForUser(Number(id), user.orgId);
    if (!site) {
        return NextResponse.json({ success: false, error: "트래커를 찾을 수 없습니다." }, { status: 404 });
    }
    return NextResponse.json({ success: true, data: site });
}

export async function PATCH(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> },
) {
    const user = getUserFromNextRequest(req);
    if (!user) {
        return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    }
    if (user.role === "member") {
        return NextResponse.json({ success: false, error: "권한이 없습니다." }, { status: 403 });
    }

    const { id } = await params;
    const site = await getSiteForUser(Number(id), user.orgId);
    if (!site) {
        return NextResponse.json({ success: false, error: "트래커를 찾을 수 없습니다." }, { status: 404 });
    }

    const body = await req.json().catch(() => null);
    const parsed = updateSiteSchema.safeParse(body);
    if (!parsed.success) {
        return NextResponse.json(
            { success: false, error: parsed.error.issues[0]?.message ?? "잘못된 요청" },
            { status: 400 },
        );
    }

    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (parsed.data.name !== undefined) updates.name = parsed.data.name;
    if (parsed.data.domains !== undefined) updates.domains = parsed.data.domains;
    if (parsed.data.isActive !== undefined) updates.isActive = parsed.data.isActive;

    const [updated] = await db
        .update(trackerSites)
        .set(updates)
        .where(eq(trackerSites.id, site.id))
        .returning();

    return NextResponse.json({ success: true, data: updated });
}

export async function DELETE(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> },
) {
    const user = getUserFromNextRequest(req);
    if (!user) {
        return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    }
    if (user.role === "member") {
        return NextResponse.json({ success: false, error: "권한이 없습니다." }, { status: 403 });
    }

    const { id } = await params;
    const site = await getSiteForUser(Number(id), user.orgId);
    if (!site) {
        return NextResponse.json({ success: false, error: "트래커를 찾을 수 없습니다." }, { status: 404 });
    }

    await db.delete(trackerSites).where(eq(trackerSites.id, site.id));

    return NextResponse.json({ success: true });
}
