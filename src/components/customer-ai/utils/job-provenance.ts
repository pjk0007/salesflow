type Origin = {
    originConversationId?: unknown;
    fromMergedConversation?: unknown;
};
export type SupportJobProvenance = "current" | "merged" | "unknown";
function provenance(origin: Origin, conversationId: string): SupportJobProvenance {
    if (origin.fromMergedConversation === true) return "merged";
    if (
        typeof origin.originConversationId === "string" &&
        origin.originConversationId &&
        origin.originConversationId !== conversationId
    )
        return "merged";
    if (
        origin.originConversationId === conversationId &&
        origin.fromMergedConversation === false
    )
        return "current";
    return "unknown";
}
/** Both list and detail must agree before a record can expose current-chat actions. */
export function supportJobProvenance(
    job: Origin,
    conversationId: string,
    summary?: Origin,
): SupportJobProvenance {
    const detail = provenance(job, conversationId);
    const list = summary ? provenance(summary, conversationId) : detail;
    if (detail === "merged" || list === "merged") return "merged";
    return detail === "current" && list === "current" ? "current" : "unknown";
}
export const supportProvenanceNames: Record<SupportJobProvenance, string> = {
    current: "현재 상담 기록",
    merged: "병합 전 상담 기록",
    unknown: "출처 확인이 필요한 기록",
};
export function supportJobCreatedAt(value: string) {
    const date = new Date(value);
    return Number.isNaN(date.getTime())
        ? "생성 시각 확인 안 됨"
        : date.toLocaleString("ko-KR", {
              year: "numeric",
              month: "2-digit",
              day: "2-digit",
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
              hour12: false,
          });
}
