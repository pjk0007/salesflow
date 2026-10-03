import { NextRequest, NextResponse } from "next/server";
import { db, emailFollowupQueue } from "@/lib/db";
import { eq, and } from "drizzle-orm";
import { getUserFromNextRequest } from "@/lib/auth";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const user = getUserFromNextRequest(req);
    if (!user) {
        return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    }

    try {
        const { id } = await params;
        const queueId = Number(id);
        if (!queueId) {
            return NextResponse.json({ success: false, error: "유효하지 않은 ID입니다." }, { status: 400 });
        }

        const [item] = await db
            .select({ id: emailFollowupQueue.id, status: emailFollowupQueue.status })
            .from(emailFollowupQueue)
            .where(and(eq(emailFollowupQueue.id, queueId), eq(emailFollowupQueue.orgId, user.orgId)))
            .limit(1);

        if (!item) {
            return NextResponse.json({ success: false, error: "항목을 찾을 수 없습니다." }, { status: 404 });
        }

        if (item.status !== "pending") {
            return NextResponse.json({ success: false, error: "대기 상태인 항목만 취소할 수 있습니다." }, { status: 400 });
        }

        // 위에서 읽은 뒤 워커가 이 줄을 processing으로 집었을 수 있다 — 아직 pending일 때만 바꾼다.
        // 조건 없이 쓰면 워커가 그 뒤 미룸(pending)으로 덮어 취소한 후속이 다시 나간다
        const cancelled = await db
            .update(emailFollowupQueue)
            .set({ status: "cancelled", processedAt: new Date() })
            .where(and(
                eq(emailFollowupQueue.id, queueId),
                eq(emailFollowupQueue.orgId, user.orgId),
                eq(emailFollowupQueue.status, "pending")
            ))
            .returning({ id: emailFollowupQueue.id });

        if (cancelled.length === 0) {
            return NextResponse.json(
                { success: false, error: "이미 발송 처리 중이라 취소할 수 없습니다. 잠시 뒤 목록을 새로 고쳐 확인해주세요." },
                { status: 409 }
            );
        }

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error("Followup queue cancel error:", error);
        return NextResponse.json({ success: false, error: "서버 오류가 발생했습니다." }, { status: 500 });
    }
}
