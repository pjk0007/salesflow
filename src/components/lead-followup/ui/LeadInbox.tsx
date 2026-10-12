"use client";
import { useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useKeyLeads } from "../hooks/useKeyLeads";
import { FOLLOWUP_LABELS } from "../types";
import { journeyPriorityLabel, kstDisplay } from "../utils/labels";
import { LeadFollowupPanel } from "./LeadFollowupPanel";

export function LeadInbox() {
    const { leads, criteria, asOf, error, isLoading, reload } = useKeyLeads();
    const [selected, setSelected] = useState<number | null>(null);
    const [status, setStatus] = useState("all"), [business, setBusiness] = useState("all");
    const visible = leads.filter((lead) => (business === "all" || String(lead.workspaceId) === business)
        && (status === "all" || (status === "overdue" ? lead.followup.status === "planned" && !!lead.followup.dueAt && Date.parse(lead.followup.dueAt) <= Date.parse(asOf ?? "") : lead.followup.status === status)));
    const businesses = [...new Map(leads.map((lead) => [lead.workspaceId, lead.businessName])).entries()];
    return <Card><CardHeader><CardTitle className="text-base">핵심 리드 · 후속 대응</CardTitle>
        <p className="text-xs text-muted-foreground">{criteria || "구글챗과 동일한 고객 여정 기준"} · 최대 50명</p>
        <div className="flex flex-wrap gap-2">
            <select aria-label="리드 사업 선택" value={business} onChange={(e) => setBusiness(e.target.value)} className="rounded-md border bg-background p-2 text-sm"><option value="all">전체 사업</option>{businesses.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select>
            <select aria-label="처리 상태 필터" value={status} onChange={(e) => setStatus(e.target.value)} className="rounded-md border bg-background p-2 text-sm"><option value="all">전체 상태</option>{Object.entries(FOLLOWUP_LABELS).map(([key, value]) => <option key={key} value={key}>{value}</option>)}<option value="overdue">연락 기한 지남</option></select>
        </div></CardHeader><CardContent>
        {isLoading ? <p className="text-sm text-muted-foreground">불러오는 중…</p> : error ? <div role="alert"><p className="text-sm text-destructive">{error}</p><Button variant="outline" size="sm" onClick={() => void reload()}>다시 불러오기</Button></div>
            : !visible.length ? <p className="text-sm text-muted-foreground">{leads.length ? "선택한 조건의 리드가 없습니다." : "유효한 고객 여정 중 관심 높음·핵심 리드로 판정된 고객이 아직 없습니다. 새 방문부터 구글챗과 같은 판정이 쌓입니다."}</p> : <Table><TableHeader><TableRow>
                <TableHead>고객 · 사업</TableHead><TableHead>판정 · 근거</TableHead><TableHead>담당자 · 처리 상태</TableHead><TableHead>다음 연락</TableHead><TableHead>관리</TableHead>
            </TableRow></TableHeader><TableBody>{visible.map((lead) => <TableRow key={`${lead.workspaceId}-${lead.customerKey}`}>
                <TableCell><Link className="font-medium hover:underline" href={`/records/${lead.recordId}/journey`}>{lead.company} · {lead.person}</Link><p className="text-xs text-muted-foreground">{lead.businessName} · {lead.email}</p></TableCell>
                <TableCell><Badge variant="outline" className={lead.priority.tier === "urgent" ? "border-red-300 text-red-700 dark:text-red-300" : "border-orange-300 text-orange-700 dark:text-orange-300"}>{journeyPriorityLabel(lead.priority)}</Badge><p className="mt-1 text-xs">{lead.priority.score}점 · {lead.priority.evidence.slice(0, 2).join(" / ")}</p></TableCell>
                <TableCell><p className="text-sm">{lead.ownerName || "연결 전"}</p><p className="text-xs text-muted-foreground">{FOLLOWUP_LABELS[lead.followup.status]}</p></TableCell>
                <TableCell className="text-xs">{lead.followup.dueAt ? kstDisplay(lead.followup.dueAt) : "예정 없음"}</TableCell>
                <TableCell><Button size="sm" variant="outline" onClick={() => setSelected(lead.recordId)}>상태 관리</Button></TableCell>
            </TableRow>)}</TableBody></Table>}
        <Dialog open={selected !== null} onOpenChange={(open) => { if (!open) setSelected(null); }}><DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl"><DialogHeader><DialogTitle>담당자 후속 대응</DialogTitle></DialogHeader>{selected !== null && <LeadFollowupPanel key={selected} recordId={selected} />}</DialogContent></Dialog>
    </CardContent></Card>;
}
