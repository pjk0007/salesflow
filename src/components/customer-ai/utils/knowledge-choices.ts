/**
 * AI 응대 설정의 승인 지식 선택지. 승인된 지식만 새로 고를 수 있으니 초안·차단 등은 숨기고 (UX-238),
 * 이미 설정에 연결된 경우에만 남겨 무엇이 연결돼 있는지(예: 차단됨) 보이게 한다.
 */
export function supportKnowledgeChoices<T extends { id: number; state: string }>(
    options: T[],
    currentId: number | null | undefined,
): T[] {
    return options.filter((k) => k.state === "approved" || k.id === currentId);
}
