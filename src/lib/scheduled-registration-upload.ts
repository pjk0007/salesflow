import type { db } from "@/lib/db";
import { scheduledRegistrations } from "@/lib/db/schema";
import { parseCheckboxValue } from "@/lib/checkbox-value";

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

/**
 * 업로드 행 → 레코드 data. 체크박스 열은 "TRUE"/"1"만 참인 boolean으로 바꾼다 — "FALSE"·"0"이 문자열로 남아
 * '체크됨'으로 보이지 않게 한다 (UX-046). 빈 칸은 기존처럼 빈 문자열로 둔다.
 */
export function mapScheduledRow(row: unknown[], colKey: Array<string | null>, checkboxKeys: ReadonlySet<string>): Record<string, unknown> {
    const data: Record<string, unknown> = {};
    for (let c = 0; c < colKey.length; c++) {
        const key = colKey[c];
        if (!key) continue;
        const value = row[c] ?? "";
        data[key] = checkboxKeys.has(key) && value !== "" ? parseCheckboxValue(value) : value;
    }
    return data;
}
