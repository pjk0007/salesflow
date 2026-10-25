import { OpenColumnHead } from "@/components/email/opens/ui/OpenColumnHead";
import { OpenCountCell } from "@/components/email/opens/ui/OpenCountCell";
import { ClickCountCell } from "@/components/email/clicks/ui/ClickCountCell";
import { useState } from "react";
import { useUnifiedLogs } from "@/hooks/useUnifiedLogs";
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
import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import { QueryErrorState } from "@/components/layouts/WorkspaceLayout";

const CHANNEL_MAP: Record<string, { label: string; variant: "default" | "secondary" | "outline" }> = {
    alimtalk: { label: "알림톡", variant: "secondary" },
    email: { label: "이메일", variant: "outline" },
};

const STATUS_MAP: Record<string, { label: string; variant: "default" | "secondary" | "destructive" }> = {
    uncertain: { label: "결과 미확인", variant: "secondary" },
    cancelled: { label: "발송 취소", variant: "secondary" },
    pending: { label: "대기", variant: "secondary" },
    sent: { label: "성공", variant: "default" },
    failed: { label: "실패", variant: "destructive" },
    rejected: { label: "거부", variant: "destructive" },
};

const TRIGGER_TYPE_MAP: Record<string, { label: string; variant: "default" | "secondary" | "outline" }> = {
    manual: { label: "수동", variant: "outline" },
    auto: { label: "자동", variant: "default" },
    repeat: { label: "반복", variant: "secondary" },
    ai_auto: { label: "AI 자동", variant: "default" },
    ai_followup: { label: "후속발송", variant: "secondary" },
    visit_ack: { label: "방문 감사", variant: "secondary" },
    // 템플릿 후속·AI 후속 테스트 발송이 남기는 값 (발송 이력 표와 같은 이름)
    followup: { label: "템플릿 후속", variant: "secondary" },
    test_followup: { label: "후속 테스트", variant: "outline" },
};

interface UnifiedLogTableProps {
    recordId?: number;
    compact?: boolean;
}

