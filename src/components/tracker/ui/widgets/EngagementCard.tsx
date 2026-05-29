"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { useEngagementAnalytics } from "../../hooks/useEngagementAnalytics";
import type { SegmentFilters } from "../../types/overview";

interface Props {
    siteId: number;
    range: { from: string; to: string };
    filters: SegmentFilters;
}

const ALL_PAGES = "__all__";

function formatDwell(ms: number): string {
    if (!ms) return "-";
    const s = Math.round(ms / 1000);
    if (s < 60) return `${s}초`;
    const m = Math.floor(s / 60);
    const rs = s % 60;
    return rs ? `${m}분 ${rs}초` : `${m}분`;
}

function formatPct(rate: number): string {
    return `${Math.round(rate * 1000) / 10}%`;
}

/**
 * 페이지 인게이지먼트 — 섹션별 시인율·체류 + 클릭별 카운트.
 * data-track-section / data-track-click 가 한 건도 없으면 빈 상태 안내.
 */
export function EngagementCard({ siteId, range, filters }: Props) {
    const [page, setPage] = useState<string | null>(null);
    const { data, isLoading } = useEngagementAnalytics({
        siteId,
        from: range.from,
        to: range.to,
        device: filters.device,
        channel: filters.channel,
        channelMode: filters.channelMode,
        page,
    });

    const empty = useMemo(
        () => !!data && data.sections.length === 0 && data.clicks.length === 0,
        [data],
    );

    return (
        <div className="rounded-lg border bg-card p-5">
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-3">
                <div>
                    <p className="text-sm font-semibold">페이지 인게이지먼트</p>
                    <p className="text-[11px] text-muted-foreground">
                        섹션 시인율·평균 체류와 버튼 클릭을 분석합니다.
                    </p>
                </div>
                <Select
                    value={page ?? ALL_PAGES}
                    onValueChange={(v) => setPage(v === ALL_PAGES ? null : v)}
                >
                    <SelectTrigger className="h-8 w-64 text-xs">
                        <SelectValue placeholder="페이지 선택" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value={ALL_PAGES}>전체 페이지</SelectItem>
                        {(data?.pages ?? []).map((p) => (
                            <SelectItem key={p.path} value={p.path}>
                                <span className="font-mono">{p.path}</span>
                                <span className="ml-2 text-[10px] text-muted-foreground">
                                    {p.pageviews.toLocaleString()} PV
                                </span>
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </div>

            {isLoading && !data && (
                <p className="text-xs text-muted-foreground">불러오는 중…</p>
            )}

            {empty && (
                <div className="rounded-md border border-dashed bg-muted/30 p-4 text-[12px] text-muted-foreground">
                    이 기간에 수집된 섹션·클릭 이벤트가 없습니다.
                    페이지의 주요 영역과 버튼에 <code className="font-mono">data-track-section</code> /{" "}
                    <code className="font-mono">data-track-click</code> 속성을 박으면 여기에 분석 결과가 표시됩니다.{" "}
                    <Link href="?tab=settings" className="underline">설정 탭의 가이드</Link>
                </div>
            )}

            {data && !empty && (
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                    <SectionTable rows={data.sections} />
                    <ClickTable rows={data.clicks} />
                </div>
            )}
        </div>
    );
}

function SectionTable({ rows }: { rows: NonNullable<ReturnType<typeof useEngagementAnalytics>["data"]>["sections"] }) {
    return (
        <div>
            <p className="mb-2 text-xs font-semibold">섹션 ({rows.length})</p>
            {rows.length === 0 ? (
                <p className="text-[12px] text-muted-foreground">섹션 이벤트 없음.</p>
            ) : (
                <div className="rounded-md border text-xs">
                    <table className="w-full">
                        <thead className="bg-muted/50">
                            <tr>
                                <th className="px-2 py-1.5 text-left font-medium">이름</th>
                                <th className="px-2 py-1.5 text-right font-medium">시인율</th>
                                <th className="px-2 py-1.5 text-right font-medium">평균 체류</th>
                                <th className="px-2 py-1.5 text-right font-medium">방문자</th>
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map((r) => (
                                <tr key={r.name} className="border-t">
                                    <td className="px-2 py-1.5">{r.name}</td>
                                    <td className="px-2 py-1.5 text-right tabular-nums">{formatPct(r.viewRate)}</td>
                                    <td className="px-2 py-1.5 text-right tabular-nums">{formatDwell(r.avgDwellMs)}</td>
                                    <td className="px-2 py-1.5 text-right tabular-nums">{r.visitors.toLocaleString()}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}

function ClickTable({ rows }: { rows: NonNullable<ReturnType<typeof useEngagementAnalytics>["data"]>["clicks"] }) {
    return (
        <div>
            <p className="mb-2 text-xs font-semibold">클릭 ({rows.length})</p>
            {rows.length === 0 ? (
                <p className="text-[12px] text-muted-foreground">클릭 이벤트 없음.</p>
            ) : (
                <div className="rounded-md border text-xs">
                    <table className="w-full">
                        <thead className="bg-muted/50">
                            <tr>
                                <th className="px-2 py-1.5 text-left font-medium">이름</th>
                                <th className="px-2 py-1.5 text-left font-medium">섹션</th>
                                <th className="px-2 py-1.5 text-right font-medium">클릭</th>
                                <th className="px-2 py-1.5 text-right font-medium">방문자</th>
                                <th className="px-2 py-1.5 text-right font-medium">클릭율</th>
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map((r) => (
                                <tr key={r.name} className="border-t">
                                    <td className="px-2 py-1.5">{r.name}</td>
                                    <td className="px-2 py-1.5 text-muted-foreground">{r.section ?? "-"}</td>
                                    <td className="px-2 py-1.5 text-right tabular-nums">{r.clicks.toLocaleString()}</td>
                                    <td className="px-2 py-1.5 text-right tabular-nums">{r.visitors.toLocaleString()}</td>
                                    <td className="px-2 py-1.5 text-right tabular-nums">{formatPct(r.clickRate)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}
