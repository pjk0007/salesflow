import type { FieldDefinition, FieldType } from "@/types";

/** 영업 리드 공통 칸 — 엑셀 가져오기 칸 맞추기·명함 여러 장 검토에 쓴다 (서버 /api/sales/leads/bulk KEYS와 같음) */
export const SALES_IMPORT_COLUMNS: Array<{ key: string; label: string; fieldType: FieldType }> = [
    { key: "companyName", label: "기업명", fieldType: "text" },
    { key: "name", label: "이름", fieldType: "text" },
    { key: "contactTitle", label: "직책", fieldType: "text" },
    { key: "phone", label: "연락처", fieldType: "phone" },
    { key: "email", label: "이메일", fieldType: "email" },
    { key: "address", label: "주소", fieldType: "text" },
    { key: "profileNote", label: "메모", fieldType: "textarea" },
];

/** 레코드 가져오기 창(ImportDialog)에 그대로 넘길 수 있는 칸 정의 */
export const SALES_IMPORT_FIELDS: FieldDefinition[] = SALES_IMPORT_COLUMNS.map((c, i) => ({
    id: -(i + 1),
    workspaceId: 0,
    fieldTypeId: null,
    key: c.key,
    label: c.label,
    fieldType: c.fieldType,
    category: null,
    sortOrder: i,
    isRequired: false,
    isSystem: false,
    isSortable: false,
    defaultWidth: 160,
    minWidth: 80,
    cellType: null,
    cellClassName: null,
    options: null,
    optionColors: null,
    optionStyle: null,
    isGroupable: false,
    statusOptionCategoryId: null,
    defaultValue: null,
    formulaConfig: null,
    systemColumn: null,
    trackHistory: false,
}));
