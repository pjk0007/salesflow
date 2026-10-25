import type { db } from "@/lib/db";
import { scheduledRegistrations } from "@/lib/db/schema";

/** 업로드 전체가 커밋되거나 전부 롤백된다. 중간 배치 실패 후 앞부분만 남지 않는다. */
export async function enqueueScheduledRows(
    exec: Pick<typeof db, "transaction">,
    values: Array<typeof scheduledRegistrations.$inferInsert>,
    onProgress: (processed: number, total: number) => void,
) {
    return exec.transaction(async (tx) => {
        let inserted = 0;
        for (let i = 0; i < values.length; i += 1000) {
            const batch = values.slice(i, i + 1000);
            await tx.insert(scheduledRegistrations).values(batch);
            inserted += batch.length;
            onProgress(inserted, values.length);
        }
        return inserted;
    });
}
