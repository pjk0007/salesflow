import { NextRequest, NextResponse } from "next/server";
import { db, trackerSites, workspaces } from "@/lib/db";
import { eq, and } from "drizzle-orm";
import { getUserFromNextRequest } from "@/lib/auth";
import { createSiteSchema } from "@/lib/tracker/validations";
import { generateApiKey } from "@/lib/tracker/api-key";

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
            const [site] = await tx
                .insert(trackerSites)
                .values({
                    orgId: user.orgId,
                    workspaceId,
                    name: parsed.data.name,
                    apiKey,
                    domains: parsed.data.domains,
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
