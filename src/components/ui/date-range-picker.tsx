"use client";

import { useState } from "react";
import { format } from "date-fns";
import { ko } from "date-fns/locale";
import { CalendarIcon } from "lucide-react";
import { Calendar } from "@/components/ui/calendar";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

interface DateRangePickerProps {
    from: Date | undefined;
    to: Date | undefined;
    onChange: (range: { from: Date | undefined; to: Date | undefined }) => void;
    placeholder?: string;
    maxDate?: Date;
}

/**
 * 공용 기간 선택 — 시작일/종료일 달력 2개. 적용 버튼으로 확정.
 * 하단에 선택한 범위를 텍스트로 표기. from/to 모두 선택해야 onChange 호출.
 */
export function DateRangePicker({ from, to, onChange, placeholder = "기간 선택", maxDate }: DateRangePickerProps) {
    const [open, setOpen] = useState(false);
    const [draftFrom, setDraftFrom] = useState<Date | undefined>(from);
    const [draftTo, setDraftTo] = useState<Date | undefined>(to);

    const handleApply = () => {
        if (draftFrom && draftTo) {
            // swap if reversed
            const f = draftFrom <= draftTo ? draftFrom : draftTo;
            const t = draftFrom <= draftTo ? draftTo : draftFrom;
            onChange({ from: f, to: t });
            setOpen(false);
        }
    };

    const label = from && to
        ? `${format(from, "yyyy-MM-dd")} ~ ${format(to, "yyyy-MM-dd")}`
        : placeholder;

    const draftLabel = draftFrom
        ? `${format(draftFrom, "yyyy-MM-dd")} ~ ${draftTo ? format(draftTo, "yyyy-MM-dd") : "종료일 선택"}`
        : "시작일을 선택하세요";

    return (
        <Popover open={open} onOpenChange={(o) => {
            setOpen(o);
            if (o) { setDraftFrom(from); setDraftTo(to); }
        }}>
            <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="gap-2">
                    <CalendarIcon className="h-3.5 w-3.5" />
                    {label}
                </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
                <div className="flex flex-col gap-2 p-3 sm:flex-row">
                    <div className="space-y-1">
                        <p className="text-xs font-medium text-muted-foreground">시작일</p>
                        <Calendar
                            mode="single"
                            locale={ko}
                            selected={draftFrom}
                            onSelect={setDraftFrom}
                            defaultMonth={draftFrom ?? maxDate}
                            disabled={maxDate ? { after: maxDate } : undefined}
                        />
                    </div>
                    <div className="space-y-1">
                        <p className="text-xs font-medium text-muted-foreground">종료일</p>
                        <Calendar
                            mode="single"
                            locale={ko}
                            selected={draftTo}
                            onSelect={setDraftTo}
                            defaultMonth={draftTo ?? maxDate}
                            disabled={[
                                ...(maxDate ? [{ after: maxDate }] : []),
                                ...(draftFrom ? [{ before: draftFrom }] : []),
                            ]}
                        />
                    </div>
                </div>
                <div className="flex items-center justify-between gap-2 border-t p-2">
                    <p className="pl-1 text-xs tabular-nums text-muted-foreground">{draftLabel}</p>
                    <div className="flex gap-2">
                        <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>취소</Button>
                        <Button size="sm" onClick={handleApply} disabled={!draftFrom || !draftTo}>적용</Button>
                    </div>
                </div>
            </PopoverContent>
        </Popover>
    );
}
