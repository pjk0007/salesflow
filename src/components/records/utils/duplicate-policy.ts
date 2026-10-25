/**
 * 파티션 중복 정책을 가져오기 화면에 알리는 규칙(UX-070).
 * 가져오기의 '건너뛰기/에러 표시' 선택은 정책이 '거부'일 때만 쓰인다 — 병합·교체·허용이면 서버가 그 정책을 따른다
 * (src/lib/record-import.ts insertImportedRecords).
 */
export type DuplicateActionType = "reject" | "allow" | "merge" | "delete_old";

export interface ImportDuplicatePolicy {
    /** 중복 기준 필드 이름(label). 없으면 null */
    fieldLabel: string | null;
    action: DuplicateActionType;
    /** '건너뛰기/에러 표시' 선택을 보여줄지 */
    askSkipOrError: boolean;
    notice: string;
}

export function importDuplicatePolicy(
    partition: { duplicateConfig?: { field?: string; action?: string } | null; duplicateCheckField?: string | null } | null | undefined,
    fields: { key: string; label: string }[],
): ImportDuplicatePolicy {
    const field = partition?.duplicateConfig?.field || partition?.duplicateCheckField || null;
    const raw = partition?.duplicateConfig?.action;
    const action: DuplicateActionType = raw === "allow" || raw === "merge" || raw === "delete_old" ? raw : "reject";
    if (!field) {
        return { fieldLabel: null, action, askSkipOrError: false, notice: "중복 기준 필드가 없어 모든 행을 새 레코드로 등록합니다." };
    }
    const fieldLabel = fields.find((f) => f.key === field)?.label ?? field;
    const notice = {
        reject: `'${fieldLabel}' 값이 같은 기존 레코드가 있으면 아래 선택대로 처리합니다.`,
        merge: `이 파티션은 '${fieldLabel}' 값이 같으면 기존 레코드에 파일 값을 덮어씁니다(병합). 새 레코드는 생기지 않습니다.`,
        delete_old: `이 파티션은 '${fieldLabel}' 값이 같으면 기존 레코드를 삭제하고 새로 만듭니다(교체). 기존 레코드의 메모·이력도 함께 사라집니다.`,
        allow: `이 파티션은 중복을 허용해 '${fieldLabel}' 값이 같아도 새 레코드로 등록합니다.`,
    }[action];
    return { fieldLabel, action, askSkipOrError: action === "reject", notice };
}
