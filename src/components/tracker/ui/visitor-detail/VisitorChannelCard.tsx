"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { TrackerSession } from "../../types";
import { parseInflowDetail } from "../../utils/inflowDetail";

/**
 * 유입 채널 분포 — 이 사람이 어떤 경로로 반복 방문하는지.
 * 세션별 referrer/UTM을 채널로 분류해 집계.
 */
export function VisitorChannelCard({ sessions }: { sessions: TrackerSession[] }) {
    if (sessions.length === 0) return null;

    const counts = new Map<string, { count: number; isPaid: boolean }>();
    for (const s of sessions) {
        const { channel, isPaid } = parseInflowDetail(s.referrer, s.landingPage);
        const cur = counts.get(channel) ?? { count: 0, isPaid };
        cur.count++;
        counts.set(channel, cur);
    }
    const rows = [...counts.entries()]
        .map(([channel, v]) => ({ channel, ...v }))
        .sort((a, b) => b.count - a.count);
    const max = rows[0]?.count ?? 1;

    return (
        <Card>
            <CardHeader>
                <CardTitle className="text-base">유입 경로</CardTitle>
                <p className="text-[11px] text-muted-foreground">세션 기준 · 최근 {sessions.length}회 방문</p>
            </CardHeader>
            <CardContent>
                <ul className="space-y-2.5 text-sm">
                    {rows.map((r) => (
                        <li key={r.channel}>
                            <div className="flex items-baseline justify-between gap-2">
                                <span className="inline-flex min-w-0 items-center gap-1.5">
                                    <span className="line-clamp-1">{r.channel}</span>
                                    {r.isPaid && (
                                        <Badge variant="secondary" className="h-4 shrink-0 px-1 text-[10px]">광고</Badge>
                                    )}
                                </span>
                                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                                    {r.count}회
                                </span>
                            </div>
                            <div className="mt-1 h-1.5 rounded bg-muted">
                                <div
                                    className="h-full rounded bg-emerald-500"
                                    style={{ width: `${Math.max(8, (r.count / max) * 100)}%` }}
                                />
                            </div>
                        </li>
                    ))}
                </ul>
            </CardContent>
        </Card>
    );
}
