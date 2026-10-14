import { randomBytes } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import {
    crmCompanies,
    crmContacts,
    crmContactCompanies,
    crmPipelines,
    crmDeals,
    crmTasks,
    inboxChannels,
    inboxConversations as chats,
    inboxMessages as messages,
    customerImportObjects as keys,
    customerImportResults as results,
    crmActivities,
} from "@/lib/db";
import type { DbExec } from "@/lib/db/tx";
import {
    upsertCompany,
    upsertContact,
} from "@/lib/customer-platform/repository";
import {
    createSales,
    patchSales,
    type SalesActor,
} from "@/lib/customer-platform/sales-repository";
import { appendActivity } from "@/lib/customer-platform/activities";
import { appendInboxAudit } from "@/lib/inbox/audit";
import { InboxError } from "@/lib/inbox/errors";
import { withImportOrigin } from "./origin";
import {
    fingerprint,
    sourceUuid,
    type ImportPlanRow,
    type ImportKind,
} from "./rules";
import {
    targetSnapshot,
    lockImportTargets,
    rowExternalId,
    publicOrigin,
    type ImportScope,
} from "./storage";
import type { ImportJob } from "./repository";

export async function applyImportRow(
    actor: SalesActor,
    scope: ImportScope,
    job: ImportJob,
    row: ImportPlanRow,
    tx: DbExec,
) {
    const state = await lockImportTargets(scope, row, tx);
    if (row.operation === "error" || row.expected !== state.expected)
        throw new InboxError(
            `자료 ${row.index + 1}의 대상이 바뀌었습니다. 미리보기를 다시 만들어주세요.`,
            409,
        );
    async function reference(
        kind: ImportKind,
        sourceId: unknown,
    ): Promise<string | undefined> {
        if (sourceId === undefined || sourceId === null || sourceId === "")
            return undefined;
        const dependency = row.dependencies.find(
            (d) => d.kind === kind && d.sourceId === String(sourceId),
        );
        if (!dependency)
            throw new InboxError("검토하지 않은 자료 관계입니다.", 409);
        let targetId = dependency.targetId,
            expected = dependency.expected;
        if (!targetId) {
            const parent = job.plan.find(
                (r) => r.kind === kind && r.sourceId === String(sourceId),
            );
            if (!parent)
                throw new InboxError("먼저 가져올 관계 자료가 없습니다.", 409);
            const [saved] = await tx
                .select()
                .from(results)
                .where(
                    and(
                        eq(results.jobId, job.id),
                        eq(results.position, parent.index),
                    ),
                );
            targetId = saved?.targetId;
            expected = saved?.targetFingerprint;
        }
        const value = targetId
            ? await targetSnapshot(scope, kind, targetId, tx)
            : null;
        if (!value || fingerprint(value) !== expected)
            throw new InboxError(
                `연결할 ${kind} 자료가 검토 이후 바뀌었습니다. 미리보기를 다시 만들어주세요.`,
                409,
            );
        return targetId;
    }
    const d = row.data,
        externalId = rowExternalId(scope, row),
        imported = publicOrigin(scope, row, job.id);
    const occurredAt = d.createdAt ? new Date(String(d.createdAt)) : undefined;
    return withImportOrigin({ jobId: job.id, occurredAt }, async () => {
        let targetId = state.targetId;
        const modifying =
            row.operation === "create" || row.operation === "update";
        if (row.kind === "companies" && modifying) {
            const saved = await upsertCompany(
                actor.orgId,
                {
                    workspaceId: scope.workspaceId,
                    externalId,
                    name: d.name,
                    domain: d.domain,
                    attributes: d.attributes,
                },
                true,
                tx,
                { actor, source: "import" },
            );
            targetId = saved.id;
        }
        if (row.kind === "contacts") {
            const companyIds = await Promise.all(
                ((d.companyIds as string[]) || []).map((id) =>
                    reference("companies", id),
                ),
            );
            if (modifying) {
                const saved = await upsertContact(
                    actor.orgId,
                    {
                        workspaceId: scope.workspaceId,
                        externalId,
                        name: d.name,
                        email: d.email,
                        phone: d.phone,
                        attributes: d.attributes,
                        lifecycleStage: d.lifecycleStage,
                        isInternal: d.isInternal,
                        companyIds: companyIds.filter(Boolean),
                    },
                    true,
                    tx,
                    { actor, source: "import" },
                );
                targetId = saved.id;
            } else if (
                targetId &&
                row.operation === "link" &&
                companyIds.length
            ) {
                const [contact] = await tx
                    .select()
                    .from(crmContacts)
                    .where(eq(crmContacts.id, targetId));
                const links = await tx
                    .select({ id: crmContactCompanies.companyId })
                    .from(crmContactCompanies)
                    .where(eq(crmContactCompanies.contactId, targetId));
                await upsertContact(
                    actor.orgId,
                    {
                        workspaceId: scope.workspaceId,
                        externalId: contact.externalId,
                        name: contact.name,
                        version: contact.version,
                        companyIds: [
                            ...new Set([
                                ...links.map((l) => l.id),
                                ...companyIds.filter(
                                    (id): id is string => !!id,
                                ),
                            ]),
                        ],
                    },
                    true,
                    tx,
                    { actor, source: "import" },
                );
            }
        }
        if (row.kind === "pipelines" && modifying) {
            const stages = (
                d.stages as { id: string; name: string; category: string }[]
            ).map((s) => ({
                ...s,
                id: sourceUuid(
                    `${scope.source}:${scope.namespace}:${row.sourceId}`,
                    s.id,
                ),
            }));
            if (row.operation === "create") {
                const saved = await createSales(
                    actor,
                    "pipelines",
                    {
                        workspaceId: scope.workspaceId,
                        externalId,
                        name: d.name,
                        stages,
                    },
                    tx,
                );
                targetId = saved.id;
            } else
                await patchSales(
                    actor,
                    scope.workspaceId,
                    "pipelines",
                    targetId!,
                    { version: state.current!.version, name: d.name, stages },
                    tx,
                );
        }
        if ((row.kind === "deals" || row.kind === "tasks") && modifying) {
            const contactId = await reference("contacts", d.contactId),
                companyId = await reference("companies", d.companyId);
            let value: Record<string, unknown>;
            if (row.kind === "deals") {
                const pipelineId = (await reference(
                        "pipelines",
                        d.pipelineId,
                    ))!,
                    pipeline = await targetSnapshot(
                        scope,
                        "pipelines",
                        pipelineId,
                        tx,
                    ),
                    stages = pipeline!.stages as { id: string }[],
                    stage = String(d.stageId),
                    stageId = stages.some((s) => s.id === stage)
                        ? stage
                        : sourceUuid(
                              `${scope.source}:${scope.namespace}:${d.pipelineId}`,
                              stage,
                          );
                value = {
                    title: d.title,
                    pipelineId,
                    stageId,
                    contactId,
                    companyId,
                    amount: d.amount,
                    currency: d.currency,
                    expectedCloseDate: d.expectedCloseDate,
                    notes: d.notes,
                };
            } else
                value = {
                    title: d.title,
                    body: d.body,
                    contactId,
                    companyId,
                    dealId: await reference("deals", d.dealId),
                    status: d.status,
                    dueAt: d.dueAt,
                };
            if (row.operation === "create") {
                const saved = await createSales(
                    actor,
                    row.kind,
                    { ...value, workspaceId: scope.workspaceId, externalId },
                    tx,
                );
                targetId = saved.id;
            } else
                await patchSales(
                    actor,
                    scope.workspaceId,
                    row.kind,
                    targetId!,
                    { ...value, version: state.current!.version },
                    tx,
                );
        }
        if (row.kind === "conversations" && modifying) {
            const contactId = await reference("contacts", d.contactId),
                [channel] = await tx
                    .select()
                    .from(inboxChannels)
                    .where(
                        and(
                            eq(inboxChannels.orgId, scope.orgId),
                            eq(inboxChannels.workspaceId, scope.workspaceId),
                        ),
                    );
            if (!channel)
                throw new InboxError("이 사업의 상담창을 먼저 만들어주세요.");
            const customer = contactId
                ? await targetSnapshot(scope, "contacts", contactId, tx)
                : null;
            const values = {
                contactId: contactId ?? null,
                name: String(d.name),
                status: String(d.status),
                tags: d.tags as string[],
                historyOnly: true,
                aiState: "human",
                email: customer?.email ? String(customer.email) : null,
                importMetadata: {
                    ...imported,
                    originalStatus: d.status,
                    customerName: customer?.name ?? null,
                },
            };
            if (row.operation === "create") {
                const [saved] = await tx
                    .insert(chats)
                    .values({
                        ...values,
                        orgId: scope.orgId,
                        channelId: channel.id,
                        tokenHash: randomBytes(32).toString("hex"),
                        createdAt: occurredAt,
                        lastMessageAt: occurredAt,
                    })
                    .returning();
                targetId = saved.id;
            } else
                await tx
                    .update(chats)
                    .set({
                        ...values,
                        version: Number(state.current!.version) + 1,
                    })
                    .where(eq(chats.id, targetId!));
            await appendInboxAudit(tx, {
                orgId: scope.orgId,
                channelId: channel.id,
                conversationId: targetId,
                actorId: actor.userId,
                actorName: actor.name,
                action: "conversation.imported",
                changes: {
                    source: {
                        before: state.current?.importMetadata ?? null,
                        after: imported,
                        beforeLabel: state.current ? "이전 원본" : "없음",
                        afterLabel: `${scope.source} · ${row.sourceId}`,
                    },
                },
            });
        }
        if (row.kind === "messages" && modifying) {
            const conversationId = (await reference(
                "conversations",
                d.conversationId,
            ))!;
            const [chat] = await tx
                .select()
                .from(chats)
                .where(eq(chats.id, conversationId))
                .for("update");
            if (!chat?.historyOnly)
                throw new InboxError(
                    "과거 상담 기록에만 메시지를 가져올 수 있습니다.",
                    409,
                );
            const values = {
                conversationId,
                clientId: sourceUuid(
                    `${scope.source}:${scope.namespace}:message`,
                    row.sourceId,
                ),
                body: String(d.body),
                kind: String(d.messageKind),
                authorName: String(d.authorName),
                createdAt: new Date(String(d.createdAt)),
                importMetadata: { ...imported, files: d.files },
            };
            if (row.operation === "create") {
                const [saved] = await tx
                    .insert(messages)
                    .values(values)
                    .returning();
                targetId = String(saved.id);
            } else
                await tx
                    .update(messages)
                    .set(values)
                    .where(eq(messages.id, Number(targetId)));
            const [latest] = await tx
                .select()
                .from(messages)
                .where(
                    and(
                        eq(messages.conversationId, conversationId),
                        sql`${messages.kind}<>'note'`,
                    ),
                )
                .orderBy(desc(messages.createdAt), desc(messages.id))
                .limit(1);
            const [count] = await tx
                .select({ value: sql<number>`count(*)`.mapWith(Number) })
                .from(messages)
                .where(
                    and(
                        eq(messages.conversationId, conversationId),
                        eq(messages.kind, "customer"),
                    ),
                );
            await tx
                .update(chats)
                .set({
                    preview: latest?.body.slice(0, 200) || "",
                    lastMessageAt: latest?.createdAt ?? chat.createdAt,
                    customerSeq: count.value,
                })
                .where(eq(chats.id, conversationId));
            const eventKey = `import-message:${rowExternalId(scope, row)}`;
            if (chat.contactId && d.messageKind !== "note") {
                await tx
                    .insert(crmActivities)
                    .values({
                        orgId: scope.orgId,
                        workspaceId: scope.workspaceId,
                        contactId: chat.contactId,
                        source: "conversation",
                        entityId: conversationId,
                        eventKey,
                        action: String(d.messageKind),
                        summary: `이전 자료 · ${String(d.body)}`.slice(0, 200),
                        actorName: String(d.authorName),
                        metadata: {
                            ...imported,
                            conversationId,
                            messageId: Number(targetId),
                        },
                        occurredAt: new Date(String(d.createdAt)),
                    })
                    .onConflictDoUpdate({
                        target: [
                            crmActivities.workspaceId,
                            crmActivities.eventKey,
                        ],
                        set: {
                            summary: `이전 자료 · ${String(d.body)}`.slice(
                                0,
                                200,
                            ),
                            action: String(d.messageKind),
                            metadata: {
                                ...imported,
                                conversationId,
                                messageId: Number(targetId),
                            },
                        },
                    });
            } else if (d.messageKind === "note")
                await tx
                    .update(crmActivities)
                    .set({
                        summary: "원본 기록이 내부 메모로 변경되었습니다.",
                        action: "import.corrected",
                        metadata: { ...imported },
                    })
                    .where(
                        and(
                            eq(crmActivities.workspaceId, scope.workspaceId),
                            eq(crmActivities.eventKey, eventKey),
                        ),
                    );
        }
        if (!targetId)
            throw new InboxError(
                "가져온 대상 자료를 확인하지 못했습니다.",
                409,
            );
        if (
            modifying &&
            row.operation === "create" &&
            occurredAt &&
            row.kind !== "conversations" &&
            row.kind !== "messages"
        ) {
            const tables = {
                    companies: crmCompanies,
                    contacts: crmContacts,
                    pipelines: crmPipelines,
                    deals: crmDeals,
                    tasks: crmTasks,
                },
                t = tables[row.kind];
            await tx
                .update(t)
                .set({
                    createdAt: occurredAt,
                    updatedAt: d.updatedAt
                        ? new Date(String(d.updatedAt))
                        : occurredAt,
                })
                .where(eq(t.id, targetId));
        }
        const after = await targetSnapshot(scope, row.kind, targetId, tx);
        if (!after)
            throw new InboxError(
                "이전 결과가 현재 사업에 저장되지 않았습니다.",
                409,
            );
        const afterFingerprint = fingerprint(after),
            owned = state.key?.owned ?? row.operation === "create";
        if (row.operation !== "reuse")
            await tx
                .insert(keys)
                .values({
                    orgId: scope.orgId,
                    workspaceId: scope.workspaceId,
                    source: scope.source,
                    namespace: scope.namespace,
                    kind: row.kind,
                    sourceId: row.sourceId,
                    targetId,
                    sourceFingerprint: fingerprint({
                        data: row.data,
                        original: row.original,
                    }),
                    targetFingerprint: afterFingerprint,
                    owned,
                    jobId: job.id,
                })
                .onConflictDoUpdate({
                    target: [
                        keys.workspaceId,
                        keys.source,
                        keys.namespace,
                        keys.kind,
                        keys.sourceId,
                    ],
                    set: {
                        targetId,
                        sourceFingerprint: fingerprint({
                            data: row.data,
                            original: row.original,
                        }),
                        targetFingerprint: afterFingerprint,
                        owned,
                        jobId: job.id,
                        updatedAt: new Date(),
                    },
                });
        await tx.insert(results).values({
            jobId: job.id,
            position: row.index,
            operation: row.operation,
            targetId,
            targetFingerprint: afterFingerprint,
            before: state.current,
            after,
        });
        if (row.kind === "contacts" && row.operation !== "reuse")
            await appendActivity(tx, {
                orgId: scope.orgId,
                workspaceId: scope.workspaceId,
                contactId: targetId,
                source: "import",
                entityId: targetId,
                eventKey: `import:${job.id}:${row.index}`,
                action: "import.contact",
                summary: "고객 자료의 원본 연결을 확인했습니다.",
                metadata: imported,
                actorName: actor.name,
                occurredAt: occurredAt ?? new Date(),
            });
        return { targetId, after };
    });
}
