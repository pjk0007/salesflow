// 레코드 테이블의 시스템 컬럼 정의
// visibleFieldKeys 와 동일한 인터페이스로 토글 가능하도록 일반 FieldDefinition 형태로 노출

import type { FieldDefinition } from "@/types";

export const SYSTEM_COLUMN_KEYS = {
    registeredAt: "__registeredAt__",
} as const;

export type SystemColumnKey = typeof SYSTEM_COLUMN_KEYS[keyof typeof SYSTEM_COLUMN_KEYS];

// 토글 popover에서 일반 필드와 함께 표시하기 위한 가상 FieldDefinition
// 실제 렌더링은 RecordTable에서 별도 분기로 처리한다.
export const SYSTEM_COLUMNS: FieldDefinition[] = [
    {
        id: -1,
        workspaceId: 0,
        fieldTypeId: null,
        key: SYSTEM_COLUMN_KEYS.registeredAt,
        label: "등록일",
        fieldType: "datetime",
        category: null,
        sortOrder: -1,
        isRequired: false,
        isSystem: true,
        isSortable: true,
        defaultWidth: 150,
        minWidth: 120,
        cellType: "readonly",
        cellClassName: null,
        options: null,
        optionColors: null,
        optionStyle: null,
        isGroupable: false,
        statusOptionCategoryId: null,
        defaultValue: null,
        formulaConfig: null,
    },
];

export function isSystemColumnVisible(
    visibleFieldKeys: string[] | null,
    columnKey: SystemColumnKey,
): boolean {
    // null → 전체 표시 모드 (시스템 컬럼도 기본 ON)
    if (!visibleFieldKeys) return true;
    return visibleFieldKeys.includes(columnKey);
}
