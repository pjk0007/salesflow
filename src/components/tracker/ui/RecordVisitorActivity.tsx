"use client";

import { useRecordVisitorActivity } from "../hooks/useRecordVisitorActivity";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Activity, Eye, MonitorSmartphone } from "lucide-react";
import Link from "next/link";

export function RecordVisitorActivity({ recordId }: { recordId: number }) {
    const { activity, isLoading } = useRecordVisitorActivity(recordId);

    if (isLoading) {
        return (
            <Card>
                <CardHeader>
                    <CardTitle className="text-base flex items-center gap-2">
                        <Activity className="h-4 w-4" /> 행동 정보
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    <Skeleton className="h-24 w-full" />
                </CardContent>
            </Card>
        );
    }

    if (!activity?.summary || activity.summary.deviceCount === 0) {
        return null;
    }

    const { summary, recentEvents } = activity;

    return (
        <Card>
            <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                    <Activity className="h-4 w-4" /> 행동 정보
                </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <Stat label="총 방문" value={summary.totalVisits} />
                    <Stat label="페이지뷰" value={summary.totalPageviews} />
                    <Stat label="이벤트" value={summary.totalEvents} />
                    <Stat
                        label="디바이스"
                        value={summary.deviceCount}
                        icon={<MonitorSmartphone className="h-3 w-3" />}
                    />
                </div>

                <div className="text-xs text-muted-foreground">
                    {summary.firstSeen && (
                        <>첫 방문: {formatDate(summary.firstSeen)} · </>
                    )}
                    {summary.lastSeen && <>마지막 방문: {formatDate(summary.lastSeen)}</>}
                </div>

                {recentEvents.length > 0 && (
                    <div>
                        <div className="mb-2 text-sm font-medium">최근 활동</div>
                        <ul className="space-y-1">
                            {recentEvents.slice(0, 5).map((e) => (
                                <li
                                    key={e.id}
                                    className="flex items-center gap-2 text-xs text-muted-foreground"
                                >
                                    <Eye className="h-3 w-3 shrink-0" />
                                    <span className="shrink-0">{formatDate(e.occurredAt)}</span>
                                    <span className="truncate">
                                        {e.eventType === "PAGE_VIEW"
                                            ? `페이지뷰 ${e.pageUrl ?? ""}`
                                            : e.eventName ?? e.eventType}
                                    </span>
                                </li>
                            ))}
                        </ul>
                    </div>
                )}

                <Link
                    href={`/tracker?recordId=${recordId}`}
                    className="text-xs text-primary hover:underline"
                >
                    전체 행동 보기 →
                </Link>
            </CardContent>
        </Card>
    );
}

function Stat({
    label,
    value,
    icon,
}: {
    label: string;
    value: number;
    icon?: React.ReactNode;
}) {
    return (
        <div>
            <div className="text-xs text-muted-foreground flex items-center gap-1">
                {icon} {label}
            </div>
            <div className="text-lg font-semibold">{value.toLocaleString()}</div>
        </div>
    );
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
