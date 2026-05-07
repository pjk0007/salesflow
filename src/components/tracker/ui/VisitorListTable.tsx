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
import type { TrackerVisitor } from "../types";

export function VisitorListTable({ visitors }: { visitors: TrackerVisitor[] }) {
    if (visitors.length === 0) {
        return (
            <div className="rounded border border-dashed p-8 text-center text-sm text-muted-foreground">
                아직 방문자 데이터가 없습니다.
            </div>
        );
    }

    return (
        <div className="rounded border">
            <Table>
                <TableHeader>
                    <TableRow>
                        <TableHead>방문자</TableHead>
                        <TableHead className="text-right">방문</TableHead>
                        <TableHead className="text-right">페이지뷰</TableHead>
                        <TableHead>디바이스</TableHead>
                        <TableHead>유입</TableHead>
                        <TableHead>마지막 방문</TableHead>
                        <TableHead>리드</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {visitors.map((v) => (
                        <TableRow key={v.id}>
                            <TableCell>
                                <Link
                                    href={`/tracker/visitors/${v.id}`}
                                    className="text-primary hover:underline"
                                >
                                    {v.email ?? v.name ?? truncate(v.visitorId)}
                                </Link>
                                {v.email && v.name && (
                                    <div className="text-xs text-muted-foreground">{v.name}</div>
                                )}
                            </TableCell>
                            <TableCell className="text-right">{v.totalVisits}</TableCell>
                            <TableCell className="text-right">{v.totalPageviews}</TableCell>
                            <TableCell>
                                <span className="text-xs">
                                    {v.deviceType ?? "-"}
                                    {v.browser ? ` · ${v.browser}` : ""}
                                </span>
                            </TableCell>
                            <TableCell>
                                <span className="text-xs">{v.lastUtmSource ?? "-"}</span>
                            </TableCell>
                            <TableCell>
                                <span className="text-xs">{formatDate(v.lastSeenAt)}</span>
                            </TableCell>
                            <TableCell>
                                {v.recordId ? (
                                    <Link
                                        href={`/records?id=${v.recordId}`}
                                        className="inline-flex"
                                    >
                                        <Badge variant="default">연결됨</Badge>
                                    </Link>
                                ) : (
                                    <Badge variant="outline">익명</Badge>
                                )}
                            </TableCell>
                        </TableRow>
                    ))}
                </TableBody>
            </Table>
        </div>
    );
}

function truncate(s: string, len = 12): string {
    return s.length <= len ? s : `${s.slice(0, len)}…`;
}

function formatDate(s: string): string {
    const d = new Date(s);
    if (isNaN(d.getTime())) return s;
    return d.toLocaleString("ko-KR", {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
    });
}
