import { and, eq, isNotNull, lte } from "drizzle-orm";
import { db, inboxConversations as chats } from "@/lib/db";
import type { DbExec } from "@/lib/db/tx";
import { appendInboxAudit } from "./audit";

/** 보류 시간이 지난 상담을 진행중으로 되돌린다 (상담톡 보류 메뉴의 "언제까지") */
export async function wakeSnoozedConversations(exec: DbExec = db, now = new Date()) {
    return exec.transaction(async (tx) => {
        const due = await tx
            .select({ id: chats.id, orgId: chats.orgId, channelId: chats.channelId, version: chats.version })
            .from(chats)
            .where(and(eq(chats.status, "snoozed"), isNotNull(chats.snoozedUntil), lte(chats.snoozedUntil, now)))
            .limit(100)
            .for("update", { skipLocked: true });
        for (const chat of due) {
            await tx
                .update(chats)
                .set({ status: "open", snoozedUntil: null, version: chat.version + 1 })
                .where(eq(chats.id, chat.id));
            await appendInboxAudit(tx, {
                orgId: chat.orgId,
                channelId: chat.channelId,
                conversationId: chat.id,
                actorName: "보류 시간 종료",
                action: "conversation.updated",
                changes: { status: { before: "snoozed", after: "open" } },
            });
        }
        return due.length;
    });
}

const runtime = globalThis as typeof globalThis & { __sendbSnoozeTimer?: NodeJS.Timeout };
export function startSnoozeScheduler() {
    if (runtime.__sendbSnoozeTimer) return;
    const tick = async () => {
        try {
            await wakeSnoozedConversations();
        } catch {
            console.error("[inbox-snooze] 보류 종료 처리 실패, 다음 회차에서 다시 확인");
        } finally {
            runtime.__sendbSnoozeTimer = setTimeout(() => void tick(), 60_000);
            runtime.__sendbSnoozeTimer.unref();
        }
    };
    runtime.__sendbSnoozeTimer = setTimeout(() => void tick(), 10_000);
    runtime.__sendbSnoozeTimer.unref();
}
