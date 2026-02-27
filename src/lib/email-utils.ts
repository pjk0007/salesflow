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
