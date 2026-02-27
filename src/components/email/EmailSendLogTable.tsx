import { useState } from "react";
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
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ChevronLeft, ChevronRight, RefreshCw, Loader2 } from "lucide-react";
import { toast } from "sonner";

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
};

export default function EmailSendLogTable() {
    const [page, setPage] = useState(1);
    const [triggerType, setTriggerType] = useState<string>("");
    const [syncing, setSyncing] = useState(false);

    const { logs, totalCount, isLoading, syncLogs } = useEmailLogs({
        page,
        triggerType: triggerType || undefined,
    });

    const totalPages = Math.ceil(totalCount / 50);

    const handleSync = async () => {
        setSyncing(true);
        const result = await syncLogs();
        setSyncing(false);
        if (result.success) {
            toast.success(`동기화 완료: ${result.data.updated}건 상태 업데이트`);
        } else {
            toast.error(result.error || "동기화에 실패했습니다.");
        }
    };

    const formatDate = (dateStr: string) => {
        const d = new Date(dateStr);
        return `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
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

            <div className="flex items-center gap-3">
                <Select value={triggerType || "all"} onValueChange={(v) => { setTriggerType(v === "all" ? "" : v); setPage(1); }}>
                    <SelectTrigger className="w-[130px]">
                        <SelectValue placeholder="방식" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">전체</SelectItem>
                        <SelectItem value="manual">수동</SelectItem>
                        <SelectItem value="auto">자동</SelectItem>
                        <SelectItem value="repeat">반복</SelectItem>
                    </SelectContent>
                </Select>
            </div>

            {isLoading ? (
                <div className="space-y-3">
                    {[1, 2, 3, 4, 5].map((i) => (
                        <Skeleton key={i} className="h-10 w-full" />
                    ))}
                </div>
            ) : logs.length === 0 ? (
                <div className="text-center text-muted-foreground py-12">
                    발송 이력이 없습니다.
                </div>
            ) : (
                <>
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>수신자</TableHead>
                                <TableHead>제목</TableHead>
                                <TableHead>상태</TableHead>
                                <TableHead>방식</TableHead>
                                <TableHead>발송일</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {logs.map((log) => {
                                const statusInfo = STATUS_MAP[log.status] || { label: log.status, variant: "secondary" as const };
                                const triggerInfo = TRIGGER_TYPE_MAP[log.triggerType || "manual"] || { label: log.triggerType, variant: "outline" as const };

                                return (
                                    <TableRow key={log.id}>
                                        <TableCell className="font-mono text-sm">{log.recipientEmail}</TableCell>
                                        <TableCell className="max-w-[200px] truncate text-muted-foreground">
                                            {log.subject}
                                        </TableCell>
                                        <TableCell>
                                            <Badge variant={statusInfo.variant}>{statusInfo.label}</Badge>
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
        </div>
    );
}
