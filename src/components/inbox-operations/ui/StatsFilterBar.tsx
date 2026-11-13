"use client";

import { CalendarRange, ChevronDown, GitCompareArrows, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { RangePills } from "@/components/leads/ui/stats/RangePills";
import { PeriodCompareBar } from "@/components/leads/ui/stats/PeriodCompareBar";
import { GROUPS } from "@/components/leadgen/utils/groups";
import { cn } from "@/lib/utils";
import { MEDIUMS, STATS_RANGES, mediumName, type Medium, type StatsFilters } from "../hooks/useStatsFilters";

/** 날짜 고르기 — 리드젠통계와 같은 틀 (빠른 기간·직접 선택·초기화·기간 비교) */
export function StatsDateBar({ f }: { f: StatsFilters }) {
    if (f.periods.periods) return <PeriodCompareBar pc={f.periods} />;
    return (
        <div className="flex flex-wrap items-center gap-2">
            <RangePills ranges={STATS_RANGES} value={f.range} onChange={f.selectRange} />
            <DateRangePicker
                from={f.custom.from}
                to={f.custom.to}
                maxDate={new Date()}
                placeholder="날짜 직접 선택"
                align="end"
                triggerClassName={cn("bg-background", f.isCustom && "border-primary/40 text-primary")}
                onChange={f.selectCustom}
            />
            {f.isCustom && (
                <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={f.reset}>
                    <RotateCcw className="mr-1 h-3.5 w-3.5" />
                    초기화
                </Button>
            )}
            <Button variant="outline" size="sm" onClick={f.startPeriods}>
                <CalendarRange className="mr-1 h-4 w-4" />
                기간 비교
            </Button>
        </div>
    );
}

/** 매체 칸 — 리드젠통계 메일 고르기와 같은 모양 */
const pickerClass = "flex h-9 items-center gap-2 rounded-md border border-border/70 bg-background px-3 text-left text-sm";

function MediumPicker({ value, onChange }: { value: Medium; onChange: (m: Medium) => void }) {
    // 둘 다 고르거나 아무것도 안 고르면 전체
    const checked = (m: Exclude<Medium, "all">) => value === m;
    const toggle = (m: Exclude<Medium, "all">) => onChange(value === m ? "all" : value === "all" ? m : "all");
    return (
        <Popover>
            <PopoverTrigger asChild>
                <button type="button" className={cn(pickerClass, "w-72")} aria-label="응대 매체 고르기">
                    <span className="min-w-0 flex-1 truncate">{value === "all" ? "전체 응대 (웹·이메일)" : mediumName(value)}</span>
                    <ChevronDown className="size-4 shrink-0 opacity-50" />
                </button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-72 p-1">
                <button
                    type="button"
                    onClick={() => onChange("all")}
                    disabled={value === "all"}
                    className="mb-1 flex w-full items-center rounded-sm border-b border-border/40 px-2 py-1.5 text-left text-sm hover:bg-accent disabled:text-muted-foreground disabled:hover:bg-transparent"
                >
                    전체 응대
                    {value !== "all" && <span className="ml-auto text-xs text-muted-foreground">선택 해제</span>}
                </button>
                {MEDIUMS.map((m) => (
                    <label key={m.value} className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent">
                        <Checkbox checked={checked(m.value)} onCheckedChange={() => toggle(m.value)} />
                        <span className="min-w-0 flex-1 truncate">{m.label}</span>
                    </label>
                ))}
            </PopoverContent>
        </Popover>
    );
}

/** 매체 고르기 + 웹·이메일 비교 */
export function StatsMediumBar({ f }: { f: StatsFilters }) {
    return (
        <div className="flex flex-wrap items-center gap-2">
            {f.mediumCompare ? (
                MEDIUMS.map((m, i) => (
                    <span key={m.value} className={cn(pickerClass, "w-48")}>
                        <span className="size-2 shrink-0 rounded-full" style={{ background: GROUPS[i].color }} />
                        <span className="shrink-0 text-xs font-semibold text-muted-foreground">{GROUPS[i].letter}</span>
                        <span className="truncate">{m.label}</span>
                    </span>
                ))
            ) : (
                <MediumPicker value={f.medium} onChange={f.setMedium} />
            )}
            <Button variant="outline" size="sm" onClick={f.toggleMediumCompare} className={cn(f.mediumCompare && "border-primary/40 text-primary")}>
                <GitCompareArrows className="mr-1 h-4 w-4" />
                {f.mediumCompare ? "비교 끄기" : "웹·이메일 비교"}
            </Button>
        </div>
    );
}
