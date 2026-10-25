/**
 * AI 응대 설정의 승인 지식 선택지. 차단한 지식은 새로 고를 수 없으니 숨기고,
 * 이미 설정에 연결된 경우에만 남겨 무엇이 막혔는지 보이게 한다.
 */
export function supportKnowledgeChoices<T extends { id: number; state: string }>(
    options: T[],
    currentId: number | null | undefined,
): T[] {
    return options.filter((k) => k.state !== "blocked" || k.id === currentId);
}
