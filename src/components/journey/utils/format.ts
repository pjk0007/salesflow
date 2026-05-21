// 여정 표시용 포맷 헬퍼

export function formatDwell(sec: number): string {
    if (!sec) return "0초";
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    if (m === 0) return `${s}초`;
    return s ? `${m}분 ${s}초` : `${m}분`;
}

export function formatClickRate(rate: number): string {
    return `${Math.round(rate * 100)}%`;
}

export function formatDateTime(iso: string): string {
    return new Date(iso).toLocaleString("ko-KR", {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
    });
}

export function formatDate(iso: string): string {
    return new Date(iso).toLocaleDateString("ko-KR", {
        month: "2-digit",
        day: "2-digit",
    });
}

// 채널별 색상/아이콘 키
export const CHANNEL_STYLE: Record<string, { color: string; dot: string }> = {
    가입: { color: "text-rose-700 dark:text-rose-300", dot: "bg-rose-500" },
    단계: { color: "text-violet-700 dark:text-violet-300", dot: "bg-violet-500" },
    상태: { color: "text-blue-700 dark:text-blue-300", dot: "bg-blue-500" },
    상담: { color: "text-emerald-700 dark:text-emerald-300", dot: "bg-emerald-500" },
    사이트: { color: "text-amber-700 dark:text-amber-300", dot: "bg-amber-500" },
    메일: { color: "text-sky-700 dark:text-sky-300", dot: "bg-sky-500" },
};

// 전환/단계성 채널 — 타임라인에서 강조(굵게)
const EMPHASIZED = new Set(["가입", "단계", "상태", "상담"]);

export function channelStyle(channel: string) {
    return CHANNEL_STYLE[channel] ?? { color: "text-muted-foreground", dot: "bg-muted-foreground" };
}

export function isEmphasizedChannel(channel: string): boolean {
    return EMPHASIZED.has(channel);
}
