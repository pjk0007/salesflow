import type { SessionInput } from "./deep-visitor-alert-rules";

/** 실제 측정값만 사용하며, 정수 반올림된 duration은 유효한 세션 시간으로 제한한다. */
export function measuredSessionSeconds(s: SessionInput, now: Date): number | null {
    if (s.startedAt > now) return null;
    if (s.endedAt && (s.endedAt > now || s.endedAt < s.startedAt)) return null;
    const elapsed = ((s.endedAt ?? now).getTime() - s.startedAt.getTime()) / 1000;
    if (s.duration !== null && Number.isFinite(s.duration) && s.duration >= 0)
        return Math.min(s.duration, elapsed);
    if (s.endedAt) return elapsed;
    return null;
}
