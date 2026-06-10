"use client";

import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { VisitorHourlyActivity } from "../../types/visitor-detail";

/**
 * 방문 시간대 — 0~23시 활동 분포. 피크 시간대는 색 강조.
 * 영업 입장에서 "언제 연락하면 잡히는 사람인지"를 보여준다.
 */
export function VisitorHourlyChart({ hourly }: { hourly: VisitorHourlyActivity[] }) {
    if (hourly.length === 0) return null;

    const byHour = new Map(hourly.map((h) => [h.hour, h.count]));
    const max = Math.max(...hourly.map((h) => h.count));
    const data = Array.from({ length: 24 }, (_, hour) => {
        const count = byHour.get(hour) ?? 0;
        return { hour, label: `${hour}시`, count, peak: count > 0 && count === max };
    });
    const peakHours = data.filter((d) => d.peak).map((d) => d.label);

    return (
        <Card>
            <CardHeader>
                <CardTitle className="text-base">방문 시간대</CardTitle>
                <p className="text-[11px] text-muted-foreground">
                    주로 {peakHours.slice(0, 2).join(" · ")}에 활동
                </p>
            </CardHeader>
            <CardContent>
                <div className="h-36 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={data} margin={{ top: 8, right: 4, left: -24, bottom: 0 }}>
                            <XAxis
                                dataKey="hour"
                                tick={{ fontSize: 10 }}
                                ticks={[0, 6, 12, 18, 23]}
                                tickFormatter={(h) => `${h}시`}
                            />
                            <YAxis tick={{ fontSize: 10 }} allowDecimals={false} width={32} />
                            <Tooltip
                                cursor={{ fill: "rgba(0,0,0,0.04)" }}
                                formatter={(v) => [`${v}건`, "활동"]}
                                labelFormatter={(h) => `${h}시`}
                            />
                            <Bar dataKey="count" radius={[2, 2, 0, 0]}>
                                {data.map((d) => (
                                    <Cell key={d.hour} fill={d.peak ? "#6366f1" : "#c7c9d1"} />
                                ))}
                            </Bar>
                        </BarChart>
                    </ResponsiveContainer>
                </div>
            </CardContent>
        </Card>
    );
}
