import { db, partitions } from "@/lib/db";
import { eq, sql } from "drizzle-orm";
import type { PgTransaction } from "drizzle-orm/pg-core";

interface DistributionResult {
    distributionOrder: number;
    defaults: Record<string, unknown>;
}

/**
 * 원자적 라운드로빈 할당.
 * 단일 UPDATE + RETURNING으로 race condition 방지.
 */
export async function assignDistributionOrder(
    tx: PgTransaction<any, any, any>,
    partitionId: number
): Promise<DistributionResult | null> {
    const result = await tx.execute(sql`
        UPDATE partitions
        SET last_assigned_order = (last_assigned_order % max_distribution_order) + 1
        WHERE id = ${partitionId} AND use_distribution_order = 1
        RETURNING last_assigned_order, distribution_defaults
    `);

    const row = result.rows?.[0] as
        | { last_assigned_order: number; distribution_defaults: Record<string, { field: string; value: string }[]> | null }
        | undefined;

    if (!row) return null;

    const order = row.last_assigned_order;
    const allDefaults = row.distribution_defaults;
    const defaults: Record<string, unknown> = {};

    if (allDefaults) {
        const orderDefaults = allDefaults[order];
        if (Array.isArray(orderDefaults)) {
            for (const d of orderDefaults) {
                if (d.field && d.value !== undefined && d.value !== "") {
                    defaults[d.field] = d.value;
                }
            }
        }
    }

    return { distributionOrder: order, defaults };
}
