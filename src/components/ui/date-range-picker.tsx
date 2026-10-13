"use client";

import { useState } from "react";
import { format } from "date-fns";
import { ko } from "date-fns/locale";
import { CalendarIcon } from "lucide-react";
import { Calendar } from "@/components/ui/calendar";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { DateRange } from "react-day-picker";

interface DateRangePickerProps {
    from: Date | undefined;
    to: Date | undefined;
    onChange: (range: { from: Date | undefined; to: Date | undefined }) => void;
    placeholder?: string;
    maxDate?: Date;
    triggerClassName?: string;
}

export function DateRangePicker({ from, to, onChange, placeholder = "기간 선택", maxDate, triggerClassName }: DateRangePickerProps) {
    const [open, setOpen] = useState(false);
    const [draft, setDraft] = useState<DateRange | undefined>(undefined);
    // "start" = 시작일 선택 대기, "end" = 종료일 선택 대기
    const [phase, setPhase] = useState<"start" | "end">("start");

    const handleSelect = (range: DateRange | undefined) => {
        if (phase === "start") {
            // 첫 클릭: 시작일만 잡고 대기
            const picked = range?.from ?? range?.to;
            if (picked) {
                setDraft({ from: picked, to: picked });
                setPhase("end");
            }
        } else {
            // 두 번째 클릭: 종료일 확정하고 닫기
            if (range?.from) {
                const finalTo = range.to ?? range.from;
                setDraft({ from: range.from, to: finalTo });
                onChange({ from: range.from, to: finalTo });
                setOpen(false);
            }
        }
    };

    const label = from && to
        ? `${format(from, "yyyy-MM-dd")} ~ ${format(to, "yyyy-MM-dd")}`
        : placeholder;

    return (
        <Popover open={open} onOpenChange={(o) => {
            setOpen(o);
            if (o) {
                // 열 때: 기존 범위 보여주되, 클릭하면 새로 시작
                setDraft(from && to ? { from, to } : undefined);
                setPhase("start");
            }
        }}>
            <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className={`gap-2 ${triggerClassName ?? ""}`}>
                    <CalendarIcon className="h-3.5 w-3.5" />
                    {label}
                </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                    mode="range"
                    locale={ko}
                    selected={draft}
                    onSelect={handleSelect}
                    defaultMonth={from ?? maxDate}
                    disabled={maxDate ? { after: maxDate } : undefined}
                    numberOfMonths={1}
                />
                <div className="border-t px-3 py-2">
                    <p className="text-xs text-muted-foreground">
                        {phase === "start" ? "시작일을 선택하세요" : "종료일을 선택하세요"}
                    </p>
                </div>
            </PopoverContent>
        </Popover>
    );
}
