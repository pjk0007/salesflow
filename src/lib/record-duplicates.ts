import { and, count, eq, inArray, sql } from "drizzle-orm";
import { db, records } from "@/lib/db";

type SelectDb = Pick<typeof db, "select">;

/**
 * 중복 행 색상 표시 — 지금 페이지에 보이는 값 중 파티션 전체에서 2건 이상인 값(UX-081).
 * 페이지 50건 안에서만 비교하면 다른 페이지의 중복을 놓친다. 질의는 페이지 값으로 좁힌 GROUP BY 1회.
 */
export async function findDuplicateValues(
    exec: SelectDb,
    input: { orgId: string; partitionId: number; field: string; values: string[] },
): Promise<Set<string>> {
    const values = [...new Set(input.values.filter((v) => v !== ""))];
    if (values.length === 0) return new Set();
    const valueSql = sql<string>`${records.data}->>${input.field}`;
    const rows = await exec
        .select({ value: valueSql, cnt: count() })
        .from(records)
        .where(and(eq(records.partitionId, input.partitionId), eq(records.orgId, input.orgId), inArray(valueSql, values)))
        // SELECT 식과 GROUP BY가 다른 매개변수 번호로 그려지면 PG가 같은 식으로 보지 않는다 → 위치(1)로 묶는다
        .groupBy(sql`1`)
        .having(sql`count(*) > 1`);
    return new Set(rows.map((r) => String(r.value)));
}

/** 레코드 data에서 비교용 문자열 값(화면이 하던 String 변환과 같다) */
export function duplicateKeyOf(data: unknown, field: string): string {
    const v = (data as Record<string, unknown> | null)?.[field];
    if (v === null || v === undefined) return "";
    return typeof v === "string" ? v : JSON.stringify(v);
}
