import { useState, useCallback } from "react";
import { useEmailLogs } from "@/hooks/useEmailLogs";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import {
    Sheet,
    SheetContent,
    SheetHeader,
    SheetTitle,
    SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ChevronLeft, ChevronRight, RefreshCw, Loader2, Search, X } from "lucide-react";
import { toast } from "sonner";
import type { EmailSendLog } from "@/lib/db";

const STATUS_MAP: Record<string, { label: string; variant: "default" | "secondary" | "destructive" }> = {
    pending: { label: "대기", variant: "secondary" },
    sent: { label: "발송", variant: "default" },
    failed: { label: "실패", variant: "destructive" },
    rejected: { label: "거부", variant: "destructive" },
};

const TRIGGER_TYPE_MAP: Record<string, { label: string; variant: "default" | "secondary" | "outline" }> = {
    manual: { label: "수동", variant: "outline" },
    auto: { label: "자동", variant: "default" },
    repeat: { label: "반복", variant: "secondary" },
    ai_auto: { label: "AI 자동", variant: "default" },
    ai_followup: { label: "후속발송", variant: "secondary" },
};

type FilterChip = { key: string; value: string; label: string };

const PERIOD_OPTIONS = [
    { value: "7", label: "7일" },
    { value: "30", label: "30일" },
    { value: "90", label: "90일" },
];

const STATUS_OPTIONS = [
    { value: "sent", label: "발송" },
    { value: "failed", label: "실패" },
    { value: "pending", label: "대기" },
];

const TRIGGER_OPTIONS = [
    { value: "manual", label: "수동" },
    { value: "auto", label: "자동" },
    { value: "repeat", label: "반복" },
    { value: "ai_auto", label: "AI 자동" },
    { value: "ai_followup", label: "후속발송" },
];

const READ_OPTIONS = [
    { value: "1", label: "읽음" },
    { value: "0", label: "안읽음" },
];

const CLICK_OPTIONS = [
    { value: "1", label: "클릭" },
    { value: "0", label: "미클릭" },
];

