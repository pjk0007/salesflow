import type { AttributeRow } from "../types";
export function attributeRows(value: Record<string, unknown>): AttributeRow[] {
    return Object.entries(value).map(([key, v], i) => ({
        id: String(i),
        key,
        type:
            v === null
                ? "null"
                : typeof v === "number"
                  ? "number"
                  : typeof v === "boolean"
                    ? "boolean"
                    : typeof v === "string"
                      ? "text"
                      : "json",
        value: typeof v === "string" ? v : JSON.stringify(v),
    }));
}
export function parseAttributeRows(rows: AttributeRow[]): {
    value: Record<string, unknown>;
    error: string;
} {
    const entries: [string, unknown][] = [];
    const keys = new Set<string>();
    for (const row of rows) {
        const key = row.key.trim();
        if (!key || key.length > 100)
            return { value: {}, error: "속성 이름은 1~100자로 입력해주세요." };
        if (keys.has(key))
            return { value: {}, error: `‘${key}’ 속성 이름이 중복됩니다.` };
        keys.add(key);
        let value: unknown = row.value;
        if (row.type === "number") {
            value = Number(row.value);
            if (!row.value.trim() || !Number.isFinite(value))
                return {
                    value: {},
                    error: `‘${key}’에 올바른 숫자를 입력해주세요.`,
                };
        }
        if (row.type === "boolean") value = row.value === "true";
        if (row.type === "null") value = null;
        if (row.type === "json") {
            try {
                value = JSON.parse(row.value);
            } catch {
                return {
                    value: {},
                    error: `‘${key}’의 JSON 형식을 확인해주세요.`,
                };
            }
        }
        entries.push([key, value]);
    }
    const value = Object.fromEntries(entries);
    if (JSON.stringify(value).length > 12000)
        return {
            value: {},
            error: "추가 속성은 합계 12,000자까지 저장할 수 있습니다.",
        };
    return { value, error: "" };
}
