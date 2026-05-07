import { NextRequest, NextResponse } from "next/server";
import { db, trackerSites, trackerVisitors } from "@/lib/db";
import { eq, and, desc, lt, isNotNull, isNull, ilike, or } from "drizzle-orm";
import { getUserFromNextRequest } from "@/lib/auth";

const PAGE_SIZE = 50;

export async function GET(req: NextRequest) {
    const user = getUserFromNextRequest(req);
    if (!user) {
        return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    }

    const sp = req.nextUrl.searchParams;
    const siteIdStr = sp.get("siteId");
    if (!siteIdStr) {
        return NextResponse.json({ success: false, error: "siteId가 필요합니다." }, { status: 400 });
    }
    const siteId = Number(siteIdStr);

    const [site] = await db
        .select()
        .from(trackerSites)
        .where(and(eq(trackerSites.id, siteId), eq(trackerSites.orgId, user.orgId)));
    if (!site) {
        return NextResponse.json({ success: false, error: "트래커를 찾을 수 없습니다." }, { status: 404 });
    }

    const cursor = sp.get("cursor"); // ISO string of lastSeenAt of last item
    const q = sp.get("q")?.trim();
    const hasRecord = sp.get("hasRecord"); // "true" | "false" | null

    const conditions = [eq(trackerVisitors.siteId, site.id)];
    if (cursor) {
        const date = new Date(cursor);
        if (!isNaN(date.getTime())) {
            conditions.push(lt(trackerVisitors.lastSeenAt, date));
        }
    }
    if (hasRecord === "true") {
        conditions.push(isNotNull(trackerVisitors.recordId));
    } else if (hasRecord === "false") {
        conditions.push(isNull(trackerVisitors.recordId));
    }
    if (q) {
        const term = `%${q}%`;
        const search = or(
            ilike(trackerVisitors.email, term),
            ilike(trackerVisitors.name, term),
            ilike(trackerVisitors.visitorId, term),
        );
        if (search) conditions.push(search);
    }

    const rows = await db
        .select()
        .from(trackerVisitors)
        .where(and(...conditions))
        .orderBy(desc(trackerVisitors.lastSeenAt))
        .limit(PAGE_SIZE + 1);

    const hasMore = rows.length > PAGE_SIZE;
    const data = hasMore ? rows.slice(0, PAGE_SIZE) : rows;
    const nextCursor = hasMore ? data[data.length - 1].lastSeenAt.toISOString() : null;

    return NextResponse.json({ success: true, data, nextCursor });
}
