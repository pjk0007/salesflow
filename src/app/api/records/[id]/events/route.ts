import { NextRequest, NextResponse } from "next/server";
import { db, records, recordEvents } from "@/lib/db";
import { eq, and, desc } from "drizzle-orm";
import { getUserFromNextRequest } from "@/lib/auth";

// record 상세 화면에서 비즈니스 이벤트 타임라인을 보여줄 때.
// orgId 격리 후 occurred_at 역순으로 전체 반환 (record당 수십 건 수준 가정).

export async function GET(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const user = getUserFromNextRequest(req);
    if (!user) {
        return NextResponse.json(
            { success: false, error: "인증이 필요합니다." },
            { status: 401 }
        );
    }

    const { id } = await params;
    const recordId = Number(id);
    if (!recordId) {
        return NextResponse.json(
            { success: false, error: "레코드 ID가 필요합니다." },
            { status: 400 }
        );
    }

    const [record] = await db
        .select({ id: records.id })
        .from(records)
        .where(and(eq(records.id, recordId), eq(records.orgId, user.orgId)));

    if (!record) {
        return NextResponse.json(
            { success: false, error: "레코드를 찾을 수 없습니다." },
            { status: 404 }
        );
    }

    const events = await db
        .select()
        .from(recordEvents)
        .where(eq(recordEvents.recordId, recordId))
        .orderBy(desc(recordEvents.occurredAt));

    return NextResponse.json({ success: true, data: events });
}
