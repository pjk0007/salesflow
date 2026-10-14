import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import {
    db,
    crmContacts,
    crmCompanies,
    crmContactCompanies,
    crmDeals,
    crmTasks,
    inboxChannels,
    inboxConversations,
    inboxMessages,
    users,
    organizationMembers,
} from "@/lib/db";
import type { DbExec } from "@/lib/db/tx";
const asObject = (v: unknown): Record<string, unknown> =>
    v && typeof v === "object" && !Array.isArray(v)
        ? (v as Record<string, unknown>)
        : {};
const id = (...values: unknown[]) =>
    values.find((v) => z.string().uuid().safeParse(v).success) as
        | string
        | undefined;
export async function workflowContext(
    orgId: string,
    workspaceId: number,
    event: Record<string, unknown>,
    exec: DbExec = db,
) {
    const data = asObject(event.data);
    let conversationId = id(
            data.conversationId,
            asObject(data.conversation).id,
        ),
        contactId = id(
            data.contactId,
            asObject(data.contact).id,
            asObject(data.event).contactId,
        ),
        companyId = id(data.companyId, asObject(data.company).id);
    const dealId = id(asObject(data.deal).id, data.dealId),
        taskId = id(asObject(data.task).id, data.taskId);
    const [deal] = dealId
        ? await exec
              .select()
              .from(crmDeals)
              .where(
                  and(
                      eq(crmDeals.id, dealId),
                      eq(crmDeals.orgId, orgId),
                      eq(crmDeals.workspaceId, workspaceId),
                  ),
              )
        : [];
    const [task] = taskId
        ? await exec
              .select()
              .from(crmTasks)
              .where(
                  and(
                      eq(crmTasks.id, taskId),
                      eq(crmTasks.orgId, orgId),
                      eq(crmTasks.workspaceId, workspaceId),
                  ),
              )
        : [];
    contactId ??= deal?.contactId ?? task?.contactId ?? undefined;
    companyId ??= deal?.companyId ?? task?.companyId ?? undefined;
    const conversations = await exec
        .select({
            conversation: inboxConversations,
            enabled: inboxChannels.enabled,
        })
        .from(inboxConversations)
        .innerJoin(
            inboxChannels,
            eq(inboxChannels.id, inboxConversations.channelId),
        )
        .where(
            and(
                eq(inboxConversations.orgId, orgId),
                eq(inboxChannels.workspaceId, workspaceId),
                conversationId
                    ? eq(inboxConversations.id, conversationId)
                    : contactId
                      ? eq(inboxConversations.contactId, contactId)
                      : sql`false`,
            ),
        )
        .orderBy(
            desc(inboxConversations.lastMessageAt),
            desc(inboxConversations.id),
        )
        .limit(1);
    const conversation = conversations[0]?.conversation;
    conversationId = conversation?.id;
    contactId ??= conversation?.contactId ?? undefined;
    const [contact] = contactId
        ? await exec
              .select()
              .from(crmContacts)
              .where(
                  and(
                      eq(crmContacts.id, contactId),
                      eq(crmContacts.orgId, orgId),
                      eq(crmContacts.workspaceId, workspaceId),
                  ),
              )
        : [];
    if (!companyId && contact) {
        const links = await exec
            .select({ companyId: crmContactCompanies.companyId })
            .from(crmContactCompanies)
            .where(eq(crmContactCompanies.contactId, contact.id))
            .limit(2);
        if (links.length === 1) companyId = links[0].companyId;
    }
    const [company] = companyId
        ? await exec
              .select()
              .from(crmCompanies)
              .where(
                  and(
                      eq(crmCompanies.id, companyId),
                      eq(crmCompanies.orgId, orgId),
                      eq(crmCompanies.workspaceId, workspaceId),
                  ),
              )
        : [];
    const [publicMessage] = conversationId
        ? await exec
              .select({ id: inboxMessages.id })
              .from(inboxMessages)
              .where(
                  and(
                      eq(inboxMessages.conversationId, conversationId),
                      sql`${inboxMessages.kind}<>'note'`,
                  ),
              )
              .orderBy(desc(inboxMessages.id))
              .limit(1)
        : [];
    const [staff] = contact?.email
        ? await exec
              .select({ id: users.id })
              .from(users)
              .innerJoin(
                  organizationMembers,
                  eq(organizationMembers.userId, users.id),
              )
              .where(
                  and(
                      eq(organizationMembers.organizationId, orgId),
                      eq(users.isActive, 1),
                      sql`lower(${users.email})=${contact.email.toLowerCase()}`,
                  ),
              )
              .limit(1)
        : [];
    return {
        event,
        contact: contact ?? null,
        company: company ?? null,
        conversation: conversation
            ? {
                  ...conversation,
                  enabled: conversations[0].enabled,
                  lastPublicId: publicMessage?.id ?? 0,
              }
            : null,
        deal: deal ?? null,
        task: task ?? null,
        internal: !!contact?.isInternal || !!staff,
    };
}
export type LoadedWorkflowContext = Awaited<ReturnType<typeof workflowContext>>;
