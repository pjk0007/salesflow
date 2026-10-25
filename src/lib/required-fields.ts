/**
 * 필수 항목 빈 값 판정 — 화면 검사와 서버 검사가 같은 기준을 쓴다 (UX-036).
 * 공백만 든 문자열도 비어 있는 것으로 본다.
 */
export function isBlankRequiredValue(value: unknown): boolean {
    return value === undefined || value === null || (typeof value === "string" && value.trim() === "");
}

export interface RequiredFieldLike {
    key: string;
    label: string;
    fieldType: string;
    cellType?: string | null;
    isRequired: boolean | number | null;
}

/** 직접 입력하는 필드(수식·읽기 전용 제외) — 레코드 추가 창이 보여주는 필드와 같다 */
export function isEditableField(field: Pick<RequiredFieldLike, "fieldType" | "cellType">): boolean {
    return field.fieldType !== "formula" && field.cellType !== "readonly";
}

/** 값이 빠진 필수 필드 목록 (입력 순서 유지) */
export function missingRequiredFields<F extends RequiredFieldLike>(fields: F[], data: Record<string, unknown>): F[] {
    return fields.filter((f) => !!f.isRequired && isEditableField(f) && isBlankRequiredValue(data[f.key]));
}

export function requiredFieldMessage(field: Pick<RequiredFieldLike, "label">): string {
    return `${field.label}은(는) 필수 항목입니다.`;
}
