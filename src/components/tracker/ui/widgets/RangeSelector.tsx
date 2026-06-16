"use client";

import { DateRangePicker } from "@/components/ui/date-range-picker";
import type { Range, RangePreset } from "../../types/overview";

const DAY_MS = 24 * 60 * 60 * 1000;
// 로컬 타임존 기준 YYYY-MM-DD. toISOString()은 UTC라 KST 새벽에 날짜가 하루 밀림.
function ymd(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
}

export function presetRange(preset: RangePreset): Range {
    const today = new Date();
    if (preset === "7d") return { preset, from: ymd(new Date(today.getTime() - 6 * DAY_MS)), to: ymd(today) };
    if (preset === "30d") return { preset, from: ymd(new Date(today.getTime() - 29 * DAY_MS)), to: ymd(today) };
    if (preset === "90d") return { preset, from: ymd(new Date(today.getTime() - 89 * DAY_MS)), to: ymd(today) };
    return { preset: "7d", from: ymd(new Date(today.getTime() - 6 * DAY_MS)), to: ymd(today) };
}

interface Props {
    value: Range;
    onChange: (r: Range) => void;
}

const PRESETS: Array<{ key: RangePreset; label: string }> = [
    { key: "7d", label: "7일" },
    { key: "30d", label: "30일" },
    { key: "90d", label: "90일" },
];

export function RangeSelector({ value, onChange }: Props) {
    return (
        <div className="inline-flex items-center gap-2">
            <div className="inline-flex items-center gap-1 rounded-md border p-0.5">
                {PRESETS.map((p) => {
                    const active = value.preset === p.key;
                    return (
                        <button
                            key={p.key}
                            type="button"
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
