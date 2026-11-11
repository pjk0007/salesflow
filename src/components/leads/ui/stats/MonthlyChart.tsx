"use client";

import { useState } from "react";
import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

type Row = { month: string; leads: number; converted: number };

/**
 * 월별 유입 — 연한 빗금 막대, 고른(마우스 올린) 달은 진한 색. 말풍선에 유입·전환·전환율.
 * 한 가지 값만 막대로 그려 범례가 필요 없다.
 */
export function MonthlyChart({ data }: { data: Row[] }) {
    const [active, setActive] = useState<number | null>(null);
    if (data.length === 0) return <p className="py-10 text-center text-sm text-muted-foreground">데이터가 없습니다.</p>;
    const rows = data.slice(-12).map((d) => ({ ...d, label: `${Number(d.month.slice(5))}월` }));
    const focus = active ?? rows.length - 1;

    return (
        <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
                <BarChart
                    data={rows}
                    margin={{ top: 8, right: 4, left: -24, bottom: 0 }}
                    onMouseMove={(s) => setActive(typeof s?.activeTooltipIndex === "number" ? s.activeTooltipIndex : null)}
                    onMouseLeave={() => setActive(null)}
                >
                    <defs>
                        <pattern id="lead-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                            <rect width="6" height="6" fill="var(--primary)" fillOpacity="0.08" />
                            <line x1="0" y1="0" x2="0" y2="6" stroke="var(--primary)" strokeOpacity="0.18" strokeWidth="2" />
                        </pattern>
                        <pattern id="lead-hatch-active" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                            <rect width="6" height="6" fill="var(--primary)" />
                            <line x1="0" y1="0" x2="0" y2="6" stroke="white" strokeOpacity="0.18" strokeWidth="2" />
                        </pattern>
                    </defs>
                    <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={12} stroke="var(--muted-foreground)" />
                    <YAxis allowDecimals={false} tickLine={false} axisLine={false} fontSize={11} stroke="var(--muted-foreground)" />
                    <Tooltip
                        cursor={false}
                        content={({ active: on, payload }) => {
                            const d = on && payload?.[0]?.payload as (Row & { label: string }) | undefined;
                            if (!d) return null;
                            return (
                                <div className="rounded-lg bg-primary/10 px-3 py-2 text-xs backdrop-blur">
                                    <div className="text-muted-foreground">{d.month}</div>
                                    <div className="mt-0.5 font-semibold text-foreground">
                                        유입 {d.leads}건 · 전환 {d.converted}건
                                    </div>
                                    <div className="text-muted-foreground">
                                        전환율 {d.leads ? Math.round((d.converted / d.leads) * 100) : 0}%
                                    </div>
                                </div>
                            );
                        }}
                    />
                    <Bar dataKey="leads" radius={[4, 4, 4, 4]} maxBarSize={56}>
                        {rows.map((_, i) => (
                            <Cell key={i} fill={i === focus ? "url(#lead-hatch-active)" : "url(#lead-hatch)"} />
                        ))}
                    </Bar>
                </BarChart>
            </ResponsiveContainer>
        </div>
    );
}
