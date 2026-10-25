import { and, eq, inArray, type SQL } from "drizzle-orm";
import { db, records, trackerVisitors } from "@/lib/db";

type DeleteDb = Pick<typeof db, "update" | "delete">;

/** 한 번에 넘기는 id 수 — PostgreSQL 매개변수 한도(65,535)보다 충분히 작게 */
const UNLINK_CHUNK = 5000;

/**
 * 지운 레코드를 가리키던 트래커 방문자의 연결을 끊는다(익명으로 되돌림, 방문 기록은 보존).
 * 같은 사람이 다시 제출하면 recordId가 빈 방문자만 매칭하므로, 끊지 않으면 새 레코드에 과거 방문이 이어지지 않는다(UX-064).
 * record_events·visitor_record_links·memos는 FK CASCADE로 함께 정리된다.
 */
export async function unlinkVisitorsFromRecords(exec: DeleteDb, orgId: string, recordIds: number[]): Promise<void> {
    for (let i = 0; i < recordIds.length; i += UNLINK_CHUNK) {
        const chunk = recordIds.slice(i, i + UNLINK_CHUNK);
        await exec
            .update(trackerVisitors)
            .set({ recordId: null })
            .where(and(eq(trackerVisitors.orgId, orgId), inArray(trackerVisitors.recordId, chunk)));
    }
}

/**
 * 조직 레코드 삭제 공용(단건·일괄·조건 삭제) — 삭제와 방문자 연결 해제를 한 트랜잭션으로 묶는다.
 */
export async function deleteRecordsWhere(
    orgId: string,
    conditions: SQL[],
    root: Pick<typeof db, "transaction"> = db,
): Promise<{ id: number; partitionId: number }[]> {
    return root.transaction(async (tx) => {
        const deleted = await tx
            .delete(records)
            .where(and(eq(records.orgId, orgId), ...conditions))
            .returning({ id: records.id, partitionId: records.partitionId });
        await unlinkVisitorsFromRecords(tx, orgId, deleted.map((d) => d.id));
        return deleted;
    });
}
