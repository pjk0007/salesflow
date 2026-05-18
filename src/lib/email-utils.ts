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