export default function EmailSendLogTable() {
    const [page, setPage] = useState(1);
    const [search, setSearch] = useState("");
    const [searchInput, setSearchInput] = useState("");
    const [status, setStatus] = useState("");
    const [triggerType, setTriggerType] = useState("");
    const [isOpened, setIsOpened] = useState("");
    const [isClicked, setIsClicked] = useState("");
    const [period, setPeriod] = useState("");
    const [syncing, setSyncing] = useState(false);
    const [selectedLog, setSelectedLog] = useState<EmailSendLog | null>(null);

    const dateRange = (() => {
        if (!period) return {};
        const end = new Date();
        const start = new Date();
        start.setDate(start.getDate() - Number(period));
        return {
            startDate: start.toISOString().split("T")[0],
            endDate: end.toISOString().split("T")[0],
        };
    })();

    const { logs, totalCount, isLoading, syncLogs } = useEmailLogs({
        page,
        search: search || undefined,
        status: status || undefined,
        triggerType: triggerType || undefined,
        isOpened: isOpened || undefined,
        isClicked: isClicked || undefined,
        ...dateRange,
    });

    const totalPages = Math.ceil(totalCount / 50);

    const handleSync = async () => {
        setSyncing(true);
        const result = await syncLogs();
        setSyncing(false);
        if (result.success) {
            toast.success(`동기화 완료: ${result.data.updated}건 상태 업데이트, ${result.data.readUpdated || 0}건 읽음 확인 (${result.data.readChecked || 0}건 조회)`);
        } else {
            toast.error(result.error || "동기화에 실패했습니다.");
        }
    };

    const handleSearch = useCallback(() => {
        setSearch(searchInput);
        setPage(1);
    }, [searchInput]);

    const toggleFilter = useCallback((setter: (v: string) => void, current: string, value: string) => {
        setter(current === value ? "" : value);
        setPage(1);
    }, []);

    const activeFilters: FilterChip[] = [];
    if (period) activeFilters.push({ key: "period", value: period, label: `최근 ${period}일` });
    if (status) activeFilters.push({ key: "status", value: status, label: STATUS_MAP[status]?.label || status });
    if (triggerType) activeFilters.push({ key: "triggerType", value: triggerType, label: TRIGGER_TYPE_MAP[triggerType]?.label || triggerType });
    if (isOpened) activeFilters.push({ key: "isOpened", value: isOpened, label: isOpened === "1" ? "읽음" : "안읽음" });
    if (isClicked) activeFilters.push({ key: "isClicked", value: isClicked, label: isClicked === "1" ? "클릭" : "미클릭" });
    if (search) activeFilters.push({ key: "search", value: search, label: `"${search}"` });

    const clearFilter = useCallback((key: string) => {
        if (key === "period") setPeriod("");
        if (key === "status") setStatus("");
        if (key === "triggerType") setTriggerType("");
        if (key === "isOpened") setIsOpened("");
        if (key === "isClicked") setIsClicked("");
        if (key === "search") { setSearch(""); setSearchInput(""); }
        setPage(1);
    }, []);

    const clearAll = useCallback(() => {
        setPeriod("");
        setStatus("");
        setTriggerType("");
        setIsOpened("");
        setIsClicked("");
        setSearch("");
        setSearchInput("");
        setPage(1);
    }, []);

    const formatDate = (dateStr: string) => {
        const d = new Date(dateStr);
        return `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    };

    const formatDateFull = (dateStr: string) => {
        return new Date(dateStr).toLocaleString("ko-KR");
    };

    return (
        <div className="space-y-4">
            {/* 헤더 */}
            <div className="flex items-center justify-between">
                <h3 className="text-lg font-medium">
                    발송 이력
                    <span className="text-sm font-normal text-muted-foreground ml-2">{totalCount.toLocaleString()}건</span>
                </h3>
                <Button variant="outline" size="sm" onClick={handleSync} disabled={syncing}>
                    {syncing ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-1.5" />}
                    동기화
                </Button>
            </div>

            {/* 검색 */}
            <div className="flex gap-2">
                <div className="relative flex-1 max-w-sm">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                        placeholder="수신자 이메일 또는 제목 검색..."
                        value={searchInput}
                        onChange={(e) => setSearchInput(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                        className="pl-9"
                    />
                </div>
                <Button variant="outline" size="icon" onClick={handleSearch}>
                    <Search className="h-4 w-4" />
                </Button>
            </div>

            {/* 필터 칩 그룹 */}
            <div className="space-y-2">
                {/* 기간 */}
                <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-xs font-medium text-muted-foreground w-10 shrink-0">기간</span>
                    {PERIOD_OPTIONS.map((opt) => (
                        <button
                            key={opt.value}
                            onClick={() => toggleFilter(setPeriod, period, opt.value)}
                            className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                                period === opt.value
                                    ? "bg-primary text-primary-foreground"
                                    : "bg-muted text-muted-foreground hover:bg-muted/80"
                            }`}
                        >
                            {opt.label}
                        </button>
                    ))}

                    <span className="text-xs text-muted-foreground mx-1">|</span>

                    {/* 상태 */}
                    <span className="text-xs font-medium text-muted-foreground w-10 shrink-0">상태</span>
                    {STATUS_OPTIONS.map((opt) => (
                        <button
                            key={opt.value}
                            onClick={() => toggleFilter(setStatus, status, opt.value)}
                            className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                                status === opt.value
                                    ? "bg-primary text-primary-foreground"
                                    : "bg-muted text-muted-foreground hover:bg-muted/80"
                            }`}
                        >
                            {opt.label}
                        </button>
                    ))}
                </div>

                {/* 방식 */}
                <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-xs font-medium text-muted-foreground w-10 shrink-0">방식</span>
                    {TRIGGER_OPTIONS.map((opt) => (
                        <button
                            key={opt.value}
                            onClick={() => toggleFilter(setTriggerType, triggerType, opt.value)}
                            className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                                triggerType === opt.value
                                    ? "bg-primary text-primary-foreground"
                                    : "bg-muted text-muted-foreground hover:bg-muted/80"
                            }`}
                        >
                            {opt.label}
                        </button>
                    ))}

                    <span className="text-xs text-muted-foreground mx-1">|</span>

                    {/* 읽음/클릭 */}
                    {READ_OPTIONS.map((opt) => (
                        <button
                            key={`read-${opt.value}`}
                            onClick={() => toggleFilter(setIsOpened, isOpened, opt.value)}
                            className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                                isOpened === opt.value
                                    ? "bg-green-600 text-white"
                                    : "bg-muted text-muted-foreground hover:bg-muted/80"
                            }`}
                        >
                            {opt.label}
                        </button>
                    ))}
                    {CLICK_OPTIONS.map((opt) => (
                        <button
                            key={`click-${opt.value}`}
                            onClick={() => toggleFilter(setIsClicked, isClicked, opt.value)}
                            className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                                isClicked === opt.value
                                    ? "bg-blue-600 text-white"
                                    : "bg-muted text-muted-foreground hover:bg-muted/80"
                            }`}
                        >
                            {opt.label}
                        </button>
                    ))}
                </div>

                {/* 적용된 필터 요약 + 초기화 */}
                {activeFilters.length > 0 && (
                    <div className="flex items-center gap-1.5 flex-wrap pt-1">
                        {activeFilters.map((f) => (
                            <Badge
                                key={f.key}
                                variant="secondary"
                                className="gap-1 cursor-pointer hover:bg-destructive/10 hover:text-destructive transition-colors"
                                onClick={() => clearFilter(f.key)}
                            >
                                {f.label}
                                <X className="h-3 w-3" />
                            </Badge>
                        ))}
                        <button
                            onClick={clearAll}
                            className="text-xs text-muted-foreground hover:text-destructive ml-1"
                        >
                            전체 초기화
                        </button>
                    </div>
                )}
            </div>

            {/* 테이블 */}
            {isLoading ? (
                <div className="space-y-3">
                    {[1, 2, 3, 4, 5].map((i) => (
                        <Skeleton key={i} className="h-10 w-full" />
                    ))}
                </div>
            ) : logs.length === 0 ? (
                <div className="text-center text-muted-foreground py-12">
                    {activeFilters.length > 0 ? "조건에 맞는 이력이 없습니다." : "발송 이력이 없습니다."}
                </div>
            ) : (
                <>
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>수신자</TableHead>
                                <TableHead>제목</TableHead>
                                <TableHead>상태</TableHead>
                                <TableHead>읽음</TableHead>
                                <TableHead>클릭</TableHead>
                                <TableHead>방식</TableHead>
                                <TableHead>발송일</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {logs.map((log) => {
                                const statusInfo = STATUS_MAP[log.status] || { label: log.status, variant: "secondary" as const };
                                const triggerInfo = TRIGGER_TYPE_MAP[log.triggerType || "manual"] || { label: log.triggerType, variant: "outline" as const };

                                return (
                                    <TableRow
                                        key={log.id}
                                        className="cursor-pointer"
                                        onClick={() => setSelectedLog(log)}
                                    >
                                        <TableCell className="font-mono text-sm">{log.recipientEmail}</TableCell>
                                        <TableCell className="max-w-[200px] truncate text-muted-foreground">
                                            {log.subject}
                                        </TableCell>
                                        <TableCell>
                                            <Badge variant={statusInfo.variant}>{statusInfo.label}</Badge>
                                        </TableCell>
                                        <TableCell>
                                            {log.status === "sent" ? (
                                                log.isOpened ? (
                                                    <div className="flex flex-col gap-0.5">
                                                        <Badge variant="default" className="bg-green-600 w-fit">읽음</Badge>
                                                        {log.openedAt && (
                                                            <span className="text-xs text-muted-foreground">{formatDate(log.openedAt as unknown as string)}</span>
                                                        )}
                                                    </div>
                                                ) : (
                                                    <Badge variant="outline">안읽음</Badge>
                                                )
                                            ) : null}
                                        </TableCell>
                                        <TableCell>
                                            {log.status === "sent" ? (
                                                (log as Record<string, unknown>).clickCount ? (
                                                    <Badge variant="default" className="bg-blue-600 text-xs">
                                                        {(log as Record<string, unknown>).clickCount as number}회
                                                    </Badge>
                                                ) : (
                                                    <span className="text-xs text-muted-foreground">-</span>
                                                )
                                            ) : null}
                                        </TableCell>
                                        <TableCell>
                                            <Badge variant={triggerInfo.variant}>{triggerInfo.label}</Badge>
                                        </TableCell>
                                        <TableCell className="text-muted-foreground text-sm">
                                            {formatDate(log.sentAt as unknown as string)}
                                        </TableCell>
                                    </TableRow>
                                );
                            })}
                        </TableBody>
                    </Table>

                    {totalPages > 1 && (
                        <div className="flex items-center justify-center gap-2 pt-2">
                            <Button
                                variant="outline"
                                size="icon"
                                onClick={() => setPage(Math.max(1, page - 1))}
                                disabled={page <= 1}
                            >
                                <ChevronLeft className="h-4 w-4" />
                            </Button>
                            <span className="text-sm text-muted-foreground">
                                {page} / {totalPages}
                            </span>
                            <Button
                                variant="outline"
                                size="icon"
                                onClick={() => setPage(Math.min(totalPages, page + 1))}
                                disabled={page >= totalPages}
                            >
                                <ChevronRight className="h-4 w-4" />
                            </Button>
                        </div>
                    )}
                </>
            )}

            {/* 상세 보기 Sheet */}
            <Sheet open={selectedLog !== null} onOpenChange={(open) => { if (!open) setSelectedLog(null); }}>
                <SheetContent className="sm:max-w-lg overflow-y-auto">
                    {selectedLog && (() => {
                        const statusInfo = STATUS_MAP[selectedLog.status] || { label: selectedLog.status, variant: "secondary" as const };
                        const triggerInfo = TRIGGER_TYPE_MAP[selectedLog.triggerType || "manual"] || { label: selectedLog.triggerType, variant: "outline" as const };

                        return (
                            <>
                                <SheetHeader>
                                    <SheetTitle>발송 상세</SheetTitle>
                                    <SheetDescription>{selectedLog.recipientEmail}</SheetDescription>
                                </SheetHeader>

                                <div className="space-y-4 px-4">
                                    <div className="space-y-2">
                                        <div className="grid grid-cols-3 gap-2 py-2 border-b">
                                            <span className="text-sm text-muted-foreground">수신자</span>
                                            <span className="col-span-2 text-sm font-mono">{selectedLog.recipientEmail}</span>
                                        </div>
                                        <div className="grid grid-cols-3 gap-2 py-2 border-b">
                                            <span className="text-sm text-muted-foreground">제목</span>
                                            <span className="col-span-2 text-sm">{selectedLog.subject || "-"}</span>
                                        </div>
                                        <div className="grid grid-cols-3 gap-2 py-2 border-b">
                                            <span className="text-sm text-muted-foreground">상태</span>
                                            <span className="col-span-2">
                                                <Badge variant={statusInfo.variant}>{statusInfo.label}</Badge>
                                            </span>
                                        </div>
                                        <div className="grid grid-cols-3 gap-2 py-2 border-b">
                                            <span className="text-sm text-muted-foreground">방식</span>
                                            <span className="col-span-2">
                                                <Badge variant={triggerInfo.variant}>{triggerInfo.label}</Badge>
                                            </span>
                                        </div>
                                        {selectedLog.status === "sent" && (
                                            <div className="grid grid-cols-3 gap-2 py-2 border-b">
                                                <span className="text-sm text-muted-foreground">읽음</span>
                                                <span className="col-span-2 text-sm">
                                                    {selectedLog.isOpened
                                                        ? formatDateFull(selectedLog.openedAt as unknown as string)
                                                        : "안읽음"}
                                                </span>
                                            </div>
                                        )}
                                        <div className="grid grid-cols-3 gap-2 py-2 border-b">
                                            <span className="text-sm text-muted-foreground">발송일시</span>
                                            <span className="col-span-2 text-sm">
                                                {formatDateFull(selectedLog.sentAt as unknown as string)}
                                            </span>
                                        </div>
                                        {selectedLog.resultMessage && (
                                            <div className="grid grid-cols-3 gap-2 py-2 border-b">
                                                <span className="text-sm text-muted-foreground">결과</span>
                                                <span className="col-span-2 text-sm text-muted-foreground">
                                                    {selectedLog.resultMessage}
                                                </span>
                                            </div>
                                        )}
                                    </div>

                                    {/* 본문 미리보기 */}
                                    <div className="space-y-2">
                                        <h4 className="text-sm font-medium text-muted-foreground">본문</h4>
                                        {selectedLog.body ? (
                                            <div className="border rounded-lg overflow-hidden">
                                                <iframe
                                                    srcDoc={selectedLog.body}
                                                    className="w-full min-h-[400px] bg-white"
                                                    sandbox=""
                                                    title="이메일 본문"
                                                />
                                            </div>
                                        ) : (
                                            <p className="text-sm text-muted-foreground py-4 text-center border rounded-lg border-dashed">
                                                본문 내용이 저장되지 않은 이메일입니다.
                                            </p>
                                        )}
                                    </div>
                                </div>
                            </>
                        );
                    })()}
                </SheetContent>
            </Sheet>
        </div>
    );
}
