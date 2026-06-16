import { NextRequest, NextResponse } from "next/server";
import { db, partitions, workspaces, scheduledRegistrations } from "@/lib/db";
import { eq, and, sql, inArray } from "drizzle-orm";
import { getUserFromNextRequest } from "@/lib/auth";
import type { ScheduledRegConfig } from "@/lib/scheduled-registration";

const PAGE_SIZE = 50;

async function verifyPartition(orgId: string, partitionId: number) {
    const [access] = await db
        .select({ partition: partitions })
        .from(partitions)
        .innerJoin(workspaces, eq(partitions.workspaceId, workspaces.id))
        .where(and(eq(partitions.id, partitionId), eq(workspaces.orgId, orgId)));
    return access?.partition ?? null;
}

// 대기 목록 + 요약 조회
export async function GET(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const user = getUserFromNextRequest(req);
    if (!user) {
        return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    }
    const { id } = await params;
    const partitionId = Number(id);
    if (!partitionId) {
        return NextResponse.json({ success: false, error: "파티션 ID가 필요합니다." }, { status: 400 });
    }

    const partition = await verifyPartition(user.orgId, partitionId);
    if (!partition) {
        return NextResponse.json({ success: false, error: "파티션을 찾을 수 없습니다." }, { status: 404 });
    }

    const page = Math.max(1, Number(req.nextUrl.searchParams.get("page")) || 1);

    const [countRow] = await db
        .select({ total: sql<number>`COUNT(*)::int` })
        .from(scheduledRegistrations)
        .where(and(eq(scheduledRegistrations.partitionId, partitionId), eq(scheduledRegistrations.status, "pending")));
    const total = countRow?.total ?? 0;
    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    const safePage = Math.min(page, totalPages);

    const items = await db
        .select({
            id: scheduledRegistrations.id,
            data: scheduledRegistrations.data,
            sourceFileName: scheduledRegistrations.sourceFileName,
            createdAt: scheduledRegistrations.createdAt,
        })
        .from(scheduledRegistrations)
        .where(and(eq(scheduledRegistrations.partitionId, partitionId), eq(scheduledRegistrations.status, "pending")))
        .orderBy(scheduledRegistrations.id)
        .limit(PAGE_SIZE)
        .offset((safePage - 1) * PAGE_SIZE);

    const config = (partition.scheduledRegistrationConfig as ScheduledRegConfig | null) ?? null;

    return NextResponse.json({
        success: true,
        data: { items, total, page: safePage, totalPages, config },
    });
}

// 대기 행 삭제 — body.ids 있으면 해당 항목만, 없으면 전체 pending 삭제
export async function DELETE(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const user = getUserFromNextRequest(req);
    if (!user) {
        return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    }
    const { id } = await params;
    const partitionId = Number(id);
    if (!partitionId) {
        return NextResponse.json({ success: false, error: "파티션 ID가 필요합니다." }, { status: 400 });
    }

    const partition = await verifyPartition(user.orgId, partitionId);
    if (!partition) {
        return NextResponse.json({ success: false, error: "파티션을 찾을 수 없습니다." }, { status: 404 });
    }

    const body = await req.json().catch(() => ({}));
    const ids: number[] | undefined = Array.isArray(body?.ids) ? body.ids.map(Number).filter(Boolean) : undefined;

    const base = and(
        eq(scheduledRegistrations.partitionId, partitionId),
        eq(scheduledRegistrations.status, "pending"),
    );
    const deleted = await db
        .delete(scheduledRegistrations)
        .where(ids && ids.length > 0 ? and(base, inArray(scheduledRegistrations.id, ids)) : base)
        .returning({ id: scheduledRegistrations.id });

    return NextResponse.json({ success: true, data: { deleted: deleted.length } });
}
