"use client";

import { useMemo, useState } from "react";
import { useEmailSendStats, type SendStatRow } from "./hooks/useEmailSendStats";
import EmailFollowupStats from "./EmailFollowupStats";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ChevronDown, ChevronRight } from "lucide-react";

function todayKST() {
    const now = new Date();
    const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
    return kst.toISOString().slice(0, 10);
}

function rate(numerator: number, denominator: number) {
    if (denominator === 0) return "0%";
    return `${((numerator / denominator) * 100).toFixed(1)}%`;
}

interface PartitionStats {
    totalCount: number;
    sentCount: number;
    clickCount: number;
}

interface DateStats {
    totalCount: number;
    sentCount: number;
    clickCount: number;
    partitions: Record<string, PartitionStats>;
}

interface WorkspaceGroup {
    workspaceId: number;
    workspaceName: string;
    totalCount: number;
    sentCount: number;
    clickCount: number;
    byDate: Record<string, DateStats>;
}

function groupByWorkspace(rows: SendStatRow[]): WorkspaceGroup[] {
    const map = new Map<number, WorkspaceGroup>();
    for (const row of rows) {
        let ws = map.get(row.workspaceId);
        if (!ws) {
            ws = { workspaceId: row.workspaceId, workspaceName: row.workspaceName, totalCount: 0, sentCount: 0, clickCount: 0, byDate: {} };
            map.set(row.workspaceId, ws);
        }
        ws.totalCount += row.totalCount;
        ws.sentCount += row.sentCount;
        ws.clickCount += row.clickCount;
        if (!ws.byDate[row.date]) {
            ws.byDate[row.date] = { totalCount: 0, sentCount: 0, clickCount: 0, partitions: {} };
        }
        ws.byDate[row.date].totalCount += row.totalCount;
        ws.byDate[row.date].sentCount += row.sentCount;
        ws.byDate[row.date].clickCount += row.clickCount;
        const prev = ws.byDate[row.date].partitions[row.partitionName];
        ws.byDate[row.date].partitions[row.partitionName] = {
            totalCount: (prev?.totalCount ?? 0) + row.totalCount,
            sentCount: (prev?.sentCount ?? 0) + row.sentCount,
            clickCount: (prev?.clickCount ?? 0) + row.clickCount,
        };
    }
    return [...map.values()].sort((a, b) => a.workspaceName.localeCompare(b.workspaceName));
}

