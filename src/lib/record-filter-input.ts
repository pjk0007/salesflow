import { isValidYmd } from "@/lib/tracker/date-range";

export function isCompleteRecordFilter(filter: unknown): boolean {
    if (!filter || typeof filter !== "object" || Array.isArray(filter)) return false;
    const f = filter as { field?: unknown; operator?: unknown; value?: unknown; valueTo?: unknown };
    if (typeof f.field !== "string" || !f.field.trim()) return false;
    // JSON 배열을 문자열로 바꾸면 ["equals"]가 검증만 통과하고 SQL switch에서는 빠진다.
    if (typeof f.operator !== "string") return false;
    if (["is_empty", "is_not_empty", "is_true", "is_false"].includes(f.operator)) return true;
    if (f.value === null || f.value === undefined || f.value === "" || typeof f.value === "object") return false;
    if (["contains", "equals", "not_equals"].includes(f.operator)) return true;
    if (["gt", "gte", "lt", "lte"].includes(f.operator)) return Number.isFinite(Number(f.value));
    if (["before", "after"].includes(f.operator)) return isValidYmd(String(f.value));
    if (f.operator === "between") return typeof f.valueTo === "string" && isValidYmd(String(f.value)) && isValidYmd(f.valueTo) && String(f.value) <= f.valueTo;
    return false;
}
