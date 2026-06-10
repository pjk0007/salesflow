"use client";

import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, LabelList } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { VisitorEngagement } from "../../types/visitor-detail";
import { formatDwellMs, urlPath } from "../../utils/format";

/** 오래 머문 섹션 — 누적 체류시간 가로 바차트. data-track-section 단 사이트만 데이터 있음. */
export function SectionDwellCard({
    sections,
    className,
}: {
    sections: VisitorEngagement["sections"];
    className?: string;
}) {
    if (sections.length === 0) return null;
    const data = sections.map((s) => ({
        name: s.label ?? s.name,
        dwellSec: Math.round(s.dwellMs / 1000),
        dwellText: formatDwellMs(s.dwellMs),
        views: s.views,
    }));
    const height = Math.max(144, data.length * 36 + 16);

    return (
        <Card className={className}>
            <CardHeader>
                <CardTitle className="text-base">오래 머문 섹션</CardTitle>
                <p className="text-[11px] text-muted-foreground">누적 체류시간 기준</p>
            </CardHeader>
            <CardContent>
                <div style={{ height }} className="w-full">
                    <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={data} layout="vertical" margin={{ top: 0, right: 48, left: 8, bottom: 0 }}>
                            <XAxis type="number" hide />
                            <YAxis
                                type="category"
                                dataKey="name"
                                width={110}
                                tick={{ fontSize: 11 }}
                                tickLine={false}
                                axisLine={false}
                            />
                            <Tooltip
                                cursor={{ fill: "rgba(0,0,0,0.04)" }}
                                formatter={(_v, _n, item) => [
                                    `${item.payload.dwellText} · ${item.payload.views}회 시인`,
                                    "체류",
                                ]}
                            />
                            <Bar dataKey="dwellSec" fill="#6366f1" radius={[0, 3, 3, 0]} barSize={18}>
                                <LabelList
                                    dataKey="dwellText"
                                    position="right"
                                    style={{ fontSize: 10, fill: "var(--muted-foreground, #737373)" }}
                                />
                            </Bar>
                        </BarChart>
                    </ResponsiveContainer>
                </div>
            </CardContent>
        </Card>
    );
}

/** 많이 클릭한 것 — 클릭 횟수 순위. data-track-click 단 사이트만 데이터 있음. */
export function ClickTopCard({
    clicks,
    className,
}: {
    clicks: VisitorEngagement["clicks"];
    className?: string;
}) {
    if (clicks.length === 0) return null;
    const max = clicks[0]?.count ?? 1;
    return (
        <Card className={className}>
            <CardHeader>
                <CardTitle className="text-base">많이 클릭한 것</CardTitle>
                <p className="text-[11px] text-muted-foreground">클릭 횟수 기준</p>
            </CardHeader>
            <CardContent>
                <ul className="space-y-2.5 text-sm">
                    {clicks.map((c) => (
                        <li key={c.name}>
                            <div className="flex items-baseline justify-between gap-2">
                                <span className="line-clamp-1 min-w-0" title={c.name}>
                                    {c.label ?? c.text ?? c.name}
                                </span>
                                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                                    {c.count}회
                                </span>
                            </div>
                            <div className="mt-1 h-1.5 rounded bg-muted">
                                <div
                                    className="h-full rounded bg-amber-500"
                                    style={{ width: `${Math.max(8, (c.count / max) * 100)}%` }}
                                />
                            </div>
                        </li>
                    ))}
                </ul>
            </CardContent>
        </Card>
    );
}

/** 자주 본 페이지 — 페이지뷰 순위. */
export function TopPagesCard({
    pages,
    className,
}: {
    pages: VisitorEngagement["pages"];
    className?: string;
}) {
    if (pages.length === 0) return null;
    const max = pages[0]?.views ?? 1;
    return (
        <Card className={className}>
            <CardHeader>
                <CardTitle className="text-base">자주 본 페이지</CardTitle>
                <p className="text-[11px] text-muted-foreground">페이지뷰 기준</p>
            </CardHeader>
            <CardContent>
                <ul className="space-y-2.5 text-sm">
                    {pages.map((p) => (
                        <li key={p.url}>
                            <div className="flex items-baseline justify-between gap-2">
                                <span className="line-clamp-1 min-w-0" title={p.url}>
                                    {p.title?.trim() || urlPath(p.url)}
                                </span>
                                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                                    {p.views}회
                                </span>
                            </div>
                            <div className="mt-1 h-1.5 rounded bg-muted">
                                <div
                                    className="h-full rounded bg-sky-500"
                                    style={{ width: `${Math.max(8, (p.views / max) * 100)}%` }}
                                />
                            </div>
                        </li>
                    ))}
                </ul>
            </CardContent>
        </Card>
    );
}
