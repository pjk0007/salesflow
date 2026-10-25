import { isValidYmd } from "@/lib/tracker/date-range";

export function isCompleteRecordFilter(filter: unknown): boolean {
    if (!filter || typeof filter !== "object") return false;
    const f = filter as { field?: unknown; operator?: unknown; value?: unknown; valueTo?: unknown };
    if (typeof f.field !== "string" || !f.field.trim()) return false;
    if (["is_empty", "is_not_empty", "is_true", "is_false"].includes(String(f.operator))) return true;
    if (f.value === null || f.value === undefined || f.value === "" || typeof f.value === "object") return false;
    if (["contains", "equals", "not_equals"].includes(String(f.operator))) return true;
    if (["gt", "gte", "lt", "lte"].includes(String(f.operator))) return Number.isFinite(Number(f.value));
    if (["before", "after"].includes(String(f.operator))) return isValidYmd(String(f.value));
    if (f.operator === "between") return isValidYmd(String(f.value)) && isValidYmd(String(f.valueTo)) && String(f.value) <= String(f.valueTo);
    return false;
}
