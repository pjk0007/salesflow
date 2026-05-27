"use client";

import Link from "next/link";
import type { OverviewData } from "../../types/overview";

function fmtTime(iso: string): string {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleString("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export function RecentSessions({ sessions }: { sessions: OverviewData["recentSessions"] }) {
    return (
        <div className="rounded-lg border bg-card p-4">
            <p className="mb-3 text-sm font-semibold">최근 활성 방문자</p>
            {sessions.length === 0 ? (
                <p className="text-sm text-muted-foreground">데이터 없음</p>
            ) : (
                <ul className="divide-y text-sm">
                    {sessions.map((s) => (
                        <li key={s.id} className="flex items-center gap-3 py-2">
                            <Link
                                href={`/tracker/visitors/${s.visitorId}`}
                                className="min-w-0 flex-1 truncate text-foreground hover:underline"
                            >
                                {s.visitorEmail ?? `익명 · ${s.visitorAnonId}`}
                            </Link>
                            <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                                {s.channel}
                            </span>
                            <span className="hidden min-w-0 max-w-[200px] truncate text-xs text-muted-foreground sm:inline" title={s.landingPath ?? ""}>
                                {s.landingPath}
                            </span>
                            <span className="shrink-0 tabular-nums text-xs text-muted-foreground">{s.pageCount}p</span>
                            <span className="shrink-0 tabular-nums text-xs text-muted-foreground">{fmtTime(s.startedAt)}</span>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}
