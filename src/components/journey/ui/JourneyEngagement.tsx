"use client";

import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, LabelList } from "recharts";
import type { JourneyDailyActivity } from "../types";
import { formatDate } from "../utils/format";

/**
 * L3 관여도 — 일별 활동량. 평균 대비 폭증일은 색 강조.
 */
export function JourneyEngagement({ daily }: { daily: JourneyDailyActivity[] }) {
    if (daily.length === 0) return null;

    const avg = daily.reduce((a, b) => a + b.count, 0) / daily.length;
    const spikeThreshold = avg * 1.5; // 평균 1.5배 이상 = 폭증일

    const data = daily.map((d) => ({
        ...d,
        label: formatDate(d.date + "T00:00:00"),
        spike: d.count >= spikeThreshold && d.count > 1,
    }));

    return (
        <div className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground">일별 활동량</p>
            <div className="h-40 w-full">
                <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={data} margin={{ top: 16, right: 8, left: -20, bottom: 0 }}>
                        <XAxis dataKey="label" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
                        <YAxis tick={{ fontSize: 10 }} allowDecimals={false} width={28} />
                        <Tooltip
                            cursor={{ fill: "rgba(0,0,0,0.04)" }}
                            formatter={(v) => [`${v}건`, "활동"]}
                            labelFormatter={(l) => l as string}
                        />
                        <Bar dataKey="count" radius={[3, 3, 0, 0]}>
                            <LabelList dataKey="count" position="top" style={{ fontSize: 10 }} />
                            {data.map((d, i) => (
                                <Cell key={i} fill={d.spike ? "#f97316" : "#a3a3a3"} />
                            ))}
                        </Bar>
                    </BarChart>
                </ResponsiveContainer>
            </div>
        </div>
    );
}
