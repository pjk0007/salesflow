"use client";

import { useState, useEffect, useRef } from "react";
import { useFollowupQueue } from "@/hooks/useFollowupQueue";
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
import { ChevronLeft, ChevronRight, Clock, X } from "lucide-react";

const STATUS_MAP: Record<string, { label: string; variant: "default" | "secondary" | "outline" | "destructive" }> = {
    pending: { label: "대기", variant: "outline" },
    sent: { label: "발송", variant: "default" },
    skipped: { label: "건너뜀", variant: "secondary" },
    cancelled: { label: "취소", variant: "destructive" },
};

const SOURCE_TYPE_MAP: Record<string, string> = {
    template: "템플릿",
    ai: "AI",
};

function formatDate(dateStr: string | null) {
    if (!dateStr) return "—";
    return new Date(dateStr).toLocaleString("ko-KR", {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
    });
}

export default function FollowupQueueTable() {
    const [page, setPage] = useState(1);
    const [status, setStatus] = useState<string>("");
    const [sourceType, setSourceType] = useState<string>("");
    const [searchInput, setSearchInput] = useState("");
    const [search, setSearch] = useState("");
    const [cancellingId, setCancellingId] = useState<number | null>(null);
    const debounceRef = useRef<ReturnType<typeof setTimeout>>(null);

    useEffect(() => {
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => {
            setSearch(searchInput);
            setPage(1);
        }, 300);
        return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
    }, [searchInput]);

    const { items, totalCount, isLoading, cancelItem } = useFollowupQueue({
        page,
        status: status || undefined,
        sourceType: sourceType || undefined,
        search: search || undefined,
    });

    const handleCancel = async (id: number) => {
        setCancellingId(id);
        await cancelItem(id);
        setCancellingId(null);
    };

    const totalPages = Math.ceil(totalCount / 50);

    return (
        <div className="space-y-4">
            {/* Filters */}
            <div className="flex gap-3">
                <Select value={status} onValueChange={(v) => { setStatus(v === "all" ? "" : v); setPage(1); }}>
                    <SelectTrigger className="w-[140px]">
                        <SelectValue placeholder="상태" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">전체 상태</SelectItem>
                        <SelectItem value="pending">대기</SelectItem>
                        <SelectItem value="sent">발송</SelectItem>
                        <SelectItem value="skipped">건너뜀</SelectItem>
                        <SelectItem value="cancelled">취소</SelectItem>
                    </SelectContent>
                </Select>

                <Select value={sourceType} onValueChange={(v) => { setSourceType(v === "all" ? "" : v); setPage(1); }}>
                    <SelectTrigger className="w-[140px]">
                        <SelectValue placeholder="유형" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">전체 유형</SelectItem>
                        <SelectItem value="template">템플릿</SelectItem>
                        <SelectItem value="ai">AI</SelectItem>
                    </SelectContent>
                </Select>

                <Input
                    placeholder="수신자 이메일 검색"
                    value={searchInput}
                    onChange={(e) => setSearchInput(e.target.value)}
                    className="w-[240px]"
                />
            </div>

            {/* Table */}
            {isLoading ? (
                <div className="space-y-3">
                    {Array.from({ length: 5 }).map((_, i) => (
                        <Skeleton key={i} className="h-10 w-full" />
                    ))}
                </div>
            ) : items.length === 0 ? (
                <div className="flex flex-col items-center justify-center p-12 text-muted-foreground border rounded-lg border-dashed">
                    <Clock className="h-10 w-10 mb-2" />
                    <p className="text-lg mb-1">후속 발송 예약이 없습니다</p>
                </div>
            ) : (
                <>
                    <div className="rounded-md border">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>수신자</TableHead>
                                    <TableHead>원본 제목</TableHead>
                                    <TableHead className="w-[60px]">단계</TableHead>
                                    <TableHead className="w-[80px]">유형</TableHead>
                                    <TableHead className="w-[120px]">체크 예정일</TableHead>
                                    <TableHead className="w-[80px]">상태</TableHead>
                                    <TableHead className="w-[80px]">결과</TableHead>
                                    <TableHead className="w-[120px]">처리일</TableHead>
                                    <TableHead className="w-[60px]"></TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {items.map((item) => {
                                    const st = STATUS_MAP[item.status] ?? { label: item.status, variant: "outline" as const };
                                    return (
                                        <TableRow key={item.id}>
                                            <TableCell className="max-w-[180px] truncate">
                                                {item.recipientEmail ?? "—"}
                                            </TableCell>
                                            <TableCell className="max-w-[200px] truncate">
                                                {item.parentSubject ?? "—"}
                                            </TableCell>
                                            <TableCell>{item.stepIndex + 1}단계</TableCell>
                                            <TableCell>
                                                <Badge variant="outline">
                                                    {SOURCE_TYPE_MAP[item.sourceType] ?? item.sourceType}
                                                </Badge>
                                            </TableCell>
                                            <TableCell>{formatDate(item.checkAt)}</TableCell>
                                            <TableCell>
                                                <Badge variant={st.variant}>{st.label}</Badge>
                                            </TableCell>
                                            <TableCell>
                                                {item.result === "opened" ? (
                                                    <Badge variant="default">읽음</Badge>
                                                ) : item.result === "not_opened" ? (
                                                    <Badge variant="secondary">미읽음</Badge>
                                                ) : (
                                                    <span className="text-muted-foreground">—</span>
                                                )}
                                            </TableCell>
                                            <TableCell>{formatDate(item.processedAt)}</TableCell>
                                            <TableCell>
                                                {item.status === "pending" && (
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        className="h-7 w-7"
                                                        disabled={cancellingId === item.id}
                                                        onClick={() => handleCancel(item.id)}
                                                    >
                                                        <X className="h-4 w-4" />
                                                    </Button>
                                                )}
                                            </TableCell>
                                        </TableRow>
                                    );
                                })}
                            </TableBody>
                        </Table>
                    </div>

                    {/* Pagination */}
                    {totalPages > 1 && (
                        <div className="flex items-center justify-between">
                            <p className="text-sm text-muted-foreground">
                                총 {totalCount.toLocaleString()}건
                            </p>
                            <div className="flex items-center gap-1">
                                <Button
                                    variant="outline"
                                    size="icon"
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
