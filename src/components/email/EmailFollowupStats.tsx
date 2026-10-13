"use client";

import { useMemo, useState } from "react";
import { useFollowupStats, type FollowupStatRow } from "./hooks/useFollowupStats";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ChevronDown, ChevronRight } from "lucide-react";

function rate(n: number, d: number) {
    if (d === 0) return "0%";
    return `${((n / d) * 100).toFixed(1)}%`;
}

interface RuleStats {
    ruleName: string;
    ruleType: string;
    steps: { step: string; totalCount: number; sentCount: number; clickCount: number }[];
    totalCount: number;
    sentCount: number;
    clickCount: number;
}

interface WsGroup {
    workspaceId: number;
    workspaceName: string;
    rules: RuleStats[];
    totalCount: number;
    sentCount: number;
    clickCount: number;
}

function groupData(rows: FollowupStatRow[]): WsGroup[] {
    const wsMap = new Map<number, WsGroup>();
    for (const row of rows) {
        let ws = wsMap.get(row.workspaceId);
        if (!ws) {
            ws = { workspaceId: row.workspaceId, workspaceName: row.workspaceName, rules: [], totalCount: 0, sentCount: 0, clickCount: 0 };
            wsMap.set(row.workspaceId, ws);
        }
        ws.totalCount += row.totalCount;
        ws.sentCount += row.sentCount;
        ws.clickCount += row.clickCount;

        const ruleKey = `${row.ruleType}:${row.ruleName}`;
        let rule = ws.rules.find((r) => `${r.ruleType}:${r.ruleName}` === ruleKey);
        if (!rule) {
            rule = { ruleName: row.ruleName, ruleType: row.ruleType, steps: [], totalCount: 0, sentCount: 0, clickCount: 0 };
            ws.rules.push(rule);
        }
        rule.totalCount += row.totalCount;
        rule.sentCount += row.sentCount;
        rule.clickCount += row.clickCount;

        const existing = rule.steps.find((s) => s.step === row.step);
        if (existing) {
            existing.totalCount += row.totalCount;
            existing.sentCount += row.sentCount;
            existing.clickCount += row.clickCount;
        } else {
            rule.steps.push({ step: row.step, totalCount: row.totalCount, sentCount: row.sentCount, clickCount: row.clickCount });
        }
    }
    for (const ws of wsMap.values()) {
        ws.rules.sort((a, b) => b.totalCount - a.totalCount);
    }
    return [...wsMap.values()].sort((a, b) => a.workspaceName.localeCompare(b.workspaceName));
}

const TYPE_LABEL: Record<string, string> = { ai: "AI", template: "템플릿", other: "기타" };

interface Props {
    startDate: string;
    endDate: string;
}

export default function EmailFollowupStats({ startDate, endDate }: Props) {
    const { rows, isLoading } = useFollowupStats(startDate, endDate);
    const [expandedWs, setExpandedWs] = useState<Set<number>>(new Set());
    const [expandedRules, setExpandedRules] = useState<Set<string>>(new Set());

    const groups = useMemo(() => groupData(rows), [rows]);

    const toggleWs = (id: number) => {
        setExpandedWs((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
    };
    const toggleRule = (key: string) => {
        setExpandedRules((prev) => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });
    };

    if (isLoading) {
        return <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>;
    }

    if (groups.length === 0) {
        return <div className="text-center py-8 text-muted-foreground text-sm">해당 기간에 후속발송 데이터가 없습니다.</div>;
    }

    return (
        <div className="rounded-md border">
            <Table>
                <TableHeader>
                    <TableRow>
                        <TableHead className="w-[40px]" />
                        <TableHead>구분</TableHead>
                        <TableHead className="w-[70px]">유형</TableHead>
                        <TableHead className="w-[80px]">단계</TableHead>
                        <TableHead className="w-[80px] text-right">시도</TableHead>
                        <TableHead className="w-[80px] text-right">성공</TableHead>
                        <TableHead className="w-[80px] text-right">클릭</TableHead>
                        <TableHead className="w-[70px] text-right">클릭률</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {groups.map((ws) => {
                        const wsOpen = expandedWs.has(ws.workspaceId);
                        return (
                            <>
                                <TableRow key={`ws-${ws.workspaceId}`} className="cursor-pointer hover:bg-muted/50" onClick={() => toggleWs(ws.workspaceId)}>
                                    <TableCell>{wsOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</TableCell>
                                    <TableCell className="font-semibold">{ws.workspaceName}</TableCell>
                                    <TableCell />
                                    <TableCell />
                                    <TableCell className="text-right font-semibold">{ws.totalCount.toLocaleString()}</TableCell>
                                    <TableCell className="text-right font-semibold">{ws.sentCount.toLocaleString()}</TableCell>
                                    <TableCell className="text-right font-semibold">{ws.clickCount.toLocaleString()}</TableCell>
                                    <TableCell className="text-right font-semibold">{rate(ws.clickCount, ws.sentCount)}</TableCell>
                                </TableRow>
                                {wsOpen && ws.rules.map((rule) => {
                                    const ruleKey = `${ws.workspaceId}:${rule.ruleType}:${rule.ruleName}`;
                                    const ruleOpen = expandedRules.has(ruleKey);
                                    const steps = [...rule.steps].sort((a, b) => a.step.localeCompare(b.step));
                                    return (
                                        <>
                                            <TableRow key={ruleKey} className="cursor-pointer hover:bg-muted/30 bg-muted/10" onClick={() => toggleRule(ruleKey)}>
                                                <TableCell>{ruleOpen ? <ChevronDown className="h-3.5 w-3.5 ml-1" /> : <ChevronRight className="h-3.5 w-3.5 ml-1" />}</TableCell>
                                                <TableCell className="pl-8 text-sm">{rule.ruleName}</TableCell>
                                                <TableCell><Badge variant="outline" className="text-xs">{TYPE_LABEL[rule.ruleType] ?? rule.ruleType}</Badge></TableCell>
                                                <TableCell className="text-sm text-muted-foreground">합계</TableCell>
                                                <TableCell className="text-right text-sm">{rule.totalCount.toLocaleString()}</TableCell>
                                                <TableCell className="text-right text-sm">{rule.sentCount.toLocaleString()}</TableCell>
                                                <TableCell className="text-right text-sm">{rule.clickCount.toLocaleString()}</TableCell>
                                                <TableCell className="text-right text-sm">{rate(rule.clickCount, rule.sentCount)}</TableCell>
                                            </TableRow>
                                            {ruleOpen && steps.map((s) => (
                                                <TableRow key={`${ruleKey}-${s.step}`} className="bg-muted/5">
                                                    <TableCell />
                                                    <TableCell className="pl-14 text-sm text-muted-foreground">{rule.ruleName}</TableCell>
                                                    <TableCell />
                                                    <TableCell><Badge variant={s.step === "1차 발송" ? "default" : "secondary"} className="text-xs">{s.step}</Badge></TableCell>
                                                    <TableCell className="text-right text-sm text-muted-foreground">{s.totalCount.toLocaleString()}</TableCell>
                                                    <TableCell className="text-right text-sm text-muted-foreground">{s.sentCount.toLocaleString()}</TableCell>
                                                    <TableCell className="text-right text-sm text-muted-foreground">{s.clickCount.toLocaleString()}</TableCell>
                                                    <TableCell className="text-right text-sm text-muted-foreground">{rate(s.clickCount, s.sentCount)}</TableCell>
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
    );
}
