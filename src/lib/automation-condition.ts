export interface TriggerCondition {
    field?: string;
    operator?: "eq" | "ne" | "contains";
    value?: string;
}
export function evaluateCondition(
    condition: TriggerCondition | null | undefined,
    data: Record<string, unknown>,
): boolean {
    if (!condition || !condition.field) return true;
    const fieldValue = String(data[condition.field] ?? ""),
        targetValue = condition.value ?? "",
        operator = condition.operator ?? "eq";
    switch (operator) {
        case "eq":
            return fieldValue === targetValue;
        case "ne":
            return fieldValue !== targetValue;
        case "contains":
            return targetValue.includes(",")
                ? targetValue.split(",").some((v) => v.trim() === fieldValue)
                : fieldValue.includes(targetValue);
        default:
            return false;
    }
}
