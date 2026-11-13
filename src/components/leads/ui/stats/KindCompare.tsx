"use client";

import { cn } from "@/lib/utils";
import { GROUPS } from "@/components/leadgen/utils/groups";
import { memoKindOf } from "../../utils/memo-kinds";
import { StatCard } from "./Card";

/** 기간 비교 — 연락 유형별 횟수를 기간(A·B·C)마다 나란히 (가장 많은 기간은 굵게) */
export function KindCompare({ kinds, periods }: { kinds: Array<{ kind: string; values: number[] }>; periods: number }) {
    return (
        <StatCard title="연락 유형별 횟수" info="그 기간에 들어온 리드에 달린 댓글을 종류 태그로 센 거예요.">
            {kinds.length === 0 ? (
                <p className="py-6 text-sm text-muted-foreground">데이터가 없습니다.</p>
            ) : (
                <table className="w-full text-sm">
                    <thead>
                        <tr className="text-xs text-muted-foreground">
                            <th className="pb-2 text-left font-normal">유형</th>
                            {Array.from({ length: periods }, (_, i) => (
                                <th key={i} className="pb-2 text-right font-normal">
                                    <span className="inline-flex items-center gap-1.5">
                                        <span className="size-2 rounded-full" style={{ background: GROUPS[i].color }} />
                                        {GROUPS[i].letter}
                                    </span>
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {kinds.map((row) => {
                            const k = memoKindOf(row.kind) ?? memoKindOf("etc")!;
                            const max = Math.max(...row.values);
                            const tie = row.values.filter((v) => v === max).length > 1;
                            return (
                                <tr key={row.kind} className="border-t border-border/40">
                                    <td className="py-2">
                                        <span className="flex items-center gap-2">
                                            <span className={cn("flex size-7 shrink-0 items-center justify-center rounded-lg", k.className)}>
                                                <k.icon className="h-3.5 w-3.5" />
                                            </span>
                                            <span className="text-muted-foreground">{k.label}</span>
                                        </span>
                                    </td>
                                    {row.values.map((v, i) => (
                                        <td key={i} className={cn("py-2 text-right tabular-nums", !tie && v === max && v > 0 ? "font-semibold" : "text-foreground/70")}>
                                            {v}건
                                        </td>
                                    ))}
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            )}
        </StatCard>
    );
}
