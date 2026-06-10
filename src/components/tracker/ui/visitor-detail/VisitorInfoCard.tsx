"use client";

import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { User, Monitor, Smartphone, ExternalLink } from "lucide-react";
import type { TrackerVisitor } from "../../types";
import type { VisitorSummary } from "../../types/visitor-detail";
import { formatDateTime, formatDuration, formatRelative } from "../../utils/format";

/**
 * 프로필 헤더 — 왼쪽 신원(이메일·리드 연결), 오른쪽 핵심 숫자 4개,
 * 아래 메타(디바이스·유입·첫 방문) 한 줄.
 */
export function VisitorInfoCard({
    visitor,
    summary,
    totalDuration,
}: {
    visitor: TrackerVisitor;
    summary: VisitorSummary;
    totalDuration: number;
}) {
    const primaryDevice = summary.devices[0];
    const DeviceIcon = primaryDevice?.deviceType === "mobile" ? Smartphone : Monitor;

    return (
        <Card>
            <CardContent className="space-y-4 pt-6">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                    {/* 신원 */}
                    <div className="flex items-center gap-3">
                        <div className="flex size-11 shrink-0 items-center justify-center rounded-full bg-muted">
                            <User className="size-5 text-muted-foreground" />
                        </div>
                        <div className="min-w-0">
                            <div className="flex items-center gap-2">
                                <p className="truncate text-base font-semibold">
                                    {visitor.name ?? visitor.email ?? "익명 방문자"}
                                </p>
                                {visitor.recordId ? (
                                    <Badge className="shrink-0">리드</Badge>
                                ) : (
                                    <Badge variant="outline" className="shrink-0">익명</Badge>
                                )}
                            </div>
                            <div className="mt-0.5 flex items-center gap-2 text-sm text-muted-foreground">
                                {visitor.name && visitor.email && <span className="truncate">{visitor.email}</span>}
                                {visitor.recordId && (
                                    <Link
                                        href={`/records/${visitor.recordId}/journey`}
                                        className="inline-flex shrink-0 items-center gap-1 text-primary hover:underline"
                                    >
                                        여정 보기 <ExternalLink className="size-3" />
                                    </Link>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* 핵심 숫자 */}
                    <div className="grid grid-cols-2 gap-x-8 gap-y-3 sm:grid-cols-4">
                        <Stat label="총 방문" value={`${summary.totalVisits}회`} />
                        <Stat label="페이지뷰" value={String(summary.totalPageviews)} />
                        <Stat label="총 체류시간" value={formatDuration(totalDuration)} />
                        <Stat
                            label="마지막 방문"
                            value={summary.lastSeenAt ? formatRelative(summary.lastSeenAt) : "-"}
                        />
                    </div>
                </div>

                {/* 메타 한 줄 */}
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t pt-3 text-xs text-muted-foreground">
                    {primaryDevice && (
                        <span className="inline-flex items-center gap-1">
                            <DeviceIcon className="size-3.5" />
                            {primaryDevice.deviceType ?? "-"} · {primaryDevice.browser ?? "-"} · {primaryDevice.os ?? "-"}
                            {summary.deviceCount > 1 && ` 외 ${summary.deviceCount - 1}대`}
                        </span>
                    )}
                    {visitor.firstUtmSource && (
                        <span>
                            유입 {visitor.firstUtmSource}
                            {visitor.firstUtmCampaign && ` / ${visitor.firstUtmCampaign}`}
                        </span>
                    )}
                    {summary.firstSeenAt && <span>첫 방문 {formatDateTime(summary.firstSeenAt)}</span>}
                    {visitor.recordId && (
                        <Link href={`/records?id=${visitor.recordId}`} className="hover:text-foreground hover:underline">
                            record #{visitor.recordId}
                        </Link>
                    )}
                </div>
            </CardContent>
        </Card>
    );
}

function Stat({ label, value }: { label: string; value: string }) {
    return (
        <div className="text-right sm:text-left">
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className="mt-0.5 text-lg font-semibold tabular-nums leading-tight">{value}</p>
        </div>
    );
}
