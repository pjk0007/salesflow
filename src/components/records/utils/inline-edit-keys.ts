/**
 * 인라인 편집 키 동작. 긴 텍스트(textarea)는 Enter가 줄바꿈이고 Ctrl/⌘+Enter로 저장한다(UX-058).
 * 한글 조합 중 Enter는 저장하지 않는다. Esc는 항상 취소.
 */
export type InlineEditKeyAction = "save" | "cancel" | null;

export function inlineEditKeyAction(
    multiline: boolean,
    e: { key: string; ctrlKey?: boolean; metaKey?: boolean; nativeEvent?: { isComposing?: boolean; keyCode?: number } },
): InlineEditKeyAction {
    if (e.key === "Escape") return "cancel";
    if (e.key !== "Enter") return null;
    if (e.nativeEvent?.isComposing || e.nativeEvent?.keyCode === 229) return null;
    if (multiline) return e.ctrlKey || e.metaKey ? "save" : null;
    return "save";
}
