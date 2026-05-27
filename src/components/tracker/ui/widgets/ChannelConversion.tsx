"use client";

interface Item {
    channel: string;
    visitors: number;
    leads: number;
    leadRate: number;
}

const MIN_SAMPLE = 10; // 표본 부족 임계

const CHANNEL_COLOR: Record<string, string> = {
    "메타 광고": "#3b82f6",
    "구글 검색광고": "#f97316",
    "구글 검색": "#22c55e",
    "네이버 검색광고": "#10b981",
    "네이버": "#10b981",
    "메일": "#06b6d4",
    "직접": "#94a3b8",
    "기타": "#cbd5e1",
};

/**
 * 채널별 전환율 — 어디서 온 트래픽이 가장 잘 리드로 전환되나.
 * 광고비 재분배 결정의 핵심 위젯.
 * 방문수(볼륨) + 전환율(효율)을 같이 보여줘야 함 — 전환율만 보면 표본 작은 채널 함정에 빠짐.
 */
export function ChannelConversion({ items }: { items: Item[] }) {
    const totalVisitors = items.reduce((s, i) => s + i.visitors, 0);
    return (
        <div className="rounded-lg border bg-card p-4">
            <p className="text-sm font-semibold">채널별 전환율</p>
            <p className="mb-3 text-[11px] text-muted-foreground">방문수 × 리드 전환율 — 광고 ROAS 비교용</p>
            {items.length === 0 ? (
                <p className="text-sm text-muted-foreground">데이터 없음</p>
            ) : (
                <ul className="space-y-3">
                    {items.map((c) => {
                        const visitorPct = totalVisitors > 0 ? (c.visitors / totalVisitors) * 100 : 0;
                        const color = CHANNEL_COLOR[c.channel] ?? "#94a3b8";
                        const lowSample = c.visitors < MIN_SAMPLE;
                        return (
                            <li key={c.channel} className="space-y-1 text-xs">
                                <div className="flex items-baseline justify-between gap-3">
                                    <span className="inline-flex items-center gap-1.5">
                                        <span className="h-2 w-2 rounded-full" style={{ background: color }} />
                                        <span className="font-medium">{c.channel}</span>
                                        {lowSample && (
                                            <span className="rounded bg-muted px-1 py-0.5 text-[10px] text-muted-foreground">
                                                표본 부족
                                            </span>
                                        )}
                                    </span>
                                    <span className="tabular-nums text-muted-foreground">
                                        방문 <span className="font-medium text-foreground">{c.visitors}</span>
                                        <span className="mx-1.5">·</span>
                                        리드 <span className="font-medium text-foreground">{c.leads}</span>
                                        <span className="mx-1.5">·</span>
                                        전환 <span className={`font-semibold ${lowSample ? "text-muted-foreground" : "text-foreground"}`}>
                                            {c.leadRate}%
                                        </span>
                                    </span>
                                </div>
                                {/* 방문수 비율(전체 대비)을 베이스, 그 위에 전환된 비율을 어둡게 덧칠 */}
                                <div className="relative h-2 w-full overflow-hidden rounded bg-muted">
                                    <div
                                        className="absolute left-0 top-0 h-full opacity-30"
                                        style={{ width: `${visitorPct}%`, background: color }}
                                        title={`방문 점유 ${visitorPct.toFixed(1)}%`}
                                    />
                                    <div
                                        className="absolute left-0 top-0 h-full"
                                        style={{ width: `${visitorPct * (c.leadRate / 100)}%`, background: color }}
                                        title={`전환 ${c.leadRate}%`}
                                    />
                                </div>
                            </li>
                        );
                    })}
                </ul>
            )}
        </div>
    );
}
