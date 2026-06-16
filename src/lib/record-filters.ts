import { records } from "@/lib/db";
import { eq, sql, type SQL } from "drizzle-orm";

export interface RecordFilter {
    field: string;
    operator: string;
    value: unknown;
    valueTo?: unknown;
}

export interface RecordConditionOptions {
    search?: string;
    distributionOrder?: number;
    groupBy?: string | null;
    groupValue?: string | null;
    filters?: RecordFilter[];
}

/**
 * 레코드 목록/삭제 공용 — 파티션 + 검색/분배/그룹/필드필터 조건을 SQL 배열로 구성.
 * 목록 GET과 조건 삭제가 **동일한 의미**로 매칭하도록 한 곳에서 관리한다.
 */
export function buildRecordConditions(
    partitionId: number,
    { search, distributionOrder, groupBy, groupValue, filters = [] }: RecordConditionOptions,
): SQL[] {
    const conditions: SQL[] = [eq(records.partitionId, partitionId)];

    if (search) {
        conditions.push(sql`${records.data}::text ILIKE ${"%" + search + "%"}`);
    }

    if (distributionOrder !== undefined) {
        conditions.push(eq(records.distributionOrder, distributionOrder));
    }

    if (groupBy) {
        if (!groupValue) {
            conditions.push(sql`(${records.data}->>${groupBy} IS NULL OR ${records.data}->>${groupBy} = '')`);
        } else {
            conditions.push(sql`${records.data}->>${groupBy} = ${groupValue}`);
        }
    }

    for (const f of filters) {
        const key = f.field;
        const val = f.value;
        switch (f.operator) {
            case "contains":
                conditions.push(sql`${records.data}->>${key} ILIKE ${"%" + val + "%"}`);
                break;
            case "equals":
                conditions.push(sql`${records.data}->>${key} = ${String(val)}`);
                break;
            case "not_equals":
                conditions.push(sql`${records.data}->>${key} != ${String(val)}`);
                break;
            case "gt":
                conditions.push(sql`(${records.data}->>${key})::numeric > ${Number(val)}`);
                break;
            case "gte":
                conditions.push(sql`(${records.data}->>${key})::numeric >= ${Number(val)}`);
                break;
            case "lt":
                conditions.push(sql`(${records.data}->>${key})::numeric < ${Number(val)}`);
                break;
            case "lte":
                conditions.push(sql`(${records.data}->>${key})::numeric <= ${Number(val)}`);
                break;
            case "before":
                conditions.push(sql`(${records.data}->>${key})::date < ${String(val)}::date`);
                break;
            case "after":
                conditions.push(sql`(${records.data}->>${key})::date > ${String(val)}::date`);
                break;
            case "between":
                conditions.push(sql`(${records.data}->>${key})::date >= ${String(val)}::date`);
                conditions.push(sql`(${records.data}->>${key})::date <= ${String(f.valueTo)}::date`);
                break;
            case "is_empty":
                conditions.push(sql`(${records.data}->>${key} IS NULL OR ${records.data}->>${key} = '')`);
                break;
            case "is_not_empty":
                conditions.push(sql`(${records.data}->>${key} IS NOT NULL AND ${records.data}->>${key} != '')`);
                break;
            case "is_true":
                conditions.push(sql`(${records.data}->>${key})::boolean = true`);
                break;
            case "is_false":
                conditions.push(sql`(${records.data}->>${key} IS NULL OR (${records.data}->>${key})::boolean = false)`);
                break;
        }
    }

    return conditions;
}
