import { NextRequest, NextResponse } from "next/server";
import { db, recordAutoEnrichRules, partitions, workspaces } from "@/lib/db";
import { eq, and } from "drizzle-orm";
import { getActiveUserFromNextRequest } from "@/lib/auth";

export async function GET(req: NextRequest) {
    const user = await getActiveUserFromNextRequest(req);
    if (!user) {
        return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    }

    try {
        const partitionId = Number(req.nextUrl.searchParams.get("partitionId"));
        if (!partitionId) {
            return NextResponse.json({ success: false, error: "partitionId는 필수입니다." }, { status: 400 });
        }

        const [partition] = await db
            .select()
            .from(partitions)
            .innerJoin(workspaces, eq(workspaces.id, partitions.workspaceId))
            .where(and(eq(partitions.id, partitionId), eq(workspaces.orgId, user.orgId)))
            .limit(1);

        if (!partition) {
            return NextResponse.json({ success: false, error: "파티션을 찾을 수 없습니다." }, { status: 404 });
        }

        const rules = await db
            .select()
            .from(recordAutoEnrichRules)
            .where(eq(recordAutoEnrichRules.partitionId, partitionId));

        return NextResponse.json({ success: true, data: rules });
    } catch (error) {
        console.error("Auto enrich rules fetch error:", error);
        return NextResponse.json({ success: false, error: "서버 오류가 발생했습니다." }, { status: 500 });
    }
}

export async function POST(req: NextRequest) {
    const user = await getActiveUserFromNextRequest(req);
    if (!user) {
        return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    }

    try {
        const { partitionId, searchField, targetFields } = await req.json();

        if (!partitionId || !searchField || !targetFields?.length) {
            return NextResponse.json({
                success: false,
                error: "partitionId, searchField, targetFields는 필수입니다.",
            }, { status: 400 });
        }

        const [partition] = await db
            .select()
            .from(partitions)
            .innerJoin(workspaces, eq(workspaces.id, partitions.workspaceId))
            .where(and(eq(partitions.id, partitionId), eq(workspaces.orgId, user.orgId)))
            .limit(1);

        if (!partition) {
            return NextResponse.json({ success: false, error: "파티션을 찾을 수 없습니다." }, { status: 404 });
        }

        const [created] = await db
            .insert(recordAutoEnrichRules)
            .values({
                orgId: user.orgId,
                partitionId,
                searchField,
                targetFields,
            })
            .returning();

        return NextResponse.json({ success: true, data: created }, { status: 201 });
    } catch (error) {
        console.error("Auto enrich rule create error:", error);
        return NextResponse.json({ success: false, error: "서버 오류가 발생했습니다." }, { status: 500 });
    }
}
