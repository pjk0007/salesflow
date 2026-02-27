import { useState } from "react";
import { useAlimtalkLogs } from "@/hooks/useAlimtalkLogs";
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
import { ChevronLeft, ChevronRight, RefreshCw, Loader2 } from "lucide-react";
import { toast } from "sonner";

const STATUS_MAP: Record<string, { label: string; variant: "default" | "secondary" | "destructive" }> = {
    pending: { label: "대기", variant: "secondary" },
    sent: { label: "성공", variant: "default" },
    failed: { label: "실패", variant: "destructive" },
};

const TRIGGER_TYPE_MAP: Record<string, { label: string; variant: "default" | "secondary" | "outline" }> = {
    manual: { label: "수동", variant: "outline" },
    auto: { label: "자동", variant: "default" },
    repeat: { label: "반복", variant: "secondary" },
};

export default function SendLogTable() {
    const [page, setPage] = useState(1);
    const [status, setStatus] = useState<string>("");
    const [startDate, setStartDate] = useState("");
    const [endDate, setEndDate] = useState("");
    const [syncing, setSyncing] = useState(false);

    const { logs, total, totalPages, isLoading, syncResults } = useAlimtalkLogs({
        page,
        status: status || undefined,
        startDate: startDate || undefined,
        endDate: endDate || undefined,
    });

    const handleSync = async () => {
        setSyncing(true);
        const result = await syncResults();
        setSyncing(false);
        if (result.success) {
            toast.success(`동기화 완료: ${result.data.updated}건 상태 업데이트`);
        } else {
            toast.error(result.error || "동기화에 실패했습니다.");
        }
    };

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <h3 className="text-lg font-medium">발송 이력</h3>
                <Button variant="outline" onClick={handleSync} disabled={syncing}>
                    {syncing ? (
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                        <RefreshCw className="h-4 w-4 mr-2" />
                    )}
                    결과 동기화
                </Button>
            </div>

            {/* 필터 */}
            <div className="flex items-center gap-3">
                <Select value={status} onValueChange={(v) => { setStatus(v === "all" ? "" : v); setPage(1); }}>
                    <SelectTrigger className="w-[130px]">
                        <SelectValue placeholder="상태" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">전체</SelectItem>
                        <SelectItem value="pending">대기</SelectItem>
                        <SelectItem value="sent">성공</SelectItem>
                        <SelectItem value="failed">실패</SelectItem>
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
            </div>

            {isLoading ? (
                <div className="space-y-3">
                    {Array.from({ length: 10 }).map((_, i) => (
                        <Skeleton key={i} className="h-10 w-full" />
                    ))}
                </div>
            ) : logs.length === 0 ? (
                <div className="flex flex-col items-center justify-center p-12 text-muted-foreground border rounded-lg border-dashed">
                    <p className="text-lg mb-1">발송 이력이 없습니다</p>
                    <p className="text-sm">알림톡을 발송하면 이력이 표시됩니다.</p>
                </div>
            ) : (
                <>
                    <div className="border rounded-lg">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>발송일시</TableHead>
                                    <TableHead>수신번호</TableHead>
                                    <TableHead>템플릿</TableHead>
                                    <TableHead>방식</TableHead>
                                    <TableHead>상태</TableHead>
                                    <TableHead>결과</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {logs.map((log) => {
                                    const statusInfo = STATUS_MAP[log.status] || {
                                        label: log.status,
                                        variant: "secondary" as const,
                                    };
                                    return (
                                        <TableRow key={log.id}>
                                            <TableCell className="text-sm">
                                                {new Date(log.sentAt).toLocaleString("ko-KR")}
                                            </TableCell>
                                            <TableCell className="font-mono text-xs">
                                                {log.recipientNo}
                                            </TableCell>
                                            <TableCell className="text-sm">
                                                {log.templateName || log.templateCode}
                                            </TableCell>
                                            <TableCell>
                                                {(() => {
                                                    const info = TRIGGER_TYPE_MAP[log.triggerType || "manual"] || TRIGGER_TYPE_MAP.manual;
                                                    return <Badge variant={info.variant} className="text-xs">{info.label}</Badge>;
                                                })()}
                                            </TableCell>
                                            <TableCell>
                                                <Badge variant={statusInfo.variant}>
                                                    {statusInfo.label}
                                                </Badge>
                                            </TableCell>
                                            <TableCell className="text-xs text-muted-foreground max-w-[200px] truncate">
                                                {log.resultMessage || "-"}
                                            </TableCell>
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
