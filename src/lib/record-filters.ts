import { records } from "@/lib/db/schema";
import { eq, sql, type SQL } from "drizzle-orm";
import { isValidYmd } from "@/lib/tracker/date-range";
import { isCompleteRecordFilter } from "@/lib/record-filter-input";

export interface RecordFilter {
    field: string;
    operator: string;
    value: unknown;
    valueTo?: unknown;
}

export interface RecordConditionOptions {
    orgId?: string;
    search?: string;
    distributionOrder?: number;
    groupBy?: string | null;
    groupValue?: string | null;
    filters?: RecordFilter[];
}

/** 빈 문자열·형식 밖 값은 NULL로 비교에서 제외한다. */
export function recordNumberSql(key: string): SQL {
    const value = sql`${records.data}->>${key}`;
    return sql`(CASE WHEN length(${value}) < 1000 AND ${value} ~ '^-?[0-9]+([.][0-9]+)?$' THEN (${value})::numeric END)`;
}

export function recordCheckboxSql(key: string): SQL {
    return sql`(lower(trim(COALESCE(${records.data}->>${key}, ''))) IN ('true', '1'))`;
}

function literalPattern(value: string): string {
    return `%${value.replace(/[\\%_]/g, "\\$&")}%`;
}

/**
 * 날짜·시간 속성 값의 KST 날짜(SQL date).
 *
 * date 속성("YYYY-MM-DD")은 그대로, datetime 속성(UTC ISO처럼 시간대가 붙은 값)은 KST로 바꿔
 * 날짜를 뽑는다 — DB 세션 시간대와 무관하다. 시간대 없는 일시는 적힌 날짜를 쓴다.
 * 날짜 모양이 아닌 값은 NULL이라 비교에서 빠진다.
 * 필드 타입 대신 값의 모양으로 분기해 목록·조건 삭제·내보내기·그룹 수가 같은 의미로 거른다.
 */
function validRecordDateValueSql(key: string): SQL {
    const v = sql`${records.data}->>${key}`;
    // 모양 검사 뒤에만 정수 변환한다. 달력·윤년·시각·오프셋 검증 없이 ::date로 넘기면 전체 조회가 실패한다.
    return sql`(CASE WHEN ${v} ~ '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])([T ]([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9]([.][0-9]{1,6})?)?(Z|[+-](0[0-9]|1[0-4])(:?[0-5][0-9])?)?)?$'
        THEN CASE WHEN left(${v}, 4)::int > 0 AND substring(${v}, 9, 2)::int <=
            CASE substring(${v}, 6, 2)::int
                WHEN 2 THEN CASE WHEN left(${v}, 4)::int % 400 = 0 OR (left(${v}, 4)::int % 4 = 0 AND left(${v}, 4)::int % 100 <> 0) THEN 29 ELSE 28 END
                WHEN 4 THEN 30 WHEN 6 THEN 30 WHEN 9 THEN 30 WHEN 11 THEN 30 ELSE 31
            END THEN ${v} END
    END)`;
}

export function recordKstDateSql(key: string): SQL {
    return sql`(SELECT CASE
        WHEN value ~ '(Z|[+-][0-9]{2}(:?[0-9]{2})?)$' AND length(value) > 10
            THEN (value::timestamptz AT TIME ZONE 'Asia/Seoul')::date
        ELSE left(value, 10)::date END
        FROM (SELECT ${validRecordDateValueSql(key)} AS value) AS safe_record_date)`;
}

/** 정렬도 같은 가드를 사용한다. 시간대 없는 입력은 제품 날짜 기준(KST)으로 해석한다. */
export function recordDateTimeSql(key: string): SQL {
    return sql`(SELECT CASE
        WHEN value ~ '(Z|[+-][0-9]{2}(:?[0-9]{2})?)$' AND length(value) > 10 THEN value::timestamptz
        ELSE value::timestamp AT TIME ZONE 'Asia/Seoul' END
        FROM (SELECT ${validRecordDateValueSql(key)} AS value) AS safe_record_datetime)`;
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
    { orgId, search, distributionOrder, groupBy, groupValue, filters = [] }: RecordConditionOptions,
): SQL[] {
    const conditions: SQL[] = [eq(records.partitionId, partitionId)];
    if (orgId) conditions.push(eq(records.orgId, orgId));

    if (search) {
        const pattern = literalPattern(search);
        conditions.push(sql`(${records.integratedCode} ILIKE ${pattern} OR EXISTS (
            SELECT 1 FROM jsonb_each_text(CASE WHEN jsonb_typeof(${records.data}) = 'object' THEN ${records.data} ELSE '{}'::jsonb END) AS entry
            WHERE left(entry.key, 1) <> '_' AND entry.value ILIKE ${pattern}
        ))`);
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

    // 잘못된 조건을 생략하면 조건 삭제가 파티션 전체 삭제로 넓어질 수 있으므로 아무 행도 매칭하지 않는다.
    if (!Array.isArray(filters)) return [...conditions, sql`false`];
    for (const f of filters) {
        if (!isCompleteRecordFilter(f)) {
            conditions.push(sql`false`);
            continue;
        }
        const key = f.field;
        const val = f.value;
        switch (f.operator) {
            case "contains":
                conditions.push(sql`${records.data}->>${key} ILIKE ${literalPattern(String(val))}`);
                break;
            case "equals":
                conditions.push(recordEqualsSql(key, val));
                break;
            case "not_equals":
                conditions.push(sql`${records.data}->>${key} != ${String(val)}`);
                break;
            case "gt":
                conditions.push(sql`${recordNumberSql(key)} > ${Number(val)}`);
                break;
            case "gte":
                conditions.push(sql`${recordNumberSql(key)} >= ${Number(val)}`);
                break;
            case "lt":
                conditions.push(sql`${recordNumberSql(key)} < ${Number(val)}`);
                break;
            case "lte":
                conditions.push(sql`${recordNumberSql(key)} <= ${Number(val)}`);
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
                conditions.push(recordCheckboxSql(key));
                break;
            case "is_false":
                conditions.push(sql`NOT ${recordCheckboxSql(key)}`);
                break;
        }
    }

    return conditions;
}
