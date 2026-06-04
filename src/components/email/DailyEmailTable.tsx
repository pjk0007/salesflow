"use client";

import { useState } from "react";
import { ChevronRight, ChevronDown } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
    Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { useEmailDaily, type EmailDailyGroup } from "@/hooks/useEmailDaily";

const TRIGGER_LABELS: Record<string, string> = {
    manual: "수동 발송",
    auto: "자동 발송",
    repeat: "반복 발송",
    ai_auto: "AI 자동발송",
    ai_followup: "후속 발송",
    test_followup: "후속 테스트",
};

function rate(clicked: number, sent: number): string {
    return sent > 0 ? `${Math.round((clicked / sent) * 1000) / 10}%` : "0%";
}

/**
 * 날짜별 발송·클릭 — 날짜 행을 펼치면 발송 유형 + 캠페인(템플릿/AI규칙)별로 쪼개 보여준다.
 * 같은 날 한 줄로 뭉치면 "무슨 발송이 나갔나"를 알 수 없어서 드릴다운 제공.
 */
export function DailyEmailTable({ startDate, endDate }: { startDate: string; endDate: string }) {
    const { days, isLoading } = useEmailDaily(startDate, endDate);
    const [expanded, setExpanded] = useState<Set<string>>(new Set());

    const toggle = (date: string) => {
        setExpanded((prev) => {
            const next = new Set(prev);
            if (next.has(date)) next.delete(date);
            else next.add(date);
            return next;
        });
    };

    const rows = days.filter((d) => d.totalSent > 0);

    if (isLoading && days.length === 0) {
        return (
            <Card>
                <CardHeader><CardTitle className="text-base">날짜별 발송·클릭</CardTitle></CardHeader>
                <CardContent><p className="text-sm text-muted-foreground">불러오는 중…</p></CardContent>
            </Card>
        );
    }
    if (rows.length === 0) return null;

    return (
        <Card>
            <CardHeader>
                <CardTitle className="text-base">날짜별 발송·클릭</CardTitle>
                <p className="text-xs text-muted-foreground">날짜를 클릭하면 발송 유형·캠페인별로 펼쳐집니다.</p>
            </CardHeader>
            <CardContent>
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>날짜</TableHead>
                            <TableHead className="text-right">발송</TableHead>
                            <TableHead className="text-right">클릭</TableHead>
                            <TableHead className="text-right">클릭률</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {rows.map((day) => (
                            <DayRows
                                key={day.date}
                                day={day}
                                isOpen={expanded.has(day.date)}
                                onToggle={() => toggle(day.date)}
                            />
                        ))}
                    </TableBody>
                </Table>
            </CardContent>
        </Card>
    );
}

function DayRows({ day, isOpen, onToggle }: { day: EmailDailyGroup; isOpen: boolean; onToggle: () => void }) {
    return (
        <>
            <TableRow className="cursor-pointer hover:bg-muted/40" onClick={onToggle}>
                <TableCell className="font-medium">
                    <span className="inline-flex items-center gap-1">
                        {isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                        {day.date}
                        <span className="ml-1 text-xs text-muted-foreground">({day.breakdown.length})</span>
                    </span>
                </TableCell>
                <TableCell className="text-right tabular-nums">{day.totalSent.toLocaleString()}</TableCell>
                <TableCell className="text-right tabular-nums">{day.totalClicked.toLocaleString()}</TableCell>
                <TableCell className="text-right tabular-nums font-medium text-blue-500">
                    {rate(day.totalClicked, day.totalSent)}
                </TableCell>
            </TableRow>
            {isOpen && day.breakdown.map((b, i) => (
                <TableRow key={`${day.date}-${i}`} className="bg-muted/20 text-sm">
                    <TableCell className="pl-9">
                        <span className="text-muted-foreground">{TRIGGER_LABELS[b.triggerType] ?? b.triggerType}</span>
                        {b.product && (
                            <span className="ml-1.5 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{b.product}</span>
                        )}
                        {b.campaign ? (
                            <span className="ml-1.5">· {b.campaign}</span>
                        ) : (
                            <span className="ml-1.5 text-muted-foreground/60">· (캠페인 정보 없음)</span>
                        )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">{b.sent.toLocaleString()}</TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">{b.clicked.toLocaleString()}</TableCell>
                    <TableCell className="text-right tabular-nums">{rate(b.clicked, b.sent)}</TableCell>
                </TableRow>
            ))}
        </>
    );
}
