/**
 * 공개 API(/api/v1/**) CORS 허용 — middleware가 모든 v1 응답과 사전 요청(OPTIONS)에 같은 값을 붙인다 (UX-041).
 * 인증은 Authorization: Bearer 또는 x-api-key 둘 다 받으므로 두 헤더를 모두 허용한다.
 */
export const PUBLIC_API_CORS_HEADERS: Readonly<Record<string, string>> = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, x-api-key",
    "Access-Control-Max-Age": "86400",
};
