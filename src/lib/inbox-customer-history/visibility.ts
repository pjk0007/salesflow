import { and, eq, getTableColumns, isNull, or, sql } from "drizzle-orm";
import {
    customerImports as imports,
    customerImportObjects as objects,
    customerImportResults as results,
    inboxConversations as chats,
} from "@/lib/db";
import type { DbExec } from "@/lib/db/tx";
import { fingerprint, type ImportPlanRow } from "@/lib/customer-imports/rules";

type Channel = { id: number; orgId: string; workspaceId: number };
type Customer = { id: string; externalId: string };

// Match customer-imports/storage.targetSnapshot's stable conversation fields.
const volatileFields = new Set([
    "preview", "lastMessageAt", "customerSeq", "isCurrent", "customerCreateKey",
]);
const currentImportedSnapshot = sql`jsonb_build_object(${sql.join(
    Object.entries(getTableColumns(chats)).filter(([name]) => !volatileFields.has(name)).flatMap(([name, column]) => {
        const value = sql.raw(`"inbox_conversations"."${column.name}"`);
        return [sql`${name}::text`, column.dataType === "date"
            ? sql`to_char(${value} at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`
            : value];
    }),
    sql`,`,
)})`;

// Only a successful, reviewed ChannelTalk member mapping proves ownership of
// imported history. CRM names/emails and generated import IDs are not proof.
async function reviewedChannelMembers(
    channel: Channel,
    customer: Customer,
    exec: DbExec,
) {
    const planRow = sql<ImportPlanRow>`${imports.plan}->${results.position}`;
    const rows = await exec
        .select({
            namespace: objects.namespace,
            sourceId: objects.sourceId,
            sourceFingerprint: objects.sourceFingerprint,
            jobId: objects.jobId,
            position: results.position,
            row: planRow,
            format: sql<string>`${imports.input}->>'format'`,
        })
        .from(objects)
        .innerJoin(
            imports,
            and(
                eq(imports.id, objects.jobId),
                eq(imports.orgId, channel.orgId),
                eq(imports.workspaceId, channel.workspaceId),
                eq(imports.source, "channel"),
                eq(imports.namespace, objects.namespace),
            ),
        )
        .innerJoin(
            results,
            and(
                eq(results.jobId, imports.id),
                eq(results.targetId, objects.targetId),
            ),
        )
        .where(
            and(
                eq(objects.orgId, channel.orgId),
                eq(objects.workspaceId, channel.workspaceId),
                eq(objects.source, "channel"),
                eq(objects.kind, "contacts"),
                eq(objects.targetId, customer.id),
                sql`${imports.input}->'verifiedCustomerHistory'='true'::jsonb`,
                sql`${planRow}->>'kind'='contacts'`,
                sql`${planRow}->>'sourceId'=${objects.sourceId}`,
            ),
        );
    return rows.flatMap(({ row, format, position, ...key }) => {
        const original = row?.original, data = row?.data;
        if (!original || !data || format !== "json") return [];
        const memberId =
            typeof original.memberId === "string"
                ? original.memberId
                : typeof original.memberId === "number"
                  ? String(original.memberId)
                  : "";
        const veilId =
            typeof original.veilId === "string"
                ? original.veilId
                : typeof original.veilId === "number"
                  ? String(original.veilId)
                  : "";
        const confirmed =
            original.member !== false &&
            (original.type === "member" ||
                (!original.type && original.member === true));
        if (
            row.index !== position ||
            row.kind !== "contacts" ||
            row.sourceId !== key.sourceId ||
            !confirmed ||
            !memberId ||
            memberId === veilId ||
            memberId !== data.externalId ||
            data.externalId !== customer.externalId ||
            fingerprint({ data, original }) !== key.sourceFingerprint
        )
            return [];
        return [{
            namespace: key.namespace,
            source_id: key.sourceId,
            fingerprint: key.sourceFingerprint,
            job_id: key.jobId,
        }];
    });
}

export async function readableCustomerConversation(
    channel: Channel,
    customer: Customer,
    exec: DbExec,
) {
    // Read only the executed plan row at its recorded position. Do not expand
    // every 10,000-row JSON plan again for each of the 50 conversation rows.
    const members = await reviewedChannelMembers(channel, customer, exec);
    const imported = members.length
        ? sql`exists (
            select 1
            from customer_import_objects chat_key
            join customer_imports chat_job on chat_job.id=chat_key.job_id
                and chat_job.org_id=${channel.orgId}::uuid
                and chat_job.workspace_id=${channel.workspaceId}
                and chat_job.source='channel'
                and chat_job.namespace=chat_key.namespace
                and chat_job.input->'verifiedCustomerHistory'='true'::jsonb
            join customer_import_results saved on saved.job_id=chat_job.id
                and saved.target_id=chat_key.target_id
            join jsonb_to_recordset(${JSON.stringify(members)}::jsonb)
                as verified_member(namespace text, source_id text, fingerprint text, job_id text)
                on verified_member.namespace=chat_key.namespace
                and verified_member.source_id=chat_job.plan->saved.position->'data'->>'contactId'
            join customer_import_objects member_key on member_key.org_id=${channel.orgId}::uuid
                and member_key.workspace_id=${channel.workspaceId}
                and member_key.source='channel' and member_key.kind='contacts'
                and member_key.namespace=verified_member.namespace
                and member_key.source_id=verified_member.source_id
                and member_key.source_fingerprint=verified_member.fingerprint
                and member_key.job_id::text=verified_member.job_id
                and member_key.target_id=${customer.id}
            where chat_key.org_id=${channel.orgId}::uuid
                and chat_key.workspace_id=${channel.workspaceId}
                and chat_key.source='channel' and chat_key.kind='conversations'
                and chat_key.target_id=${chats.id}::text
                and chat_key.namespace=${chats.importMetadata}->>'namespace'
                and chat_key.source_id=${chats.importMetadata}->>'sourceId'
                and chat_job.plan->saved.position->>'kind'='conversations'
                and chat_job.plan->saved.position->>'sourceId'=chat_key.source_id
                and chat_job.plan->saved.position->>'index'=saved.position::text
                and saved.target_fingerprint=chat_key.target_fingerprint
                and saved.after=${currentImportedSnapshot}
                and saved.after->>'contactId'=${customer.id}
                and saved.after->>'channelId'=${String(channel.id)}
                and saved.after->>'historyOnly'='true'
        )`
        : sql`false`;
    return and(
        eq(chats.orgId, channel.orgId),
        eq(chats.channelId, channel.id),
        eq(chats.contactId, customer.id),
        isNull(chats.mergedIntoId),
        or(
            and(eq(chats.historyOnly, false), eq(chats.medium, "web")),
            and(
                eq(chats.historyOnly, true),
                sql`${chats.importMetadata}->>'source'='channel'`,
                sql`exists(select 1 from inbox_messages public_message where public_message.conversation_id=${chats.id} and public_message.kind in ('customer','reply'))`,
                imported,
            ),
        ),
    );
}
