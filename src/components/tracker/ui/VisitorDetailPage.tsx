"use client";

import useSWR from "swr";
import { defaultFetcher } from "@/lib/swr-fetcher";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";
import type { TrackerVisitor, TrackerSession, TrackerEvent } from "../types";

type Response =
    | {
          success: true;
          data: { visitor: TrackerVisitor; sessions: TrackerSession[]; events: TrackerEvent[] };
      }
    | { success: false; error: string };

export function VisitorDetailPage({ visitorPk }: { visitorPk: number }) {
    const { data, isLoading } = useSWR<Response>(
        `/api/tracker/visitors/${visitorPk}`,
        defaultFetcher,
    );

    if (isLoading) {
        return <Skeleton className="h-96 w-full" />;
    }

    if (!data?.success) {
        return <p className="text-sm text-muted-foreground">방문자를 찾을 수 없습니다.</p>;
    }

    const { visitor, sessions, events } = data.data;
    const totalDuration = sessions.reduce((sum, s) => sum + (s.duration ?? 0), 0);

    return (
        <div className="space-y-6">
            <Card>
                <CardHeader>
                    <CardTitle className="text-base">방문자 정보</CardTitle>
                </CardHeader>
                <CardContent>
                    <dl className="grid grid-cols-2 gap-4 text-sm">
                        <Item label="이메일" value={visitor.email ?? "-"} />
                        <Item label="이름" value={visitor.name ?? "-"} />
                        <Item label="총 방문" value={String(visitor.totalVisits)} />
                        <Item label="페이지뷰" value={String(visitor.totalPageviews)} />
                        <Item label="총 체류시간" value={formatDuration(totalDuration)} />
                        <Item
                            label="디바이스"
                            value={`${visitor.deviceType ?? "-"} / ${visitor.browser ?? "-"} / ${visitor.os ?? "-"}`}
                        />
                        <Item label="첫 방문" value={formatDate(visitor.firstSeenAt)} />
                        <Item label="마지막 방문" value={formatDate(visitor.lastSeenAt)} />
                        <Item
                            label="유입"
                            value={
                                visitor.firstUtmSource
                                    ? `${visitor.firstUtmSource}${visitor.firstUtmCampaign ? ` / ${visitor.firstUtmCampaign}` : ""}`
                                    : "-"
                            }
                        />
                        <Item
                            label="리드 연결"
                            value={
                                visitor.recordId ? (
                                    <Link
                                        href={`/records?id=${visitor.recordId}`}
                                        className="text-primary hover:underline"
                                    >
                                        record #{visitor.recordId}
                                    </Link>
                                ) : (
                                    <Badge variant="outline">익명</Badge>
                                )
                            }
                        />
                    </dl>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle className="text-base">세션 ({sessions.length})</CardTitle>
                </CardHeader>
                <CardContent>
                    {sessions.length === 0 ? (
                        <p className="text-sm text-muted-foreground">세션 기록 없음</p>
                    ) : (
                        <ul className="space-y-2 text-sm">
                            {sessions.map((s) => (
                                <li
                                    key={s.id}
                                    className="rounded border p-3 grid grid-cols-2 gap-x-4 gap-y-1"
                                >
                                    <div className="min-w-0">
                                        <span className="text-muted-foreground">시작: </span>
                                        {formatDate(s.startedAt)}
                                    </div>
                                    <div className="min-w-0">
                                        <span className="text-muted-foreground">페이지: </span>
                                        {s.pageCount}개
                                    </div>
                                    <div className="min-w-0">
                                        <span className="text-muted-foreground">체류: </span>
                                        {formatDuration(s.duration)}
                                    </div>
                                    <div className="min-w-0 truncate">
                                        <span className="text-muted-foreground">유입: </span>
                                        {s.utmSource ?? "-"}
                                        {s.utmCampaign ? ` / ${s.utmCampaign}` : ""}
                                    </div>
                                    <div className="col-span-2 flex gap-1">
                                        <span className="shrink-0 text-muted-foreground">착륙: </span>
                                        <span
                                            className="line-clamp-1 break-all"
                                            title={s.landingPage ?? undefined}
                                        >
                                            {s.landingPage ?? "-"}
                                        </span>
                                    </div>
                                </li>
                            ))}
                        </ul>
                    )}
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle className="text-base">최근 이벤트 ({events.length})</CardTitle>
                </CardHeader>
                <CardContent>
                    {events.length === 0 ? (
                        <p className="text-sm text-muted-foreground">이벤트 없음</p>
                    ) : (
                        <ul className="space-y-1 text-sm">
                            {events.map((e) => (
                                <li
                                    key={e.id}
                                    className="flex items-center gap-3 border-b py-1.5 last:border-0"
                                >
                                    <span className="w-32 shrink-0 text-xs text-muted-foreground">
                                        {formatDate(e.occurredAt)}
                                    </span>
                                    <Badge variant="outline" className="shrink-0 text-xs">
                                        {e.eventType}
                                    </Badge>
                                    <span
                                        className="line-clamp-1 flex-1 break-all text-muted-foreground"
                                        title={e.eventName ?? e.pageUrl ?? undefined}
                                    >
                                        {e.eventName ?? e.pageUrl ?? "-"}
                                    </span>
                                </li>
                            ))}
                        </ul>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}

function Item({ label, value }: { label: string; value: React.ReactNode }) {
    return (
        <div>
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className="mt-0.5">{value}</dd>
        </div>
    );
}

function formatDate(s: string): string {
    const d = new Date(s);
    if (isNaN(d.getTime())) return s;
    return d.toLocaleString("ko-KR", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
    });
}

/** 초 단위 duration을 사람이 읽는 형태로 (예: 1분 42초, 2시간 5분) */
function formatDuration(seconds: number | null): string {
    if (!seconds || seconds <= 0) return "-";
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (h > 0) return `${h}시간 ${m}분`;
    if (m > 0) return `${m}분 ${s}초`;
    return `${s}초`;
}
