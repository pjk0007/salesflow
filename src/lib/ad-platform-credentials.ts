/**
 * 광고 플랫폼 자격 정보 응답 마스킹 — 목록·단건 API가 같은 규칙을 쓴다.
 * 비밀값(토큰·시크릿, 페이지별 토큰 객체 안쪽 포함)은 앞 4자만 보이고, 화면이 그대로 써야 하는 값만 공개한다.
 */
const UNMASK_KEYS = new Set(["type", "webhookVerifyToken", "tokenExpiresAt"]);

function maskSecret(value: unknown): unknown {
    if (typeof value === "string") return value ? (value.length > 8 ? value.substring(0, 4) + "****" : "****") : "";
    if (Array.isArray(value)) return value.map(maskSecret);
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, maskSecret(item)]));
    return value;
}

export function maskCredentials(credentials: Record<string, unknown>): Record<string, unknown> {
    return Object.fromEntries(Object.entries(credentials).map(([key, value]) => [key, UNMASK_KEYS.has(key) ? value : maskSecret(value)]));
}
