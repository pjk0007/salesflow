import { and, count, desc, eq, inArray, or, sql } from "drizzle-orm";
import { db, partitions, records, workspaces } from "@/lib/db";
import { filterAccessiblePartitions, loadOrgScopes } from "@/lib/partition-access";
import { ensureCategoryFieldType } from "@/lib/leads/lead-field-type";
import { salesExtrasFor } from "./extras";
import type { OrgRole } from "@/types";

type User = { userId: string; orgId: string; role: OrgRole };

/** 사용자가 볼 수 있는 영업 파티션 (관리자는 전부) */
export async function visibleSalesPartitions(user: User) {
    const parts = await db
        .select({ id: partitions.id, folderId: partitions.folderId, workspaceId: partitions.workspaceId })
        .from(partitions)
        .innerJoin(workspaces, eq(workspaces.id, partitions.workspaceId))
        .where(and(eq(workspaces.orgId, user.orgId), eq(partitions.category, "sales")));
    if (user.role !== "member") return parts;
    const orgScopes = await loadOrgScopes(user.orgId);
    return filterAccessiblePartitions({ user, partitions: parts, permission: "read", orgScopes });
}

/**
 * 영업 리드 목록 — 사업부 탭(workspaceId)이면 그 사업부에 등록됐거나 사업부 목록(data.workspaceIds)에 그 사업부가 있는 리드,
 * 없으면 전체. mine이면 내 담당만.
 */
export async function listSalesLeads(
    user: User,
    opts: { workspaceId: number | null; mine: boolean; search: string; page: number; pageSize: number },
) {
    const parts = await visibleSalesPartitions(user);
    if (parts.length === 0) return { data: [], total: 0, page: opts.page, pageSize: opts.pageSize, totalPages: 0 };
    const conds = [eq(records.orgId, user.orgId), inArray(records.partitionId, parts.map((p) => p.id))];
    if (opts.workspaceId) {
        conds.push(
            or(
                eq(records.workspaceId, opts.workspaceId),
                sql`coalesce(${records.data}->'workspaceIds', '[]'::jsonb) @> ${JSON.stringify([opts.workspaceId])}::jsonb`,
            )!,
        );
    }
    if (opts.mine) conds.push(sql`${records.data}->>'owner' = ${user.userId}`);
    if (opts.search) conds.push(sql`${records.data}::text ILIKE ${"%" + opts.search + "%"}`);
    const where = and(...conds);
    const [{ value: total }] = await db.select({ value: count() }).from(records).where(where);
    const rows = await db
        .select({
            id: records.id,
            orgId: records.orgId,
            workspaceId: records.workspaceId,
            partitionId: records.partitionId,
            integratedCode: records.integratedCode,
            data: records.data,
            distributionOrder: records.distributionOrder,
            registeredAt: records.registeredAt,
            createdAt: records.createdAt,
            updatedAt: records.updatedAt,
        })
        .from(records)
        .where(where)
        .orderBy(desc(records.registeredAt), desc(records.id))
        .limit(opts.pageSize)
        .offset((opts.page - 1) * opts.pageSize);
    const extras = await salesExtrasFor(
        rows.map((r) => r.id),
        rows,
    );
    return {
        data: rows.map((r) => ({ ...r, sales: extras.get(r.id) })),
        total,
        page: opts.page,
        pageSize: opts.pageSize,
        totalPages: Math.ceil(total / opts.pageSize),
    };
}

/** 사업부의 영업 리드함 — 없으면 만든다 */
export async function salesPartitionFor(workspaceId: number) {
    const [existing] = await db
        .select({ id: partitions.id })
        .from(partitions)
        .where(and(eq(partitions.workspaceId, workspaceId), eq(partitions.category, "sales")))
        .orderBy(partitions.id)
        .limit(1);
    if (existing) return existing.id;
    const [created] = await db
        .insert(partitions)
        .values({ workspaceId, name: "영업 리드", category: "sales", visibleFields: [], folderId: null })
        .returning({ id: partitions.id });
    await ensureCategoryFieldType(created.id, "sales");
    return created.id;
}


/** 사업부별 영업 리드 수 — 등록 사업부 + 추가로 고른 사업부(data.workspaceIds) 모두 센다 */
export async function salesWorkspaceCounts(user: User) {
    const parts = await visibleSalesPartitions(user);
    if (parts.length === 0) return [];
    const rows = await db.execute<{ workspace_id: number; leads: number }>(sql`
        SELECT ws_id AS workspace_id, count(DISTINCT id)::int AS leads
        FROM (
            SELECT r.id, r.workspace_id AS ws_id FROM records r
            WHERE r.org_id = ${user.orgId} AND r.partition_id IN (${sql.join(parts.map((p) => sql`${p.id}`), sql`, `)})
            UNION ALL
            SELECT r.id, (jsonb_array_elements_text(r.data->'workspaceIds'))::int AS ws_id FROM records r
            WHERE r.org_id = ${user.orgId} AND r.partition_id IN (${sql.join(parts.map((p) => sql`${p.id}`), sql`, `)})
              AND jsonb_typeof(r.data->'workspaceIds') = 'array'
        ) t
        GROUP BY ws_id
    `);
    return Array.from(rows).map((r) => ({ workspaceId: r.workspace_id, leads: r.leads }));
}

/** 영업 리드의 기업 목록 (같은 기업 이름 규칙으로 묶어 대표 이름·인원) — 기업 옮기기에서 고른다 */
export async function listSalesCompanies(user: User) {
    const parts = await visibleSalesPartitions(user);
    if (parts.length === 0) return [];
    const rows = await db
        .select({
            name: sql<string>`trim(coalesce(${records.data}->>'companyName', ${records.data}->>'companyname', ''))`,
            address: sql<string>`trim(coalesce(${records.data}->>'address', ''))`,
            workspaceId: records.workspaceId,
            workspaceIds: sql<unknown>`${records.data}->'workspaceIds'`,
        })
        .from(records)
        .where(and(eq(records.orgId, user.orgId), inArray(records.partitionId, parts.map((p) => p.id))));
    const by = new Map<string, { name: string; count: number; address: string; workspaceIds: Set<number> }>();
    for (const r of rows) {
        if (!r.name) continue;
        const key = r.name.toLowerCase().replace(/\(주\)|㈜|주식회사|\s/g, "");
        const g = by.get(key) ?? { name: r.name, count: 0, address: "", workspaceIds: new Set<number>() };
        g.count++;
        if (!g.address && r.address) g.address = r.address;
        if (r.workspaceId) g.workspaceIds.add(r.workspaceId);
        if (Array.isArray(r.workspaceIds)) for (const w of r.workspaceIds) if (Number(w)) g.workspaceIds.add(Number(w));
        by.set(key, g);
    }
    return [...by.values()]
        .map((g) => ({ ...g, workspaceIds: [...g.workspaceIds] }))
        .sort((a, b) => a.name.localeCompare(b.name, "ko"));
}
