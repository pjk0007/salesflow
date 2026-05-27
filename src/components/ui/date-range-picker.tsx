"use client";

import { useState } from "react";
import { format } from "date-fns";
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
 * 공용 기간 선택 — Calendar 2개 popover. 적용 버튼으로 확정.
 * from/to 모두 선택해야 onChange 호출. 단일 선택 중에는 임시 state.
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
                        <p className="text-xs text-muted-foreground">시작일</p>
                        <Calendar
                            mode="single"
                            selected={draftFrom}
                            onSelect={setDraftFrom}
                            disabled={maxDate ? { after: maxDate } : undefined}
                        />
                    </div>
                    <div className="space-y-1">
                        <p className="text-xs text-muted-foreground">종료일</p>
                        <Calendar
                            mode="single"
                            selected={draftTo}
                            onSelect={setDraftTo}
                            disabled={maxDate ? { after: maxDate } : undefined}
                        />
                    </div>
                </div>
                <div className="flex justify-end gap-2 border-t p-2">
                    <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>취소</Button>
                    <Button size="sm" onClick={handleApply} disabled={!draftFrom || !draftTo}>적용</Button>
                </div>
            </PopoverContent>
        </Popover>
    );
}
