import {
    appendCustomerAudit,
    type CustomerWrite,
} from "@/lib/customer-records/audit";
import { objectListInput } from "@/lib/customer-records/rules";
import { enqueuePlatformEvent } from "./outbox";
import { and, desc, eq, ilike, inArray, lt, or, sql } from "drizzle-orm";
import { isDeepStrictEqual } from "node:util";
import {
    db,
    crmCompanies,
    crmContacts,
    crmContactCompanies,
    crmCustomerEvents,
    workspaces,
    records,
    inboxConversations,
} from "@/lib/db";
import type { DbExec } from "@/lib/db/tx";
import { InboxError } from "@/lib/inbox/errors";
import {
    attributesInput,
    companyInput,
    contactInput,
    eventInput,
} from "./rules";
import { appendActivity } from "./activities";

function definedValues<T extends object>(value: T): T {
    return Object.fromEntries(
        Object.entries(value).filter(([, v]) => v !== undefined),
    ) as T;
}
export async function requirePlatformWorkspace(
    orgId: string,
    workspaceId: number,
    exec: DbExec = db,
) {
    const [workspace] = await exec
        .select({ id: workspaces.id, name: workspaces.name })
        .from(workspaces)
        .where(
            and(eq(workspaces.id, workspaceId), eq(workspaces.orgId, orgId)),
        );
    if (!workspace)
        throw new InboxError("워크스페이스를 찾을 수 없습니다.", 404);
    return workspace;
}
export async function upsertCompany(
    orgId: string,
    raw: unknown,
    mayUpdate: boolean,
    exec: DbExec = db,
    write: CustomerWrite = {},
) {
    const { version, ...parsed } = companyInput.parse(raw);
    const input = definedValues(parsed);
    await requirePlatformWorkspace(orgId, input.workspaceId, exec);
    return exec.transaction(async (tx) => {
        await tx
            .select({ id: workspaces.id })
            .from(workspaces)
            .where(eq(workspaces.id, input.workspaceId))
            .for("update");
        const [before] = await tx
            .select()
            .from(crmCompanies)
            .where(
                and(
                    eq(crmCompanies.workspaceId, input.workspaceId),
                    eq(crmCompanies.externalId, input.externalId),
                ),
            );
        if (before && !mayUpdate)
            throw new InboxError("기존 회사의 수정 권한이 필요합니다.", 403);
        if (version !== undefined && version !== (before?.version ?? 0))
            throw new InboxError(
                "다른 사람이 고객 정보를 변경했습니다. 최신 내용을 불러온 뒤 다시 저장해주세요.",
                409,
            );
        const attributes = attributesInput.parse(
            write.replaceAttributes
                ? (input.attributes ?? before?.attributes ?? {})
                : { ...before?.attributes, ...input.attributes },
        );
        const next = before
            ? {
                  ...before,
                  ...input,
                  attributes,
              }
            : null;
        if (before && isDeepStrictEqual(before, next)) return before;
        const insert = tx
            .insert(crmCompanies)
            .values({ ...input, orgId, attributes });
        const [saved] = await insert
            .onConflictDoUpdate({
                target: [crmCompanies.workspaceId, crmCompanies.externalId],
                set: {
                    ...input,
                    attributes,
                    version: before ? before.version + 1 : 1,
                    updatedAt: new Date(),
                },
            })
            .returning();
        await appendCustomerAudit(tx, "companies", before, saved, write);
        await enqueuePlatformEvent(tx, {
            orgId,
            workspaceId: input.workspaceId,
            key: before
                ? `company:${saved.id}:v${saved.version}`
                : `company:${saved.id}:created`,
            type: before ? "company.updated" : "company.created",
            data: { company: saved },
        });
        return saved;
    });
}
export async function upsertContact(
    orgId: string,
    raw: unknown,
    mayUpdate: boolean,
    exec: DbExec = db,
    write: CustomerWrite = {},
) {
    const { version, companyIds, ...parsed } = contactInput.parse(raw);
    const input = definedValues(parsed);
    await requirePlatformWorkspace(orgId, input.workspaceId, exec);
    return exec.transaction(async (tx) => {
        await tx
            .select({ id: workspaces.id })
            .from(workspaces)
            .where(eq(workspaces.id, input.workspaceId))
            .for("update");
        const [before] = await tx
            .select()
            .from(crmContacts)
            .where(
                and(
                    eq(crmContacts.workspaceId, input.workspaceId),
                    eq(crmContacts.externalId, input.externalId),
                ),
            );
        const previousLinks = before
            ? await tx
                  .select({ companyId: crmContactCompanies.companyId })
                  .from(crmContactCompanies)
                  .where(eq(crmContactCompanies.contactId, before.id))
            : [];
        if (before && !mayUpdate)
            throw new InboxError("기존 고객의 수정 권한이 필요합니다.", 403);
        if (version !== undefined && version !== (before?.version ?? 0))
            throw new InboxError(
                "다른 사람이 고객 정보를 변경했습니다. 최신 내용을 불러온 뒤 다시 저장해주세요.",
                409,
            );
        const attributes = attributesInput.parse(
            write.replaceAttributes
                ? (input.attributes ?? before?.attributes ?? {})
                : { ...before?.attributes, ...input.attributes },
        );
        const next = before
            ? {
                  ...before,
                  ...input,
                  attributes,
              }
            : null;
        const linksChanged =
            companyIds !== undefined &&
            !isDeepStrictEqual(
                [...new Set(companyIds)].sort(),
                previousLinks.map((l) => l.companyId).sort(),
            );
        if (before && isDeepStrictEqual(before, next) && !linksChanged)
            return {
                ...before,
                companyIds: previousLinks.map((l) => l.companyId),
            };
        if (input.recordId) {
            const [record] = await tx
                .select({ id: records.id })
                .from(records)
                .where(
                    and(
                        eq(records.id, input.recordId),
                        eq(records.orgId, orgId),
                        eq(records.workspaceId, input.workspaceId),
                    ),
                );
            if (!record)
                throw new InboxError(
                    "같은 사업의 CRM 레코드만 연결할 수 있습니다.",
                );
        }
        if (companyIds?.length) {
            const companies = await tx
                .select({
                    id: crmCompanies.id,
                    archivedAt: crmCompanies.archivedAt,
                })
                .from(crmCompanies)
                .where(
                    and(
                        inArray(crmCompanies.id, companyIds),
                        eq(crmCompanies.orgId, orgId),
                        eq(crmCompanies.workspaceId, input.workspaceId),
                    ),
                );
            if (
                companies.some(
                    (c) =>
                        c.archivedAt &&
                        !previousLinks.some((l) => l.companyId === c.id),
                )
            )
                throw new InboxError(
                    "보관된 회사는 새로 연결할 수 없습니다. 회사 보관함에서 먼저 복구해주세요.",
                    409,
                );
            if (companies.length !== new Set(companyIds).size)
                throw new InboxError("같은 사업의 회사만 연결할 수 있습니다.");
        }
        const insert = tx
            .insert(crmContacts)
            .values({ ...input, orgId, attributes });
        const [contact] = mayUpdate
            ? await insert
                  .onConflictDoUpdate({
                      target: [crmContacts.workspaceId, crmContacts.externalId],
                      set: {
                          ...input,
                          attributes,
                          version: before ? before.version + 1 : 1,
                          updatedAt: new Date(),
                      },
                  })
                  .returning()
            : await insert.onConflictDoNothing().returning();
        if (!contact)
            throw new InboxError("기존 고객의 수정 권한이 필요합니다.", 403);
        if (companyIds) {
            await tx
                .delete(crmContactCompanies)
                .where(eq(crmContactCompanies.contactId, contact.id));
            if (companyIds.length)
                await tx.insert(crmContactCompanies).values(
                    [...new Set(companyIds)].map((companyId) => ({
                        contactId: contact.id,
                        companyId,
                    })),
                );
        }
        const changedConversations = await tx
            .update(inboxConversations)
            .set({
                name: contact.name,
                email: contact.email,
                version: sql`${inboxConversations.version}+1`,
                ...(input.recordId !== undefined
                    ? { recordId: input.recordId }
                    : {}),
            })
            .where(
                and(
                    eq(inboxConversations.orgId, orgId),
                    eq(inboxConversations.contactId, contact.id),
                    eq(inboxConversations.historyOnly, false),
                    or(
                        sql`${inboxConversations.name} IS DISTINCT FROM ${contact.name}`,
                        sql`${inboxConversations.email} IS DISTINCT FROM ${contact.email}`,
                        input.recordId !== undefined
                            ? sql`${inboxConversations.recordId} IS DISTINCT FROM ${input.recordId}`
                            : undefined,
                    ),
                ),
            )
            .returning({
                id: inboxConversations.id,
                version: inboxConversations.version,
            });
        for (const chat of changedConversations)
            await enqueuePlatformEvent(tx, {
                orgId,
                workspaceId: input.workspaceId,
                key: `conversation-profile:${chat.id}:v${chat.version}`,
                type: "conversation.updated",
                data: {
                    conversationId: chat.id,
                    version: chat.version,
                    action: "customer.profile.updated",
                    profile: {
                        name: contact.name,
                        email: contact.email,
                        ...(input.recordId !== undefined
                            ? { recordId: input.recordId }
                            : {}),
                    },
                },
            });
        const links = await tx
            .select({ companyId: crmContactCompanies.companyId })
            .from(crmContactCompanies)
            .where(eq(crmContactCompanies.contactId, contact.id));
        const saved = { ...contact, companyIds: links.map((l) => l.companyId) };
        await appendCustomerAudit(
            tx,
            "contacts",
            before
                ? {
                      ...before,
                      companyIds: previousLinks.map((l) => l.companyId),
                  }
                : null,
            saved,
            write,
        );
        await enqueuePlatformEvent(tx, {
            orgId,
            workspaceId: input.workspaceId,
            key: before
                ? `contact:${contact.id}:v${contact.version}`
                : `contact:${contact.id}:created`,
            type: before ? "contact.updated" : "contact.created",
            data: { contact: saved },
        });
        return saved;
    });
}
export async function platformContact(
    orgId: string,
    workspaceId: number,
    id: string,
    exec: DbExec = db,
) {
    const [contact] = await exec
        .select()
        .from(crmContacts)
        .where(
            and(
                eq(crmContacts.id, id),
                eq(crmContacts.orgId, orgId),
                eq(crmContacts.workspaceId, workspaceId),
            ),
        );
    if (!contact) throw new InboxError("고객을 찾을 수 없습니다.", 404);
    return contact;
}
export async function listPlatformObjects(
    orgId: string,
    workspaceId: number,
    kind: "contacts" | "companies",
    before?: string,
    exec: DbExec = db,
    q = "",
    archived: "false" | "true" | "all" = "false",
) {
    await requirePlatformWorkspace(orgId, workspaceId, exec);
    const table = kind === "contacts" ? crmContacts : crmCompanies;
    archived = objectListInput.parse({ archived }).archived;
    const pattern = `%${q.replace(/[\\%_]/g, "\\$&")}%`;
    const rows = await exec
        .select()
        .from(table)
        .where(
            and(
                eq(table.orgId, orgId),
                eq(table.workspaceId, workspaceId),
                archived === "all"
                    ? undefined
                    : archived === "true"
                      ? sql`${table.archivedAt} IS NOT NULL`
                      : sql`${table.archivedAt} IS NULL`,
                before ? lt(table.id, before) : undefined,
                q
                    ? or(
                          ilike(table.name, pattern),
                          ilike(table.externalId, pattern),
                          kind === "contacts"
                              ? ilike(crmContacts.email, pattern)
                              : ilike(crmCompanies.domain, pattern),
                      )
                    : undefined,
            ),
        )
        .orderBy(desc(table.id))
        .limit(100);
    if (kind === "companies" || !rows.length) return rows;
    const links = await exec
        .select({
            contactId: crmContactCompanies.contactId,
            companyId: crmContactCompanies.companyId,
        })
        .from(crmContactCompanies)
        .where(
            inArray(
                crmContactCompanies.contactId,
                rows.map((row) => row.id),
            ),
        );
    return rows.map((row) => ({
        ...row,
        companyIds: links
            .filter((link) => link.contactId === row.id)
            .map((link) => link.companyId),
    }));
}
export async function recordCustomerEvent(
    orgId: string,
    workspaceId: number,
    contactId: string,
    raw: unknown,
    source: "server" | "web",
    exec: DbExec = db,
) {
    return exec.transaction((tx) =>
        recordCustomerEventInTx(orgId, workspaceId, contactId, raw, source, tx),
    );
}
async function recordCustomerEventInTx(
    orgId: string,
    workspaceId: number,
    contactId: string,
    raw: unknown,
    source: "server" | "web",
    exec: DbExec,
) {
    const input = eventInput.parse(raw);
    await platformContact(orgId, workspaceId, contactId, exec);
    const [created] = await exec
        .insert(crmCustomerEvents)
        .values({
            ...input,
            orgId,
            workspaceId,
            contactId,
            source,
            occurredAt: input.occurredAt
                ? new Date(input.occurredAt)
                : new Date(),
        })
        .onConflictDoNothing({
            target: [crmCustomerEvents.workspaceId, crmCustomerEvents.eventId],
        })
        .returning();
    if (created) {
        await enqueuePlatformEvent(exec, {
            orgId,
            workspaceId,
            key: `event:${created.id}`,
            type: "customer.event",
            data: { event: created },
            occurredAt: created.occurredAt,
        });
        await appendActivity(exec, {
            orgId,
            workspaceId,
            contactId,
            source: "event",
            entityId: created.id,
            eventKey: `event:${created.id}`,
            action: created.name,
            summary: created.name,
            metadata: { properties: created.properties, eventSource: source },
            occurredAt: created.occurredAt,
        });
        return created;
    }
    const [previous] = await exec
        .select()
        .from(crmCustomerEvents)
        .where(
            and(
                eq(crmCustomerEvents.workspaceId, workspaceId),
                eq(crmCustomerEvents.eventId, input.eventId),
            ),
        );
    if (
        previous.contactId !== contactId ||
        previous.name !== input.name ||
        previous.source !== source ||
        !isDeepStrictEqual(previous.properties, input.properties ?? {}) ||
        (input.occurredAt &&
            previous.occurredAt.getTime() !== Date.parse(input.occurredAt))
    )
        throw new InboxError("이미 처리된 이벤트 번호의 내용이 다릅니다.", 409);
    return previous;
}
export async function listCustomerEvents(
    orgId: string,
    workspaceId: number,
    contactId: string,
    before?: string,
    exec: DbExec = db,
) {
    await platformContact(orgId, workspaceId, contactId, exec);
    return exec
        .select()
        .from(crmCustomerEvents)
        .where(
            and(
                eq(crmCustomerEvents.orgId, orgId),
                eq(crmCustomerEvents.workspaceId, workspaceId),
                eq(crmCustomerEvents.contactId, contactId),
                before ? lt(crmCustomerEvents.id, before) : undefined,
            ),
        )
        .orderBy(desc(crmCustomerEvents.id))
        .limit(100);
}
