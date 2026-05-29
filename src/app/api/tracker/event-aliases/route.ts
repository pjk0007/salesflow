import { NextRequest, NextResponse } from "next/server";
import { db, trackerSites, trackerEventAliases } from "@/lib/db";
import { and, eq, sql } from "drizzle-orm";
import { getUserFromNextRequest } from "@/lib/auth";
import { eventAliasCreateSchema } from "@/lib/tracker/event-alias-validations";

/**
 * GET /api/tracker/event-aliases?siteId=N
 *
 * 사이트의 실제 발생 (event_type, event_name) 목록 + 등록된 alias label을 LEFT JOIN으로 반환.
 * 발생수 desc 정렬 + 200건 LIMIT (Design 결정대로 전체 기간).
 */
export async function GET(req: NextRequest) {
    const user = getUserFromNextRequest(req);
    if (!user) return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });

    const siteId = Number(req.nextUrl.searchParams.get("siteId"));
    if (!siteId) return NextResponse.json({ success: false, error: "siteId가 필요합니다." }, { status: 400 });

    const [site] = await db.select().from(trackerSites)
        .where(and(eq(trackerSites.id, siteId), eq(trackerSites.orgId, user.orgId)));
    if (!site) return NextResponse.json({ success: false, error: "트래커를 찾을 수 없습니다." }, { status: 404 });

    const rows = (await db.execute(sql`
        SELECT
            a.id,
            ev.event_type AS "eventType",
            ev.event_name AS "eventName",
            a.label,
            COUNT(*)::int AS occurrences
        FROM tracker_events ev
        LEFT JOIN tracker_event_aliases a
            ON a.site_id = ev.site_id
           AND a.event_type = ev.event_type
           AND a.event_name = ev.event_name
        WHERE ev.site_id = ${siteId}
          AND ev.event_type IN ('SECTION_VIEW', 'CLICK')
          AND ev.event_name IS NOT NULL
        GROUP BY a.id, ev.event_type, ev.event_name, a.label
        ORDER BY ev.event_type, occurrences DESC
        LIMIT 200
    `)) as unknown as Array<{
        id: number | null;
        eventType: "SECTION_VIEW" | "CLICK";
        eventName: string;
        label: string | null;
        occurrences: number;
    }>;

    return NextResponse.json({ success: true, data: rows });
}

/**
 * POST /api/tracker/event-aliases
 * body: { siteId, eventType, eventName, label }
 * UNIQUE 위반 시 409.
 */
export async function POST(req: NextRequest) {
    const user = getUserFromNextRequest(req);
    if (!user) return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    if (user.role === "member") return NextResponse.json({ success: false, error: "권한이 없습니다." }, { status: 403 });

    const body = await req.json().catch(() => null);
    const parsed = eventAliasCreateSchema.safeParse(body);
    if (!parsed.success) {
        return NextResponse.json({
            success: false,
            error: parsed.error.issues[0]?.message ?? "잘못된 요청입니다.",
        }, { status: 400 });
    }

    const [site] = await db.select().from(trackerSites)
        .where(and(eq(trackerSites.id, parsed.data.siteId), eq(trackerSites.orgId, user.orgId)));
    if (!site) return NextResponse.json({ success: false, error: "트래커를 찾을 수 없습니다." }, { status: 404 });

    try {
        const [created] = await db.insert(trackerEventAliases).values({
            orgId: user.orgId,
            siteId: parsed.data.siteId,
            eventType: parsed.data.eventType,
            eventName: parsed.data.eventName,
            label: parsed.data.label,
        }).returning();

        return NextResponse.json({
            success: true,
            data: {
                id: created.id,
                eventType: created.eventType as "SECTION_VIEW" | "CLICK",
                eventName: created.eventName,
                label: created.label,
            },
        }, { status: 201 });
    } catch (err) {
        const message = err instanceof Error ? err.message : "";
        if (message.includes("tracker_event_aliases_site_type_name_unique")) {
            return NextResponse.json({
                success: false,
                error: "이미 등록된 이벤트입니다.",
            }, { status: 409 });
        }
        console.error("event-alias create error:", { message });
        return NextResponse.json({ success: false, error: "별칭 등록에 실패했습니다." }, { status: 500 });
    }
}
