"use client";

import { useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import useSWR from "swr";
import { ChevronLeft, ChevronRight, CheckCircle2, MailQuestion } from "lucide-react";
import { defaultFetcher } from "@/lib/swr-fetcher";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useReplies } from "../hooks/useReplies";
import { KIND_OPTIONS, MATCH_LABELS, formatKstDateTime, ruleStepText } from "../utils/labels";
import { ReplyKindBadge } from "./ReplyKindBadge";
import { ReplySyncBanner } from "./ReplySyncBanner";
import { ReplyDetailSheet } from "./ReplyDetailSheet";

const PAGE_SIZE = 50;

interface PartitionRow {
    workspaceId: number;
    workspaceName: string;
}

/**
 * 이메일 → "회신" 탭 (DESIGN-RPL 11절 1번).
 * 위 띠(연결 상태) · 거르개(분류·상태·처리·사업) · 줄(도착·사업·보낸 사람·제목·분류·규칙·단계·처리) · 옆 창.
 * 카드 링크 `/email?tab=replies&reply={id}`로 열면 그 회신의 옆 창을 바로 연다
 */
export default function RepliesTab() {
    const router = useRouter();
    const pathname = usePathname();
    const searchParams = useSearchParams();
    const deepLinkId = Number(searchParams.get("reply")) || undefined;

    const [page, setPage] = useState(1);
    const [kind, setKind] = useState("");
    const [matchStatus, setMatchStatus] = useState("");
    const [handled, setHandled] = useState<"" | "0" | "1">("");
    const [workspaceId, setWorkspaceId] = useState<number | undefined>(undefined);
    // 줄을 눌러 고른 회신이 먼저, 없으면 카드 링크(reply=)로 연 회신
    const [pickedId, setPickedId] = useState<number | undefined>(undefined);
    const selectedId = pickedId ?? deepLinkId;

    const { items, totalCount, sync, isAdmin, isLoading, loadFailed, update } = useReplies({
        page,
        pageSize: PAGE_SIZE,
        kind: kind || undefined,
        matchStatus: matchStatus || undefined,
        handled: handled || undefined,
        workspaceId,
    });
    // 지금 쪽에 없는 회신(카드 링크로 연 것)은 하나만 따로 읽는다
    const inPage = selectedId !== undefined ? items.find((r) => r.id === selectedId) : undefined;
    const single = useReplies({ id: selectedId }, selectedId !== undefined && !inPage);
    const selected = inPage ?? (selectedId !== undefined ? single.items[0] ?? null : null);

    const { data: partitionsData } = useSWR<{ success: boolean; data?: PartitionRow[] }>("/api/partitions", defaultFetcher);
    const workspaces = useMemo(() => {
        const seen = new Map<number, string>();
        for (const p of partitionsData?.data ?? []) if (!seen.has(p.workspaceId)) seen.set(p.workspaceId, p.workspaceName);
        return [...seen].map(([id, name]) => ({ id, name }));
    }, [partitionsData]);

    const closeSheet = () => {
        setPickedId(undefined);
        if (deepLinkId) {
            const qs = new URLSearchParams(searchParams.toString());
            qs.delete("reply");
            router.replace(`${pathname}?${qs.toString()}`);
        }
    };

    const updateAndRefresh = async (id: number, body: Parameters<typeof update>[1]) => {
        const res = await update(id, body);
        if (!inPage) await single.mutate();
        return res;
    };

    const totalPages = Math.ceil(totalCount / PAGE_SIZE);
    const resetPage = () => setPage(1);

    return (
        <div className="space-y-4">
            <ReplySyncBanner sync={sync} isAdmin={isAdmin} />

            <div className="flex flex-wrap gap-3">
                <Select value={kind || "all"} onValueChange={(v) => { setKind(v === "all" ? "" : v); resetPage(); }}>
                    <SelectTrigger className="w-[150px]">
                        <SelectValue placeholder="분류" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">전체 분류</SelectItem>
                        {KIND_OPTIONS.map((o) => (
                            <SelectItem key={o.value} value={o.value}>
                                {o.label}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>

                <Select value={matchStatus || "all"} onValueChange={(v) => { setMatchStatus(v === "all" ? "" : v); resetPage(); }}>
                    <SelectTrigger className="w-[140px]">
                        <SelectValue placeholder="상태" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">전체 상태</SelectItem>
                        <SelectItem value="matched">이어짐</SelectItem>
                        {isAdmin && <SelectItem value="unmatched">미분류</SelectItem>}
                        {isAdmin && <SelectItem value="ambiguous">애매함</SelectItem>}
                    </SelectContent>
                </Select>

                <Select value={handled || "all"} onValueChange={(v) => { setHandled(v === "all" ? "" : (v as "0" | "1")); resetPage(); }}>
                    <SelectTrigger className="w-[130px]">
                        <SelectValue placeholder="처리" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">처리 전체</SelectItem>
                        <SelectItem value="0">처리 안 함</SelectItem>
                        <SelectItem value="1">처리함</SelectItem>
                    </SelectContent>
                </Select>

                {workspaces.length > 1 && (
                    <Select
                        value={workspaceId ? String(workspaceId) : "all"}
                        onValueChange={(v) => { setWorkspaceId(v === "all" ? undefined : Number(v)); resetPage(); }}
                    >
                        <SelectTrigger className="w-[160px]">
                            <SelectValue placeholder="사업" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">전체 사업</SelectItem>
                            {workspaces.map((w) => (
                                <SelectItem key={w.id} value={String(w.id)}>
                                    {w.name}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                )}
            </div>

            {isLoading ? (
                <div className="space-y-3">
                    {Array.from({ length: 5 }).map((_, i) => (
                        <Skeleton key={i} className="h-10 w-full" />
                    ))}
                </div>
            ) : loadFailed ? (
                <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">회신 목록을 불러오지 못했습니다.</div>
            ) : items.length === 0 ? (
                <div className="flex flex-col items-center justify-center rounded-lg border border-dashed p-12 text-muted-foreground">
                    <MailQuestion className="mb-2 h-10 w-10" />
                    <p className="mb-1 text-lg">아직 회신이 없습니다</p>
                    <p className="text-sm">샌드비 발신 주소로 온 회신만 여기에 보입니다</p>
                </div>
            ) : (
                <>
                    <div className="rounded-md border">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead className="w-[110px]">도착</TableHead>
                                    <TableHead className="w-[120px]">사업</TableHead>
                                    <TableHead>보낸 사람</TableHead>
                                    <TableHead>제목</TableHead>
                                    <TableHead className="w-[90px]">분류</TableHead>
                                    <TableHead>규칙·단계</TableHead>
                                    <TableHead className="w-[60px]">처리</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {items.map((r) => (
                                    <TableRow key={r.id} className="cursor-pointer" onClick={() => setPickedId(r.id)}>
                                        <TableCell className="whitespace-nowrap">{formatKstDateTime(r.receivedAt)}</TableCell>
                                        <TableCell className="max-w-[120px] truncate">
                                            {r.workspaceName ?? <span className="text-muted-foreground">—</span>}
                                        </TableCell>
                                        <TableCell className="max-w-[200px] truncate" title={r.fromEmail}>
                                            {r.fromName || r.fromEmail}
                                        </TableCell>
                                        <TableCell className="max-w-[240px] truncate">
                                            {r.unsubscribeHint && <Badge variant="outline" className="mr-1 border-amber-400 text-amber-700">수신거부?</Badge>}
                                            {r.subject || "(제목 없음)"}
                                        </TableCell>
                                        <TableCell>
                                            <ReplyKindBadge kind={r.kind} />
                                            {/* 구글 챗 카드를 못 보냈으면(실패·버려짐·웹훅 기다림) 목록에서도 보인다 (WPN-5) */}
                                            {(r.alertStatus === "failed" ||
                                                (r.alertStatus === "skipped" && /^(오래되어|웹훅)/.test(r.alertLastError ?? "")) ||
                                                (r.alertStatus === "pending" && /^웹훅/.test(r.alertLastError ?? ""))) && (
                                                <Badge variant="outline" className="ml-1 border-amber-400 text-amber-700" title={r.alertLastError ?? undefined}>
                                                    알림 못 보냄
                                                </Badge>
                                            )}
                                            {r.matchStatus !== "matched" && (
                                                <span className="ml-1 text-xs text-muted-foreground">{MATCH_LABELS[r.matchStatus] ?? r.matchStatus}</span>
                                            )}
                                        </TableCell>
                                        <TableCell className="max-w-[220px] truncate text-xs">{ruleStepText(r)}</TableCell>
                                        <TableCell>
                                            {r.handledAt ? <CheckCircle2 className="size-4 text-emerald-600" /> : <span className="text-muted-foreground">—</span>}
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </div>

                    {totalPages > 1 && (
                        <div className="flex items-center justify-between">
                            <p className="text-sm text-muted-foreground">총 {totalCount.toLocaleString()}건</p>
                            <div className="flex items-center gap-1">
                                <Button variant="outline" size="icon" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                                    <ChevronLeft className="h-4 w-4" />
                                </Button>
                                <span className="px-2 text-sm">
                                    {page} / {totalPages}
                                </span>
                                <Button variant="outline" size="icon" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>
                                    <ChevronRight className="h-4 w-4" />
                                </Button>
                            </div>
                        </div>
                    )}
                </>
            )}

            <ReplyDetailSheet reply={selected} isAdmin={isAdmin} onClose={closeSheet} onUpdate={updateAndRefresh} />
        </div>
    );
}
