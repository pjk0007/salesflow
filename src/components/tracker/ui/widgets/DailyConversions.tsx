"use client";

import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from "recharts";

interface Props {
    data: Array<{ date: string; signups: number; paid: number }>;
    conversionLabel?: string | null;
}

function fmtDate(d: string): string {
    const dt = new Date(d + "T00:00:00");
    return `${dt.getMonth() + 1}/${dt.getDate()}`;
}

/**
 * 일별 가입/구독 추이 — KPI 카드의 ±% 변화를 "왜 그런지" 설명해주는 보조 차트.
 * PV 추세와 다른 점: PV는 volume(허영지표), 가입/구독은 actionable.
 */
export function DailyConversions({ data, conversionLabel }: Props) {
    const empty = data.length === 0 || data.every((d) => d.signups === 0 && d.paid === 0);
    if (empty) {
        return (
            <div className="rounded-lg border bg-card p-4">
                <p className="mb-1 text-sm font-semibold">일별 전환 추이</p>
                <p className="text-sm text-muted-foreground">기간 내 전환 이벤트 없음</p>
            </div>
        );
    }
    const chartData = data.map((d) => ({ ...d, label: fmtDate(d.date) }));
    const hasPaid = data.some((d) => d.paid > 0);
    return (
        <div className="rounded-lg border bg-card p-4">
            <p className="mb-1 text-sm font-semibold">일별 전환 추이</p>
            <p className="mb-3 text-[11px] text-muted-foreground">
                가입{conversionLabel ? ` · ${conversionLabel}` : ""} 발생일 기준
            </p>
            <div className="h-[220px]">
                <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartData} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-border" />
                        <XAxis dataKey="label" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                        <YAxis tick={{ fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
                        <Tooltip contentStyle={{ fontSize: 12, borderRadius: 6 }} />
                        <Legend wrapperStyle={{ fontSize: 11 }} iconType="line" />
                        <Line type="monotone" dataKey="signups" name="가입" stroke="#0ea5e9" strokeWidth={2} dot={{ r: 3 }} />
                        {hasPaid && (
                            <Line
                                type="monotone"
                                dataKey="paid"
                                name={conversionLabel ?? "전환"}
                                stroke="#10b981"
                                strokeWidth={2}
                                dot={{ r: 3 }}
                            />
                        )}
                    </LineChart>
                </ResponsiveContainer>
            </div>
        </div>
    );
}
