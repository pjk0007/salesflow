"use client";

import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { StatCard } from "@/components/leads/ui/stats/Card";
import { COMPARE_METRICS, useCompareTrend, type CompareGroup } from "../hooks/useCompareStats";
import { GROUPS } from "../utils/groups";

/**
 * 묶음 일별 추세 — 고른 지표 하나를 묶음마다 한 선으로 (A 실선·B 긴 점선·C 짧은 점선).
 * byDay: 기간 비교 — 가로축이 기간 첫날부터 "N일째"
 */
export function CompareTrend({ groups, names, byDay = false }: { groups: CompareGroup[]; names: string[]; byDay?: boolean }) {
    const t = useCompareTrend(groups, byDay);
    const label = (i: number) => `${GROUPS[groups[i].index].letter} ${names[i]}`;
    return (
        <StatCard
            title="일별 추세 비교"
            info={`메일을 보낸 날만 점이 찍혀요. 집계가 끝나지 않은 날은 비워 둡니다.${byDay ? "\n가로축은 기간마다 첫날부터 며칠째인지예요." : ""}\nA는 실선, B는 긴 점선, C는 짧은 점선이에요.`}
            action={
                <Tabs value={t.metric} onValueChange={t.setMetric}>
                    <TabsList>
                        {COMPARE_METRICS.map((m) => (
                            <TabsTrigger key={m.value} value={m.value}>
                                {m.label}
                            </TabsTrigger>
                        ))}
                    </TabsList>
                </Tabs>
            }
        >
            {t.error ? (
                <div role="alert" className="flex items-center gap-3 text-sm">
                    이메일 통계를 불러오지 못했습니다.{" "}
                    <Button variant="outline" onClick={t.retry}>
                        다시 불러오기
                    </Button>
                </div>
            ) : t.isLoading ? (
                <Skeleton className="h-80" />
            ) : (
                <ResponsiveContainer width="100%" height={320}>
                    <LineChart data={t.points} margin={{ top: 10, right: 16, bottom: 5, left: 0 }}>
                        <CartesianGrid vertical={false} stroke="var(--border)" strokeOpacity={0.5} />
                        <XAxis dataKey="date" fontSize={11} minTickGap={40} tickLine={false} axisLine={false} />
                        <YAxis unit="%" fontSize={11} tickLine={false} axisLine={false} width={44} />
                        <Tooltip
                            formatter={(v, key) => [v === null || v === undefined ? "—" : `${v}%`, label(Number(String(key).slice(1)))]}
                            contentStyle={{
                                borderRadius: 8,
                                borderColor: "var(--border)",
                                fontSize: 12,
                            }}
                        />
                        {groups.map((g, i) => (
                            <Line
                                key={g.index}
                                dataKey={`g${i}`}
                                stroke={GROUPS[g.index].color}
                                strokeWidth={2}
                                strokeDasharray={GROUPS[g.index].dash}
                                dot={{ r: 2 }}
                                connectNulls
                            />
                        ))}
                    </LineChart>
                </ResponsiveContainer>
            )}
            <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
                {groups.map((g, i) => (
                    <span key={g.index} className="flex min-w-0 items-center gap-1.5">
                        <svg width="16" height="4" className="shrink-0">
                            <line x1="0" y1="2" x2="16" y2="2" stroke={GROUPS[g.index].color} strokeWidth="2" strokeDasharray={GROUPS[g.index].dash} />
                        </svg>
                        <span className="truncate">{label(i)}</span>
                    </span>
                ))}
            </div>
        </StatCard>
    );
}
