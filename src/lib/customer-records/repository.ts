import { and, eq, desc, lt, or, sql, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import {
    db,
    crmContacts,
    crmCompanies,
    crmContactCompanies,
    crmDeals,
    crmTasks,
    inboxConversations,
    inboxChannels,
    crmObjectAudit as audit,
    customerWorkflowRuns as runs,
} from "@/lib/db";
import type { DbExec } from "@/lib/db/tx";
import {
    requireCustomerAccess,
    type CustomerActor,
} from "@/lib/customer-access/access";
import { InboxError } from "@/lib/inbox/errors";
import { lockWorkflowWorkspace } from "@/lib/customer-workflows/repository";
import {
    upsertCompany,
    upsertContact,
} from "@/lib/customer-platform/repository";
import { enqueuePlatformEvent } from "@/lib/customer-platform/outbox";
import { appendCustomerAudit, type CustomerWrite } from "./audit";
import {
    companyPatch,
    contactPatch,
    archiveInput,
    type CustomerResource,
} from "./rules";
const tableFor = (resource: CustomerResource) =>
    resource === "contacts" ? crmContacts : crmCompanies;
export async function ownedCustomerObject(
    actor: CustomerActor,
    workspaceId: number,
    resource: CustomerResource,
    id: string,
    exec: DbExec = db,
) {
    await requireCustomerAccess(actor, workspaceId, "read", exec);
    const table = tableFor(resource);
    const [row] = await exec
        .select()
        .from(table)
        .where(
            and(
                eq(table.id, z.uuid().parse(id)),
                eq(table.orgId, actor.orgId),
                eq(table.workspaceId, workspaceId),
            ),
        );
    if (!row) throw new InboxError("고객·회사 정보를 찾을 수 없습니다.", 404);
    if (resource === "companies") return row;
    const links = await exec
        .select({ id: crmContactCompanies.companyId })
        .from(crmContactCompanies)
        .where(eq(crmContactCompanies.contactId, id));
    return { ...row, companyIds: links.map((l) => l.id) };
}
const pendingStates = ["queued", "running", "waiting", "retry"];
function subject(resource: CustomerResource, id: string) {
    return eq(
        resource === "contacts" ? runs.subjectContactId : runs.subjectCompanyId,
        id,
    );
}
export async function customerArchiveImpact(
    actor: CustomerActor,
    workspaceId: number,
    resource: CustomerResource,
    id: string,
    exec: DbExec = db,
) {
    await ownedCustomerObject(actor, workspaceId, resource, id, exec);
    const contacts =
        resource === "contacts"
            ? sql`SELECT ${id}::uuid`
            : sql`SELECT contact_id FROM crm_contact_companies WHERE company_id=${id}::uuid`;
    const [dealCount, taskCount, chatCount, runCount] = await Promise.all([
        exec
            .select({ count: sql<number>`count(*)`.mapWith(Number) })
            .from(crmDeals)
            .where(
                and(
                    eq(crmDeals.orgId, actor.orgId),
                    eq(crmDeals.workspaceId, workspaceId),
                    isNull(crmDeals.archivedAt),
                    resource === "contacts"
                        ? eq(crmDeals.contactId, id)
                        : eq(crmDeals.companyId, id),
                ),
            ),
        exec
            .select({ count: sql<number>`count(*)`.mapWith(Number) })
            .from(crmTasks)
            .where(
                and(
                    eq(crmTasks.orgId, actor.orgId),
                    eq(crmTasks.workspaceId, workspaceId),
                    eq(crmTasks.status, "open"),
                    resource === "contacts"
                        ? eq(crmTasks.contactId, id)
                        : eq(crmTasks.companyId, id),
                ),
            ),
        exec
            .select({ count: sql<number>`count(*)`.mapWith(Number) })
            .from(inboxConversations)
            .innerJoin(
                inboxChannels,
                eq(inboxChannels.id, inboxConversations.channelId),
            )
            .where(
                and(
                    eq(inboxConversations.orgId, actor.orgId),
                    eq(inboxChannels.workspaceId, workspaceId),
                    isNull(inboxConversations.mergedIntoId),
                    sql`${inboxConversations.contactId} IN (${contacts})`,
                ),
            ),
        exec
            .select({ count: sql<number>`count(*)`.mapWith(Number) })
            .from(runs)
            .where(
                and(
                    eq(runs.orgId, actor.orgId),
                    eq(runs.workspaceId, workspaceId),
                    subject(resource, id),
                    inArray(runs.state, pendingStates),
                ),
            ),
    ]);
    return {
        deals: dealCount[0].count,
        tasks: taskCount[0].count,
        conversations: chatCount[0].count,
        pendingWorkflows: runCount[0].count,
    };
}
export async function customerObjectDetail(
    actor: CustomerActor,
    workspaceId: number,
    resource: CustomerResource,
    id: string,
    before?: string,
    exec: DbExec = db,
) {
    const item = await ownedCustomerObject(
        actor,
        workspaceId,
        resource,
        id,
        exec,
    );
    const base = and(
        eq(audit.orgId, actor.orgId),
        eq(audit.workspaceId, workspaceId),
        eq(audit.resource, resource),
        eq(audit.objectId, id),
    );
    const [cursor] = before
        ? await exec
              .select()
              .from(audit)
              .where(and(base, eq(audit.id, z.uuid().parse(before))))
        : [];
    if (before && !cursor)
        throw new InboxError("고객 변경 이력 위치를 확인해주세요.", 404);
    const history = await exec
        .select()
        .from(audit)
        .where(
            and(
                base,
                cursor
                    ? or(
                          lt(audit.createdAt, cursor.createdAt),
                          and(
                              eq(audit.createdAt, cursor.createdAt),
                              lt(audit.id, cursor.id),
                          ),
                      )
                    : undefined,
            ),
        )
        .orderBy(desc(audit.createdAt), desc(audit.id))
        .limit(50);
    const [creation] = await exec
        .select({ id: audit.id })
        .from(audit)
        .where(and(base, eq(audit.action, "created")))
        .limit(1);
    return {
        item,
        history,
        hasMore: history.length === 50,
        creationTracked: !!creation,
        impact: await customerArchiveImpact(
            actor,
            workspaceId,
            resource,
            id,
            exec,
        ),
    };
}
export async function patchCustomerObject(
    actor: CustomerActor,
    workspaceId: number,
    resource: CustomerResource,
    id: string,
    raw: unknown,
    exec: DbExec = db,
    source: CustomerWrite["source"] = "staff",
) {
    const patch =
        resource === "contacts"
            ? contactPatch.parse(raw)
            : companyPatch.parse(raw);
    await requireCustomerAccess(actor, workspaceId, "respond", exec);
    return exec.transaction(async (tx) => {
        await lockWorkflowWorkspace(actor.orgId, workspaceId, tx);
        const old = await ownedCustomerObject(
            actor,
            workspaceId,
            resource,
            id,
            tx,
        );
        if (old.version !== patch.version)
            throw new InboxError(
                "다른 사람이 고객 정보를 변경했습니다. 최신 내용을 불러온 뒤 다시 저장해주세요.",
                409,
            );
        if (old.archivedAt)
            throw new InboxError(
                "보관된 정보입니다. 보관함에서 복구한 뒤 수정해주세요.",
                409,
            );
        const input = {
            workspaceId,
            externalId: old.externalId,
            name: old.name,
            ...patch,
        };
        const write: CustomerWrite = { actor, source, replaceAttributes: true };
        return resource === "contacts"
            ? upsertContact(actor.orgId, input, true, tx, write)
            : upsertCompany(actor.orgId, input, true, tx, write);
    });
}
export async function archiveCustomerObject(
    actor: CustomerActor,
    workspaceId: number,
    resource: CustomerResource,
    id: string,
    raw: unknown,
    exec: DbExec = db,
    source: CustomerWrite["source"] = "staff",
) {
    const input = archiveInput.parse(raw);
    await requireCustomerAccess(actor, workspaceId, "manage", exec);
    return exec.transaction(async (tx) => {
        await lockWorkflowWorkspace(actor.orgId, workspaceId, tx);
        const old = await ownedCustomerObject(
            actor,
            workspaceId,
            resource,
            id,
            tx,
        );
        if (old.version !== input.version)
            throw new InboxError(
                "다른 사람이 고객 정보를 변경했습니다. 최신 내용을 확인해주세요.",
                409,
            );
        if (!!old.archivedAt === (input.action === "archive"))
            return { item: old, cancelledWorkflows: 0 };
        const table = tableFor(resource),
            now = new Date();
        const [saved] = await tx
            .update(table)
            .set({
                archivedAt: input.action === "archive" ? now : null,
                version: old.version + 1,
                updatedAt: now,
            })
            .where(eq(table.id, id))
            .returning();
        const after = {
            ...saved,
            ...("companyIds" in old ? { companyIds: old.companyIds } : {}),
        };
        const stopped =
            input.action === "archive"
                ? await tx
                      .update(runs)
                      .set({
                          state: "cancelled",
                          reason: "고객·회사 보관으로 자동화를 중단했습니다.",
                          leaseId: null,
                          leaseUntil: null,
                          updatedAt: now,
                      })
                      .where(
                          and(
                              eq(runs.orgId, actor.orgId),
                              eq(runs.workspaceId, workspaceId),
                              subject(resource, id),
                              inArray(runs.state, pendingStates),
                          ),
                      )
                      .returning({ id: runs.id })
                : [];
        await appendCustomerAudit(
            tx,
            resource,
            old,
            after,
            { actor, source },
            input.action === "archive" ? "archived" : "restored",
            input.reason,
        );
        await enqueuePlatformEvent(tx, {
            orgId: actor.orgId,
            workspaceId,
            key: `${resource}:${id}:v${saved.version}`,
            type:
                resource === "contacts" ? "contact.updated" : "company.updated",
            data: {
                [resource === "contacts" ? "contact" : "company"]: after,
                administrative: true,
                action: input.action,
                cancelledWorkflows: stopped.length,
            },
        });
        return { item: after, cancelledWorkflows: stopped.length };
    });
}
