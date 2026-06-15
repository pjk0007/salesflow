"use client";

import Link from "next/link";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Monitor, Smartphone, Tablet, Users } from "lucide-react";
import type { TrackerVisitorRow } from "../types";
import { classifyInflow, channelBadgeClass } from "@/components/journey/utils/referrer";
import { cn } from "@/lib/utils";

export function VisitorListTable({ visitors }: { visitors: TrackerVisitorRow[] }) {
    if (visitors.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center rounded-xl border border-dashed py-16 text-center">
                <div className="flex h-11 w-11 items-center justify-center rounded-full bg-muted">
                    <Users className="h-5 w-5 text-muted-foreground" />
                </div>
                <p className="mt-3 text-sm font-medium">아직 방문자가 없습니다</p>
                <p className="mt-1 text-xs text-muted-foreground">
                    사이트에 스크립트를 설치하면 방문자가 여기에 표시됩니다.
                </p>
            </div>
        );
    }

    return (
        <div className="overflow-hidden rounded-xl border">
            <Table>
                <TableHeader>
                    <TableRow className="bg-muted/40 hover:bg-muted/40">
                        <TableHead>방문자</TableHead>
                        <TableHead className="text-right">방문</TableHead>
                        <TableHead className="text-right">페이지뷰</TableHead>
                        <TableHead>디바이스</TableHead>
                        <TableHead className="text-center">유입</TableHead>
                        <TableHead>마지막 방문</TableHead>
                        <TableHead className="w-24">상태</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {visitors.map((v) => (
                        <TableRow key={v.id}>
                            <TableCell>
                                <Link
                                    href={`/tracker/visitors/${v.id}`}
                                    className="font-medium text-foreground hover:text-primary hover:underline"
                                >
                                    {v.email ?? v.name ?? (
                                        <span className="text-muted-foreground">
                                            익명 · {truncate(v.visitorId)}
                                        </span>
                                    )}
                                </Link>
                                {v.email && v.name && (
                                    <div className="text-xs text-muted-foreground">{v.name}</div>
                                )}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                                {v.totalVisits}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                                {v.totalPageviews}
                            </TableCell>
                            <TableCell>
                                <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
                                    <DeviceIcon type={v.deviceType} />
                                    {v.browser ?? "-"}
                                    {v.deviceCount > 1 && (
                                        <span className="text-xs text-muted-foreground/70">
                                            외 {v.deviceCount - 1}
                                        </span>
                                    )}
                                </span>
                            </TableCell>
                            <TableCell className="text-center">
                                {(() => {
                                    const channel = classifyInflow(v.lastReferrer, v.lastPage);
                                    return channel === "직접" ? (
                                        <span className="text-sm text-muted-foreground">-</span>
                                    ) : (
                                        <Badge
                                            variant="secondary"
                                            className={cn("font-normal", channelBadgeClass(channel))}
                                        >
                                            {channel}
                                        </Badge>
                                    );
                                })()}
                            </TableCell>
                            <TableCell className="text-sm text-muted-foreground">
                                {formatRelative(v.lastSeenAt)}
                            </TableCell>
                            <TableCell>
                                {v.recordId ? (
                                    <Link href={`/records?id=${v.recordId}`}>
                                        <Badge className="cursor-pointer">리드 연결</Badge>
                                    </Link>
                                ) : (
                                    <Badge variant="outline" className="text-muted-foreground">
                                        익명
                                    </Badge>
                                )}
                            </TableCell>
                        </TableRow>
                    ))}
                </TableBody>
            </Table>
        </div>
    );
}

function DeviceIcon({ type }: { type: string | null }) {
    if (type === "mobile") return <Smartphone className="h-3.5 w-3.5" />;
    if (type === "tablet") return <Tablet className="h-3.5 w-3.5" />;
    return <Monitor className="h-3.5 w-3.5" />;
}

function truncate(s: string, len = 10): string {
    return s.length <= len ? s : `${s.slice(0, len)}…`;
}

function formatRelative(s: string): string {
    const d = new Date(s);
    if (isNaN(d.getTime())) return s;
    const diff = Date.now() - d.getTime();
    const min = Math.floor(diff / 60000);
    if (min < 1) return "방금 전";
    if (min < 60) return `${min}분 전`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr}시간 전`;
    const day = Math.floor(hr / 24);
    if (day < 7) return `${day}일 전`;
    return d.toLocaleDateString("ko-KR", { month: "2-digit", day: "2-digit" });
}
