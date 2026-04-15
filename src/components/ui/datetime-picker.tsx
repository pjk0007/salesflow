"use client";

import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { ko } from "date-fns/locale";
import { CalendarIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/** 0~23 사이로 클램프 + 두 자리 문자열 */
function pad2(n: number) {
    return String(n).padStart(2, "0");
}

interface DateTimePickerProps {
    /** ISO 8601 string (UTC) or null */
    value: string | null;
    /** ISO 8601 string (UTC) or null */
    onChange: (value: string | null) => void;
    placeholder?: string;
    className?: string;
    triggerClassName?: string;
    /** 트리거 버튼 안쪽에 보이는 텍스트의 클래스 (배지 스타일 등) */
    valueClassName?: string;
    disabled?: boolean;
}

/**
 * 로컬 시간으로 캘린더에서 선택, UTC ISO로 저장.
 * - value: UTC ISO ("2026-04-15T06:00:00.000Z")
 * - 표시: 로컬 시간 ("2026.04.15 오후 03:00")
 */
export function DateTimePicker({
    value,
    onChange,
    placeholder = "날짜 선택",
    className,
    triggerClassName,
    valueClassName,
    disabled,
}: DateTimePickerProps) {
    const [open, setOpen] = useState(false);

    const date = useMemo(() => (value ? new Date(value) : null), [value]);

    // 시/분 입력 버퍼 (편집 중에는 자유 입력, blur/엔터 때 커밋)
    const [hourInput, setHourInput] = useState<string>("");
    const [minInput, setMinInput] = useState<string>("");

    useEffect(() => {
        setHourInput(date ? pad2(date.getHours()) : "09");
        setMinInput(date ? pad2(date.getMinutes()) : "00");
    }, [date]);

    const display = useMemo(() => {
        if (!date) return null;
        return format(date, "yyyy.MM.dd a hh:mm", { locale: ko });
    }, [date]);

    const updateDate = (next: Date) => {
        onChange(next.toISOString());
    };

    const handleDaySelect = (selected: Date | undefined) => {
        if (!selected) return;
        // 기존 시간 유지 (없으면 09:00)
        const h = Number(hourInput) || 0;
        const m = Number(minInput) || 0;
        const next = new Date(selected);
        next.setHours(h, m, 0, 0);
        updateDate(next);
    };

    const commitTime = (h: number, m: number) => {
        const hh = Math.max(0, Math.min(23, h));
        const mm = Math.max(0, Math.min(59, m));
        const base = date ?? new Date();
        const nextDate = new Date(base);
        nextDate.setHours(hh, mm, 0, 0);
        updateDate(nextDate);
        setHourInput(pad2(hh));
        setMinInput(pad2(mm));
    };

    const onTimeKeyDown = (
        e: React.KeyboardEvent<HTMLInputElement>,
        kind: "h" | "m",
    ) => {
        if (e.key === "ArrowUp" || e.key === "ArrowDown") {
            e.preventDefault();
            const delta = e.key === "ArrowUp" ? 1 : -1;
            const h = Number(hourInput) || 0;
            const m = Number(minInput) || 0;
            if (kind === "h") {
                commitTime((h + delta + 24) % 24, m);
            } else {
                const total = h * 60 + m + delta;
                const wrapped = ((total % 1440) + 1440) % 1440;
                commitTime(Math.floor(wrapped / 60), wrapped % 60);
            }
        } else if (e.key === "Enter") {
            e.preventDefault();
            commitTime(Number(hourInput) || 0, Number(minInput) || 0);
            setOpen(false);
        }
    };

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <Button
                    type="button"
                    variant="ghost"
                    disabled={disabled}
                    className={cn(
                        "h-7 w-full justify-start px-1 text-xs font-normal hover:bg-muted/50",
                        !display && "text-muted-foreground",
                        triggerClassName,
                    )}
                >
                    <CalendarIcon className="mr-1.5 h-3.5 w-3.5 shrink-0 opacity-60" />
                    {display ? (
                        <span className={cn("truncate", valueClassName)}>{display}</span>
                    ) : (
                        <span>{placeholder}</span>
                    )}
                </Button>
            </PopoverTrigger>
            <PopoverContent className={cn("w-auto p-0", className)} align="start">
                <Calendar
                    mode="single"
                    selected={date ?? undefined}
                    onSelect={handleDaySelect}
                    locale={ko}
                    captionLayout="dropdown"
                    autoFocus
                />
                <div className="flex items-center gap-2 border-t p-3">
                    <span className="text-xs text-muted-foreground">시간</span>
                    <div className="flex flex-1 items-center gap-1">
                        <Input
                            type="text"
                            inputMode="numeric"
                            maxLength={2}
                            value={hourInput}
                            onChange={(e) => setHourInput(e.target.value.replace(/\D/g, ""))}
                            onFocus={(e) => e.currentTarget.select()}
                            onBlur={() => commitTime(Number(hourInput) || 0, Number(minInput) || 0)}
                            onKeyDown={(e) => onTimeKeyDown(e, "h")}
                            className="h-8 w-12 text-center tabular-nums"
                            placeholder="HH"
                            aria-label="시"
                        />
                        <span className="text-muted-foreground">:</span>
                        <Input
                            type="text"
                            inputMode="numeric"
                            maxLength={2}
                            value={minInput}
                            onChange={(e) => setMinInput(e.target.value.replace(/\D/g, ""))}
                            onFocus={(e) => e.currentTarget.select()}
                            onBlur={() => commitTime(Number(hourInput) || 0, Number(minInput) || 0)}
                            onKeyDown={(e) => onTimeKeyDown(e, "m")}
                            className="h-8 w-12 text-center tabular-nums"
                            placeholder="MM"
                            aria-label="분"
                        />
                    </div>
                    {date && (
                        <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-8 text-xs text-muted-foreground"
                            onClick={() => {
                                onChange(null);
                                setOpen(false);
                            }}
                        >
                            지우기
                        </Button>
                    )}
                </div>
            </PopoverContent>
        </Popover>
    );
}
