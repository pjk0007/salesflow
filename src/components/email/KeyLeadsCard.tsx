"use client";

import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
    Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { useKeyLeads, type KeyLead } from "@/hooks/useKeyLeads";

function formatDuration(sec: number): string {
    if (!sec) return "-";
    if (sec < 60) return `${sec}초`;
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return s ? `${m}분 ${s}초` : `${m}분`;
}

function leadLabel(lead: KeyLead): string {
    return lead.name || lead.email || `고객 #${lead.recordId}`;
}

/**
 * 핵심 리드 — 재방문 잦음/체류 김/메일 클릭 많은 고객을 모아 보여준다.
 * 개인화 메일·후속 액션 대상 선별용.
 */
export function KeyLeadsCard() {
    const { leads, criteria, isLoading } = useKeyLeads();

    return (
        <Card>
            <CardHeader>
                <CardTitle className="text-base">핵심 리드</CardTitle>
                {criteria && (
                    <p className="text-xs text-muted-foreground">
                        방문 {criteria.minVisits}회↑ · 체류 {Math.round(criteria.minDurationSec / 60)}분↑ ·
                        클릭 {criteria.minClicks}회↑ 중 하나라도 충족
                    </p>
                )}
            </CardHeader>
            <CardContent>
                {isLoading ? (
                    <p className="text-sm text-muted-foreground">불러오는 중…</p>
                ) : leads.length === 0 ? (
                    <p className="text-sm text-muted-foreground">조건을 충족하는 핵심 리드가 아직 없습니다.</p>
                ) : (
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>고객</TableHead>
                                <TableHead>프로덕트</TableHead>
                                <TableHead className="text-right">방문</TableHead>
                                <TableHead className="text-right">체류</TableHead>
                                <TableHead className="text-right">클릭</TableHead>
                                <TableHead className="text-right">최근 방문</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {leads.map((lead) => {
                                const label = leadLabel(lead);
                                return (
                                    <TableRow key={`${lead.recordId}-${lead.siteId}`}>
                                        <TableCell className="font-medium max-w-[200px] truncate">
                                            <Link href={`/records?id=${lead.recordId}`} className="hover:underline" title={label}>
                                                {label}
                                            </Link>
                                            {lead.email && lead.name && (
                                                <span className="ml-1 text-xs text-muted-foreground">{lead.email}</span>
                                            )}
                                        </TableCell>
                                        <TableCell>
                                            {lead.product && (
                                                <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">{lead.product}</span>
                                            )}
                                        </TableCell>
                                        <TableCell className="text-right tabular-nums">
                                            {lead.totalVisits >= (criteria?.minVisits ?? 3)
                                                ? <Badge variant="secondary">{lead.totalVisits}</Badge>
                                                : lead.totalVisits}
                                        </TableCell>
                                        <TableCell className="text-right tabular-nums">{formatDuration(lead.totalDurationSec)}</TableCell>
                                        <TableCell className="text-right tabular-nums">
                                            {lead.clickCount >= (criteria?.minClicks ?? 2)
                                                ? <Badge variant="secondary">{lead.clickCount}</Badge>
                                                : lead.clickCount}
                                        </TableCell>
                                        <TableCell className="text-right text-xs text-muted-foreground">
                                            {new Date(lead.lastSeenAt).toLocaleDateString("ko-KR", { month: "2-digit", day: "2-digit" })}
                                        </TableCell>
                                    </TableRow>
                                );
                            })}
                        </TableBody>
                    </Table>
                )}
            </CardContent>
        </Card>
    );
}
