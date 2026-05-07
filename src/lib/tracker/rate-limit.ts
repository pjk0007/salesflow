/**
 * 단순 in-memory rate limiter.
 * 단일 인스턴스에서만 동작. 다중 서버에선 Redis 등으로 교체 필요.
 */

type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();

export function rateLimit(
    key: string,
    options: { maxRequests: number; windowMs: number },
): { allowed: boolean; remaining: number } {
    const now = Date.now();
    const bucket = buckets.get(key);

    if (!bucket || now >= bucket.resetAt) {
        buckets.set(key, { count: 1, resetAt: now + options.windowMs });
        return { allowed: true, remaining: options.maxRequests - 1 };
    }

    if (bucket.count >= options.maxRequests) {
        return { allowed: false, remaining: 0 };
    }

    bucket.count++;
    return { allowed: true, remaining: options.maxRequests - bucket.count };
}

// 메모리 누수 방지용 cleanup (5분마다 만료된 버킷 제거)
if (typeof setInterval !== "undefined") {
    setInterval(() => {
        const now = Date.now();
        for (const [k, v] of buckets) {
            if (v.resetAt < now) buckets.delete(k);
        }
    }, 5 * 60 * 1000).unref?.();
}
