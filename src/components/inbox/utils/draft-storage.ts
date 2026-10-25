/** 상담 상세의 답변·메모 초안 저장 키(ConversationPane과 같은 규칙). */
export const inboxDraftStorageKey = (userId: string, conversationId: string) =>
    `sendb-inbox-draft:${userId}:${conversationId}`;

/**
 * 비회원 상담이 회원 상담으로 합쳐졌을 때 초안을 합쳐진 상담으로 옮긴다.
 * 대상에 같은 종류 초안이 이미 있으면 덮어쓰지 않고 뒤에 붙인다. 옮긴 초안이 있으면 true.
 */
export function moveInboxDraft(
    storage: Pick<Storage, "getItem" | "setItem" | "removeItem">,
    userId: string,
    sourceId: string,
    targetId: string,
) {
    try {
        const sourceKey = inboxDraftStorageKey(userId, sourceId),
            targetKey = inboxDraftStorageKey(userId, targetId);
        const source = JSON.parse(storage.getItem(sourceKey) ?? "{}") as Record<string, string>;
        const target = JSON.parse(storage.getItem(targetKey) ?? "{}") as Record<string, string>;
        let moved = false;
        for (const kind of ["reply", "note"]) {
            const text = source[`${sourceId}:${kind}`];
            if (typeof text !== "string" || !text.trim()) continue;
            const current = target[`${targetId}:${kind}`];
            target[`${targetId}:${kind}`] =
                typeof current === "string" && current.trim() ? `${current}\n\n${text}` : text;
            moved = true;
        }
        if (moved) storage.setItem(targetKey, JSON.stringify(target));
        storage.removeItem(sourceKey);
        return moved;
    } catch {
        return false;
    }
}
