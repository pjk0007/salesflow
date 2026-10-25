import type { KeyboardEvent } from "react";

/**
 * 메모 입력창의 Enter 저장 — 한글 조합 중 Enter(isComposing·keyCode 229)와 Shift+Enter(줄바꿈)는 저장하지 않는다.
 * 목록 팝오버와 상세 메모가 같은 규칙을 쓴다(UX-059).
 */
export function isMemoSubmitKey(
    e: Pick<KeyboardEvent, "key" | "shiftKey"> & { nativeEvent: { isComposing?: boolean; keyCode?: number } },
): boolean {
    if (e.key !== "Enter" || e.shiftKey) return false;
    if (e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229) return false;
    return true;
}

/** 메모 삭제 확인창 문구 — 목록 팝오버·상세 메모 공용 */
export const MEMO_DELETE_CONFIRM = {
    title: "메모를 삭제하시겠습니까?",
    description: "삭제된 메모는 복구할 수 없습니다.",
} as const;
