import { NextRequest, NextResponse } from "next/server";
import { db, trackerSites, trackerEventAliases } from "@/lib/db";
import { and, eq } from "drizzle-orm";
import { getActiveUserFromNextRequest } from "@/lib/auth";
import { eventAliasCreateSchema } from "@/lib/tracker/event-alias-validations";
import { clampEventAliasPage, eventAliasCountSql, eventAliasPageSql, parseEventAliasListQuery } from "@/lib/tracker/event-alias-list";
import type { EventAliasRow } from "@/components/tracker/types/event-alias";

/**
 * GET /api/tracker/event-aliases?siteId=N&type=&q=&page=&pageSize=
 *
 * 사이트의 실제 발생 (event_type, event_name) 목록 + 등록된 alias label을 LEFT JOIN으로 반환(전체 기간).
 * 타입·검색(이름·라벨) 필터 후 타입 → 발생수 desc → 이름 순으로 페이지 응답(PaginatedResponse).
 */
export async function GET(req: NextRequest) {
    const user = await getActiveUserFromNextRequest(req);
    if (!user) return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });

    const siteId = Number(req.nextUrl.searchParams.get("siteId"));
    if (!siteId) return NextResponse.json({ success: false, error: "siteId가 필요합니다." }, { status: 400 });

    const [site] = await db.select().from(trackerSites)
        .where(and(eq(trackerSites.id, siteId), eq(trackerSites.orgId, user.orgId)));
    if (!site) return NextResponse.json({ success: false, error: "트래커를 찾을 수 없습니다." }, { status: 404 });

    // 발생한 이벤트(SECTION_VIEW/CLICK/CUSTOM) + 등록된 모든 alias의 합집합.
    // 등록된 alias는 아직 발생 안 했어도(occurrences=0) 노출 — CUSTOM 이벤트를 미리 정의하고
    // 사이트에 심기 전이라도 퍼널/코드 안내에서 쓸 수 있게.
    // 타입·검색을 먼저 적용하고 페이지로 나눠 저빈도·등록 별칭도 모두 찾아 수정·삭제할 수 있게 한다.
    const requested = parseEventAliasListQuery(req.nextUrl.searchParams);
    const [{ total }] = (await db.execute(eventAliasCountSql(siteId, requested))) as unknown as Array<{ total: number }>;
    const query = clampEventAliasPage(requested, total);
    const rows = (await db.execute(eventAliasPageSql(siteId, query))) as unknown as EventAliasRow[];

    return NextResponse.json({
        success: true,
        data: rows,
        total,
        page: query.page,
        pageSize: query.pageSize,
        totalPages: Math.ceil(total / query.pageSize),
    });
}

/**
 * POST /api/tracker/event-aliases
 * body: { siteId, eventType, eventName, label }
 * UNIQUE 위반 시 409.
 */
export async function POST(req: NextRequest) {
    const user = await getActiveUserFromNextRequest(req);
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
                eventType: created.eventType as "SECTION_VIEW" | "CLICK" | "CUSTOM",
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
