import { records } from "@/lib/db/schema";
import { eq, sql, type SQL } from "drizzle-orm";
import { isValidYmd } from "@/lib/tracker/date-range";

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
 * 날짜·시간 속성 값의 KST 날짜(SQL date).
 *
 * date 속성("YYYY-MM-DD")은 그대로, datetime 속성(UTC ISO처럼 시간대가 붙은 값)은 KST로 바꿔
 * 날짜를 뽑는다 — DB 세션 시간대와 무관하다. 시간대 없는 일시는 적힌 날짜를 쓴다.
 * 날짜 모양이 아닌 값은 NULL이라 비교에서 빠진다.
 * 필드 타입 대신 값의 모양으로 분기해 목록·조건 삭제·내보내기·그룹 수가 같은 의미로 거른다.
 */
export function recordKstDateSql(key: string): SQL {
    const v = sql`${records.data}->>${key}`;
    return sql`(CASE
        WHEN ${v} ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN (${v})::date
        WHEN ${v} ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}[T ][0-9]{2}:[0-9]{2}.*(Z|[+-][0-9]{2}(:?[0-9]{2})?)$'
            THEN ((${v})::timestamptz AT TIME ZONE 'Asia/Seoul')::date
        WHEN ${v} ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}[T ]' THEN left(${v}, 10)::date
    END)`;
}

/** '같음' — 값이 날짜(YYYY-MM-DD)면 날짜·시간 속성을 KST 날짜로도 비교한다. 그 밖에는 문자열 비교 */
export function recordEqualsSql(key: string, value: unknown): SQL {
    const text = String(value);
    if (!isValidYmd(text)) return sql`${records.data}->>${key} = ${text}`;
    return sql`(${records.data}->>${key} = ${text} OR ${recordKstDateSql(key)} = ${text}::date)`;
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
                conditions.push(recordEqualsSql(key, val));
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
                conditions.push(sql`${recordKstDateSql(key)} < ${String(val)}::date`);
                break;
            case "after":
                conditions.push(sql`${recordKstDateSql(key)} > ${String(val)}::date`);
                break;
            case "between":
                conditions.push(sql`${recordKstDateSql(key)} >= ${String(val)}::date`);
                conditions.push(sql`${recordKstDateSql(key)} <= ${String(f.valueTo)}::date`);
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
