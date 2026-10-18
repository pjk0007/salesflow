"use client";

import { DateRangePicker } from "@/components/ui/date-range-picker";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { Range, RangePreset } from "../../types/overview";
import { presetRange, rangeDays, shiftRange, ymd } from "../../utils/range";

interface Props {
    value: Range;
    onChange: (r: Range) => void;
}

const PRESETS: Array<{ key: RangePreset; label: string }> = [
    { key: "1d", label: "1일" },
    { key: "7d", label: "7일" },
    { key: "30d", label: "30일" },
    { key: "90d", label: "90일" },
];

export function RangeSelector({ value, onChange }: Props) {
    const days = rangeDays(value);
    const nextDisabled = value.to >= ymd(new Date());
    return (
        <div className="inline-flex flex-wrap items-center gap-2">
            <Button
                type="button"
                variant="outline"
                size="icon-sm"
                aria-label={`이전 ${days}일 보기`}
                title={`이전 ${days}일 보기`}
                onClick={() => onChange(shiftRange(value, -1))}
            >
                <ChevronLeft className="h-4 w-4" />
            </Button>
            <div className="inline-flex items-center gap-1 rounded-md border p-0.5">
                {PRESETS.map((p) => {
                    const active = value.preset === p.key;
                    return (
                        <button
                            key={p.key}
                            type="button"
                            aria-pressed={active}
                            onClick={() => onChange(presetRange(p.key))}
                            className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                                active ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"
                            }`}
                        >
                            {p.label}
                        </button>
                    );
                })}
            </div>
            <Button
                type="button"
                variant="outline"
                size="icon-sm"
                aria-label={`다음 ${days}일 보기`}
                title={nextDisabled ? "오늘까지의 기간입니다" : `다음 ${days}일 보기`}
                disabled={nextDisabled}
                onClick={() => onChange(shiftRange(value, 1))}
            >
                <ChevronRight className="h-4 w-4" />
            </Button>
            <DateRangePicker
                from={value.preset === "custom" ? new Date(`${value.from}T00:00:00`) : undefined}
                to={value.preset === "custom" ? new Date(`${value.to}T00:00:00`) : undefined}
                maxDate={new Date()}
                placeholder="사용자지정"
                onChange={({ from, to }) => {
                    if (from && to) onChange({ preset: "custom", from: ymd(from), to: ymd(to) });
                }}
            />
        </div>
    );
}
