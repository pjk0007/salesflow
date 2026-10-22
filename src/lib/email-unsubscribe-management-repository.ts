import { and, desc, eq, sql, type SQL } from "drizzle-orm";
import type { db } from "./db";
import { emailUnsubscribes, workspaces } from "./db/schema";
import { EMAIL_TRIM_CHARS, normalizeEmail } from "./deep-visitor-alert-rules";
import type { UnsubscribeEntry, UnsubscribeLookupResult, UnsubscribeTarget } from "@/components/email/unsubscribes/types";
import { parseUnsubscribeTarget } from "./email-unsubscribe-management-rules";

const fields = {
    id: emailUnsubscribes.id, email: emailUnsubscribes.email,
    workspaceId: emailUnsubscribes.workspaceId, workspaceName: workspaces.name,
    source: emailUnsubscribes.source, reason: emailUnsubscribes.reason,
    unsubscribedAt: emailUnsubscribes.unsubscribedAt,
};

function targetCondition(target: UnsubscribeTarget): SQL {
    const normalizedEmail = sql`lower(btrim(${emailUnsubscribes.email}, ${EMAIL_TRIM_CHARS}))`;
    return target.kind === "email"
        ? sql`${normalizedEmail} = ${target.query}`
        : sql`split_part(${normalizedEmail}, '@', 2) = ${target.query}`;
}

export function createUnsubscribeManagementRepository(database: Pick<typeof db, "select">) {
    async function readEntries(orgId: string, condition: SQL | undefined, page: number, pageSize: number) {
        const where = and(eq(emailUnsubscribes.orgId, orgId), condition);
        const [rows, counts] = await Promise.all([
            database.select(fields).from(emailUnsubscribes)
                .leftJoin(workspaces, and(eq(workspaces.id, emailUnsubscribes.workspaceId), eq(workspaces.orgId, orgId)))
                .where(where).orderBy(desc(emailUnsubscribes.unsubscribedAt), desc(emailUnsubscribes.id))
                .limit(pageSize).offset((page - 1) * pageSize),
            database.select({ count: sql<number>`count(*)` }).from(emailUnsubscribes).where(where),
        ]);
        const items: UnsubscribeEntry[] = rows.map((row) => ({ ...row, email: normalizeEmail(row.email), unsubscribedAt: row.unsubscribedAt.toISOString() }));
        return { items, totalCount: Number(counts[0]?.count ?? 0) };
    }
    return {
        async list(orgId: string, { q, page, pageSize }: { q: string; page: number; pageSize: number }) {
            const target = parseUnsubscribeTarget(q);
            // position() treats %, _ and other input literally; email/domain searches are exact.
            const condition = !q ? undefined : target ? targetCondition(target) : sql`position(${q} in lower(${emailUnsubscribes.email})) > 0`;
            return readEntries(orgId, condition, page, pageSize);
        },
        async lookup(orgId: string, targets: UnsubscribeTarget[]) {
            const results: UnsubscribeLookupResult[] = [];
            // Bound each domain result and use sequential targets to avoid exhausting the DB pool.
            for (const target of targets) {
                const result = await readEntries(orgId, targetCondition(target), 1, 50);
                results.push({ ...target, ...result, status: target.kind === "email" ? (result.totalCount ? "blocked" : "not_found") : (result.totalCount ? "domain_matches" : "domain_empty") });
            }
            return results;
        },
    };
}
