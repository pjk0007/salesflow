"use client";

// 채널별 색상 — 광고(따뜻한 톤)/자연검색(초록)/직접(중립)/메일(파랑) 구분
const CHANNEL_COLOR: Record<string, string> = {
    "메타 광고": "#3b82f6",       // 메타 = 파란 계열
    "구글 검색광고": "#f97316",   // 광고 = 주황(눈에 띄게)
    "구글 검색": "#22c55e",       // 자연 = 초록
    "네이버": "#10b981",          // 네이버 = 에메랄드
    "메일": "#06b6d4",            // 메일 = 시안
    "직접": "#94a3b8",            // 직접 = 슬레이트
    "기타": "#cbd5e1",            // 기타 = 옅은 슬레이트
};

interface Props {
    channels: Array<{ channel: string; sessions: number }>;
}

export function InflowChannels({ channels }: Props) {
    const total = channels.reduce((s, c) => s + c.sessions, 0);
    return (
        <div className="rounded-lg border bg-card p-4">
            <p className="mb-3 text-sm font-semibold">유입 채널</p>
            {channels.length === 0 ? (
                <p className="text-sm text-muted-foreground">데이터 없음</p>
            ) : (
                <ul className="space-y-2">
                    {channels.map((c) => {
                        const pct = total > 0 ? (c.sessions / total) * 100 : 0;
                        const color = CHANNEL_COLOR[c.channel] ?? "#737373";
                        return (
                            <li key={c.channel} className="space-y-1 text-xs">
                                <div className="flex items-center justify-between">
                                    <span className="inline-flex items-center gap-1.5">
                                        <span className="h-2 w-2 rounded-full" style={{ background: color }} />
                                        {c.channel}
                                    </span>
                                    <span className="tabular-nums text-muted-foreground">
                                        {c.sessions.toLocaleString()} · {pct.toFixed(1)}%
                                    </span>
                                </div>
                                <div className="h-1.5 w-full overflow-hidden rounded bg-muted">
                                    <div className="h-full" style={{ width: `${pct}%`, background: color }} />
                                </div>
                            </li>
                        );
                    })}
                </ul>
            )}
        </div>
    );
}
