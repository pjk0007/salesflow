"use client";

import { cn } from "@/lib/utils";
import type { LeadStats } from "@/lib/leads/stats";
import { StatCard } from "./Card";

const INFO =
    "들어온 달마다, 들어온 뒤 며칠 안에 전환됐는지 비율이에요.\n아직 그만큼 지나지 않은 리드는 빼고 셉니다. 일부만 센 칸은 옅게 보여요.\n전환일을 모르는 리드(상태 기록·댓글이 없는 리드)는 분모에만 들어가요.";

/** 코호트 — 행: 들어온 달, 열: 들어온 뒤 N일 안 누적 전환율. 진할수록 높다 (한 색 농도) */
export function CohortTable({ cohorts }: { cohorts: LeadStats["cohorts"] }) {
    if (cohorts.length === 0)
        return (
            <StatCard title="코호트 전환" info={INFO}>
                <p className="py-6 text-sm text-muted-foreground">데이터가 없습니다.</p>
            </StatCard>
        );
    const days = cohorts[0].cells.map((c) => c.days);
    const rate = (c: { eligible: number; converted: number }) => (c.eligible ? c.converted / c.eligible : null);
    const max = Math.max(0.0001, ...cohorts.flatMap((r) => r.cells.map((c) => rate(c) ?? 0)));
    return (
        <StatCard title="코호트 전환" info={INFO}>
            <div className="overflow-x-auto">
                <table className="w-full min-w-[520px] border-separate border-spacing-0.5 text-sm">
                    <thead>
                        <tr className="text-xs text-muted-foreground">
                            <th className="pb-1.5 text-left font-normal">들어온 달</th>
                            <th className="pb-1.5 text-right font-normal">유입</th>
                            {days.map((d) => (
                                <th key={d} className="pb-1.5 text-center font-normal">
                                    {d}일 안
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {cohorts.map((row) => (
                            <tr key={row.month}>
                                <td className="py-1 pr-2 text-muted-foreground tabular-nums">{row.month.replace("-", ".")}</td>
                                <td className="py-1 pr-2 text-right tabular-nums">{row.leads}</td>
                                {row.cells.map((c) => {
                                    const v = rate(c);
                                    const strength = v === null ? 0 : Math.round((v / max) * 70) + 8;
                                    const partial = c.eligible > 0 && c.eligible < row.leads;
                                    return (
                                        <td
                                            key={c.days}
                                            title={v === null ? "아직 지나지 않았어요" : `${c.eligible}건 중 ${c.converted}건 전환`}
                                            className={cn(
                                                "rounded-sm px-2 py-1.5 text-center tabular-nums",
                                                v === null && "text-muted-foreground/50",
                                                partial && "opacity-60",
                                                strength > 50 && "text-primary-foreground",
                                            )}
                                            style={v === null ? undefined : { background: `color-mix(in oklch, var(--primary) ${strength}%, transparent)` }}
                                        >
                                            {v === null ? "—" : `${(v * 100).toFixed(0)}%`}
                                        </td>
                                    );
                                })}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </StatCard>
    );
}
