export function reconnectWindow(lastPollAt?: string | null, now = Date.now()) {
    const last = lastPollAt ? Date.parse(lastPollAt) : NaN;
    if (!Number.isFinite(last)) return { days: 0, beyondWindow: false };
    const elapsed = now - last;
    return { days: elapsed <= 7 * 86400000 ? 7 : 30, beyondWindow: elapsed > 30 * 86400000 };
}
