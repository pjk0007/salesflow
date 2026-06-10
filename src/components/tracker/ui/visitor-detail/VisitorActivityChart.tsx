"use client";

import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { VisitorDailyActivity } from "../../types/visitor-detail";

/**
 * 일별 활동량 — 언제 들어와서 얼마나 움직였는지. 평균 1.5배 이상 폭증일은 색 강조.
 */
export function VisitorActivityChart({ daily }: { daily: VisitorDailyActivity[] }) {
    if (daily.length < 2) return null;

    const avg = daily.reduce((a, b) => a + b.count, 0) / daily.length;
    const spikeThreshold = avg * 1.5;
    const data = daily.map((d) => ({
        ...d,
        label: d.date.slice(5).replace("-", "/"),
        spike: d.count >= spikeThreshold && d.count > 1,
    }));

    return (
        <Card>
            <CardHeader>
                <CardTitle className="text-base">일별 활동량</CardTitle>
                <p className="text-[11px] text-muted-foreground">
                    페이지뷰·클릭 등 전체 이벤트 수 — 주황색은 평소보다 활발했던 날
                </p>
            </CardHeader>
            <CardContent>
                <div className="h-36 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={data} margin={{ top: 8, right: 8, left: -24, bottom: 0 }}>
                            <XAxis dataKey="label" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
                            <YAxis tick={{ fontSize: 10 }} allowDecimals={false} width={32} />
                            <Tooltip
                                cursor={{ fill: "rgba(0,0,0,0.04)" }}
                                formatter={(v) => [`${v}건`, "활동"]}
                                labelFormatter={(_l, payload) => payload?.[0]?.payload?.date ?? ""}
                            />
                            <Bar dataKey="count" radius={[3, 3, 0, 0]}>
                                {data.map((d, i) => (
                                    <Cell key={i} fill={d.spike ? "#f97316" : "#a3a3a3"} />
                                ))}
                            </Bar>
                        </BarChart>
                    </ResponsiveContainer>
                </div>
            </CardContent>
        </Card>
    );
}
