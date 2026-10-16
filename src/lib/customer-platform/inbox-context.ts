import { and, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import {
    db,
    inboxChannels,
    crmContacts,
    crmCompanies,
    crmContactCompanies,
    crmDeals,
    crmPipelines,
    crmTasks,
} from "@/lib/db";
import type { DbExec } from "@/lib/db/tx";
import { ownedConversation } from "@/lib/inbox/repository";
import type { SalesActor } from "./sales-repository";
import { platformContact } from "./repository";
import { InboxError } from "@/lib/inbox/errors";
export async function inboxCustomerContext(
    actor: SalesActor,
    conversationId: string,
    exec: DbExec = db,
) {
    const chat = await ownedConversation(actor, conversationId, exec),
        [channel] = await exec
            .select()
            .from(inboxChannels)
            .where(
                and(
                    eq(inboxChannels.id, chat.channelId),
                    eq(inboxChannels.orgId, actor.orgId),
                ),
            );
    if (!channel) throw new InboxError("상담 채널을 찾을 수 없습니다.", 404);
    if (!chat.contactId)
        return {
            workspaceId: channel.workspaceId,
            contact: null,
            companies: [],
            contacts: [],
            editorCompanies: [],
            pipelines: [],
            deals: [],
            tasks: [],
        };
    const contact = await platformContact(
        actor.orgId,
        channel.workspaceId,
        chat.contactId,
        exec,
    );
    const companies = await exec
        .select({ company: crmCompanies })
        .from(crmContactCompanies)
        .innerJoin(
            crmCompanies,
            eq(crmCompanies.id, crmContactCompanies.companyId),
        )
        .where(
            and(
                eq(crmContactCompanies.contactId, contact.id),
                eq(crmCompanies.orgId, actor.orgId),
                eq(crmCompanies.workspaceId, channel.workspaceId),
            ),
        );
    const linked = companies.map((row) => row.company),
        companyIds = linked.map((company) => company.id);
    const [rawDeals, tasks, pipelines] = await Promise.all([
        exec
            .select({
                deal: crmDeals,
                pipelineName: crmPipelines.name,
                stages: crmPipelines.stages,
            })
            .from(crmDeals)
            .innerJoin(crmPipelines, eq(crmPipelines.id, crmDeals.pipelineId))
            .where(
                and(
                    eq(crmDeals.orgId, actor.orgId),
                    eq(crmDeals.workspaceId, channel.workspaceId),
                    eq(crmPipelines.orgId, actor.orgId),
                    eq(crmPipelines.workspaceId, channel.workspaceId),
                    isNull(crmDeals.archivedAt),
                    or(
                        eq(crmDeals.contactId, contact.id),
                        companyIds.length
                            ? inArray(crmDeals.companyId, companyIds)
                            : undefined,
                    ),
                    sql`EXISTS (SELECT 1 FROM jsonb_array_elements(${crmPipelines.stages}) stage WHERE stage->>'id'=${crmDeals.stageId}::text AND stage->>'category'='open')`,
                ),
            )
            .orderBy(desc(crmDeals.updatedAt), desc(crmDeals.id))
            .limit(20),
        exec
            .select()
            .from(crmTasks)
            .where(
                and(
                    eq(crmTasks.orgId, actor.orgId),
                    eq(crmTasks.workspaceId, channel.workspaceId),
                    eq(crmTasks.contactId, contact.id),
                    eq(crmTasks.status, "open"),
                ),
            )
            .orderBy(sql`${crmTasks.dueAt} ASC NULLS LAST`, crmTasks.id)
            .limit(20),
        exec
            .select()
            .from(crmPipelines)
            .where(
                and(
                    eq(crmPipelines.orgId, actor.orgId),
                    eq(crmPipelines.workspaceId, channel.workspaceId),
                ),
            )
            .orderBy(crmPipelines.id)
            .limit(100),
    ]);
    const contactIds = [
            ...new Set([
                contact.id,
                ...rawDeals.flatMap((row) =>
                    row.deal.contactId ? [row.deal.contactId] : [],
                ),
            ]),
        ],
        editorCompanyIds = [
            ...new Set([
                ...companyIds,
                ...rawDeals.flatMap((row) =>
                    row.deal.companyId ? [row.deal.companyId] : [],
                ),
                ...tasks.flatMap((task) =>
                    task.companyId ? [task.companyId] : [],
                ),
            ]),
        ];
    const [contacts, editorCompanies] = await Promise.all([
        exec
            .select()
            .from(crmContacts)
            .where(
                and(
                    eq(crmContacts.orgId, actor.orgId),
                    eq(crmContacts.workspaceId, channel.workspaceId),
                    inArray(crmContacts.id, contactIds),
                ),
            ),
        editorCompanyIds.length
            ? exec
                  .select()
                  .from(crmCompanies)
                  .where(
                      and(
                          eq(crmCompanies.orgId, actor.orgId),
                          eq(crmCompanies.workspaceId, channel.workspaceId),
                          inArray(crmCompanies.id, editorCompanyIds),
                      ),
                  )
            : [],
    ]);
    return {
        workspaceId: channel.workspaceId,
        contact: { ...contact, companyIds },
        companies: linked,
        contacts: contacts.map((c) => ({
            ...c,
            companyIds: c.id === contact.id ? companyIds : [],
        })),
        editorCompanies,
        pipelines,
        deals: rawDeals.map((row) => ({
            ...row.deal,
            pipelineName: row.pipelineName,
            stageName:
                row.stages.find((stage) => stage.id === row.deal.stageId)
                    ?.name ?? "",
            relation: row.deal.contactId === contact.id ? "contact" : "company",
        })),
        tasks,
    };
}
