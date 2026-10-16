export const sourceNames: Record<string, string> = {
    staff: "직접 편집",
    api: "API 연동",
    workflow: "고객 자동화",
    import: "자료 이전",
    email: "메일 수신",
    system: "시스템",
};
export const actionNames: Record<string, string> = {
    created: "등록",
    updated: "수정",
    archived: "보관",
    restored: "복구",
};
const fields: Record<string, string> = {
    name: "이름",
    email: "이메일",
    phone: "전화",
    domain: "회사 도메인",
    recordId: "샌드비 레코드",
    lifecycleStage: "고객 단계",
    isInternal: "내부 구성원",
    archivedAt: "보관 시각",
    companyIds: "연결 회사",
};
export function fieldName(key: string) {
    if (fields[key]) return fields[key];
    if (key.startsWith("attributes[")) {
        try {
            return `추가 속성 · ${JSON.parse(key.slice(11, -1))}`;
        } catch {}
    }
    return key;
}
export function changeValue(value: unknown, present: boolean, label?: string) {
    return (
        label ??
        (!present
            ? "미설정"
            : value === null
              ? "비어 있음"
              : value === ""
                ? "빈 문자열"
                : typeof value === "string"
                  ? value
                  : JSON.stringify(value))
    );
}
