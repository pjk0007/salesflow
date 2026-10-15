import { customerAccessPredicate } from "@/lib/customer-access/access";
import { and, eq, isNull, inArray, desc, sql, lte } from "drizzle-orm";
import {
    inboxConversations as chats,
    inboxMessages as messages,
    inboxChannels as channels,
    crmContacts,
    organizationMembers,
    users,
    inboxNotifications as notices,
    inboxOperationsSettings as settings,
    inboxServiceCases as cases,
    inboxResponseObligations as obligations,
    inboxEmailDeliveries as deliveries,
    platformEvents,
} from "@/lib/db";
import type { DbExec } from "@/lib/db/tx";
import { defaultPolicy, policyInput } from "./rules";
import { businessMilliseconds, addBusinessMilliseconds } from "./calendar";
type Chat = typeof chats.$inferSelect;
export type ServiceCase = typeof cases.$inferSelect;
export async function operationsRecipients(
    exec: DbExec,
    chat: Chat,
    target?: string | null,
) {
    const rows = await exec
        .select({ id: users.id })
        .from(organizationMembers)
        .innerJoin(users, eq(users.id, organizationMembers.userId))
        .where(
            and(
                eq(organizationMembers.organizationId, chat.orgId),
                eq(users.isActive, 1),
                customerAccessPredicate(
                    chat.orgId,
                    users.id,
                    sql`(SELECT workspace_id FROM inbox_channels WHERE id=${chat.channelId})`,
                    "respond",
                ),
            ),
        );
    const recipient = target ?? chat.assigneeId;
    return recipient && rows.some((u) => u.id === recipient)
        ? rows.filter((u) => u.id === recipient)
        : rows;
}
export async function notifyOperations(
    exec: DbExec,
    chat: Chat,
    type: string,
    key: string,
    preview: string,
    now: Date,
    options: { target?: string | null; customerSeq?: number } = {},
) {
    const recipients = await operationsRecipients(exec, chat, options.target);
    if (!recipients.length) return;
    await exec
        .insert(notices)
        .values(
            recipients.map((user) => ({
                orgId: chat.orgId,
                channelId: chat.channelId,
                conversationId: chat.id,
                userId: user.id,
                type,
                eventKey: key.slice(0, 250),
                preview: preview.slice(0, 250),
                createdAt: now,
                customerSeq: options.customerSeq ?? null,
            })),
        )
        .onConflictDoNothing();
}
export async function isOperationsInternal(exec: DbExec, chat: Chat) {
    if (!chat.contactId) return false;
    const [contact] = await exec
        .select({ internal: crmContacts.isInternal })
        .from(crmContacts)
        .where(
            and(
                eq(crmContacts.id, chat.contactId),
                eq(crmContacts.orgId, chat.orgId),
            ),
        );
    return contact?.internal ?? false;
}
function shifted(
    policy: ServiceCase["policy"],
    due: Date | null,
    pauseAt: Date,
    paused: number,
) {
    return due && pauseAt <= due
        ? addBusinessMilliseconds(policy.calendar, due, paused)
        : due;
}
export async function resumeServiceCase(
    exec: DbExec,
    c: ServiceCase,
    at: Date,
) {
    if (!c.pausedAt) return c;
    const duration = businessMilliseconds(c.policy.calendar, c.pausedAt, at),
        due = shifted(c.policy, c.resolutionDueAt, c.pausedAt, duration);
    const rows = await exec
        .select()
        .from(obligations)
        .where(
            and(eq(obligations.caseId, c.id), isNull(obligations.respondedAt)),
        )
        .for("update");
    for (const row of rows)
        await exec
            .update(obligations)
            .set({
                pausedMs: row.pausedMs + duration,
                dueAt: shifted(c.policy, row.dueAt, c.pausedAt, duration),
            })
            .where(eq(obligations.id, row.id));
    const [saved] = await exec
        .update(cases)
        .set({
            pausedAt: null,
            pausedMs: c.pausedMs + duration,
            resolutionDueAt: due,
        })
        .where(eq(cases.id, c.id))
        .returning();
    return saved;
}
async function invalidateCaseAlerts(exec: DbExec, c: ServiceCase) {
    const rows = await exec
        .select({ id: obligations.id })
        .from(obligations)
        .where(eq(obligations.caseId, c.id));
    const keys = [
        `sla-resolution:${c.id}`,
        ...rows.map((r) => `sla-response:${r.id}`),
    ];
    await exec
        .update(notices)
        .set({ readAt: new Date() })
        .where(
            and(
                eq(notices.orgId, c.orgId),
                inArray(notices.eventKey, keys),
                isNull(notices.readAt),
            ),
        );
}
async function incoming(
    exec: DbExec,
    chat: Chat,
    message: typeof messages.$inferSelect,
) {
    const [saved] = await exec
            .select()
            .from(settings)
            .where(eq(settings.channelId, chat.channelId)),
        policy = saved ? policyInput.parse(saved.policy) : defaultPolicy();
    const at = message.createdAt;
    const active = await exec
        .select()
        .from(cases)
        .where(and(eq(cases.conversationId, chat.id), isNull(cases.closedAt)))
        .orderBy(desc(cases.startedAt))
        .for("update");
    // A late historical Gmail message must not create a new response obligation after a confirmed newer reply.
    const [last] = await exec
        .select({
            at:
                chat.medium === "email"
                    ? deliveries.sentAt
                    : messages.createdAt,
        })
        .from(messages)
        .leftJoin(deliveries, eq(deliveries.messageId, messages.id))
        .where(
            and(
                eq(messages.conversationId, chat.id),
                eq(messages.kind, "reply"),
                (active[0]?.policy.includeAi ?? policy.includeAi)
                    ? undefined
                    : sql`${messages.authorId} IS NOT NULL`,
                chat.medium === "email"
                    ? eq(deliveries.state, "sent")
                    : undefined,
            ),
        )
        .orderBy(
            desc(
                chat.medium === "email"
                    ? deliveries.sentAt
                    : messages.createdAt,
            ),
        )
        .limit(1);
    if (last?.at && last.at >= at) {
        const [earlier] = await exec
            .select()
            .from(cases)
            .where(
                and(
                    eq(cases.conversationId, chat.id),
                    sql`${cases.startedAt}>${at}`,
                    sql`${cases.firstReplyAt}>=${at}`,
                ),
            )
            .orderBy(cases.startedAt)
            .limit(1)
            .for("update");
        if (earlier) {
            const applied =
                earlier.slaApplied &&
                !!earlier.policyEffectiveAt &&
                at >= earlier.policyEffectiveAt;
            const [first] = await exec
                .select()
                .from(obligations)
                .where(
                    and(
                        eq(obligations.caseId, earlier.id),
                        eq(obligations.kind, "first"),
                    ),
                )
                .limit(1);
            const due = applied
                ? addBusinessMilliseconds(
                      earlier.policy.calendar,
                      at,
                      earlier.policy.firstMinutes * 60000 +
                          (first?.pausedMs ?? 0),
                  )
                : null;
            if (first)
                await exec
                    .update(obligations)
                    .set({
                        startedAt: at,
                        dueAt: due,
                        elapsedMs: first.respondedAt
                            ? Math.max(
                                  0,
                                  businessMilliseconds(
                                      earlier.policy.calendar,
                                      at,
                                      first.respondedAt,
                                  ) - first.pausedMs,
                              )
                            : null,
                        breachedAt: applied
                            ? (first.breachedAt ??
                              (due &&
                              first.respondedAt &&
                              first.respondedAt > due
                                  ? first.respondedAt
                                  : null))
                            : null,
                    })
                    .where(eq(obligations.id, first.id));
            await exec
                .update(cases)
                .set({
                    startedAt: at,
                    slaApplied: applied,
                    resolutionBreachedAt: applied
                        ? earlier.resolutionBreachedAt
                        : null,
                    firstReplyMs: earlier.firstReplyAt
                        ? Math.max(
                              0,
                              businessMilliseconds(
                                  earlier.policy.calendar,
                                  at,
                                  earlier.firstReplyAt,
                              ) - (first?.pausedMs ?? 0),
                          )
                        : null,
                    resolutionMs: earlier.closedAt
                        ? Math.max(
                              0,
                              businessMilliseconds(
                                  earlier.policy.calendar,
                                  at,
                                  earlier.closedAt,
                              ) - earlier.pausedMs,
                          )
                        : null,
                    resolutionDueAt: applied
                        ? addBusinessMilliseconds(
                              earlier.policy.calendar,
                              at,
                              earlier.policy.resolutionMinutes * 60000 +
                                  earlier.pausedMs,
                          )
                        : null,
                })
                .where(eq(cases.id, earlier.id));
            if (!applied) {
                await invalidateCaseAlerts(exec, earlier);
                await exec
                    .update(obligations)
                    .set({ dueAt: null, breachedAt: null })
                    .where(eq(obligations.caseId, earlier.id));
            }
        }
        return;
    }
    for (let i = 0; i < active.length; i++)
        if (active[i].pausedAt)
            active[i] = await resumeServiceCase(exec, active[i], at);

    let c = active[0];
    if (!c) {
        const applied = policy.enabled && !!saved && at >= saved.effectiveAt;
        [c] = await exec
            .insert(cases)
            .values({
                orgId: chat.orgId,
                channelId: chat.channelId,
                conversationId: chat.id,
                originConversationId: chat.id,
                openedMessageId: message.id,
                startedAt: at,
                policy,
                policyVersion: saved?.version ?? 0,
                policyEffectiveAt: saved?.effectiveAt ?? null,
                slaApplied: applied,
                resolutionDueAt: applied
                    ? addBusinessMilliseconds(
                          policy.calendar,
                          at,
                          policy.resolutionMinutes * 60000,
                      )
                    : null,
            })
            .returning();
    } else if (at < c.startedAt) {
        const applied =
            c.slaApplied && !!c.policyEffectiveAt && at >= c.policyEffectiveAt;
        const [earliest] = await exec
            .select()
            .from(obligations)
            .where(
                and(
                    eq(obligations.caseId, c.id),
                    isNull(obligations.respondedAt),
                ),
            )
            .orderBy(obligations.startedAt)
            .limit(1);
        if (earliest && at < earliest.startedAt)
            await exec
                .update(obligations)
                .set({
                    startedAt: at,
                    dueAt: applied
                        ? addBusinessMilliseconds(
                              c.policy.calendar,
                              at,
                              (earliest.kind === "first"
                                  ? c.policy.firstMinutes
                                  : c.policy.nextMinutes) * 60000,
                          )
                        : null,
                })
                .where(eq(obligations.id, earliest.id));
        [c] = await exec
            .update(cases)
            .set({
                startedAt: at,
                slaApplied: applied,
                resolutionBreachedAt: applied ? c.resolutionBreachedAt : null,
                resolutionDueAt: applied
                    ? addBusinessMilliseconds(
                          c.policy.calendar,
                          at,
                          c.policy.resolutionMinutes * 60000,
                      )
                    : null,
            })
            .where(eq(cases.id, c.id))
            .returning();
        if (!applied) {
            await invalidateCaseAlerts(exec, c);
            await exec
                .update(obligations)
                .set({ dueAt: null, breachedAt: null })
                .where(eq(obligations.caseId, c.id));
        }
    }
    const waiting = await exec
        .select()
        .from(obligations)
        .where(
            and(eq(obligations.caseId, c.id), isNull(obligations.respondedAt)),
        )
        .orderBy(desc(obligations.startedAt));
    if (waiting.length) {
        // A queued email cannot answer a customer question received after its body was prepared.
        const [prepared] =
            chat.medium === "email"
                ? await exec
                      .select({ at: messages.createdAt })
                      .from(messages)
                      .where(
                          and(
                              eq(messages.conversationId, chat.id),
                              eq(messages.kind, "reply"),
                              sql`${messages.authorId} IS NOT NULL`,
                              sql`${messages.createdAt}>=${waiting[0].startedAt}`,
                              sql`${messages.createdAt}<${at}`,
                          ),
                      )
                      .orderBy(desc(messages.createdAt))
                      .limit(1)
                : [];
        if (!prepared) return;
    }
    const [any] = await exec
            .select({ id: obligations.id })
            .from(obligations)
            .where(eq(obligations.caseId, c.id))
            .limit(1),
        kind = any ? "next" : "first";
    await exec
        .insert(obligations)
        .values({
            caseId: c.id,
            requestedMessageId: message.id,
            kind,
            startedAt: at,
            dueAt: c.slaApplied
                ? addBusinessMilliseconds(
                      c.policy.calendar,
                      at,
                      (kind === "first"
                          ? c.policy.firstMinutes
                          : c.policy.nextMinutes) * 60000,
                  )
                : null,
        })
        .onConflictDoNothing();
}
async function responded(
    exec: DbExec,
    chat: Chat,
    message: typeof messages.$inferSelect,
    at: Date,
) {
    const rows = await exec
        .select()
        .from(cases)
        .where(
            and(
                eq(cases.conversationId, chat.id),
                lte(cases.startedAt, message.createdAt),
                sql`(${cases.closedAt} IS NULL OR ${cases.closedAt}>=${message.createdAt})`,
            ),
        )
        .for("update");
    for (const c of rows) {
        if (!message.authorId && !c.policy.includeAi) continue;
        const pending = await exec
            .select()
            .from(obligations)
            .where(
                and(
                    eq(obligations.caseId, c.id),
                    isNull(obligations.respondedAt),
                    lte(obligations.startedAt, message.createdAt),
                ),
            )
            .for("update");
        for (const obligation of pending) {
            const pause = c.pausedAt
                    ? businessMilliseconds(c.policy.calendar, c.pausedAt, at)
                    : 0,
                elapsed = Math.max(
                    0,
                    businessMilliseconds(
                        c.policy.calendar,
                        obligation.startedAt,
                        at,
                    ) -
                        obligation.pausedMs -
                        pause,
                ),
                due = c.pausedAt
                    ? shifted(c.policy, obligation.dueAt, c.pausedAt, pause)
                    : obligation.dueAt,
                responder = message.authorId ? "agent" : "ai";
            await exec
                .update(obligations)
                .set({
                    respondedAt: at,
                    replyMessageId: message.id,
                    elapsedMs: elapsed,
                    responder,
                    pausedMs: obligation.pausedMs + pause,
                    dueAt: due,
                    breachedAt:
                        obligation.breachedAt ?? (due && at > due ? at : null),
                })
                .where(eq(obligations.id, obligation.id));
            if (!c.firstReplyAt || at < c.firstReplyAt) {
                await exec
                    .update(cases)
                    .set({
                        firstReplyAt: at,
                        firstReplyMs: Math.max(
                            0,
                            businessMilliseconds(
                                c.policy.calendar,
                                c.startedAt,
                                at,
                            ) -
                                c.pausedMs -
                                pause,
                        ),
                        firstResponder: responder,
                        lastReplyAt: at,
                    })
                    .where(eq(cases.id, c.id));
                c.firstReplyAt = at;
            } else
                await exec
                    .update(cases)
                    .set({
                        lastReplyAt: sql`greatest(${cases.lastReplyAt},${at})`,
                    })
                    .where(eq(cases.id, c.id));
        }
    }
}
/** Source transaction only; no network, no synthetic mutation of original conversation events. */
export async function onOperationsEvent(
    exec: DbExec,
    event: typeof platformEvents.$inferSelect,
) {
    if (
        ![
            "message.created",
            "conversation.updated",
            "conversation.identified",
            "ai.handoff",
        ].includes(event.type)
    )
        return;
    const data = event.payload.data,
        id = data.conversationId;
    if (typeof id !== "string") return;
    const [chat] = await exec
        .select()
        .from(chats)
        .innerJoin(channels, eq(channels.id, chats.channelId))
        .where(
            and(
                eq(chats.id, id),
                eq(chats.orgId, event.orgId),
                eq(channels.workspaceId, event.workspaceId),
            ),
        )
        .then((rows) => rows.map((r) => r.inbox_conversations));
    if (
        !chat ||
        chat.historyOnly ||
        chat.mergedIntoId ||
        (await isOperationsInternal(exec, chat))
    )
        return;
    const at = new Date(event.payload.occurredAt);
    if (event.type === "message.created") {
        const raw = data.message as { id?: unknown } | undefined;
        if (typeof raw?.id !== "number") return;
        const [message] = await exec
            .select()
            .from(messages)
            .where(
                and(eq(messages.id, raw.id), eq(messages.conversationId, id)),
            );
        if (!message) return;
        if (message.kind === "customer") {
            await notifyOperations(
                exec,
                chat,
                "customer",
                event.eventKey,
                message.body || "첨부 파일이 도착했습니다.",
                new Date(),
                { customerSeq: chat.customerSeq + 1 },
            );
            await incoming(exec, chat, message);
        } else if (message.kind === "reply" && chat.medium === "web")
            await responded(exec, chat, message, at);
        return;
    }
    if (event.type === "conversation.identified") {
        const source = data.sourceConversationId;
        if (typeof source === "string" && source !== id) {
            await exec
                .update(cases)
                .set({ conversationId: id })
                .where(
                    and(
                        eq(cases.conversationId, source),
                        eq(cases.orgId, chat.orgId),
                    ),
                );
            await exec
                .update(notices)
                .set({ readAt: new Date() })
                .where(
                    and(
                        eq(notices.orgId, chat.orgId),
                        inArray(notices.conversationId, [source, id]),
                        sql`${notices.type}<>'mentioned'`,
                        isNull(notices.readAt),
                    ),
                );
            await notifyOperations(
                exec,
                chat,
                "identity",
                event.eventKey,
                "비회원 이력을 연결했습니다. 이어진 문의를 확인해주세요.",
                new Date(),
            );
        }
        return;
    }
    if (event.type === "ai.handoff") {
        await notifyOperations(
            exec,
            chat,
            "handoff",
            event.eventKey,
            "AI가 상담원 확인을 요청했습니다.",
            at,
        );
        return;
    }
    if (data.action === "email.sent" && typeof data.messageId === "number") {
        const [message] = await exec
            .select()
            .from(messages)
            .where(
                and(
                    eq(messages.id, data.messageId),
                    eq(messages.conversationId, id),
                ),
            );
        if (message) await responded(exec, chat, message, at);
        return;
    }
    const changes = data.changes as
        | Record<string, { before?: unknown; after?: unknown }>
        | undefined;
    if (
        changes?.assigneeId &&
        changes.assigneeId.after !== changes.assigneeId.before &&
        typeof changes.assigneeId.after === "string" &&
        data.action !== "ai.handoff"
    )
        await notifyOperations(
            exec,
            chat,
            "assigned",
            event.eventKey,
            "담당자로 지정됐습니다. 상담 내용을 확인해주세요.",
            at,
            { target: changes.assigneeId.after },
        );
    const status = changes?.status?.after;
    if (!["open", "snoozed", "closed"].includes(String(status))) return;
    const active = await exec
        .select()
        .from(cases)
        .where(and(eq(cases.conversationId, id), isNull(cases.closedAt)))
        .for("update");
    for (let c of active) {
        if (status === "snoozed" && c.policy.pauseOnSnooze && !c.pausedAt) {
            await exec
                .update(cases)
                .set({ pausedAt: at })
                .where(eq(cases.id, c.id));
            continue;
        }
        if ((status === "open" || status === "closed") && c.pausedAt)
            c = await resumeServiceCase(exec, c, at);
        if (status === "closed")
            await exec
                .update(cases)
                .set({
                    closedAt: at,
                    assigneeAtClose: chat.assigneeId,
                    resolutionMs: Math.max(
                        0,
                        businessMilliseconds(
                            c.policy.calendar,
                            c.startedAt,
                            at,
                        ) - c.pausedMs,
                    ),
                    resolutionBreachedAt:
                        c.resolutionBreachedAt ??
                        (c.resolutionDueAt && at > c.resolutionDueAt
                            ? at
                            : null),
                })
                .where(eq(cases.id, c.id));
    }
}
