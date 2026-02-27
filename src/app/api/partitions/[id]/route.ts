import { NextRequest, NextResponse } from "next/server";
import { db, partitions, workspaces, records } from "@/lib/db";
import { eq, and, count } from "drizzle-orm";
import { getUserFromNextRequest } from "@/lib/auth";

async function verifyOwnership(partitionId: number, orgId: string) {
    const result = await db
        .select({ partition: partitions, wsOrgId: workspaces.orgId })
        .from(partitions)
        .innerJoin(workspaces, eq(partitions.workspaceId, workspaces.id))
        .where(and(eq(partitions.id, partitionId), eq(workspaces.orgId, orgId)));
    return result[0] ?? null;
}

export async function GET(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const user = getUserFromNextRequest(req);
    if (!user) {
        return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    }
    if (user.role === "member") {
        return NextResponse.json({ success: false, error: "접근 권한이 없습니다." }, { status: 403 });
    }

    const { id } = await params;
    const partitionId = Number(id);
    if (!partitionId || isNaN(partitionId)) {
        return NextResponse.json({ success: false, error: "잘못된 파티션 ID입니다." }, { status: 400 });
    }

    try {
        const access = await verifyOwnership(partitionId, user.orgId);
        if (!access) {
            return NextResponse.json({ success: false, error: "파티션을 찾을 수 없습니다." }, { status: 404 });
        }

        const [result] = await db
            .select({ count: count() })
            .from(records)
            .where(eq(records.partitionId, partitionId));

        return NextResponse.json({
            success: true,
            data: {
                ...access.partition,
                recordCount: result.count,
            },
        });
    } catch (error) {
        console.error("Partition stats error:", error);
        return NextResponse.json({ success: false, error: "서버 오류가 발생했습니다." }, { status: 500 });
    }
}

export async function PATCH(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const user = getUserFromNextRequest(req);
    if (!user) {
        return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    }
    if (user.role === "member") {
        return NextResponse.json({ success: false, error: "접근 권한이 없습니다." }, { status: 403 });
    }

    const { id } = await params;
    const partitionId = Number(id);
    if (!partitionId || isNaN(partitionId)) {
        return NextResponse.json({ success: false, error: "잘못된 파티션 ID입니다." }, { status: 400 });
    }

    const { name, useDistributionOrder, maxDistributionOrder, distributionDefaults } = await req.json();

    // name-only 업데이트가 아닌 경우에도 지원
    if (name !== undefined && (!name || !String(name).trim())) {
        return NextResponse.json({ success: false, error: "이름을 입력해주세요." }, { status: 400 });
    }

    try {
        const access = await verifyOwnership(partitionId, user.orgId);
        if (!access) {
            return NextResponse.json({ success: false, error: "파티션을 찾을 수 없습니다." }, { status: 404 });
        }

        const updateData: Record<string, unknown> = { updatedAt: new Date() };

        if (name !== undefined) {
            updateData.name = String(name).trim();
        }

        if (useDistributionOrder !== undefined) {
            updateData.useDistributionOrder = useDistributionOrder ? 1 : 0;
        }

        if (maxDistributionOrder !== undefined) {
            const max = Number(maxDistributionOrder);
            if (max < 1 || max > 99) {
                return NextResponse.json({ success: false, error: "분배 순번은 1~99 범위여야 합니다." }, { status: 400 });
            }
            updateData.maxDistributionOrder = max;
            // lastAssignedOrder가 새 max를 초과하면 리셋
            if (access.partition.lastAssignedOrder > max) {
                updateData.lastAssignedOrder = 0;
            }
        }

        if (distributionDefaults !== undefined) {
            updateData.distributionDefaults = distributionDefaults;
        }

        const [updated] = await db
            .update(partitions)
            .set(updateData)
            .where(eq(partitions.id, partitionId))
            .returning();

        return NextResponse.json({ success: true, data: updated });
    } catch (error) {
        console.error("Partition update error:", error);
        return NextResponse.json({ success: false, error: "서버 오류가 발생했습니다." }, { status: 500 });
    }
}

export async function DELETE(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const user = getUserFromNextRequest(req);
    if (!user) {
        return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    }
    if (user.role === "member") {
        return NextResponse.json({ success: false, error: "접근 권한이 없습니다." }, { status: 403 });
    }

    const { id } = await params;
    const partitionId = Number(id);
    if (!partitionId || isNaN(partitionId)) {
        return NextResponse.json({ success: false, error: "잘못된 파티션 ID입니다." }, { status: 400 });
    }

    try {
        const access = await verifyOwnership(partitionId, user.orgId);
        if (!access) {
            return NextResponse.json({ success: false, error: "파티션을 찾을 수 없습니다." }, { status: 404 });
        }

        await db.delete(partitions).where(eq(partitions.id, partitionId));

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error("Partition delete error:", error);
        return NextResponse.json({ success: false, error: "서버 오류가 발생했습니다." }, { status: 500 });
    }
}