export default function EmailSendStats() {
    const today = todayKST();
    const [startDate, setStartDate] = useState(today);
    const [endDate, setEndDate] = useState(today);
    const { rows, isLoading } = useEmailSendStats(startDate, endDate);
    const [expandedWs, setExpandedWs] = useState<Set<number>>(new Set());
    const [expandedDates, setExpandedDates] = useState<Set<string>>(new Set());

    const groups = useMemo(() => groupByWorkspace(rows), [rows]);
    const grandTotal = groups.reduce((s, g) => s + g.totalCount, 0);
    const grandSent = groups.reduce((s, g) => s + g.sentCount, 0);
    const grandClick = groups.reduce((s, g) => s + g.clickCount, 0);

    const toggleWs = (id: number) => {
        setExpandedWs((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id); else next.add(id);
            return next;
        });
    };

    const toggleDate = (key: string) => {
        setExpandedDates((prev) => {
            const next = new Set(prev);
            if (next.has(key)) next.delete(key); else next.add(key);
            return next;
        });
    };

    return (
        <div className="space-y-4">
            <div className="flex items-center gap-3 flex-wrap">
                <div className="flex items-center gap-2">
                    <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="w-[160px]" />
                    <span className="text-muted-foreground">~</span>
                    <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="w-[160px]" />
                </div>
                <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" onClick={() => { setStartDate(today); setEndDate(today); }}>오늘</Button>
                    <Button variant="outline" size="sm" onClick={() => {
                        const d = new Date(new Date().getTime() + 9 * 60 * 60 * 1000);
                        d.setDate(d.getDate() - 7);
                        setStartDate(d.toISOString().slice(0, 10)); setEndDate(today);
                    }}>최근 7일</Button>
                    <Button variant="outline" size="sm" onClick={() => {
                        const d = new Date(new Date().getTime() + 9 * 60 * 60 * 1000);
                        d.setDate(d.getDate() - 30);
                        setStartDate(d.toISOString().slice(0, 10)); setEndDate(today);
                    }}>최근 30일</Button>
                </div>
                <span className="text-sm text-muted-foreground ml-auto">
                    시도 {grandTotal.toLocaleString()} · 성공 {grandSent.toLocaleString()} · 클릭 {grandClick.toLocaleString()} ({rate(grandClick, grandSent)})
                </span>
            </div>

            {isLoading ? (
                <div className="space-y-2">
                    {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
                </div>
            ) : groups.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">해당 기간에 발송 데이터가 없습니다.</div>
            ) : (
                <div className="rounded-md border">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead className="w-[40px]" />
                                <TableHead>구분</TableHead>
                                <TableHead className="w-[90px] text-right">시도</TableHead>
                                <TableHead className="w-[90px] text-right">성공</TableHead>
                                <TableHead className="w-[90px] text-right">클릭</TableHead>
                                <TableHead className="w-[80px] text-right">클릭률</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {groups.map((ws) => {
                                const wsOpen = expandedWs.has(ws.workspaceId);
                                const dates = Object.keys(ws.byDate).sort().reverse();
                                return (
                                    <>
                                        <TableRow
                                            key={`ws-${ws.workspaceId}`}
                                            className="cursor-pointer hover:bg-muted/50"
                                            onClick={() => toggleWs(ws.workspaceId)}
                                        >
                                            <TableCell>{wsOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</TableCell>
                                            <TableCell className="font-semibold">{ws.workspaceName}</TableCell>
                                            <TableCell className="text-right font-semibold">{ws.totalCount.toLocaleString()}</TableCell>
                                            <TableCell className="text-right font-semibold">{ws.sentCount.toLocaleString()}</TableCell>
                                            <TableCell className="text-right font-semibold">{ws.clickCount.toLocaleString()}</TableCell>
                                            <TableCell className="text-right font-semibold">{rate(ws.clickCount, ws.sentCount)}</TableCell>
                                        </TableRow>
                                        {wsOpen && dates.map((date) => {
                                            const d = ws.byDate[date];
                                            const dateKey = `${ws.workspaceId}-${date}`;
                                            const dateOpen = expandedDates.has(dateKey);
                                            const partEntries = Object.entries(d.partitions).sort((a, b) => b[1].sendCount - a[1].sendCount);
                                            return (
                                                <>
                                                    <TableRow
                                                        key={dateKey}
                                                        className="cursor-pointer hover:bg-muted/30 bg-muted/10"
                                                        onClick={() => toggleDate(dateKey)}
                                                    >
                                                        <TableCell>{dateOpen ? <ChevronDown className="h-3.5 w-3.5 ml-1" /> : <ChevronRight className="h-3.5 w-3.5 ml-1" />}</TableCell>
                                                        <TableCell className="pl-8 text-sm">{date}</TableCell>
                                                        <TableCell className="text-right text-sm">{d.totalCount.toLocaleString()}</TableCell>
                                                        <TableCell className="text-right text-sm">{d.sentCount.toLocaleString()}</TableCell>
                                                        <TableCell className="text-right text-sm">{d.clickCount.toLocaleString()}</TableCell>
                                                        <TableCell className="text-right text-sm">{rate(d.clickCount, d.sentCount)}</TableCell>
                                                    </TableRow>
                                                    {dateOpen && partEntries.map(([name, stats]) => (
                                                        <TableRow key={`${dateKey}-${name}`} className="bg-muted/5">
                                                            <TableCell />
                                                            <TableCell className="pl-14 text-sm text-muted-foreground">{name}</TableCell>
                                                            <TableCell className="text-right text-sm text-muted-foreground">{stats.totalCount.toLocaleString()}</TableCell>
                                                            <TableCell className="text-right text-sm text-muted-foreground">{stats.sentCount.toLocaleString()}</TableCell>
                                                            <TableCell className="text-right text-sm text-muted-foreground">{stats.clickCount.toLocaleString()}</TableCell>
                                                            <TableCell className="text-right text-sm text-muted-foreground">{rate(stats.clickCount, stats.sentCount)}</TableCell>
                                                        </TableRow>
                                                    ))}
                                                </>
                                            );
                                        })}
                                    </>
                                );
                            })}
                        </TableBody>
                    </Table>
                </div>
            )}

            {/* 규칙별 후속발송 성과 */}
            <div className="mt-8">
                <h3 className="text-base font-semibold mb-3">규칙별 후속발송 성과</h3>
                <EmailFollowupStats startDate={startDate} endDate={endDate} />
            </div>
        </div>
    );
}
