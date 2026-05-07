import { NextRequest, NextResponse } from "next/server";
import {
    db,
    trackerSites,
    workspaces,
    fieldTypes,
    fieldDefinitions,
    partitions,
} from "@/lib/db";
import { eq, and } from "drizzle-orm";
import { getUserFromNextRequest } from "@/lib/auth";
import { createSiteSchema } from "@/lib/tracker/validations";
import { generateApiKey } from "@/lib/tracker/api-key";
import { TRACKER_SYSTEM_FIELDS, TRACKER_FIELD_TYPE_NAME_PREFIX } from "@/lib/tracker/system-fields";

export async function GET(req: NextRequest) {
    const user = getUserFromNextRequest(req);
    if (!user) {
        return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    }

    const workspaceIdStr = req.nextUrl.searchParams.get("workspaceId");
    if (!workspaceIdStr) {
        return NextResponse.json({ success: false, error: "workspaceId가 필요합니다." }, { status: 400 });
    }
    const workspaceId = Number(workspaceIdStr);

    // 권한 체크 (워크스페이스가 같은 org에 속해야 함)
    const [ws] = await db
        .select()
        .from(workspaces)
        .where(and(eq(workspaces.id, workspaceId), eq(workspaces.orgId, user.orgId)));
    if (!ws) {
        return NextResponse.json({ success: false, error: "워크스페이스를 찾을 수 없습니다." }, { status: 404 });
    }

    const [site] = await db
        .select()
        .from(trackerSites)
        .where(eq(trackerSites.workspaceId, workspaceId));

    return NextResponse.json({ success: true, data: site ?? null });
}

export async function POST(req: NextRequest) {
    const user = getUserFromNextRequest(req);
    if (!user) {
        return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    }
    if (user.role === "member") {
        return NextResponse.json({ success: false, error: "권한이 없습니다." }, { status: 403 });
    }

    const body = await req.json().catch(() => null);
    const workspaceId = Number(body?.workspaceId);
    if (!workspaceId) {
        return NextResponse.json({ success: false, error: "workspaceId가 필요합니다." }, { status: 400 });
    }

    const parsed = createSiteSchema.safeParse(body);
    if (!parsed.success) {
        return NextResponse.json(
            { success: false, error: parsed.error.issues[0]?.message ?? "잘못된 요청" },
            { status: 400 },
        );
    }

    const [ws] = await db
        .select()
        .from(workspaces)
        .where(and(eq(workspaces.id, workspaceId), eq(workspaces.orgId, user.orgId)));
    if (!ws) {
        return NextResponse.json({ success: false, error: "워크스페이스를 찾을 수 없습니다." }, { status: 404 });
    }

    // 워크스페이스당 1개 제약
    const [existing] = await db
        .select()
        .from(trackerSites)
        .where(eq(trackerSites.workspaceId, workspaceId));
    if (existing) {
        return NextResponse.json(
            { success: false, error: "이미 트래커가 존재합니다." },
            { status: 409 },
        );
    }

    const apiKey = generateApiKey();

    try {
        const created = await db.transaction(async (tx) => {
            // 1) field_type 생성 ("[트래커] 디자이너하이어" 같은 이름)
            const [ft] = await tx
                .insert(fieldTypes)
                .values({
                    orgId: user.orgId,
                    name: `${TRACKER_FIELD_TYPE_NAME_PREFIX}${parsed.data.name}`,
                    description: "트래커 자동 생성",
                    icon: "activity",
                })
                .returning();

            // 2) 시스템 field_definitions 일괄 생성
            await tx.insert(fieldDefinitions).values(
                TRACKER_SYSTEM_FIELDS.map((f, i) => ({
                    workspaceId,
                    fieldTypeId: ft.id,
                    key: f.key,
                    label: f.label,
                    fieldType: f.fieldType,
                    category: "트래커",
                    sortOrder: i,
                    isSystem: 1,
                    isSortable: f.isSortable,
                    isGroupable: f.isGroupable ?? 0,
                    options: f.options ?? null,
                })),
            );

            // 3) 파티션 생성 (records UI에 자연스럽게 노출됨)
            const [partition] = await tx
                .insert(partitions)
                .values({
                    workspaceId,
                    name: parsed.data.name,
                    fieldTypeId: ft.id,
                    displayOrder: 999,
                    visibleFields: [
                        "tracker_email",
                        "tracker_name",
                        "tracker_total_visits",
                        "tracker_last_seen",
                        "tracker_device_type",
                        "tracker_last_utm_source",
                        "tracker_last_event",
                    ],
                })
                .returning();

            // 4) tracker_sites 생성 (위에서 만든 fieldType, partition 연결)
            const [site] = await tx
                .insert(trackerSites)
                .values({
                    orgId: user.orgId,
                    workspaceId,
                    name: parsed.data.name,
                    apiKey,
                    domains: parsed.data.domains,
                    fieldTypeId: ft.id,
                    partitionId: partition.id,
                })
                .returning();

            return site;
        });

        return NextResponse.json({ success: true, data: created }, { status: 201 });
    } catch (err) {
        console.error("Tracker create error:", err);
        return NextResponse.json(
            { success: false, error: "트래커 생성 실패" },
            { status: 500 },
        );
    }
}
