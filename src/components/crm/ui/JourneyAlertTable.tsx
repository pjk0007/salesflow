"use client";

import { useState } from "react";
import { useJourneyAlerts, type JourneyAlertRow } from "../hooks/useJourneyAlerts";
import { useWorkspaces } from "@/hooks/useWorkspaces";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ChevronLeft, ChevronRight, Search, ExternalLink } from "lucide-react";

const STATUS_MAP: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
    pending: { label: "대기", variant: "secondary" },
    sent: { label: "발송됨", variant: "default" },
    failed: { label: "실패", variant: "destructive" },
    skipped: { label: "건너뜀", variant: "outline" },
    dry_run: { label: "테스트", variant: "outline" },
};

const STAGE_MAP: Record<string, string> = {
    "3": "사이트 도착",
    "4": "둘러봄",
    "5": "서비스 깊이 확인",
    "6": "상담·데모·체험",
    "7": "신청 시작",
    "8": "신청 제출·구독",
    "사이트 도착": "사이트 도착",
    "둘러봄": "둘러봄",
    "서비스 깊이 확인": "서비스 깊이 확인",
    "상담·데모·체험 행동": "상담·데모·체험",
    "신청 시작": "신청 시작",
    "신청 제출·구독": "신청 제출·구독",
    "신청·구독·구매 완료": "완료",
};

const TIER_MAP: Record<string, { label: string; color: string }> = {
    urgent: { label: "긴급", color: "text-red-600 bg-red-50" },
    high: { label: "높음", color: "text-orange-600 bg-orange-50" },
    normal: { label: "일반", color: "text-gray-600 bg-gray-50" },
};

function formatDate(dateStr: string) {
    const d = new Date(dateStr);
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    const hour = String(d.getHours()).padStart(2, "0");
    const min = String(d.getMinutes()).padStart(2, "0");
    return `${month}/${day} ${hour}:${min}`;
}

function extractInfo(row: JourneyAlertRow) {
    const card = row.message.cardsV2?.[0]?.card;
    const header = card?.header;
    const priority = row.message.journeyPriority;
    return {
        title: header?.title ?? "",
        subtitle: header?.subtitle ?? "",
        tier: priority?.tier ?? "normal",
        score: priority?.score ?? 0,
        evidence: priority?.evidence ?? [],
    };
}

