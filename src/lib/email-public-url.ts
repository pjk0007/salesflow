type PublicUrlEnvironment = Record<string, string | undefined>;

/** Server-side resolution: a development service must not issue production tokens. */
export function resolveEmailPublicOrigin(env: PublicUrlEnvironment = process.env): string {
    const configured = env.EMAIL_PUBLIC_BASE_URL?.trim()
        || env.NEXT_PUBLIC_APP_URL?.trim()
        || env.NEXT_PUBLIC_BASE_URL?.trim();
    if (!configured) {
        return env.NODE_ENV === "development" ? "http://localhost:3000" : "https://sendb.kr";
    }
    const url = new URL(configured);
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if ((url.protocol !== "https:" && !(local && url.protocol === "http:"))
        || url.username || url.password || url.search || url.hash || url.pathname !== "/") {
        throw new Error("메일 공개 주소는 경로와 인증정보가 없는 HTTPS 주소여야 합니다.");
    }
    return url.origin;
}

export function buildPublicUnsubscribeUrl(
    token: string,
    oneClick = false,
    env: PublicUrlEnvironment = process.env,
): string {
    const url = new URL(oneClick ? "/api/email/unsubscribe/one-click" : "/unsubscribe", resolveEmailPublicOrigin(env));
    url.searchParams.set("token", token);
    return url.toString();
}

/** Exclude both current-service and legacy production links from click tracking. */
export function isPublicUnsubscribeUrl(url: string, env: PublicUrlEnvironment = process.env): boolean {
    try {
        const parsed = new URL(url);
        return [resolveEmailPublicOrigin(env), "https://sendb.kr"].includes(parsed.origin)
            && ["/unsubscribe", "/api/email/unsubscribe/one-click"].includes(parsed.pathname);
    } catch {
        return false;
    }
}
