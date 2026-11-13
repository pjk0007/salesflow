"use client";

import { Plus, X } from "lucide-react";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import { pickerDate } from "@/components/email/dashboard/utils/period";
import { GROUPS } from "@/components/leadgen/utils/groups";
import { MAX_PERIODS, type PeriodCompare } from "../../hooks/usePeriodCompare";

/** 기간 비교 켰을 때 날짜 자리 — A·B·C 기간 고르기 + 기간 추가 + 비교 끄기 */
export function PeriodCompareBar({ pc }: { pc: PeriodCompare }) {
    if (!pc.periods) return null;
    const periods = pc.periods;
    return (
        <div className="flex flex-wrap items-center gap-2">
            {periods.map((p, i) => (
                <div key={i} className="flex items-center gap-1.5">
                    <span className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
                        <span className="size-2 rounded-full" style={{ background: GROUPS[i].color }} />
                        {GROUPS[i].letter}
                    </span>
                    <DateRangePicker
                        from={pickerDate(p.from)}
                        to={pickerDate(p.to)}
                        maxDate={new Date()}
                        align="end"
                        triggerClassName="bg-background"
                        onChange={({ from, to }) => {
                            if (from && to)
                                pc.set(i, {
                                    from: format(from, "yyyy-MM-dd"),
                                    to: format(to, "yyyy-MM-dd"),
                                });
                        }}
                    />
                    {periods.length > 2 && (
                        <Button variant="ghost" size="icon" aria-label={`${GROUPS[i].letter} 기간 빼기`} onClick={() => pc.remove(i)}>
                            <X className="h-4 w-4" />
                        </Button>
                    )}
                </div>
            ))}
            {periods.length < MAX_PERIODS && (
                <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={pc.add}>
                    <Plus className="mr-1 h-4 w-4" />
                    기간 추가
                </Button>
            )}
            <Button variant="outline" size="sm" className="border-primary/40 text-primary" onClick={pc.stop}>
                비교 끄기
            </Button>
        </div>
    );
}
