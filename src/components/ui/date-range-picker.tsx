"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { ko } from "date-fns/locale";
import { CalendarIcon, ChevronDown } from "lucide-react";
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
    /** 달력이 버튼 어느 쪽 끝에 맞춰 열릴지 (end: 버튼 오른쪽 끝) */
    align?: "start" | "center" | "end";
}

export function DateRangePicker({ from, to, onChange, placeholder = "기간 선택", maxDate, triggerClassName, align = "start" }: DateRangePickerProps) {
    const [open, setOpen] = useState(false);
    const [draft, setDraft] = useState<DateRange | undefined>(undefined);
    // "start" = 시작일 선택 대기, "end" = 종료일 선택 대기
    const [phase, setPhase] = useState<"start" | "end">("start");
    // 보고 있는 달 — "오늘"을 누르면 이번 달로
    const [month, setMonth] = useState<Date>(() => new Date());
    // 위 "2026년 11월"을 누르면 달력 왼쪽에 연도·월 목록
    const [jumpOpen, setJumpOpen] = useState(false);

    // 달력이 계산한 범위 대신 누른 날짜로 정한다 — 시작일을 한 번 더 누르면 달력은 "선택 해제"로 보지만, 우리는 그날 하루로 본다
    const handleSelect = (_range: DateRange | undefined, day: Date) => {
        if (phase === "start" || !draft?.from) {
            // 첫 클릭: 시작일만 잡고 대기
            setDraft({ from: day, to: day });
            setPhase("end");
            return;
        }
        // 두 번째 클릭: 종료일 확정하고 닫기 (같은 날이면 하루, 시작일보다 앞이면 서로 바꾼다)
        const start = draft.from;
        const range = day < start ? { from: day, to: start } : { from: start, to: day };
        setDraft(range);
        onChange(range);
        setOpen(false);
    };

    // 오늘: 날짜를 고르지 않고 달력만 이번 달로
    const goToday = () => {
        setMonth(new Date());
        setJumpOpen(false);
    };

    const label = from && to ? `${format(from, "yyyy-MM-dd")} ~ ${format(to, "yyyy-MM-dd")}` : placeholder;

    return (
        <Popover
            open={open}
            onOpenChange={(o) => {
                setOpen(o);
                if (o) {
                    // 열 때: 기존 범위 보여주되, 클릭하면 새로 시작
                    setDraft(from && to ? { from, to } : undefined);
                    setPhase("start");
                    setMonth(from ?? maxDate ?? new Date());
                    setJumpOpen(false);
                }
            }}
        >
            <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className={`gap-2 ${triggerClassName ?? ""}`}>
                    <CalendarIcon className="h-3.5 w-3.5" />
                    {label}
                </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align={align}>
                <div className="flex">
                    {jumpOpen && (
                        <MonthJumpPanel
                            month={month}
                            maxDate={maxDate}
                            onPick={(d) => {
                                setMonth(d);
                                setJumpOpen(false);
                            }}
                        />
                    )}
                    <Calendar
                        mode="range"
                        locale={ko}
                        selected={draft}
                        onSelect={handleSelect}
                        month={month}
                        onMonthChange={setMonth}
                        disabled={maxDate ? { after: maxDate } : undefined}
                        numberOfMonths={1}
                        components={{
                            CaptionLabel: ({ children }) => (
                                <button
                                    type="button"
                                    onClick={() => setJumpOpen((v) => !v)}
                                    className="relative z-10 flex items-center gap-1 rounded-md px-2 py-1 text-sm font-medium hover:bg-accent"
                                >
                                    {children}
                                    <ChevronDown className={`h-3.5 w-3.5 opacity-60 transition-transform ${jumpOpen ? "rotate-180" : ""}`} />
                                </button>
                            ),
                        }}
                    />
                </div>
                <div className="flex items-center justify-between gap-2 border-t px-3 py-2">
                    <p className="text-xs text-muted-foreground">{phase === "start" ? "시작일을 선택하세요" : "종료일을 선택하세요"}</p>
                    <button type="button" className="h-7 rounded-md px-2 text-xs hover:bg-accent" onClick={goToday}>
                        오늘
                    </button>
                </div>
            </PopoverContent>
        </Popover>
    );
}

/** 달력 왼쪽 연도·월 목록 — 연도를 고르고 월을 누르면 그 달로 */
function MonthJumpPanel({ month, maxDate, onPick }: { month: Date; maxDate?: Date; onPick: (d: Date) => void }) {
    const [year, setYear] = useState(month.getFullYear());
    const last = (maxDate ?? new Date()).getFullYear();
    const years = Array.from({ length: last - 2015 + 1 }, (_, i) => last - i);
    const selectedRef = useRef<HTMLButtonElement>(null);
    useEffect(() => {
        selectedRef.current?.scrollIntoView({ block: "center" });
    }, []);
    const disabled = (m: number) => !!maxDate && new Date(year, m, 1) > maxDate;
    return (
        <div className="flex border-r text-sm">
            <ul className="scrollbar-thin h-[300px] w-20 overflow-y-auto p-1.5">
                {years.map((y) => (
                    <li key={y}>
                        <button
                            ref={y === year ? selectedRef : undefined}
                            type="button"
                            onClick={() => setYear(y)}
                            className={cn("w-full rounded-md px-2 py-1.5 text-left hover:bg-accent", y === year && "bg-accent font-semibold")}
                        >
                            {y}년
                        </button>
                    </li>
                ))}
            </ul>
            <ul className="scrollbar-thin h-[300px] w-16 overflow-y-auto border-l p-1.5">
                {Array.from({ length: 12 }, (_, m) => (
                    <li key={m}>
                        <button
                            type="button"
                            disabled={disabled(m)}
                            onClick={() => onPick(new Date(year, m, 1))}
                            className={cn(
                                "w-full rounded-md px-2 py-1.5 text-left hover:bg-accent disabled:pointer-events-none disabled:opacity-40",
                                year === month.getFullYear() && m === month.getMonth() && "bg-primary text-primary-foreground hover:bg-primary",
                            )}
                        >
                            {m + 1}월
                        </button>
                    </li>
                ))}
            </ul>
        </div>
    );
}
