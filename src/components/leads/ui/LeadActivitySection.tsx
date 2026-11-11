"use client";

import Link from "next/link";
import { Activity, Eye } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useRecordVisitorActivity } from "@/components/tracker/hooks/useRecordVisitorActivity";
import { formatDateTime } from "../utils/lead-fields";

/** 상세 패널의 행동 분석 — 이 리드와 연결된 방문자의 사이트 방문·페이지뷰 (트래커) */
export function LeadActivitySection({ recordId }: { recordId: number }) {
    const { activity, isLoading } = useRecordVisitorActivity(recordId);
    const summary = activity?.summary;

    return (
        <section className="space-y-3 border-t pt-4">
            <div className="flex items-center justify-between">
                <h3 className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                    <Activity className="h-3.5 w-3.5" />
                    행동 분석
                </h3>
                <Link href={`/records/${recordId}/journey`} className="text-xs text-primary hover:underline">
                    고객 여정 전체 보기 →
                </Link>
            </div>
            {isLoading ? (
                <Skeleton className="h-16 w-full" />
            ) : !summary || summary.deviceCount === 0 ? (
                <p className="text-sm text-muted-foreground">
                    연결된 방문 기록이 없습니다. 추적 코드가 설치된 사이트에서 이 리드의 방문이 확인되면 여기에 보입니다.
                </p>
            ) : (
                <>
                    <div className="grid grid-cols-4 gap-3">
                        {[
                            ["총 방문", summary.totalVisits],
                            ["페이지뷰", summary.totalPageviews],
                            ["이벤트", summary.totalEvents],
                            ["기기", summary.deviceCount],
                        ].map(([label, value]) => (
                            <div key={label as string}>
                                <div className="text-xs text-muted-foreground">{label}</div>
                                <div className="text-lg font-semibold">{Number(value).toLocaleString()}</div>
                            </div>
                        ))}
                    </div>
                    <div className="text-xs text-muted-foreground">
                        {summary.firstSeen && <>첫 방문 {formatDateTime(summary.firstSeen)}</>}
                        {summary.firstSeen && summary.lastSeen && " · "}
                        {summary.lastSeen && <>마지막 방문 {formatDateTime(summary.lastSeen)}</>}
                    </div>
                    {activity.recentEvents.length > 0 && (
                        <ul className="space-y-1">
                            {activity.recentEvents.slice(0, 6).map((e) => (
                                <li key={e.id} className="flex items-center gap-2 text-xs text-muted-foreground">
                                    <Eye className="h-3 w-3 shrink-0" />
                                    <span className="shrink-0">{formatDateTime(e.occurredAt)}</span>
                                    <span className="truncate">
                                        {e.eventType === "PAGE_VIEW" ? `페이지뷰 ${e.pageUrl ?? ""}` : e.eventName ?? e.eventType}
                                    </span>
                                </li>
                            ))}
                        </ul>
                    )}
                </>
            )}
        </section>
    );
}