export default function JourneyAlertTable() {
    const [page, setPage] = useState(1);
    const [workspaceId, setWorkspaceId] = useState<number | undefined>();
    const [status, setStatus] = useState("");
    const [stage, setStage] = useState("");
    const [search, setSearch] = useState("");
    const [searchInput, setSearchInput] = useState("");

    const { workspaces } = useWorkspaces();
    const { alerts, total, totalPages, isLoading } = useJourneyAlerts({
        workspaceId,
        status: status || undefined,
        stage: stage || undefined,
        search: search || undefined,
        page,
        pageSize: 30,
    });

    const workspaceMap = Object.fromEntries(workspaces.map((w) => [w.id, w.name]));

    const handleSearch = () => {
        setSearch(searchInput);
        setPage(1);
    };

    return (
        <div className="space-y-4">
            {/* 워크스페이스(서비스) 탭 */}
            <div className="flex items-center gap-2 border-b pb-3 overflow-x-auto">
                <Button
                    variant={workspaceId === undefined ? "default" : "ghost"}
                    size="sm"
                    onClick={() => { setWorkspaceId(undefined); setPage(1); }}
                >
                    전체
                </Button>
                {workspaces.map((ws) => (
                    <Button
                        key={ws.id}
                        variant={workspaceId === ws.id ? "default" : "ghost"}
                        size="sm"
                        onClick={() => { setWorkspaceId(ws.id); setPage(1); }}
                    >
                        {ws.name}
                    </Button>
                ))}
            </div>

            {/* 필터 */}
            <div className="flex items-center gap-3 flex-wrap">
                <Select value={status || "all"} onValueChange={(v) => { setStatus(v === "all" ? "" : v); setPage(1); }}>
                    <SelectTrigger className="w-[130px]">
                        <SelectValue placeholder="상태" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">전체 상태</SelectItem>
                        <SelectItem value="sent">발송됨</SelectItem>
                        <SelectItem value="pending">대기</SelectItem>
                        <SelectItem value="failed">실패</SelectItem>
                        <SelectItem value="skipped">건너뜀</SelectItem>
                        <SelectItem value="dry_run">테스트</SelectItem>
                    </SelectContent>
                </Select>

                <Select value={stage || "all"} onValueChange={(v) => { setStage(v === "all" ? "" : v); setPage(1); }}>
                    <SelectTrigger className="w-[160px]">
                        <SelectValue placeholder="여정 단계" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">전체 단계</SelectItem>
                        <SelectItem value="사이트 도착">사이트 도착</SelectItem>
                        <SelectItem value="둘러봄">둘러봄</SelectItem>
                        <SelectItem value="서비스 깊이 확인">서비스 깊이 확인</SelectItem>
                        <SelectItem value="상담·데모·체험 행동">상담·데모·체험</SelectItem>
                        <SelectItem value="신청 시작">신청 시작</SelectItem>
                        <SelectItem value="신청 제출·구독">신청 제출·구독</SelectItem>
                        <SelectItem value="신청·구독·구매 완료">완료</SelectItem>
                    </SelectContent>
                </Select>

                <div className="flex items-center gap-2 flex-1 min-w-[200px] max-w-[400px]">
                    <Input
                        placeholder="회사명, 이름 등 검색"
                        value={searchInput}
                        onChange={(e) => setSearchInput(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                        className="flex-1"
                    />
                    <Button variant="outline" size="icon" onClick={handleSearch}>
                        <Search className="h-4 w-4" />
                    </Button>
                </div>

                <span className="text-sm text-muted-foreground ml-auto">
                    총 {total}건
                </span>
            </div>

            {/* 테이블 */}
            <div className="rounded-md border">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead className="w-[60px]">우선순위</TableHead>
                            <TableHead>고객</TableHead>
                            {!workspaceId && <TableHead className="w-[120px]">서비스</TableHead>}
                            <TableHead className="w-[130px]">여정 단계</TableHead>
                            <TableHead className="w-[90px]">상태</TableHead>
                            <TableHead className="w-[110px]">마지막 활동</TableHead>
                            <TableHead className="w-[110px]">생성일</TableHead>
                            <TableHead className="w-[60px]">링크</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {isLoading ? (
                            Array.from({ length: 10 }).map((_, i) => (
                                <TableRow key={i}>
                                    {Array.from({ length: workspaceId ? 7 : 8 }).map((_, j) => (
                                        <TableCell key={j}><Skeleton className="h-5 w-full" /></TableCell>
                                    ))}
                                </TableRow>
                            ))
                        ) : alerts.length === 0 ? (
                            <TableRow>
                                <TableCell colSpan={workspaceId ? 7 : 8} className="text-center py-8 text-muted-foreground">
                                    알림 데이터가 없습니다.
                                </TableCell>
                            </TableRow>
                        ) : (
                            alerts.map((row) => {
                                const info = extractInfo(row);
                                const tierInfo = TIER_MAP[info.tier] ?? TIER_MAP.normal;
                                const statusInfo = STATUS_MAP[row.status] ?? { label: row.status, variant: "outline" as const };
                                const stageLabel = STAGE_MAP[row.stage] ?? row.stage;
                                return (
                                    <TableRow key={row.id}>
                                        <TableCell>
                                            <span className={`text-xs font-medium px-2 py-0.5 rounded ${tierInfo.color}`}>
                                                {tierInfo.label}
                                            </span>
                                        </TableCell>
                                        <TableCell>
                                            <div className="font-medium text-sm">{info.title}</div>
                                            <div className="text-xs text-muted-foreground">{info.subtitle}</div>
                                        </TableCell>
                                        {!workspaceId && (
                                            <TableCell className="text-sm">
                                                {workspaceMap[row.workspaceId] ?? `#${row.workspaceId}`}
                                            </TableCell>
                                        )}
                                        <TableCell>
                                            <span className="text-sm">{stageLabel}</span>
                                        </TableCell>
                                        <TableCell>
                                            <Badge variant={statusInfo.variant}>{statusInfo.label}</Badge>
                                        </TableCell>
                                        <TableCell className="text-sm text-muted-foreground">
                                            {formatDate(row.lastActivityAt)}
                                        </TableCell>
                                        <TableCell className="text-sm text-muted-foreground">
                                            {formatDate(row.createdAt)}
                                        </TableCell>
                                        <TableCell>
                                            <a
                                                href={`/records/${row.recordId}/journey`}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="text-blue-600 hover:text-blue-800"
                                            >
                                                <ExternalLink className="h-4 w-4" />
                                            </a>
                                        </TableCell>
                                    </TableRow>
                                );
                            })
                        )}
                    </TableBody>
                </Table>
            </div>

            {totalPages > 1 && (
                <div className="flex items-center justify-center gap-2">
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setPage((p) => Math.max(1, p - 1))}
                        disabled={page <= 1}
                    >
                        <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <span className="text-sm text-muted-foreground">
                        {page} / {totalPages}
                    </span>
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                        disabled={page >= totalPages}
                    >
                        <ChevronRight className="h-4 w-4" />
                    </Button>
                </div>
            )}
        </div>
    );
}
