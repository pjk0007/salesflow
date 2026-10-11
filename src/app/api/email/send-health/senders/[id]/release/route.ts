import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth-admin";
import { releaseSenderPause, senderWorkspaceIds } from "@/lib/partition-hold";
import { notifyRelease } from "@/lib/sender-health";
import { describeReplyError } from "@/lib/email-reply-rules";

/**
 * 발신 주소 자동 멈춤 풀기 (DESIGN-SND 6-5) — 관리자만 (멤버 403, 다른 조직 404). 본문 { note?: string }.
 * 자동으로 멈춘 주소(paused_source='auto')만 — 손으로 멈춘 주소는 409 (발신 주소 설정에서 푼다).
 * health_reset_at = 지금 (그 뒤 발송만으로 다시 판정), 웜업 중이면 시작일을 멈춘 날만큼 뒤로 (풀린 날 한도 = 멈춘 날 한도).
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const auth = await requireAdmin(req);
    if (!auth.ok) {
        return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
    }
    const user = auth.user;
    const { id } = await params;
    const profileId = Number(id);
    if (!Number.isSafeInteger(profileId) || profileId <= 0) {
        return NextResponse.json({ success: false, error: "발신 주소를 찾을 수 없습니다." }, { status: 404 });
    }
    const body = (await req.json().catch(() => ({}))) as { note?: unknown };
    // 코드 포인트로 자른다 (이모지를 반으로 가르지 않게, HR-10)
    const note = typeof body?.note === "string" && body.note.trim() ? Array.from(body.note.trim()).slice(0, 500).join("") : null;

    try {
        const r = await releaseSenderPause(user.orgId, profileId);
        if (!r.ok) {
            return NextResponse.json({ success: false, error: r.error }, { status: r.status });
        }
        await notifyRelease({
            orgId: user.orgId,
            kind: "sender",
            entityId: profileId,
            workspaceIds: await senderWorkspaceIds(user.orgId, profileId, r.pausedAt),
            name: r.fromEmail,
            releasedAt: r.releasedAt,
            actorUserId: user.userId,
            actorName: user.name ?? null,
            note,
            todayCap: r.todayCap,
            warmupDay: r.warmupDay,
        });
        return NextResponse.json({
            success: true,
            data: { profileId, releasedAt: r.releasedAt.toISOString(), warmupStartedOn: r.warmupStartedOn, todayCap: r.todayCap, warmupDay: r.warmupDay },
        });
    } catch (error) {
        console.error("[send-health] sender release error:", describeReplyError(error));
        return NextResponse.json({ success: false, error: "자동 멈춤을 풀지 못했습니다." }, { status: 500 });
    }
}
