// 시스템 필드 매핑 정의
// 필드를 만들 때 "시스템 필드"를 선택하면 records의 시스템 컬럼 값을 보여준다.
// (커스텀 data 필드가 아니라 records.{registered_at|created_at|updated_at}을 직접 읽음)

export const SYSTEM_FIELD_COLUMNS = [
    { value: "registeredAt", label: "등록일" },
    { value: "updatedAt", label: "수정일" },
] as const;

export type SystemFieldColumn = typeof SYSTEM_FIELD_COLUMNS[number]["value"];

export function isValidSystemColumn(v: unknown): v is SystemFieldColumn {
    return typeof v === "string" && SYSTEM_FIELD_COLUMNS.some((c) => c.value === v);
}

export function getSystemColumnLabel(value: string): string {
    return SYSTEM_FIELD_COLUMNS.find((c) => c.value === value)?.label ?? value;
}
