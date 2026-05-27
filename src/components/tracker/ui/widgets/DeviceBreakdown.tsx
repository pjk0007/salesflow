"use client";

import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";
import type { OverviewData } from "../../types/overview";

const DEVICE_COLOR: Record<string, string> = {
    desktop: "#6366f1",
    mobile: "#10b981",
    tablet: "#f59e0b",
    unknown: "#a3a3a3",
};

// 브라우저/OS는 알려진 브랜드는 그 색, 모르는 건 팔레트에서 순환
const BROWSER_COLOR: Record<string, string> = {
    Chrome: "#fbbc04",
    Safari: "#06b6d4",
    Edge: "#3b82f6",
    Firefox: "#f97316",
    unknown: "#94a3b8",
};
const OS_COLOR: Record<string, string> = {
    Windows: "#3b82f6",
    macOS: "#a855f7",
    Linux: "#f59e0b",
    iOS: "#06b6d4",
    Android: "#10b981",
    unknown: "#94a3b8",
};

interface Props {
    devices: OverviewData["devices"];
}

function HorizontalBars({
    items,
    colorMap,
}: {
    items: Array<{ name: string; count: number }>;
    colorMap: Record<string, string>;
}) {
    const total = items.reduce((s, i) => s + i.count, 0);
    if (total === 0) return <p className="text-xs text-muted-foreground">데이터 없음</p>;
    return (
        <ul className="space-y-1.5">
            {items.map((i) => {
                const pct = (i.count / total) * 100;
                const color = colorMap[i.name] ?? colorMap.unknown ?? "#94a3b8";
                return (
                    <li key={i.name} className="space-y-0.5 text-xs">
                        <div className="flex items-center justify-between">
                            <span className="inline-flex items-center gap-1.5 truncate">
                                <span className="h-2 w-2 rounded-full" style={{ background: color }} />
                                {i.name}
                            </span>
                            <span className="tabular-nums text-muted-foreground">{i.count}</span>
                        </div>
                        <div className="h-1.5 w-full overflow-hidden rounded bg-muted">
                            <div className="h-full" style={{ width: `${pct}%`, background: color }} />
                        </div>
                    </li>
                );
            })}
        </ul>
    );
}

export function DeviceBreakdown({ devices }: Props) {
    const total = devices.types.reduce((s, t) => s + t.count, 0);
    return (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="rounded-lg border bg-card p-4">
                <p className="mb-2 text-sm font-semibold">디바이스</p>
                {total === 0 ? (
                    <p className="text-xs text-muted-foreground">데이터 없음</p>
                ) : (
                    <>
                        <div className="h-[140px]">
                            <ResponsiveContainer width="100%" height="100%">
                                <PieChart>
                                    <Tooltip contentStyle={{ fontSize: 12, borderRadius: 6 }} />
                                    <Pie data={devices.types} dataKey="count" nameKey="name" innerRadius={36} outerRadius={60}>
                                        {devices.types.map((t, i) => (
                                            <Cell key={i} fill={DEVICE_COLOR[t.name] ?? DEVICE_COLOR.unknown} />
                                        ))}
                                    </Pie>
                                </PieChart>
                            </ResponsiveContainer>
                        </div>
                        <ul className="mt-2 space-y-0.5 text-xs">
                            {devices.types.map((t) => (
                                <li key={t.name} className="flex items-center justify-between">
                                    <span className="inline-flex items-center gap-1.5">
                                        <span className="h-2 w-2 rounded-full" style={{ background: DEVICE_COLOR[t.name] ?? DEVICE_COLOR.unknown }} />
                                        {t.name}
                                    </span>
                                    <span className="tabular-nums text-muted-foreground">{t.count}</span>
                                </li>
                            ))}
                        </ul>
                    </>
                )}
            </div>
            <div className="rounded-lg border bg-card p-4">
                <p className="mb-2 text-sm font-semibold">브라우저 TOP5</p>
                <HorizontalBars items={devices.browsers} colorMap={BROWSER_COLOR} />
            </div>
            <div className="rounded-lg border bg-card p-4">
                <p className="mb-2 text-sm font-semibold">OS TOP5</p>
                <HorizontalBars items={devices.oss} colorMap={OS_COLOR} />
            </div>
        </div>
    );
}
