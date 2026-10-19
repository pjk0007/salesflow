import { randomUUID } from "node:crypto";
import { and, asc, eq, lte, or, sql } from "drizzle-orm";
import { db, inboxChatAlertDeliveries as deliveries, inboxMessages as messages, inboxConversations as chats, inboxChannels as channels, crmContacts, inboxAttachments } from "@/lib/db";
import type { DbExec } from "@/lib/db/tx";
import { postGoogleChatMessage } from "@/lib/google-chat";
import { chatAlertRoutes, chatAlertWorkerEnabled, routeFingerprint } from "./config";
import { alertRequestId, chatAlertMessages } from "./message";

type Delivery = typeof deliveries.$inferSelect;
async function claim(exec: DbExec, now: Date) {
    return exec.transaction(async tx => {
        const [row] = await tx.select().from(deliveries).where(or(
            and(sql`${deliveries.state} IN ('pending','retry')`, lte(deliveries.availableAt, now)),
            and(eq(deliveries.state, "processing"), lte(deliveries.leaseUntil, now)),
        )).orderBy(asc(deliveries.availableAt), asc(deliveries.messageId)).limit(1).for("update", { skipLocked: true });
        if (!row) return null;
        const [claimed] = await tx.update(deliveries).set({ state: "processing", attempts: row.attempts + 1,
            leaseId: randomUUID(), leaseUntil: new Date(now.getTime() + 120000) })
            .where(eq(deliveries.messageId, row.messageId)).returning();
        return claimed;
    });
}
const owned = (row: Delivery) => and(eq(deliveries.messageId, row.messageId), eq(deliveries.leaseId, row.leaseId!), eq(deliveries.state, "processing"));
async function finish(exec: DbExec, row: Delivery, state: string, error: string | null = null, status: number | null = null, now = new Date()) {
    await exec.update(deliveries).set({ state, lastError: error, lastStatus: status, leaseId: null, leaseUntil: null,
        deliveredAt: state === "sent" ? now : null,
        availableAt: new Date(now.getTime() + Math.min(1800000, 15000 * 2 ** Math.min(7, row.attempts - 1))),
    }).where(owned(row));
}
export async function processInboxChatAlerts(options: {
    exec?: DbExec; send?: typeof postGoogleChatMessage; now?: () => Date;
    baseUrl?: string; limit?: number;
} = {}) {
    const exec = options.exec ?? db, send = options.send ?? postGoogleChatMessage,
        clock = options.now ?? (() => new Date());
    let sent = 0, skipped = 0;
    for (let index = 0; index < Math.min(10, Math.max(1, options.limit ?? 3)); index++) {
        const row = await claim(exec, clock());
        if (!row) break;
        if (row.attempts > 8) { await finish(exec, row, "dead", "자동 재시도 한도에 도달했습니다.", null, clock()); continue; }
        const [source] = await exec.select({ message: messages, chat: chats, channel: channels, internal: crmContacts.isInternal })
            .from(messages).innerJoin(chats, eq(chats.id, messages.conversationId))
            .innerJoin(channels, eq(channels.id, chats.channelId)).leftJoin(crmContacts, eq(crmContacts.id, chats.contactId))
            .where(eq(messages.id, row.messageId));
        const route = source && chatAlertRoutes().find(route => route.orgId === source.chat.orgId && route.orgId === source.channel.orgId && route.workspaceId === source.channel.workspaceId && route.channelId === source.chat.channelId && routeFingerprint(route) === row.routeHash);
        if (!source || !route || !source.channel.enabled || source.message.kind !== "customer" || source.internal || source.chat.historyOnly || source.chat.mergedIntoId || source.message.importMetadata || source.message.originConversationId) {
            await finish(exec, row, "cancelled", "알림 대상 또는 사업별 연결 설정이 바뀌었습니다.", null, clock()); skipped++; continue;
        }
        try {
            const attachments = await exec.select({ name: inboxAttachments.fileName }).from(inboxAttachments).where(eq(inboxAttachments.messageId, row.messageId));
            const payloads = chatAlertMessages({ id: row.messageId, conversationId: source.chat.id, channelId: source.chat.channelId,
                name: source.chat.name, channelName: source.channel.name, body: source.message.body, createdAt: source.message.createdAt,
                medium: source.chat.medium, status: source.chat.status, attachments: attachments.map(file => file.name),
            }, options.baseUrl ?? process.env.NEXT_PUBLIC_APP_URL ?? "https://sendb.kr");
            let failed = false;
            for (let part = row.sentParts; part < payloads.length; part++) {
                // A configuration change or a replacement lease must stop the old worker before HTTP.
                const stillConfigured = chatAlertRoutes().some(candidate => routeFingerprint(candidate) === row.routeHash);
                const [lease] = await exec.select({ id: deliveries.messageId }).from(deliveries).where(owned(row));
                if (!stillConfigured || !lease) { if (lease) await finish(exec, row, "cancelled", "연결 설정이 변경되었습니다.", null, clock()); failed = true; break; }
                const result = await send(route.webhook, payloads[part], fetch, {
                    requestId: alertRequestId(row.routeHash, row.messageId, part),
                    threadKey: `inbox:${source.chat.id}`,
                });
                if (!result.ok) {
                    const state = (result.retryable || result.uncertain) && row.attempts < 8 ? "retry" : "dead";
                    await finish(exec, row, state, result.error.split(route.webhook).join("[webhook]").slice(0, 500), result.status, clock());
                    failed = true; break;
                }
                await exec.update(deliveries).set({ sentParts: part + 1, leaseUntil: new Date(clock().getTime() + 120000) }).where(owned(row));
            }
            if (!failed) { await finish(exec, row, "sent", null, 200, clock()); sent++; }
        } catch {
            await finish(exec, row, row.attempts < 8 ? "retry" : "dead", "상담 알림 처리에 실패했습니다.", null, clock());
        }
    }
    return { sent, skipped };
}

const runtime = globalThis as typeof globalThis & { __sendbInboxChatTimer?: ReturnType<typeof setTimeout> };
export function startInboxChatAlertScheduler() {
    if (!chatAlertWorkerEnabled() || runtime.__sendbInboxChatTimer) return;
    const tick = async () => {
        try { await processInboxChatAlerts(); }
        catch { console.error("[inbox-chat-alerts] 알림 처리 실패, 다음 회차에 다시 확인합니다."); }
        finally {
            runtime.__sendbInboxChatTimer = setTimeout(() => void tick(), 5000);
            runtime.__sendbInboxChatTimer.unref();
        }
    };
    runtime.__sendbInboxChatTimer = setTimeout(() => void tick(), 5000);
    runtime.__sendbInboxChatTimer.unref();
}
