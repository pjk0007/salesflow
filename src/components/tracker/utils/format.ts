/** "2026. 06. 09. 14:32" 형태 */
export function formatDateTime(s: string): string {
    const d = new Date(s);
    if (isNaN(d.getTime())) return s;
    return d.toLocaleString("ko-KR", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
    });
}

/** 초 단위 → "1분 42초", "2시간 5분" */
export function formatDuration(seconds: number | null): string {
    if (!seconds || seconds <= 0) return "-";
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (h > 0) return `${h}시간 ${m}분`;
    if (m > 0) return `${m}분 ${s}초`;
    return `${s}초`;
}

/** 상대 시각 → "방금 전", "5분 전", "3시간 전", "12일 전", 그 이상은 날짜 */
export function formatRelative(s: string): string {
    const t = new Date(s).getTime();
    if (isNaN(t)) return s;
    const diff = Date.now() - t;
    const min = Math.floor(diff / 60000);
    if (min < 1) return "방금 전";
    if (min < 60) return `${min}분 전`;
    const h = Math.floor(min / 60);
    if (h < 24) return `${h}시간 전`;
    const d = Math.floor(h / 24);
    if (d < 30) return `${d}일 전`;
    return new Date(s).toLocaleDateString("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit" });
}

/** ms 단위 체류시간 → "1분 40초", "12초" */
export function formatDwellMs(ms: number): string {
    if (!ms || ms <= 0) return "-";
    return formatDuration(Math.round(ms / 1000));
}

/** URL에서 path만 (호스트/쿼리 제거) — 목록 표시용 */
export function urlPath(url: string | null): string {
    if (!url) return "-";
    try {
        const u = new URL(url);
        return u.pathname + (u.search ? u.search : "");
    } catch {
        return url;
    }
}
