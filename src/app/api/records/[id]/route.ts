import { NextRequest, NextResponse } from "next/server";
import { db, records } from "@/lib/db";
import { eq, and } from "drizzle-orm";
import { getUserFromNextRequest } from "@/lib/auth";
import { processAutoTrigger } from "@/lib/alimtalk-automation";
import { processEmailAutoTrigger } from "@/lib/email-automation";
import { broadcastToPartition } from "@/lib/sse";

export async function PATCH(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const user = getUserFromNextRequest(req);
    if (!user) {
        return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    }

    const { id } = await params;
    const recordId = Number(id);
    if (!recordId) {
        return NextResponse.json({ success: false, error: "레코드 ID가 필요합니다." }, { status: 400 });
    }

    const { data: newData } = await req.json();
    if (!newData || typeof newData !== "object") {
        return NextResponse.json({ success: false, error: "수정할 데이터가 필요합니다." }, { status: 400 });
    }

    try {
        // 레코드 조회 + 조직 검증
        const [existing] = await db
            .select()
            .from(records)
            .where(and(eq(records.id, recordId), eq(records.orgId, user.orgId)));

        if (!existing) {
            return NextResponse.json({ success: false, error: "레코드를 찾을 수 없습니다." }, { status: 404 });
        }

        // 기존 data와 병합
        const mergedData = { ...(existing.data as Record<string, unknown>), ...newData };

        const [updated] = await db
            .update(records)
            .set({ data: mergedData, updatedAt: new Date() })
            .where(eq(records.id, recordId))
            .returning();

        processAutoTrigger({
            record: updated,
            partitionId: updated.partitionId,
            triggerType: "on_update",
            orgId: user.orgId,
        }).catch((err) => console.error("Auto trigger error:", err));

        processEmailAutoTrigger({
            record: updated,
            partitionId: updated.partitionId,
            triggerType: "on_update",
            orgId: user.orgId,
        }).catch((err) => console.error("Email auto trigger error:", err));

        broadcastToPartition(updated.partitionId, "record:updated", {
            partitionId: updated.partitionId,
            recordId: updated.id,
        }, req.headers.get("x-session-id") as string);

        return NextResponse.json({ success: true, data: updated });
    } catch (error) {
        console.error("Record update error:", error);
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

    const { id } = await params;
    const recordId = Number(id);
    if (!recordId) {
        return NextResponse.json({ success: false, error: "레코드 ID가 필요합니다." }, { status: 400 });
    }

    try {
        const [existing] = await db
            .select({ id: records.id, partitionId: records.partitionId })
            .from(records)
            .where(and(eq(records.id, recordId), eq(records.orgId, user.orgId)));

        if (!existing) {
            return NextResponse.json({ success: false, error: "레코드를 찾을 수 없습니다." }, { status: 404 });
        }

        await db.delete(records).where(eq(records.id, recordId));

        broadcastToPartition(existing.partitionId, "record:deleted", {
            partitionId: existing.partitionId,
            recordId: existing.id,
        }, req.headers.get("x-session-id") as string);

        return NextResponse.json({ success: true, message: "레코드가 삭제되었습니다." });
    } catch (error) {
        console.error("Record delete error:", error);
        return NextResponse.json({ success: false, error: "서버 오류가 발생했습니다." }, { status: 500 });
    }
}