export default function UnifiedLogTable({ recordId, compact }: UnifiedLogTableProps) {
    const [page, setPage] = useState(1);
    const [channel, setChannel] = useState("");
    const [status, setStatus] = useState("");
    const [triggerType, setTriggerType] = useState("");
    const [startDate, setStartDate] = useState("");
    const [endDate, setEndDate] = useState("");
    const [search, setSearch] = useState("");
    const [searchInput, setSearchInput] = useState("");

    const { logs, total, totalPages, isLoading, loadError, mutate } = useUnifiedLogs({
        channel: channel || undefined,
        status: status || undefined,
        triggerType: triggerType || undefined,
        startDate: startDate || undefined,
        endDate: endDate || undefined,
        recordId: recordId || undefined,
        search: search || undefined,
        page,
        pageSize: compact ? 20 : 50,
    });

    const handleSearch = () => {
        setSearch(searchInput);
        setPage(1);
    };

    const handleSearchKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === "Enter") handleSearch();
    };

    // 화면에서 고른 필터·검색만 본다 (레코드 상세 compact 모드의 recordId는 필터가 아니다)
    const hasFilter = !compact && Boolean(channel || status || triggerType || startDate || endDate || search);
    const resetFilters = () => {
        setChannel("");
        setStatus("");
        setTriggerType("");
        setStartDate("");
        setEndDate("");
        setSearch("");
        setSearchInput("");
        setPage(1);
    };

    return (
        <div className="space-y-4">
            {!compact && (
                <div className="flex items-center gap-3 flex-wrap">
                    <Select value={channel || "all"} onValueChange={(v) => { setChannel(v === "all" ? "" : v); setPage(1); }}>
                        <SelectTrigger className="w-[120px]">
                            <SelectValue placeholder="채널" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">전체</SelectItem>
                            <SelectItem value="alimtalk">알림톡</SelectItem>
                            <SelectItem value="email">이메일</SelectItem>
                        </SelectContent>
                    </Select>

                    <Select value={status || "all"} onValueChange={(v) => { setStatus(v === "all" ? "" : v); setPage(1); }}>
                        <SelectTrigger className="w-[120px]">
                            <SelectValue placeholder="상태" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">전체</SelectItem>
                            {Object.entries(STATUS_MAP).map(([value, { label }]) => (
                                <SelectItem key={value} value={value}>{label}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>

                    <Select value={triggerType || "all"} onValueChange={(v) => { setTriggerType(v === "all" ? "" : v); setPage(1); }}>
                        <SelectTrigger className="w-[120px]">
                            <SelectValue placeholder="방식" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">전체</SelectItem>
                            {Object.entries(TRIGGER_TYPE_MAP).map(([value, { label }]) => (
                                <SelectItem key={value} value={value}>{label}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>

                    <Input
                        type="date"
                        value={startDate}
                        onChange={(e) => { setStartDate(e.target.value); setPage(1); }}
                        className="w-[160px]"
                    />
                    <span className="text-muted-foreground">~</span>
                    <Input
                        type="date"
                        value={endDate}
                        onChange={(e) => { setEndDate(e.target.value); setPage(1); }}
                        className="w-[160px]"
                    />

                    <div className="flex gap-2">
                        <Input
                            placeholder="수신자/제목 또는 이메일 주소 전체"
                            value={searchInput}
                            onChange={(e) => setSearchInput(e.target.value)}
                            onKeyDown={handleSearchKeyDown}
                            className="w-[200px]"
                        />
                        <Button variant="outline" size="icon" onClick={handleSearch}>
                            <Search className="h-4 w-4" />
                        </Button>
                    </div>
                </div>
            )}

            {loadError ? <QueryErrorState error={loadError} onRetry={() => mutate()} /> : isLoading ? (
                <div className="space-y-3">
                    {Array.from({ length: compact ? 5 : 10 }).map((_, i) => (
                        <Skeleton key={i} className="h-10 w-full" />
                    ))}
                </div>
            ) : logs.length === 0 ? (
                <div className="flex flex-col items-center justify-center p-12 text-muted-foreground border rounded-lg border-dashed">
                    {hasFilter ? (
                        <>
                            <p className="text-lg mb-1">조건에 맞는 발송 이력이 없습니다</p>
                            <p className="text-sm mb-3">필터나 검색어를 바꾸거나 초기화해 보세요.</p>
                            <Button variant="outline" size="sm" onClick={resetFilters}>필터 초기화</Button>
                        </>
                    ) : (
                        <>
                            <p className="text-lg mb-1">발송 이력이 없습니다</p>
                            <p className="text-sm">알림톡/이메일을 발송하면 이력이 표시됩니다.</p>
                        </>
                    )}
                </div>
            ) : (
                <>
                    <div className="border rounded-lg">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>채널</TableHead>
                                    <TableHead>수신자</TableHead>
                                    <TableHead>제목</TableHead>
                                    <TableHead>상태</TableHead>
                                    <TableHead>클릭</TableHead>
                                    <TableHead><OpenColumnHead /></TableHead>
                                    {!compact && <TableHead>방식</TableHead>}
                                    <TableHead>발송일시</TableHead>
                                    {!compact && <TableHead>결과</TableHead>}
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {logs.map((log) => {
                                    const channelInfo = CHANNEL_MAP[log.channel] || { label: log.channel, variant: "outline" as const };
                                    const statusInfo = STATUS_MAP[log.status] || { label: log.status, variant: "secondary" as const };
                                    const triggerInfo = TRIGGER_TYPE_MAP[log.triggerType || "manual"] || { label: log.triggerType, variant: "outline" as const };

                                    return (
                                        <TableRow key={`${log.channel}-${log.id}`}>
                                            <TableCell>
                                                <Badge variant={channelInfo.variant} className="text-xs">
                                                    {channelInfo.label}
                                                </Badge>
                                            </TableCell>
                                            <TableCell className="font-mono text-sm">
                                                {log.recipient}
                                            </TableCell>
                                            <TableCell className="text-sm max-w-[200px] truncate">
                                                {log.title || "-"}
                                            </TableCell>
                                            <TableCell>
                                                <Badge variant={statusInfo.variant}>
                                                    {statusInfo.label}
                                                </Badge>
                                            </TableCell>
                                            <TableCell><ClickCountCell log={log} /></TableCell>
                                            <TableCell><OpenCountCell log={log} /></TableCell>
                                            {!compact && (
                                                <TableCell>
                                                    <Badge variant={triggerInfo.variant} className="text-xs">
                                                        {triggerInfo.label}
                                                    </Badge>
                                                </TableCell>
                                            )}
                                            <TableCell className="text-sm">
                                                {new Date(log.sentAt).toLocaleString("ko-KR")}
                                            </TableCell>
                                            {!compact && (
                                                <TableCell className="text-xs text-muted-foreground max-w-[200px] truncate">
                                                    {log.resultMessage || "-"}
                                                </TableCell>
                                            )}
                                        </TableRow>
                                    );
                                })}
                            </TableBody>
                        </Table>
                    </div>

                    {totalPages > 1 && (
                        <div className="flex items-center justify-between">
                            <p className="text-sm text-muted-foreground">
                                총 {total.toLocaleString()}건
                            </p>
                            <div className="flex items-center gap-1">
                                <Button
                                    aria-label="이전 페이지"
                                    variant="outline"
                                    size="icon"
                                    className="h-8 w-8"
                                    disabled={page <= 1}
                                    onClick={() => setPage(page - 1)}
                                >
                                    <ChevronLeft className="h-4 w-4" />
                                </Button>
                                <span className="text-sm px-2">
                                    {page} / {totalPages}
                                </span>
                                <Button
                                    aria-label="다음 페이지"
                                    variant="outline"
                                    size="icon"
                                    className="h-8 w-8"
                                    disabled={page >= totalPages}
                                    onClick={() => setPage(page + 1)}
                                >
                                    <ChevronRight className="h-4 w-4" />
                                </Button>
                            </div>
                        </div>
                    )}
                </>
            )}
        </div>
    );
}
