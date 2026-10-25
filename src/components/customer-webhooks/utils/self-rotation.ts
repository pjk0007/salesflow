/**
 * 내가 방금 서명 키를 재발급해 올라간 버전. 설정 내용은 그대로라 편집 중인 초안을 '다른 변경'으로 보지 않게 한다.
 * from은 연속 재발급 전 처음 버전, to는 마지막 재발급 응답 버전.
 */
export type SelfRotation = { id: string; from: number; to: number };
export function nextSelfRotation(
    prev: SelfRotation | null,
    id: string,
    from: number,
    to: number,
): SelfRotation {
    return prev && prev.id === id && prev.to === from
        ? { id, from: prev.from, to }
        : { id, from, to };
}
/** 초안이 재발급 전 버전이면 재발급 응답 버전을 기준으로 삼는다. 그 사이 다른 변경이 있었다면 그대로 둬 경고가 뜬다. */
export function draftBaseVersion(
    draftVersion: number,
    rotation: SelfRotation | undefined,
): number {
    return rotation && rotation.from === draftVersion
        ? rotation.to
        : draftVersion;
}
