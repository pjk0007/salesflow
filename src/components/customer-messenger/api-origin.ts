let apiOrigin: string | undefined;
/** Set only by the dedicated customer UI bootstrap; staff requests stay on their original origin. */
export function configureMessengerApiOrigin(value?: string) {
    if (!value) { apiOrigin = undefined; return; }
    const url = new URL(value);
    if (url.username || url.password || url.pathname !== "/" || url.search || url.hash ||
        !(url.protocol === "https:" || (url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))))
        throw new Error("상담 서버 주소를 확인해주세요.");
    apiOrigin = url.origin;
}
export function messengerApiUrl(value: string) {
    if (!apiOrigin || !value.startsWith("/api/messenger/")) return value;
    const parsed = new URL(value, "https://relative.invalid");
    if (!/^\/api\/messenger\/[a-f0-9]{48}(?:\/|$)/.test(parsed.pathname) || parsed.hash)
        throw new Error("상담 요청 주소를 확인해주세요.");
    return apiOrigin + parsed.pathname + parsed.search;
}
