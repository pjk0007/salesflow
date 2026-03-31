"use client";

import { Badge } from "@/components/ui/badge";
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { useAdLeadLogs } from "@/hooks/useAdLeadLogs";
import type { AdLeadLogStatus } from "@/types";

const STATUS_CONFIG: Record<AdLeadLogStatus, { label: string; variant: string }> = {
    success: { label: "성공", variant: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300" },
    failed: { label: "실패", variant: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300" },
    duplicate: { label: "중복", variant: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300" },
    skipped: { label: "스킵", variant: "bg-gray-100 text-gray-700 dark:bg-gray-900/40 dark:text-gray-300" },
};

function formatDateTime(dateStr: string | null): string {
    if (!dateStr) return "-";
    const date = new Date(dateStr);
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    const hours = String(date.getHours()).padStart(2, "0");
    const minutes = String(date.getMinutes()).padStart(2, "0");
    return `${month}/${day} ${hours}:${minutes}`;
}

export default function AdLeadLogTable() {
    const { logs, isLoading } = useAdLeadLogs();

    const recentLogs = logs.slice(0, 20);

    if (isLoading) {
        return <div className="text-muted-foreground py-8 text-center">로딩 중...</div>;
    }

    return (
        <Card>
            <CardHeader>
                <CardTitle>최근 수집 로그</CardTitle>
                <CardDescription>
                    광고 리드 수집 결과를 확인합니다.
                </CardDescription>
            </CardHeader>
            <CardContent>
                {recentLogs.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground text-sm">
                        수집 로그가 없습니다.
                    </div>
                ) : (
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>시간</TableHead>
                                <TableHead>연동</TableHead>
                                <TableHead>리드ID</TableHead>
                                <TableHead>상태</TableHead>
                                <TableHead>에러</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {recentLogs.map((log) => {
                                const statusConfig = STATUS_CONFIG[log.status];
                                return (
                                    <TableRow key={log.id}>
                                        <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                                            {formatDateTime(log.processedAt || log.createdAt)}
                                        </TableCell>
                                        <TableCell className="text-sm">
                                            {log.integrationName || `#${log.integrationId}`}
                                        </TableCell>
                                        <TableCell>
                                            <code className="text-xs font-mono bg-muted px-1.5 py-0.5 rounded">
                                                {log.externalLeadId || "-"}
                                            </code>
                                        </TableCell>
                                        <TableCell>
                                            <span
                                                className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${statusConfig.variant}`}
                                            >
                                                {statusConfig.label}
                                            </span>
                                        </TableCell>
                                        <TableCell className="text-sm text-muted-foreground max-w-[200px] truncate">
                                            {log.errorMessage || "-"}
                                        </TableCell>
                                    </TableRow>
                                );
                            })}
                        </TableBody>
                    </Table>
                )}
            </CardContent>
        </Card>
    );
}
