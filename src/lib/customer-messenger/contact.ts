import { createHash, randomInt, timingSafeEqual } from "node:crypto";
import { and, eq, gte, sql } from "drizzle-orm";
import { z } from "zod";
import {
    db,
    customerReplyContacts as contacts,
    inboxConversations as chats,
    inboxMessages as messages,
    emailConfigs,
} from "@/lib/db";
import type { DbExec } from "@/lib/db/tx";
import { visitorConversation, publicChannel } from "@/lib/inbox/repository";
import { appendInboxAudit } from "@/lib/inbox/audit";
import { InboxError } from "@/lib/inbox/errors";
import { queueLatestCustomerReply } from "./queue";
import {
    contactInput,
    messengerSettingsSchema,
    notificationWorkerEnabled,
} from "./rules";
import { notificationSender, sendNotificationMail } from "./transport";
const digest = (id: string, email: string, code: string) =>
    createHash("sha256").update(`${id}:${email}:${code}`).digest("hex");
function publicContact(c?: typeof contacts.$inferSelect) {
    return {
        name: c?.name ?? "",
        phone: c?.phone ?? "",
        email: c?.email ?? "",
        notifyEmail: c?.notifyEmail ?? false,
        verified: !!c?.verifiedAt,
        consent: !!c?.consentAt,
    };
}
export async function customerReplyContact(
    key: string,
    token: string,
    conversationId: string | undefined,
    raw?: unknown,
    exec: DbExec = db,
    send = sendNotificationMail,
    now = new Date(),
) {
    const channel = await publicChannel(key, exec);
    const settings = messengerSettingsSchema.parse(
        channel.messengerSettings ?? {},
    );
    const chat = await visitorConversation(
        key,
        token,
        exec,
        false,
        conversationId,
    );
    if (!chat.id || chat.readOnly)
        throw new InboxError("새 문의를 시작한 뒤 연락처를 남겨주세요.", 409);
    const id = chat.id;
    if (raw === undefined) {
        const [saved] = await exec
            .select()
            .from(contacts)
            .where(eq(contacts.conversationId, id));
        return publicContact(saved);
    }
    const action = z
        .object({
            action: z.enum(["contact", "send-code", "verify-code", "seen"]),
        })
        .parse(raw).action;
    if (action === "seen") {
        const input = z
            .object({
                action: z.literal("seen"),
                messageId: z.number().int().positive(),
            })
            .strict()
            .parse(raw);
        const [m] = await exec
            .select({ id: messages.id })
            .from(messages)
            .where(
                and(
                    eq(messages.id, input.messageId),
                    eq(messages.conversationId, id),
                ),
            );
        if (m)
            await exec
                .update(contacts)
                .set({
                    readMessageId: sql`greatest(${contacts.readMessageId},${m.id})`,
                })
                .where(eq(contacts.conversationId, id));
        return { seen: !!m };
    }
    if (!settings.enabled)
        throw new InboxError("연락처 수집이 설정되지 않은 상담창입니다.", 409);
    if (action === "contact") {
        const input = contactInput.parse(raw),
            email = input.email.toLowerCase();
        if (
            input.notifyEmail &&
            (!settings.emailNotifications ||
                !notificationWorkerEnabled() ||
                !(await notificationSender(channel.orgId, exec)))
        )
            throw new InboxError(
                "지금은 이메일 답변 알림을 사용할 수 없습니다. 연락처는 알림 선택 없이 저장할 수 있습니다.",
                409,
            );
        return exec.transaction(async (tx) => {
            await tx
                .select({ id: chats.id })
                .from(chats)
                .where(eq(chats.id, id))
                .for("update");
            await visitorConversation(key, token, tx, false, id);
            const [previous] = await tx
                .select()
                .from(contacts)
                .where(eq(contacts.conversationId, id));
            const sameEmail = previous?.email === email;
            const memberEmail =
                chat.profile.identified &&
                !!email &&
                chat.profile.email?.toLowerCase() === email;
            const [saved] = await tx
                .insert(contacts)
                .values({
                    conversationId: id,
                    name: input.name,
                    phone: input.phone,
                    email,
                    notifyEmail: input.notifyEmail,
                    consentAt: input.notifyEmail ? now : null,
                    verifiedAt: memberEmail ? now : null,
                    updatedAt: now,
                })
                .onConflictDoUpdate({
                    target: contacts.conversationId,
                    set: {
                        name: input.name,
                        phone: input.phone,
                        email,
                        notifyEmail: input.notifyEmail,
                        consentAt: input.notifyEmail ? now : null,
                        verifiedAt: memberEmail
                            ? now
                            : sameEmail
                              ? (previous?.verifiedAt ?? null)
                              : null,
                        verificationHash: null,
                        verificationExpiresAt: null,
                        verificationAttempts: 0,
                        version:
                            previous &&
                            sameEmail &&
                            previous.notifyEmail === input.notifyEmail
                                ? previous.version
                                : (previous?.version ?? 0) + 1,
                        updatedAt: now,
                    },
                })
                .returning();
            if (
                !chat.profile.identified &&
                (chat.profile.name !== (input.name || "방문 고객") ||
                    chat.profile.email !== (email || null))
            ) {
                const nextName = input.name || "방문 고객";
                await tx
                    .update(chats)
                    .set({
                        name: nextName,
                        email: email || null,
                        version: sql`${chats.version}+1`,
                    })
                    .where(eq(chats.id, id));
                await appendInboxAudit(tx, {
                    orgId: channel.orgId,
                    channelId: channel.id,
                    conversationId: id,
                    actorId: null,
                    actorName: nextName,
                    action: "visitor.profile.updated",
                    changes: {
                        name: { before: chat.profile.name, after: nextName },
                        email: {
                            before: chat.profile.email,
                            after: email || null,
                        },
                    },
                });
            }
            if (saved.notifyEmail && saved.verifiedAt)
                await queueLatestCustomerReply(
                    tx,
                    { ...chat, id, medium: "web" },
                    now,
                );
            return publicContact(saved);
        });
    }
    if (action === "send-code") {
        if (!settings.emailNotifications || !notificationWorkerEnabled())
            throw new InboxError("이메일 알림을 사용할 수 없습니다.", 409);
        const code = String(randomInt(100000, 1000000));
        const saved = await exec.transaction(async (tx) => {
            const [c] = await tx
                .select()
                .from(contacts)
                .where(eq(contacts.conversationId, id))
                .for("update");
            if (!c?.email || !c.notifyEmail || !c.consentAt)
                throw new InboxError(
                    "이메일과 답변 알림 동의를 먼저 저장해주세요.",
                );
            if (c.verifiedAt) return null;
            if (
                c.verificationSentAt &&
                now.getTime() - c.verificationSentAt.getTime() < 60000
            )
                throw new InboxError(
                    "인증 메일은 1분 뒤 다시 요청해주세요.",
                    429,
                );
            await tx
                .select({ id: emailConfigs.id })
                .from(emailConfigs)
                .where(eq(emailConfigs.orgId, channel.orgId))
                .for("update");
            const [total] = await tx
                .select({
                    value: sql<number>`coalesce(sum(${contacts.verificationSends}),0)::int`,
                })
                .from(contacts)
                .where(
                    and(
                        eq(contacts.email, c.email),
                        gte(
                            contacts.verificationSentAt,
                            new Date(now.getTime() - 86400000),
                        ),
                    ),
                );
            if (total.value >= 3)
                throw new InboxError(
                    "인증 메일 요청 한도에 도달했습니다. 나중에 다시 시도해주세요.",
                    429,
                );
            await tx
                .update(contacts)
                .set({
                    verificationHash: digest(id, c.email, code),
                    verificationExpiresAt: new Date(now.getTime() + 600000),
                    verificationSentAt: now,
                    verificationAttempts: 0,
                    verificationSends:
                        c.verificationSentAt &&
                        c.verificationSentAt.getTime() >
                            now.getTime() - 86400000
                            ? c.verificationSends + 1
                            : 1,
                })
                .where(eq(contacts.conversationId, id));
            return c;
        });
        if (!saved) return { alreadyVerified: true };
        try {
            await send(
                {
                    orgId: channel.orgId,
                    name: channel.name,
                    email: saved.email,
                    subject: `[${channel.name}] 답변 알림 이메일 인증`,
                    body: `<p>상담 답변 알림을 신청하셨다면 다음 인증번호를 입력해주세요.</p><p><strong>${code}</strong></p><p>10분 안에 입력해주세요. 신청하지 않았다면 이 메일을 무시하셔도 됩니다.</p>`,
                },
                exec,
            );
        } catch {
            throw new InboxError(
                "인증 메일 발송을 확인하지 못했습니다. 1분 뒤 다시 시도해주세요.",
                503,
            );
        }
        return { sent: true };
    }
    const input = z
        .object({
            action: z.literal("verify-code"),
            code: z.string().regex(/^\d{6}$/),
        })
        .strict()
        .parse(raw);
    // Invalid attempts must commit; throwing inside the transaction would undo the limit.
    const verified = await exec.transaction(async (tx) => {
        const [c] = await tx
            .select()
            .from(contacts)
            .where(eq(contacts.conversationId, id))
            .for("update");
        if (
            !c?.verificationHash ||
            !c.verificationExpiresAt ||
            c.verificationExpiresAt <= now ||
            c.verificationAttempts >= 5 ||
            !c.notifyEmail ||
            !c.consentAt
        )
            return false;
        const ok = timingSafeEqual(
            Buffer.from(c.verificationHash, "hex"),
            Buffer.from(digest(id, c.email, input.code), "hex"),
        );
        await tx
            .update(contacts)
            .set(
                ok
                    ? {
                          verifiedAt: now,
                          verificationHash: null,
                          verificationExpiresAt: null,
                          updatedAt: now,
                      }
                    : {
                          verificationAttempts: sql`${contacts.verificationAttempts}+1`,
                      },
            )
            .where(eq(contacts.conversationId, id));
        return ok;
    });
    if (!verified)
        throw new InboxError(
            "인증번호가 다르거나 만료되었습니다. 새 인증번호를 요청해주세요.",
        );
    await queueLatestCustomerReply(exec, { ...chat, id, medium: "web" }, now);
    return { verified: true };
}
