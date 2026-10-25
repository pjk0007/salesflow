"use client";

import { useState, useEffect, useRef } from "react";
import { useFollowupQueue } from "@/hooks/useFollowupQueue";
import { toast } from "sonner";
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
import { VISIT_ACK_MIN_SECONDS } from "@/lib/email-visit-ack-threshold";

const STATUS_MAP: Record<string, { label: string; variant: "default" | "secondary" | "outline" | "destructive" }> = {
    pending: { label: "대기", variant: "outline" },
    // 워커가 집어 가서 보내는 중. 잠금이 30분 넘게 풀리지 않으면 다음 회차가 대기로 되돌린다
    processing: { label: "처리 중", variant: "secondary" },
    uncertain: { label: "결과 미확인", variant: "outline" },
    sent: { label: "발송", variant: "default" },
    skipped: { label: "건너뜀", variant: "secondary" },
    cancelled: { label: "취소", variant: "destructive" },
    // 원본 메일의 명단이 발송 실패가 많아 보류 중 (DESIGN-SND 6-2). 관리자가 풀면 대기로 돌아간다
    held: { label: "명단 보류", variant: "outline" },
};

/** 멈춘 까닭 (DESIGN-RPL 11절 5번) — 취소 배지 옆 */
const STOP_REASON_MAP: Record<string, string> = {
    rule_inactive: "(규칙 꺼짐)",
    replied: "(회신)",
    bounced: "(반송)",
    first_failed: "(앞 메일 실패)",
    site_visit: "(사이트 방문)",
    // 방문 감사 줄이 처음부터 취소된 까닭 (email-visit-ack.ts)
    unsubscribed: "(수신거부)",
    completed: "(전환 완료)",
    // 건너뜀·오류 종료의 까닭 (email-followup.ts, UX-162·163)
    quota: "(AI 토큰 한도)",
    config: "(설정 없음)",
    send_failed: "(발송 거절)",
    unmapped_variable: "(변수 매핑 누락)",
    error: "(처리 오류)",
};

const STOP_REASON_TITLE: Record<string, string> = {
    rule_inactive: "규칙이 비활성화되어 후속 발송을 중단했습니다.",
    replied: "고객이 회신해서 자동 메일을 멈췄습니다",
    bounced: "반송된 주소라 자동 메일을 멈췄습니다",
    first_failed: "앞 메일이 받는 쪽에서 실패해(NHN 발송 실패 — 주소 없음 등) 후속을 보내지 않았습니다",
    site_visit: `메일 링크로 사이트를 ${VISIT_ACK_MIN_SECONDS}초 이상 방문해 일반 후속 메일을 중단했습니다`,
    unsubscribed: "수신거부한 주소라 방문 감사 메일을 보내지 않았습니다",
    completed: "이미 전환을 마친 고객이라 방문 감사 메일을 보내지 않았습니다",
    quota: "AI 토큰 한도를 넘어 이 후속을 만들지 않았습니다. 다음 단계도 이어지지 않으니 토큰 한도를 확인해주세요",
    config: "AI 키 또는 이메일 발송 설정이 없어 후속을 보내지 못했습니다. 설정을 확인해주세요",
    send_failed: "NHN이 발송을 받지 않아 후속을 보내지 못했습니다. 발송 이력에서 사유를 확인해주세요",
    unmapped_variable: "템플릿의 변수가 연결에 매핑되지 않아 후속을 보내지 않았습니다. 템플릿 연결에서 변수를 연결해주세요",
    error: "처리 중 오류가 반복되어 후속을 멈췄습니다. 잠시 뒤 다시 시도해도 같으면 관리자에게 알려주세요",
};

const SOURCE_TYPE_MAP: Record<string, string> = {
    template: "템플릿",
    ai: "AI",
    visit_ack: "방문 감사",
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
        const result = await cancelItem(id);
        setCancellingId(null);
        // 그사이 발송 처리에 들어간 줄은 취소되지 않는다 — 이유를 보여 준다
        if (!result?.success) toast.error(result?.error || "취소에 실패했습니다.");
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
                        <SelectItem value="processing">처리 중</SelectItem>
                        <SelectItem value="sent">발송</SelectItem>
                        <SelectItem value="skipped">건너뜀</SelectItem>
                        <SelectItem value="cancelled">취소</SelectItem>
                        <SelectItem value="held">명단 보류</SelectItem>
                        <SelectItem value="uncertain">결과 미확인</SelectItem>
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
                        <SelectItem value="visit_ack">방문 감사</SelectItem>
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
                                            <TableCell>{item.sourceType === "visit_ack" ? "1회" : `${item.stepIndex + 1}단계`}</TableCell>
                                            <TableCell>
                                                <Badge variant="outline">
                                                    {SOURCE_TYPE_MAP[item.sourceType] ?? item.sourceType}
                                                </Badge>
                                            </TableCell>
                                            <TableCell>{formatDate(item.checkAt)}</TableCell>
                                            <TableCell>
                                                <Badge variant={st.variant}>{st.label}</Badge>
                                                {item.stopReason && STOP_REASON_MAP[item.stopReason] && (
                                                    <span
                                                        className="ml-1 text-xs text-muted-foreground"
                                                        title={STOP_REASON_TITLE[item.stopReason]}
                                                    >
                                                        {STOP_REASON_MAP[item.stopReason]}
                                                    </span>
                                                )}
                                            </TableCell>
                                            <TableCell>
                                                {item.result === "clicked" ? (
                                                    <Badge variant="default">클릭</Badge>
                                                ) : item.result === "not_clicked" ? (
                                                    <Badge variant="secondary">미클릭</Badge>
                                                ) : (
                                                    <span className="text-muted-foreground">—</span>
                                                )}
                                            </TableCell>
                                            <TableCell>{formatDate(item.processedAt)}</TableCell>
                                            <TableCell>
                                                {(item.status === "pending" || item.status === "held") && (
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
