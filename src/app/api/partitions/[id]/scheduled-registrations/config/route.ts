import { NextRequest, NextResponse } from "next/server";
import { db, partitions } from "@/lib/db";
import { eq } from "drizzle-orm";
import { getUserFromNextRequest } from "@/lib/auth";
import { requirePartitionAccess } from "@/lib/partition-access";
import { normalizeScheduledConfig } from "@/lib/scheduled-registration";

/**
 * 예약 등록 설정 전용 경로.
 *
 * 파티션 PATCH(/api/partitions/[id])는 파티션 전반을 바꾸는 API라 member에게 열 수 없다.
 * 여기는 scheduledRegistrationConfig 하나만 다루므로 update 권한이 있는 member도 쓸 수 있다.
 * 요청 본문의 다른 키는 파싱조차 하지 않으므로 다른 필드가 바뀔 수 없다.
 */
export async function PATCH(
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

    // 예약 등록 설정은 원래 관리자 전용이던 기능이라 명시적 부여가 필요하다 —
    // 데이터 읽기·쓰기처럼 member의 기본 능력으로 열지 않는다.
    const access = await requirePartitionAccess(user, partitionId, "update", { denyByDefault: true });
    if (!access.ok) {
        return NextResponse.json({ success: false, error: access.error }, { status: access.status });
    }

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object" || !("scheduledRegistrationConfig" in body)) {
        return NextResponse.json({ success: false, error: "예약 등록 설정이 필요합니다." }, { status: 400 });
    }

    const input = (body as { scheduledRegistrationConfig: unknown }).scheduledRegistrationConfig;

    let config: typeof access.partition.scheduledRegistrationConfig = null;
    if (input !== null) {
        const normalized = normalizeScheduledConfig(input, access.partition.scheduledRegistrationConfig);
        if (!normalized.ok) {
            return NextResponse.json({ success: false, error: normalized.error }, { status: 400 });
        }
        config = normalized.config;
    }

    const [updated] = await db
        .update(partitions)
        .set({ scheduledRegistrationConfig: config, updatedAt: new Date() })
        .where(eq(partitions.id, partitionId))
        .returning({ scheduledRegistrationConfig: partitions.scheduledRegistrationConfig });

    return NextResponse.json({ success: true, data: updated });
}
