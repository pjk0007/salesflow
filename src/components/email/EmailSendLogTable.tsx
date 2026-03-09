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
import {
    Sheet,
    SheetContent,
    SheetHeader,
    SheetTitle,
    SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ChevronLeft, ChevronRight, RefreshCw, Loader2 } from "lucide-react";
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
};

export default function EmailSendLogTable() {
    const [page, setPage] = useState(1);
    const [triggerType, setTriggerType] = useState<string>("");
    const [isOpened, setIsOpened] = useState<string>("");
    const [syncing, setSyncing] = useState(false);
    const [selectedLog, setSelectedLog] = useState<EmailSendLog | null>(null);

    const { logs, totalCount, isLoading, syncLogs } = useEmailLogs({
        page,
        triggerType: triggerType || undefined,
        isOpened: isOpened || undefined,
    });

    const totalPages = Math.ceil(totalCount / 50);

    const handleSync = async () => {
        setSyncing(true);
        const result = await syncLogs();
        setSyncing(false);
        if (result.success) {
            toast.success(`동기화 완료: ${result.data.updated}건 상태 업데이트${result.data.readUpdated ? `, ${result.data.readUpdated}건 읽음 확인` : ""}`);
        } else {
            toast.error(result.error || "동기화에 실패했습니다.");
        }
    };

    const formatDate = (dateStr: string) => {
        const d = new Date(dateStr);
        return `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    };

    const formatDateFull = (dateStr: string) => {
        return new Date(dateStr).toLocaleString("ko-KR");
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
                        <SelectItem value="ai_auto">AI 자동</SelectItem>
                    </SelectContent>
                </Select>
                <Select value={isOpened || "all"} onValueChange={(v) => { setIsOpened(v === "all" ? "" : v); setPage(1); }}>
                    <SelectTrigger className="w-[130px]">
                        <SelectValue placeholder="읽음 상태" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">전체</SelectItem>
                        <SelectItem value="1">읽음</SelectItem>
                        <SelectItem value="0">안읽음</SelectItem>
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
                                <TableHead>읽음</TableHead>
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
