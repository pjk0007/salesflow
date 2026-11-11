import { randomUUID } from "crypto";
import { and, eq, inArray, ne, or, sql } from "drizzle-orm";
import { db, partitions, records } from "@/lib/db";

/** 같은 기업 판단용 이름 — (주)·㈜·주식회사·띄어쓰기를 빼고 소문자 */
export const companyKeySql = sql<string>`regexp_replace(lower(coalesce(${records.data}->>'companyName', ${records.data}->>'companyname', '')), '\\(주\\)|㈜|주식회사|\\s', '', 'g')`;

export function companyKey(name: unknown): string {
    return String(name ?? "")
        .toLowerCase()
        .replace(/\(주\)|㈜|주식회사|\s/g, "");
}

/**
 * 같은 기업 담당자 — 모든 사업부의 영업 리드 중 같은 기업이거나, 같은 기업으로 묶은(data.leadGroupId) 리드
 */
export async function findRelatedLeads(orgId: string, recordId: number) {
    const [base] = await db
        .select({ id: records.id, data: records.data })
        .from(records)
        .where(and(eq(records.id, recordId), eq(records.orgId, orgId)));
    if (!base) return [];
    const data = base.data as Record<string, unknown>;
    const key = companyKey(data.companyName ?? data.companyname);
    const group = typeof data.leadGroupId === "string" ? data.leadGroupId : "";
    if (!key && !group) return [];
    return db
        .select({ id: records.id, partitionId: records.partitionId, data: records.data, registeredAt: records.registeredAt })
        .from(records)
        .innerJoin(partitions, eq(partitions.id, records.partitionId))
        .where(
            and(
                eq(records.orgId, orgId),
                eq(partitions.category, "sales"),
                ne(records.id, recordId),
                or(
                    key ? sql`${companyKeySql} = ${key}` : undefined,
                    group ? sql`${records.data}->>'leadGroupId' = ${group}` : undefined,
                ),
            ),
        )
        .orderBy(records.registeredAt)
        .limit(50);
}

/**
 * 고른 리드들을 같은 기업으로 묶는다 — 기준 기업명(companyName)으로 이름을 맞추고, 원래 이름은 originalCompanyName에 남겨
 * 나중에 분리하면 되돌린다. 이미 묶인 묶음이 있으면 그 묶음 전체를 합친다.
 */
export async function linkLeads(orgId: string, recordIds: number[], companyName: string) {
    const rows = await db
        .select({ id: records.id, data: records.data })
        .from(records)
        .where(and(eq(records.orgId, orgId), inArray(records.id, recordIds)));
    const groups = [...new Set(rows.map((r) => (r.data as Record<string, unknown>).leadGroupId).filter((g): g is string => typeof g === "string" && !!g))];
    const target = groups[0] ?? randomUUID();
    const members = groups.length
        ? await db
              .select({ id: records.id, data: records.data })
              .from(records)
              .where(and(eq(records.orgId, orgId), sql`${records.data}->>'leadGroupId' IN (${sql.join(groups.map((g) => sql`${g}`), sql`, `)})`))
        : [];
    const all = new Map([...rows, ...members].map((r) => [r.id, r]));
    await db.transaction(async (tx) => {
        for (const r of all.values()) {
            const data = { ...(r.data as Record<string, unknown>) };
            const current = String(data.companyName ?? data.companyname ?? "");
            if (current !== companyName && data.originalCompanyName === undefined) data.originalCompanyName = current;
            data.companyName = companyName;
            data.leadGroupId = target;
            await tx.update(records).set({ data, updatedAt: new Date() }).where(eq(records.id, r.id));
        }
    });
    return { groupId: target, count: all.size };
}

export async function unlinkLead(orgId: string, recordId: number) {
    const [r] = await db.select({ data: records.data }).from(records).where(and(eq(records.id, recordId), eq(records.orgId, orgId)));
    if (!r) return;
    // 묶을 때 바꾼 기업명을 원래대로
    const data = { ...(r.data as Record<string, unknown>) };
    delete data.leadGroupId;
    if (typeof data.originalCompanyName === "string") data.companyName = data.originalCompanyName;
    delete data.originalCompanyName;
    await db.update(records).set({ data, updatedAt: new Date() }).where(eq(records.id, recordId));
}
