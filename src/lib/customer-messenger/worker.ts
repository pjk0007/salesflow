import { and, eq, lte, desc } from "drizzle-orm";
import {
    db,
    customerReplyContacts as contacts,
    customerReplyNotifications as notices,
    inboxConversations as chats,
    inboxChannels as channels,
    inboxMessages as messages,
} from "@/lib/db";
import type { DbExec } from "@/lib/db/tx";
import {
    notificationDecision,
    notificationWorkerEnabled,
    messengerSettingsSchema,
} from "./rules";
import { escapeEmailHtml as html, sendNotificationMail } from "./transport";
export async function processCustomerReplyNotifications(
    exec: DbExec = db,
    send = sendNotificationMail,
    now = new Date(),
) {
    // A crashed/inconclusive transport is never automatically sent again.
    await exec
        .update(notices)
        .set({ state: "uncertain", reason: "발송 결과 확인 필요" })
        .where(
            and(
                eq(notices.state, "processing"),
                lte(notices.claimedAt, new Date(now.getTime() - 300000)),
            ),
        );
    let processed = 0;
    for (let i = 0; i < 10; i++) {
        const claimed = await exec.transaction(async (tx) => {
            const [n] = await tx
                .select()
                .from(notices)
                .where(
                    and(eq(notices.state, "pending"), lte(notices.dueAt, now)),
                )
                .orderBy(notices.dueAt)
                .limit(1)
                .for("update", { skipLocked: true });
            if (!n) return null;
            const [chat] = await tx
                .select()
                .from(chats)
                .where(eq(chats.id, n.conversationId));
            const [channel] = chat
                ? await tx
                      .select()
                      .from(channels)
                      .where(eq(channels.id, chat.channelId))
                : [];
            const [contact] = await tx
                .select()
                .from(contacts)
                .where(eq(contacts.conversationId, n.conversationId))
                .for("update");
            const [latest] = await tx
                .select({ id: messages.id })
                .from(messages)
                .where(
                    and(
                        eq(messages.conversationId, n.conversationId),
                        eq(messages.kind, "reply"),
                    ),
                )
                .orderBy(desc(messages.id))
                .limit(1);
            const reason =
                chat && channel && contact
                    ? notificationDecision({
                          enabled:
                              channel.enabled &&
                              messengerSettingsSchema.parse(
                                  channel.messengerSettings ?? {},
                              ).enabled &&
                              messengerSettingsSchema.parse(
                                  channel.messengerSettings ?? {},
                              ).emailNotifications,
                          consent:
                              contact.notifyEmail &&
                              !!contact.consentAt &&
                              contact.version === n.contactVersion &&
                              !!contact.email,
                          verified: !!contact.verifiedAt,
                          read: contact.readMessageId >= n.messageId,
                          superseded: latest?.id !== n.messageId,
                          historyOnly: chat.historyOnly || !!chat.mergedIntoId,
                          medium: chat.medium,
                      })
                    : "missing_contact";
            if (n.createdAt.getTime() < now.getTime() - 86400000) {
                await tx
                    .update(notices)
                    .set({ state: "skipped", reason: "expired" })
                    .where(eq(notices.id, n.id));
                return { skipped: true as const };
            }
            if (reason !== "send") {
                await tx
                    .update(notices)
                    .set({ state: "skipped", reason })
                    .where(eq(notices.id, n.id));
                return { skipped: true as const };
            }
            await tx
                .update(notices)
                .set({ state: "processing", claimedAt: now })
                .where(eq(notices.id, n.id));
            return {
                skipped: false as const,
                notice: n,
                chat: chat!,
                channel: channel!,
                contact: contact!,
            };
        });
        if (!claimed) break;
        processed++;
        if (claimed.skipped) continue;
        const { channel, contact, notice } = claimed;
        const origin = channel.allowedOrigins.find((o) =>
            o.startsWith("https://"),
        );
        if (!origin) {
            await exec
                .update(notices)
                .set({ state: "skipped", reason: "site_unavailable" })
                .where(eq(notices.id, notice.id));
            continue;
        }
        // Recheck consent immediately before network I/O; no bodies/files/tokens in email.
        const [current] = await exec
            .select()
            .from(contacts)
            .where(eq(contacts.conversationId, notice.conversationId));
        if (
            !current?.notifyEmail ||
            !current.verifiedAt ||
            current.version !== notice.contactVersion ||
            current.readMessageId >= notice.messageId
        ) {
            await exec
                .update(notices)
                .set({ state: "skipped", reason: "preference_changed_or_read" })
                .where(eq(notices.id, notice.id));
            continue;
        }
        try {
            const providerId = await send(
                {
                    orgId: channel.orgId,
                    name: channel.name,
                    email: contact.email,
                    subject: `[${channel.name}] 상담에 새 답변이 도착했습니다`,
                    body: `<p>${html(channel.name)} 상담에 새 답변이 도착했습니다.</p><p><a href="${html(origin)}">사이트에서 답변 확인하기</a></p><p>문의를 남긴 브라우저에서 오른쪽 아래 상담창의 이전 대화를 열어주세요. 회원은 로그인 후 확인하실 수 있습니다.</p><p>답변 알림은 상담창의 연락처 설정에서 해제할 수 있습니다.</p>`,
                },
                exec,
            );
            await exec
                .update(notices)
                .set({
                    state: "sent",
                    providerId,
                    sentAt: new Date(),
                    reason: null,
                })
                .where(
                    and(
                        eq(notices.id, notice.id),
                        eq(notices.state, "processing"),
                    ),
                );
        } catch {
            await exec
                .update(notices)
                .set({
                    state: "uncertain",
                    reason: "이메일 발송 결과 확인 필요",
                })
                .where(eq(notices.id, notice.id));
        }
    }
    return { processed };
}
let running = false;
export function startCustomerReplyNotificationScheduler() {
    if (!notificationWorkerEnabled()) return;
    const tick = async () => {
        if (running) return;
        running = true;
        try {
            await processCustomerReplyNotifications();
        } catch {
            console.error("[customer-reply-notification] 처리 실패");
        } finally {
            running = false;
        }
    };
    setInterval(() => void tick(), 15000).unref();
    void tick();
}
