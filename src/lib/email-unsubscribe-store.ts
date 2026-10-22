import type { db } from "./db";
import { emailSendLogs, emailUnsubscribes, partitions, workspaces } from "./db/schema";
import { and, asc, eq, sql } from "drizzle-orm";
import { EMAIL_TRIM_CHARS, normalizeEmail } from "./deep-visitor-alert-rules";

type UnsubscribeDatabase = Pick<typeof db, "select" | "update" | "transaction">;

/** Workspace is source attribution only: every historical row suppresses across its organization. */
export function organizationUnsubscribeCondition(orgId: string, email: string) {
    return and(
        eq(emailUnsubscribes.orgId, orgId),
        sql`lower(btrim(${emailUnsubscribes.email}, ${EMAIL_TRIM_CHARS})) = lower(btrim(${email}, ${EMAIL_TRIM_CHARS}))`,
    );
}

/** Batch preflight returns input ordinals so driver text decoding cannot alter cached lookup keys. */
export function unsubscribedRecipientsQuery(orgId: string, emails: readonly string[]) {
    if (emails.length === 0) throw new Error("수신거부 조회 대상이 없습니다.");
    return sql`
        SELECT v.ordinal
        FROM (VALUES ${sql.join(emails.map((email, ordinal) => sql`(${email}::text, ${ordinal}::int)`), sql`, `)}) AS v(email, ordinal)
        WHERE EXISTS (
            SELECT 1 FROM email_unsubscribes u
            WHERE u.org_id = ${orgId}::uuid
              AND lower(btrim(u.email, ${EMAIL_TRIM_CHARS})) = lower(btrim(v.email, ${EMAIL_TRIM_CHARS}))
        )
    `;
}

/** A dependency-injected store permits real PostgreSQL semantics in isolated PGlite tests. */
export function createEmailUnsubscribeStore(database: UnsubscribeDatabase) {
    async function isOrganizationUnsubscribed(orgId: string, email: string, exec: Pick<typeof db, "select"> = database): Promise<boolean> {
        const [row] = await exec.select({ id: emailUnsubscribes.id }).from(emailUnsubscribes)
            .where(organizationUnsubscribeCondition(orgId, email)).limit(1);
        return !!row;
    }

    async function isUnsubscribed(workspaceId: number, email: string): Promise<boolean> {
        const [workspace] = await database.select({ orgId: workspaces.orgId }).from(workspaces)
            .where(eq(workspaces.id, workspaceId)).limit(1);
        // Missing ownership must never silently authorize a send.
        if (!workspace) throw new Error("수신거부 확인을 위한 사업 정보를 찾을 수 없습니다.");
        return isOrganizationUnsubscribed(workspace.orgId, email);
    }

    async function resolveWorkspaceId(partitionId: number): Promise<number | null> {
        const [row] = await database.select({ workspaceId: partitions.workspaceId }).from(partitions)
            .where(eq(partitions.id, partitionId)).limit(1);
        return row?.workspaceId ?? null;
    }

    async function resolveUnsubscribeTarget(token: string) {
        const [log] = await database.select({
            id: emailSendLogs.id,
            orgId: emailSendLogs.orgId,
            partitionId: emailSendLogs.partitionId,
            recipientEmail: emailSendLogs.recipientEmail,
            recordId: emailSendLogs.recordId,
        }).from(emailSendLogs).where(eq(emailSendLogs.unsubscribeToken, token)).limit(1);
        if (!log) return null;

        // Partition/workspace may have been deleted after this email was sent. Its org still owns the token.
        let workspaceId = log.partitionId ? await resolveWorkspaceId(log.partitionId) : null;
        if (workspaceId !== null) {
            const [workspace] = await database.select({ id: workspaces.id }).from(workspaces)
                .where(and(eq(workspaces.id, workspaceId), eq(workspaces.orgId, log.orgId))).limit(1);
            if (!workspace) workspaceId = null;
        }
        return {
            orgId: log.orgId, workspaceId, email: log.recipientEmail,
            sendLogId: log.id, recordId: log.recordId,
            alreadyUnsubscribed: await isOrganizationUnsubscribed(log.orgId, log.recipientEmail),
        };
    }

    async function recordUnsubscribe(args: {
        orgId: string;
        workspaceId: number | null;
        email: string;
        sendLogId?: number;
        recordId?: number | null;
        source?: "link" | "one_click" | "manual";
        reason?: string | null;
    }): Promise<void> {
        const email = normalizeEmail(args.email);
        if (!email || !email.includes("@") || email.length > 200) throw new Error("올바른 이메일 주소가 필요합니다.");
        await database.transaction(async (tx) => {
            if (args.workspaceId !== null) {
                const [workspace] = await tx.select({ id: workspaces.id }).from(workspaces)
                    .where(and(eq(workspaces.id, args.workspaceId), eq(workspaces.orgId, args.orgId))).limit(1);
                if (!workspace) throw new Error("수신거부 사업의 계정 정보를 확인할 수 없습니다.");
            }
            // Serialize repeat clicks/manual additions without removing duplicate historical source rows.
            await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${args.orgId}:${email}`}, 0))`);
            const [existing] = await tx.select({ id: emailUnsubscribes.id }).from(emailUnsubscribes)
                .where(organizationUnsubscribeCondition(args.orgId, email)).limit(1);
            if (existing) return;
            await tx.insert(emailUnsubscribes).values({
                orgId: args.orgId, workspaceId: args.workspaceId, email,
                sendLogId: args.sendLogId ?? null, recordId: args.recordId ?? null,
                source: args.source ?? "link", reason: args.reason ?? null,
            }).onConflictDoNothing();
        });
    }

    async function attachUnsubscribeReason(token: string, reason: string): Promise<boolean> {
        const target = await resolveUnsubscribeTarget(token);
        if (!target) return false;
        const [row] = await database.select({ id: emailUnsubscribes.id }).from(emailUnsubscribes)
            .where(organizationUnsubscribeCondition(target.orgId, target.email))
            .orderBy(asc(emailUnsubscribes.unsubscribedAt), asc(emailUnsubscribes.id)).limit(1);
        if (!row) return false;
        await database.update(emailUnsubscribes).set({ reason }).where(eq(emailUnsubscribes.id, row.id));
        return true;
    }

    return { isOrganizationUnsubscribed, isUnsubscribed, resolveWorkspaceId, resolveUnsubscribeTarget, recordUnsubscribe, attachUnsubscribeReason };
}
