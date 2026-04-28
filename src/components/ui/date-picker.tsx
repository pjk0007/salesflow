"use client";

import { useState } from "react";
import { format, parse, isValid } from "date-fns";
import { ko } from "date-fns/locale";
import { CalendarIcon } from "lucide-react";
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
}

export function DatePicker({
    value,
    onChange,
    placeholder = "날짜 선택",
    className,
    triggerClassName,
    disabled,
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
                        "w-full justify-start font-normal",
                        !display && "text-muted-foreground",
                        triggerClassName,
                    )}
                >
                    <CalendarIcon className="mr-2 h-4 w-4 shrink-0 opacity-60" />
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
            </PopoverContent>
        </Popover>
    );
}
