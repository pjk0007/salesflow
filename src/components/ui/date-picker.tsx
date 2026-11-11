"use client";

import { useState } from "react";
import { format, parse, isValid } from "date-fns";
import { ko } from "date-fns/locale";
import { CalendarIcon, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

interface DatePickerProps {
    /** YYYY-MM-DD string or "" */
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
    className?: string;
    triggerClassName?: string;
    disabled?: boolean;
    /** 값이 있을 때 달력 아래에 "지우기" 버튼 */
    clearable?: boolean;
    /** 트리거 아이콘 왼쪽 여백 등 기본 모양을 빼고 triggerClassName만 쓴다 (입력창 안 작은 버튼용) */
    compact?: boolean;
}

export function DatePicker({
    value,
    onChange,
    placeholder = "날짜 선택",
    className,
    triggerClassName,
    disabled,
    clearable,
    compact,
}: DatePickerProps) {
    const [open, setOpen] = useState(false);

    const date = (() => {
        if (!value) return null;
        const parsed = parse(value, "yyyy-MM-dd", new Date());
        return isValid(parsed) ? parsed : null;
    })();

    const display = date ? format(date, "yyyy-MM-dd") : "";

    const handleSelect = (next: Date | undefined) => {
        if (!next) {
            onChange("");
            return;
        }
        onChange(format(next, "yyyy-MM-dd"));
        setOpen(false);
    };

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <Button
                    type="button"
                    variant="outline"
                    disabled={disabled}
                    className={cn(
                        compact ? "justify-start font-normal" : "w-full justify-start font-normal",
                        !display && "text-muted-foreground",
                        triggerClassName,
                    )}
                >
                    <CalendarIcon className={cn("shrink-0 opacity-60", compact ? "h-3.5 w-3.5" : "mr-2 h-4 w-4")} />
                    {display ? <span className="truncate">{display}</span> : <span>{placeholder}</span>}
                </Button>
            </PopoverTrigger>
            <PopoverContent className={cn("w-auto p-0", className)} align="start">
                <Calendar
                    mode="single"
                    selected={date ?? undefined}
                    onSelect={handleSelect}
                    locale={ko}
                    captionLayout="dropdown"
                    autoFocus
                />
                {clearable && display && (
                    <div className="border-t p-1">
                        <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="w-full justify-center text-muted-foreground"
                            onClick={() => {
                                onChange("");
                                setOpen(false);
                            }}
                        >
                            <X className="h-3.5 w-3.5" /> 지우기
                        </Button>
                    </div>
                )}
            </PopoverContent>
        </Popover>
    );
}
