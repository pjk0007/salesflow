import { and, eq, sql } from "drizzle-orm";
import {
    crmCompanies,
    crmContacts,
    crmContactCompanies,
    crmPipelines,
    crmDeals,
    crmTasks,
    inboxConversations,
    inboxMessages,
    inboxChannels,
    customerImportObjects,
} from "@/lib/db";
import type { DbExec } from "@/lib/db/tx";
import {
    fingerprint,
    object,
    sourceExternalId,
    type ImportInput,
    type ImportKind,
    type ImportRow,
} from "./rules";
export type ImportScope = Pick<
    ImportInput,
    "source" | "namespace" | "workspaceId"
> & { orgId: string };
const tables = {
    companies: crmCompanies,
    contacts: crmContacts,
    pipelines: crmPipelines,
    deals: crmDeals,
    tasks: crmTasks,
};
export async function importObject(
    scope: ImportScope,
    kind: ImportKind,
    sourceId: string,
    exec: DbExec,
) {
    const [key] = await exec
        .select()
        .from(customerImportObjects)
        .where(
            and(
                eq(customerImportObjects.orgId, scope.orgId),
                eq(customerImportObjects.workspaceId, scope.workspaceId),
                eq(customerImportObjects.source, scope.source),
                eq(customerImportObjects.namespace, scope.namespace),
                eq(customerImportObjects.kind, kind),
                eq(customerImportObjects.sourceId, sourceId),
            ),
        );
    return key ?? null;
}
export async function targetSnapshot(
    scope: ImportScope,
    kind: ImportKind,
    id: string,
    exec: DbExec,
): Promise<Record<string, unknown> | null> {
    if (kind === "messages") {
        const [row] = await exec
            .select({ message: inboxMessages })
            .from(inboxMessages)
            .innerJoin(
                inboxConversations,
                eq(inboxConversations.id, inboxMessages.conversationId),
            )
            .innerJoin(
                inboxChannels,
                eq(inboxChannels.id, inboxConversations.channelId),
            )
            .where(
                and(
                    eq(inboxMessages.id, Number(id)),
                    eq(inboxConversations.orgId, scope.orgId),
                    eq(inboxChannels.workspaceId, scope.workspaceId),
                    eq(inboxConversations.historyOnly, true),
                ),
            );
        return row ? object(row.message) : null;
    }
    if (kind === "conversations") {
        const [row] = await exec
            .select({ chat: inboxConversations })
            .from(inboxConversations)
            .innerJoin(
                inboxChannels,
                eq(inboxChannels.id, inboxConversations.channelId),
            )
            .where(
                and(
                    eq(inboxConversations.id, id),
                    eq(inboxConversations.orgId, scope.orgId),
                    eq(inboxChannels.workspaceId, scope.workspaceId),
                    eq(inboxConversations.historyOnly, true),
                ),
            );
        if (!row) return null;
        const { preview, lastMessageAt, customerSeq, ...stable } = row.chat;
        void preview;
        void lastMessageAt;
        void customerSeq;
        return object(stable);
    }
    const table = tables[kind];
    const [row] = await exec
        .select()
        .from(table)
        .where(
            and(
                eq(table.id, id),
                eq(table.orgId, scope.orgId),
                eq(table.workspaceId, scope.workspaceId),
            ),
        );
    if (!row) return null;
    if (kind === "contacts") {
        const links = await exec
            .select({ companyId: crmContactCompanies.companyId })
            .from(crmContactCompanies)
            .where(eq(crmContactCompanies.contactId, id))
            .orderBy(crmContactCompanies.companyId);
        return { ...row, companyIds: links.map((l) => l.companyId) };
    }
    return object(row);
}
export const rowExternalId = (scope: ImportScope, row: ImportRow) =>
    String(
        row.data.externalId ||
            sourceExternalId(
                scope.source,
                scope.namespace,
                row.kind,
                row.sourceId,
            ),
    );
export async function rowState(
    scope: ImportScope,
    row: ImportRow,
    exec: DbExec,
) {
    const key = await importObject(scope, row.kind, row.sourceId, exec);
    let targetId = key?.targetId ?? null;
    if (!key && row.kind !== "conversations" && row.kind !== "messages") {
        const t = tables[row.kind];
        const [found] = await exec
            .select({ id: t.id })
            .from(t)
            .where(
                and(
                    eq(t.orgId, scope.orgId),
                    eq(t.workspaceId, scope.workspaceId),
                    eq(t.externalId, rowExternalId(scope, row)),
                ),
            );
        targetId = found?.id ?? null;
    }
    const current = targetId
        ? await targetSnapshot(scope, row.kind, targetId, exec)
        : null;
    return { key, targetId, current, expected: fingerprint({ key, current }) };
}
export function rowReferences(row: ImportRow) {
    const refs: { kind: ImportKind; sourceId: string }[] = [];
    const add = (kind: ImportKind, value: unknown) => {
        if (value !== null && value !== undefined && value !== "")
            refs.push({ kind, sourceId: String(value) });
    };
    if (row.kind === "contacts")
        for (const id of (row.data.companyIds as string[]) || [])
            add("companies", id);
    if (["deals", "tasks", "conversations"].includes(row.kind))
        add("contacts", row.data.contactId);
    if (["deals", "tasks"].includes(row.kind))
        add("companies", row.data.companyId);
    if (row.kind === "deals") add("pipelines", row.data.pipelineId);
    if (row.kind === "tasks") add("deals", row.data.dealId);
    if (row.kind === "messages") add("conversations", row.data.conversationId);
    return refs;
}
export async function lockImportTargets(
    scope: ImportScope,
    row: ImportRow,
    exec: DbExec,
) {
    const state = await rowState(scope, row, exec);
    if (state.targetId) {
        if (row.kind === "conversations")
            await exec
                .select({ id: inboxConversations.id })
                .from(inboxConversations)
                .where(eq(inboxConversations.id, state.targetId))
                .for("update");
        else if (row.kind === "messages")
            await exec
                .select({ id: inboxMessages.id })
                .from(inboxMessages)
                .where(eq(inboxMessages.id, Number(state.targetId)))
                .for("update");
        else {
            const t = tables[row.kind];
            await exec
                .select({ id: t.id })
                .from(t)
                .where(eq(t.id, state.targetId))
                .for("update");
        }
    }
    return rowState(scope, row, exec);
}
export const publicOrigin = (
    scope: ImportScope,
    row: ImportRow,
    jobId: string,
) => ({
    source: scope.source,
    namespace: scope.namespace,
    sourceId: row.sourceId,
    jobId,
});
export const noLiveConversation = sql`${inboxConversations.historyOnly}=false`;
