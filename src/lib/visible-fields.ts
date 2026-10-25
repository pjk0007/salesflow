/**
 * 파티션 '표시할 열'(partitions.visible_fields) 규칙 — 서버(속성 추가·삭제·파티션 생성)와 화면(표·열 토글)이 같이 쓴다.
 * null과 빈 배열은 모두 '전체 표시'다. 전체 표시 상태는 새 속성을 따로 담지 않아도 자동으로 보인다(UX-067).
 */
export function isAllFieldsVisible(keys: readonly string[] | null | undefined): boolean {
    return !keys || keys.length === 0;
}

/** 열이 화면에 보이는지 */
export function isFieldVisible(keys: readonly string[] | null | undefined, key: string): boolean {
    return isAllFieldsVisible(keys) || keys!.includes(key);
}

/**
 * 새 속성 key를 표시 목록에 더한 값. 바꿀 필요가 없으면 null(전체 표시이거나 이미 있음).
 * 전체 표시 파티션을 [새 key]로 바꿔 나머지 열을 숨기던 결함을 막는다.
 */
export function addVisibleFieldKeys(keys: readonly string[] | null | undefined, newKeys: readonly string[]): string[] | null {
    if (isAllFieldsVisible(keys)) return null;
    const missing = newKeys.filter((k) => !keys!.includes(k));
    return missing.length > 0 ? [...keys!, ...missing] : null;
}

/** 삭제된 속성 key를 뺀 값. 바꿀 필요가 없으면 null. 마지막 열을 빼면 전체 표시(null)로 돌아간다 */
export function removeVisibleFieldKey(keys: readonly string[] | null | undefined, key: string): string[] | null | undefined {
    if (isAllFieldsVisible(keys) || !keys!.includes(key)) return undefined;
    const next = keys!.filter((k) => k !== key);
    return next.length > 0 ? next : null;
}

/**
 * 열 보이기/숨기기 결과. 전체 표시 상태에서 숨기면 나머지 열을 명시적으로 담고,
 * 모든 열이 다시 보이면 null(전체 표시)로 되돌린다. 마지막 열은 숨기지 않는다(undefined = 변경 없음).
 */
export function toggleVisibleField(
    keys: readonly string[] | null | undefined,
    allKeys: readonly string[],
    key: string,
    visible: boolean,
): string[] | null | undefined {
    const base = isAllFieldsVisible(keys) ? [...allKeys] : keys!.filter((k) => allKeys.includes(k));
    const next = visible ? (base.includes(key) ? base : [...base, key]) : base.filter((k) => k !== key);
    if (next.length === 0) return undefined;
    if (allKeys.every((k) => next.includes(k))) return null;
    return next;
}
