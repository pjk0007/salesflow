const IP_RE = /^[0-9A-Fa-f:.]{2,45}$/;

/** XFF 첫 값 → real IP 순서로 유효한 모양의 IP를 고른다. */
export function requestIp(headers: Headers): string | null {
    const forwarded = headers.get("x-forwarded-for")?.split(",")[0].trim();
    if (forwarded && IP_RE.test(forwarded)) return forwarded;
    const real = headers.get("x-real-ip")?.trim();
    return real && IP_RE.test(real) ? real : null;
}
