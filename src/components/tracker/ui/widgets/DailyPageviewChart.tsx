"use client";

import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";

interface Props {
    data: Array<{ date: string; count: number }>;
}

function fmtDate(d: string): string {
    const dt = new Date(d + "T00:00:00");
    return `${dt.getMonth() + 1}/${dt.getDate()}`;
}

export function DailyPageviewChart({ data }: Props) {
    if (data.length === 0) {
        return (
            <div className="rounded-lg border bg-card p-6 text-center text-sm text-muted-foreground">
                일별 데이터가 없습니다
            </div>
        );
    }
    const chartData = data.map((d) => ({ ...d, label: fmtDate(d.date) }));
    return (
        <div className="rounded-lg border bg-card p-4">
            <p className="mb-3 text-sm font-semibold">일별 페이지뷰</p>
            <div className="h-[260px]">
                <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={chartData} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
                        <defs>
                            <linearGradient id="pvGrad" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor="#6366f1" stopOpacity={0.35} />
                                <stop offset="100%" stopColor="#6366f1" stopOpacity={0} />
                            </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-border" />
                        <XAxis dataKey="label" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                        <YAxis tick={{ fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
                        <Tooltip
                            contentStyle={{ fontSize: 12, borderRadius: 6 }}
                            labelStyle={{ color: "#6b7280" }}
                            formatter={(v) => [Number(v ?? 0).toLocaleString(), "PV"]}
                        />
                        <Area type="monotone" dataKey="count" stroke="#6366f1" strokeWidth={2} fill="url(#pvGrad)" />
                    </AreaChart>
                </ResponsiveContainer>
            </div>
        </div>
    );
}
