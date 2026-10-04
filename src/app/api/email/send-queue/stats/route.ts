import { NextRequest, NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { db, emailAutoPersonalizedLinks, emailSendQueue, partitions, workspaces } from "@/lib/db";
import { getUserFromNextRequest } from "@/lib/auth";
import { loadSendersWithUsage } from "@/lib/email-sender-limit";
import { buildSendQueueStats } from "@/lib/email-send-queue-stats";

/**
 * 발송 대기열 통계 (조직 범위). docs/2026-10-02-sender-warmup/DESIGN-2-queue-policy.md 3절.
 *
 * 켜진 AI 규칙마다: 그 파티션·트리거의 대기 줄 수(문의/대량), 가장 일찍 예정된 줄의 시각, 발신 묶음의 앞으로 14일
 * 하루 용량(대량 몫 = 한도 − 문의 몫), 지금 쌓인 대기가 다 나가는 예상일, 대기 ÷ 하루 용량(backlogDays), 3일치 경고.
 * 한도 없는 주소가 섞인 묶음은 용량 "제한 없음"이고 경고하지 않는다. 계산은 email-send-queue-stats.ts(순수)에 있다.
 *
 * 조회는 세 번이다 (규칙 · 대기 줄 묶음별 수 · 주소와 오늘 사용량) — 규칙 수만큼 다시 읽지 않는다.
 * 보기만 하므로 조직 구성원이면 누구나 본다.
 */
export async function GET(req: NextRequest) {
    const user = getUserFromNextRequest(req);
    if (!user) {
        return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    }

    try {
        const now = new Date();
        const [rules, groups, senders] = await Promise.all([
            // 규칙 목록 API와 같은 조직 범위 (파티션 → 워크스페이스의 조직). 꺼진 규칙은 대기열 워커가 돌리지 않으므로 뺀다
            db
                .select({
                    id: emailAutoPersonalizedLinks.id,
                    partitionId: emailAutoPersonalizedLinks.partitionId,
                    triggerType: emailAutoPersonalizedLinks.triggerType,
                    senderProfileId: emailAutoPersonalizedLinks.senderProfileId,
                    senderProfileIds: emailAutoPersonalizedLinks.senderProfileIds,
                })
                .from(emailAutoPersonalizedLinks)
                .innerJoin(partitions, eq(partitions.id, emailAutoPersonalizedLinks.partitionId))
                .innerJoin(workspaces, eq(workspaces.id, partitions.workspaceId))
                .where(and(eq(workspaces.orgId, user.orgId), eq(emailAutoPersonalizedLinks.isActive, 1)))
                .orderBy(emailAutoPersonalizedLinks.id),
            // 대기 줄을 (파티션, 트리거, priority)로 묶어 센다. processing은 지금 나가는 중이라 세지 않는다
            db
                .select({
                    partitionId: emailSendQueue.partitionId,
                    triggerType: emailSendQueue.triggerType,
                    priority: emailSendQueue.priority,
                    count: sql<number>`count(*)::int`,
                    oldestScheduledAt: sql<Date | null>`min(${emailSendQueue.scheduledAt})`.mapWith(
                        emailSendQueue.scheduledAt
                    ),
                })
                .from(emailSendQueue)
                .where(and(eq(emailSendQueue.orgId, user.orgId), eq(emailSendQueue.status, "pending")))
                .groupBy(emailSendQueue.partitionId, emailSendQueue.triggerType, emailSendQueue.priority),
            loadSendersWithUsage(user.orgId, now),
        ]);

        const data = buildSendQueueStats({
            rules,
            groups: groups.map((g) => ({
                ...g,
                count: Number(g.count) || 0,
                oldestScheduledAt: g.oldestScheduledAt instanceof Date ? g.oldestScheduledAt : null,
            })),
            senders,
            now,
        });
        return NextResponse.json({ success: true, data });
    } catch (error) {
        console.error("Send queue stats fetch error:", error);
        return NextResponse.json({ success: false, error: "서버 오류가 발생했습니다." }, { status: 500 });
    }
}
