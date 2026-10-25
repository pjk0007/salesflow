/**
 * 체크박스 값 해석 — true, 1, "true"(대소문자 무관), "1"만 참이다.
 * ImportDialog의 문자열→boolean 규칙과 같다. "false"·"0"·빈 값은 거짓이다 (Boolean("false")는 참이라 쓰지 않는다, UX-046).
 */
export function parseCheckboxValue(value: unknown): boolean {
    if (value === true || value === 1) return true;
    if (typeof value === "string") {
        const v = value.trim().toLowerCase();
        return v === "true" || v === "1";
    }
    return false;
}
