"use client";
import { useState } from "react";
import { addDays, addHours, format, nextMonday, setHours, setMinutes, startOfMinute } from "date-fns";
import { ko } from "date-fns/locale";
import { ArrowLeft, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { Hint } from "@/components/ui/hint";

const at = (day: Date, hour: number) => startOfMinute(setMinutes(setHours(day, hour), 0));
const label = (d: Date) => format(d, "yyyy년 M월 d일 a h:mm", { locale: ko });
// 30분 단위 시간 (00:00 ~ 23:30)
const TIMES = Array.from({ length: 48 }, (_, i) => `${String(Math.floor(i / 2)).padStart(2, "0")}:${i % 2 ? "30" : "00"}`);

/**
 * 상담 보류 — 언제까지 보류할지 고른다 (4시간·내일 오전·내일 오후·다음 월요일 오전·사용자 지정).
 * 그 시각이 되면 서버가 진행중으로 되돌린다. 보류 중이면 맨 위에 "보류 해제"가 나온다.
 */
export function SnoozeMenu({
    status,
    snoozedUntil,
    disabled,
    onSnooze,
    onResume,
}: {
    status: "open" | "snoozed" | "closed";
    snoozedUntil?: string | Date | null;
    disabled?: boolean;
    onSnooze: (until: Date) => void;
    onResume: () => void;
}) {
    const [open, setOpen] = useState(false);
    const [custom, setCustom] = useState(false);
    const now = new Date();
    const [day, setDay] = useState<Date | undefined>(addDays(now, 1));
    const [time, setTime] = useState("09:00");
    const tomorrow = addDays(now, 1);
    const options: [string, Date][] = [
        ["4시간", startOfMinute(addHours(now, 4))],
        ["내일 오전", at(tomorrow, 9)],
        ["내일 오후", at(tomorrow, 13)],
        ["다음 월요일 오전", at(nextMonday(now), 9)],
    ];
    const snoozed = status === "snoozed";
    const until = snoozedUntil ? new Date(snoozedUntil) : null;
    const pick = (d: Date) => {
        onSnooze(d);
        setOpen(false);
        setCustom(false);
    };
    const customDate = day ? at(day, Number(time.slice(0, 2))) : null;
    const customValue = customDate ? setMinutes(customDate, Number(time.slice(3))) : null;
    return (
        <Popover
            open={open}
            onOpenChange={(o) => {
                setOpen(o);
                if (!o) setCustom(false);
            }}
        >
            <Hint label={snoozed ? (until ? `${label(until)}까지 보류 중` : "보류 중") : "보류"}>
                <PopoverTrigger asChild>
                    <button
                        type="button"
                        disabled={disabled}
                        aria-label="상담 보류"
                        className={cn(
                            "flex h-9 w-9 items-center justify-center rounded-full hover:bg-muted disabled:opacity-50",
                            snoozed ? "text-amber-600" : "text-muted-foreground",
                        )}
                    >
                        <Clock size={17} />
                    </button>
                </PopoverTrigger>
            </Hint>
            <PopoverContent align="end" className="w-80 p-2">
                {!custom ? (
                    <div>
                        {snoozed && (
                            <div className="mb-1 border-b border-border/40 pb-1">
                                <p className="px-3 py-2 text-xs text-muted-foreground">
                                    {until ? `${label(until)}까지 보류 중` : "보류 중"}
                                </p>
                                <button
                                    type="button"
                                    onClick={() => {
                                        onResume();
                                        setOpen(false);
                                    }}
                                    className="w-full rounded-md px-3 py-2 text-left text-sm hover:bg-muted"
                                >
                                    보류 해제
                                </button>
                            </div>
                        )}
                        <p className="px-3 py-2 text-sm font-semibold">다음 시간까지 보류</p>
                        {options.map(([name, d]) => (
                            <button
                                key={name}
                                type="button"
                                onClick={() => pick(d)}
                                className="flex w-full items-center justify-between gap-3 rounded-md px-3 py-2 text-left text-sm hover:bg-muted"
                            >
                                <span>{name}</span>
                                <span className="text-xs text-muted-foreground">{label(d)}</span>
                            </button>
                        ))}
                        <button
                            type="button"
                            onClick={() => setCustom(true)}
                            className="w-full rounded-md px-3 py-2 text-left text-sm hover:bg-muted"
                        >
                            사용자 지정
                        </button>
                    </div>
                ) : (
                    <div className="space-y-2">
                        <div className="flex items-center gap-2 border-b border-border/40 pb-2">
                            <button type="button" aria-label="뒤로" onClick={() => setCustom(false)} className="rounded-md p-1.5 hover:bg-muted">
                                <ArrowLeft size={16} />
                            </button>
                            <p className="flex-1 text-center text-sm font-semibold">사용자 지정</p>
                            <span className="w-7" />
                        </div>
                        <Calendar mode="single" locale={ko} selected={day} onSelect={setDay} disabled={{ before: now }} className="mx-auto" />
                        <Select value={time} onValueChange={setTime}>
                            <SelectTrigger className="w-full border-border/70" aria-label="보류 끝나는 시간">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent className="max-h-60">
                                {TIMES.map((t) => (
                                    <SelectItem key={t} value={t}>
                                        {t}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        <Button
                            className="w-full"
                            disabled={!customValue || customValue <= now}
                            onClick={() => customValue && pick(customValue)}
                        >
                            {customValue && customValue > now ? `${label(customValue)}까지 보류` : "지난 시간은 고를 수 없어요"}
                        </Button>
                    </div>
                )}
            </PopoverContent>
        </Popover>
    );
}
