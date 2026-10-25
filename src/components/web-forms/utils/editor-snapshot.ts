import type { FormFieldItem } from "../FormBuilder";

export interface WebFormEditorValues {
    name: string;
    title: string;
    description: string;
    completionTitle: string;
    completionMessage: string;
    completionButtonText: string;
    completionButtonUrl: string;
    coverImageUrl: string;
    coverColor: string;
    defaultValues: { field: string; value: string }[];
    fields: FormFieldItem[];
}

/**
 * 편집 화면의 저장 대상 값을 비교용 문자열로 만든다 (UX-048 미저장 이탈 확인).
 * 화면용 tempId와 저장 후 채워지는 서버 id는 내용 변경이 아니므로 뺀다.
 */
export function webFormEditorSnapshot(values: WebFormEditorValues): string {
    return JSON.stringify({
        ...values,
        fields: values.fields.map((f) => [f.label, f.description, f.placeholder, f.fieldType, f.linkedFieldKey, f.isRequired, f.options]),
    });
}

/** 연결 속성이 없어 제출 답이 레코드에 저장되지 않는 질문 (UX-045) */
export function unlinkedFields(fields: FormFieldItem[]): FormFieldItem[] {
    return fields.filter((f) => !f.linkedFieldKey);
}
