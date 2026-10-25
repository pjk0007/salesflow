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

type LimitOptions = { maxRequests: number; windowMs: number };

/**
 * 트래커 수집·식별 한도. 사이트 API 키 하나에 작은 한도를 걸면 동시 방문자가 늘 때(광고 직후 등)
 * 모든 방문자의 수집이 함께 429로 버려진다. 그래서
 *   ① DB 조회 전: 사이트 전체(남용 방지, 크게)와 요청 IP 하나를 본다.
 *   ② 본문을 읽은 뒤: 방문자 하나를 본다. HEARTBEAT(30초마다 세션 갱신)는 따로 느슨한 칸을 쓴다.
 * tracker.js는 429를 다시 보내지 않으므로 막힌 횟수를 사이트별로 세어 설정 화면에서 알린다.
 */
export const TRACKER_RATE_LIMITS = {
    collect: {
        site: { maxRequests: 20_000, windowMs: 60_000 },
        ip: { maxRequests: 1_000, windowMs: 60_000 },
        visitor: { maxRequests: 200, windowMs: 60_000 },
        heartbeat: { maxRequests: 10, windowMs: 60_000 },
    },
    identify: {
        site: { maxRequests: 2_000, windowMs: 60_000 },
        ip: { maxRequests: 200, windowMs: 60_000 },
        visitor: { maxRequests: 50, windowMs: 60_000 },
    },
} as const;

type TrackerRoute = keyof typeof TRACKER_RATE_LIMITS;

const LIMITED_WINDOW_MS = 60 * 60 * 1000;
const limitedHits = new Map<string, number[]>();

function noteLimited(apiKey: string, now: number) {
    const hits = (limitedHits.get(apiKey) ?? []).filter((t) => now - t < LIMITED_WINDOW_MS);
    hits.push(now);
    // 사이트당 기억하는 시각 수를 묶어 둔다 (집계는 대략이어도 된다)
    limitedHits.set(apiKey, hits.slice(-1000));
}

function allow(apiKey: string, key: string, options: LimitOptions): boolean {
    if (rateLimit(key, options).allowed) return true;
    noteLimited(apiKey, Date.now());
    return false;
}

/** ① DB 조회 전 — 사이트 전체 + 요청 IP. IP를 모르면 사이트 전체만 본다 */
export function trackerRequestAllowed(route: TrackerRoute, apiKey: string, ip: string | null): boolean {
    const limits = TRACKER_RATE_LIMITS[route];
    if (!allow(apiKey, `tracker:${route}:${apiKey}`, limits.site)) return false;
    return ip ? allow(apiKey, `tracker:${route}:${apiKey}:ip:${ip}`, limits.ip) : true;
}

/** ② 본문을 읽은 뒤 — 방문자 하나. HEARTBEAT는 별도 칸 */
export function trackerVisitorAllowed(
    route: TrackerRoute,
    apiKey: string,
    visitorId: string,
    eventType?: string,
): boolean {
    const limits = TRACKER_RATE_LIMITS[route];
    if (route === "collect" && eventType === "HEARTBEAT") {
        return allow(apiKey, `tracker:${route}:${apiKey}:hb:${visitorId}`, TRACKER_RATE_LIMITS.collect.heartbeat);
    }
    return allow(apiKey, `tracker:${route}:${apiKey}:v:${visitorId}`, limits.visitor);
}

/** 최근 1시간 동안 한도로 거절한 수집·식별 요청 (이 서버 인스턴스 기준, 메모리) */
export function trackerRateLimitedRecently(apiKey: string, now = Date.now()): { count: number; lastAt: string | null } {
    const hits = (limitedHits.get(apiKey) ?? []).filter((t) => now - t < LIMITED_WINDOW_MS);
    return { count: hits.length, lastAt: hits.length ? new Date(hits[hits.length - 1]).toISOString() : null };
}

// 메모리 누수 방지용 cleanup (5분마다 만료된 버킷 제거)
if (typeof setInterval !== "undefined") {
    setInterval(() => {
        const now = Date.now();
        for (const [k, v] of buckets) {
            if (v.resetAt < now) buckets.delete(k);
        }
        for (const [k, hits] of limitedHits) {
            if (!hits.length || now - hits[hits.length - 1] >= LIMITED_WINDOW_MS) limitedHits.delete(k);
        }
    }, 5 * 60 * 1000).unref?.();
}
