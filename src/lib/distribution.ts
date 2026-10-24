import { partitions } from "@/lib/db/schema";
import { and, eq, sql } from "drizzle-orm";
import type { RecordDb } from "@/lib/record-create";

interface DistributionResult {
    distributionOrder: number;
    defaults: Record<string, unknown>;
}

/**
 * 원자적 라운드로빈 할당.
 * 단일 UPDATE + RETURNING으로 race condition 방지.
 * 결과는 쿼리 빌더의 returning 배열로 읽는다 — postgres-js의 execute 결과는 배열이라 `.rows`가 없다 (UX-037).
 */
export async function assignDistributionOrder(
    tx: RecordDb,
    partitionId: number
): Promise<DistributionResult | null> {
    const [row] = await tx
        .update(partitions)
        .set({
            // max_distribution_order가 0이면 0으로 나누기 오류가 나므로 최소 1로 본다
            lastAssignedOrder: sql`(${partitions.lastAssignedOrder} % GREATEST(${partitions.maxDistributionOrder}, 1)) + 1`,
        })
        .where(and(eq(partitions.id, partitionId), eq(partitions.useDistributionOrder, 1)))
        .returning({
            order: partitions.lastAssignedOrder,
            allDefaults: partitions.distributionDefaults,
        });

    if (!row) return null;

    const order = row.order;
    const allDefaults = row.allDefaults;
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
