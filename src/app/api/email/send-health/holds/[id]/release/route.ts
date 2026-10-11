import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth-admin";
import { releasePartitionHold } from "@/lib/partition-hold";
import { notifyRelease } from "@/lib/sender-health";
import { wakeSendQueue } from "@/lib/email-send-queue";
import { db, partitions } from "@/lib/db";
import { eq } from "drizzle-orm";
import { describeReplyError } from "@/lib/email-reply-rules";

/**
 * 명단 보류 풀기 (DESIGN-SND 6-5) — 관리자만 (멤버 403, 다른 조직 보류 404). 본문 { note?: string }.
 * held 줄을 원래 순서대로 pending으로 되돌리고 대기열 워커를 깨운다. 풀린 시각 뒤 발송만으로 다시 판정한다 (5-2).
 * 풀림 알림 한 통 (누가, 메모).
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const auth = await requireAdmin(req);
    if (!auth.ok) {
        return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
    }
    const user = auth.user;
    const { id } = await params;
    const holdId = Number(id);
    if (!Number.isSafeInteger(holdId) || holdId <= 0) {
        return NextResponse.json({ success: false, error: "보류를 찾을 수 없습니다." }, { status: 404 });
    }
    let note: string | null = null;
    try {
        const body = (await req.json().catch(() => ({}))) as { note?: unknown };
        // 코드 포인트로 자른다 (이모지를 반으로 가르지 않게, HR-10)
        if (typeof body?.note === "string" && body.note.trim()) note = Array.from(body.note.trim()).slice(0, 500).join("");
    } catch {
        note = null;
    }

    try {
        const released = await releasePartitionHold(user.orgId, holdId, user.userId, note);
        if (!released) {
            return NextResponse.json({ success: false, error: "보류를 찾을 수 없습니다. 이미 풀렸을 수 있습니다." }, { status: 404 });
        }
        const revived = released.revived.sendQueue + released.revived.followup + released.revived.automation;
        if (released.revived.sendQueue > 0) wakeSendQueue();
        const [p] = await db.select({ name: partitions.name }).from(partitions).where(eq(partitions.id, released.partitionId)).limit(1);
        await notifyRelease({
            orgId: user.orgId,
            kind: "hold",
            entityId: holdId,
            workspaceIds: [released.workspaceId],
            name: p?.name ?? `명단 ${released.partitionId}`,
            releasedAt: released.releasedAt,
            actorUserId: user.userId,
            actorName: user.name ?? null,
            note,
            revived,
        });
        return NextResponse.json({
            success: true,
            data: { partitionId: released.partitionId, releasedAt: released.releasedAt.toISOString(), revived: released.revived },
        });
    } catch (error) {
        console.error("[send-health] hold release error:", describeReplyError(error));
        return NextResponse.json({ success: false, error: "보류를 풀지 못했습니다." }, { status: 500 });
    }
}
