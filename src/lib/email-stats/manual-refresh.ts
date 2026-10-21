export function manualRefreshDecision(lastAt: Date | null, now: Date) {
    if (lastAt === null || now.getTime() - lastAt.getTime() >= 300000) {
        return { allowed: true as const };
    }
    const retryAfterSec = Math.ceil((300000 - (now.getTime() - lastAt.getTime())) / 1000);
    return {
        allowed: false as const,
        retryAfterSec,
        error: `${Math.ceil(retryAfterSec / 60)}분 뒤 다시 갱신할 수 있습니다.`,
    };
}
