import { and, eq, inArray, isNull } from "drizzle-orm";
import { db, records, salesActionItems, users } from "@/lib/db";
import type { OrgRole } from "@/types";
import { visibleSalesPartitions } from "./leads";

type User = { userId: string; orgId: string; role: OrgRole };

/** 영업ToDo — 볼 수 있는 영업 리드의 액션플랜 (기본: 안 끝난 것만) + 어느 기업·누구 건인지 */
export async function listSalesTodos(user: User, opts: { includeDone: boolean }) {
    const parts = await visibleSalesPartitions(user);
    if (parts.length === 0) return [];
    const rows = await db
        .select({
            id: salesActionItems.id,
            recordId: salesActionItems.recordId,
            content: salesActionItems.content,
            ownerId: salesActionItems.ownerId,
            ownerName: users.name,
            dueAt: salesActionItems.dueAt,
            doneAt: salesActionItems.doneAt,
            createdAt: salesActionItems.createdAt,
            data: records.data,
            workspaceId: records.workspaceId,
        })
        .from(salesActionItems)
        .innerJoin(records, eq(records.id, salesActionItems.recordId))
        .leftJoin(users, eq(users.id, salesActionItems.ownerId))
        .where(
            and(
                eq(salesActionItems.orgId, user.orgId),
                inArray(records.partitionId, parts.map((p) => p.id)),
                eq(salesActionItems.status, "open"),
                opts.includeDone ? undefined : isNull(salesActionItems.doneAt),
            ),
        )
        .limit(1000);
    return rows
        .map(({ data, ...r }) => {
            const d = (data ?? {}) as Record<string, unknown>;
            return {
                ...r,
                company: String(d.companyName ?? d.companyname ?? "").trim(),
                personName: String(d.name ?? d.contactName ?? "").trim(),
                personTitle: String(d.contactTitle ?? "").trim(),
            };
        })
        .sort((a, b) => (a.dueAt?.getTime() ?? Infinity) - (b.dueAt?.getTime() ?? Infinity));
}
