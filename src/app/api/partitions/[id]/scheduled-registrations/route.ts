import { NextRequest, NextResponse } from "next/server";
import { db, scheduledRegistrations } from "@/lib/db";
import { eq, and, sql, inArray } from "drizzle-orm";
import { getActiveUserFromNextRequest } from "@/lib/auth";
import { requirePartitionAccess } from "@/lib/partition-access";
import type { ScheduledRegConfig } from "@/lib/scheduled-registration";

const PAGE_SIZE = 50;
const LIST_STATUSES = ["pending", "skipped"] as const;

function listStatus(value: unknown): (typeof LIST_STATUSES)[number] {
    return value === "skipped" ? "skipped" : "pending";
}

// 대기 목록 + 요약 조회
export async function GET(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const user = await getActiveUserFromNextRequest(req);
    if (!user) {
        return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    }
    const { id } = await params;
    const partitionId = Number(id);
    if (!partitionId) {
        return NextResponse.json({ success: false, error: "파티션 ID가 필요합니다." }, { status: 400 });
    }

    const access = await requirePartitionAccess(user, partitionId, "read");
    if (!access.ok) {
        return NextResponse.json({ success: false, error: access.error }, { status: access.status });
    }
    const partition = access.partition;

    const page = Math.max(1, Math.floor(Number(req.nextUrl.searchParams.get("page")) || 1));
    // 대기(pending) 또는 중복으로 건너뛴 행(skipped) 보기(UX-078)
    const status = listStatus(req.nextUrl.searchParams.get("status"));

    const counts = await db
        .select({ status: scheduledRegistrations.status, total: sql<number>`COUNT(*)::int` })
        .from(scheduledRegistrations)
        .where(and(eq(scheduledRegistrations.partitionId, partitionId), inArray(scheduledRegistrations.status, [...LIST_STATUSES])))
        .groupBy(scheduledRegistrations.status);
    const total = counts.find((c) => c.status === status)?.total ?? 0;
    const skippedTotal = counts.find((c) => c.status === "skipped")?.total ?? 0;
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
        .where(and(eq(scheduledRegistrations.partitionId, partitionId), eq(scheduledRegistrations.status, status)))
        .orderBy(scheduledRegistrations.id)
        .limit(PAGE_SIZE)
        .offset((safePage - 1) * PAGE_SIZE);

    const config = (partition.scheduledRegistrationConfig as ScheduledRegConfig | null) ?? null;

    return NextResponse.json({
        success: true,
        data: { items, total, page: safePage, totalPages, pageSize: PAGE_SIZE, status, skippedTotal, config },
    });
}

// 대기 행 삭제 — body.ids 있으면 해당 항목만, 없으면 그 상태(기본 pending) 전체 삭제
export async function DELETE(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const user = await getActiveUserFromNextRequest(req);
    if (!user) {
        return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    }
    const { id } = await params;
    const partitionId = Number(id);
    if (!partitionId) {
        return NextResponse.json({ success: false, error: "파티션 ID가 필요합니다." }, { status: 400 });
    }

    const access = await requirePartitionAccess(user, partitionId, "delete");
    if (!access.ok) {
        return NextResponse.json({ success: false, error: access.error }, { status: access.status });
    }

    const body = await req.json().catch(() => ({}));
    const ids: number[] | undefined = Array.isArray(body?.ids) ? body.ids.map(Number).filter(Boolean) : undefined;

    const base = and(
        eq(scheduledRegistrations.partitionId, partitionId),
        eq(scheduledRegistrations.status, listStatus(body?.status)),
    );
    const deleted = await db
        .delete(scheduledRegistrations)
        .where(ids && ids.length > 0 ? and(base, inArray(scheduledRegistrations.id, ids)) : base)
        .returning({ id: scheduledRegistrations.id });

    return NextResponse.json({ success: true, data: { deleted: deleted.length } });
}
