export function extractEmailVariables(content: string): string[] {
    const matches = content.match(/##([^#]+)##/g);
    if (!matches) return [];
    return [...new Set(matches)];
}

export function substituteVariables(
    text: string,
    mappings: Record<string, string>,
    data: Record<string, unknown>
): string {
    let result = text;
    for (const [variable, fieldKey] of Object.entries(mappings)) {
        const value = data[fieldKey] != null ? String(data[fieldKey]) : "";
        result = result.replaceAll(variable, value);
    }
    return result;
}

/**
 * 템플릿(제목·본문 등)에 있지만 연결의 변수 매핑에 없는 변수. substituteVariables는 매핑에 있는 변수만 바꾸므로
 * 여기 나온 변수는 '##회사명##' 원문 그대로 고객에게 나간다 — 발송 경로(수동·자동·후속)는 비어 있지 않으면 보내지 않는다 (UX-163).
 * 매핑 값이 빈 문자열이면 연결 화면에서 '선택 안 함'이라 매핑 없음으로 본다.
 */
export function unmappedEmailVariables(texts: ReadonlyArray<string | null | undefined>, mappings: Record<string, string> | null | undefined): string[] {
    const used = extractEmailVariables(texts.filter(Boolean).join("\n"));
    return used.filter((variable) => !mappings?.[variable]);
}

/** 매핑 누락으로 보내지 않았을 때의 안내 (수동 발송 결과·자동 발송 이력) */
export function unmappedVariablesMessage(variables: readonly string[]): string {
    return `변수 매핑이 누락되어 발송하지 않았습니다 (${variables.join(", ")}). 템플릿 연결에서 변수를 연결해주세요.`;
}

/**
 * AI 자동발송용: ##필드명## 패턴을 감지해서 recordData의 동일 키 값으로 치환.
 * 값이 없으면 빈 문자열로 치환.
 */
export function substitutePromptVariables(
    text: string,
    data: Record<string, unknown> | null | undefined
): string {
    if (!text || !data) return text;
    return text.replace(/##([^#\s]+)##/g, (_match, key: string) => {
        const value = data[key];
        return value != null && value !== "" ? String(value) : "";
    });
}
