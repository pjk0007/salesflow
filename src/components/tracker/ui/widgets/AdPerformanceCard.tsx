"use client";

import { useState, useMemo } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { useAdPerformance } from "../../hooks/useAdPerformance";
import { useTrackerFunnels } from "../../hooks/useTrackerFunnels";
import { PlatformIcon } from "./PlatformIcon";
import type { AdPerformanceRow } from "../../types/ad-performance";

interface Props {
    siteId: number;
    range: { from: string; to: string };
}

type Platform = AdPerformanceRow["platform"];
type SortKey = "visitors" | "conversions" | "conversionRate";

const PLATFORM_FILTERS: Array<{ value: Platform | "all"; label: string }> = [
    { value: "all", label: "전체" },
    { value: "google", label: "구글" },
    { value: "meta", label: "메타" },
    { value: "naver", label: "네이버" },
];

function formatPct(rate: number): string {
    return `${Math.round(rate * 1000) / 10}%`;
}

/**
 * 광고 그룹별 전환 성과 — 광고 단위(플랫폼별 최대 해상도)로 방문자·전환·전환율.
 * 전환 = 선택한 퍼널의 마지막 단계 도달. 플랫폼 필터 + 컬럼 정렬 지원.
 */
export function AdPerformanceCard({ siteId, range }: Props) {
    const { funnels } = useTrackerFunnels(siteId);
    const [funnelId, setFunnelId] = useState<number | null>(null);
    const [platform, setPlatform] = useState<Platform | "all">("all");
    const [sortKey, setSortKey] = useState<SortKey>("visitors");
    const [sortDesc, setSortDesc] = useState(true);

    const { data, isLoading } = useAdPerformance({ siteId, from: range.from, to: range.to, funnelId });

    const rows = useMemo(() => {
        const filtered = (data?.rows ?? []).filter((r) => platform === "all" || r.platform === platform);
        const dir = sortDesc ? -1 : 1;
        return [...filtered].sort((a, b) => {
            const d = (a[sortKey] - b[sortKey]) * dir;
            return d !== 0 ? d : b.visitors - a.visitors; // tie-break: 방문자 많은 순
        });
    }, [data, platform, sortKey, sortDesc]);

    const toggleSort = (key: SortKey) => {
        if (key === sortKey) setSortDesc((d) => !d);
        else { setSortKey(key); setSortDesc(true); }
    };

    return (
        <div className="rounded-lg border bg-card p-5">
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-3">
                <div>
                    <p className="text-sm font-semibold">광고별 전환 성과</p>
                    <p className="text-[11px] text-muted-foreground">
                        광고 단위로 묶어 전환율을 비교합니다 · 전환 기준:{" "}
                        {data?.funnel.conversionLabel ?? "퍼널 미설정"}
                    </p>
                </div>
                {funnels.length > 0 && (
                    <Select
                        value={funnelId != null ? String(funnelId) : "__default__"}
                        onValueChange={(v) => setFunnelId(v === "__default__" ? null : Number(v))}
                    >
                        <SelectTrigger className="h-8 w-52 text-xs">
                            <SelectValue placeholder="전환 기준 퍼널" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="__default__">기본 퍼널</SelectItem>
                            {funnels.map((f) => (
                                <SelectItem key={f.id} value={String(f.id)}>{f.name}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                )}
            </div>

            {/* 플랫폼 필터 칩 */}
            <div className="mb-3 flex flex-wrap gap-1.5">
                {PLATFORM_FILTERS.map((f) => {
                    const active = platform === f.value;
                    return (
                        <button
                            key={f.value}
                            type="button"
                            onClick={() => setPlatform(f.value)}
                            className={`flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] transition-colors ${
                                active
                                    ? "border-foreground/20 bg-foreground/5 font-medium text-foreground"
                                    : "border-transparent bg-muted/50 text-muted-foreground hover:bg-muted"
                            }`}
                        >
                            {f.value !== "all" && <PlatformIcon platform={f.value} className="h-3.5 w-3.5" />}
                            {f.label}
                        </button>
                    );
                })}
            </div>

            {isLoading && !data && <p className="text-xs text-muted-foreground">불러오는 중…</p>}

            {data && rows.length === 0 && (
                <div className="rounded-md border border-dashed bg-muted/30 p-4 text-[12px] text-muted-foreground">
                    {platform === "all"
                        ? "이 기간에 광고 유입(구글·메타·네이버)이 없습니다."
                        : `이 기간에 ${PLATFORM_FILTERS.find((f) => f.value === platform)?.label} 광고 유입이 없습니다.`}
                </div>
            )}

            {data && rows.length > 0 && (
                <div className="rounded-md border text-xs">
                    <table className="w-full">
                        <thead className="bg-muted/50">
                            <tr>
                                <th className="px-2 py-1.5 text-left font-medium">광고</th>
                                <SortHeader label="방문자" col="visitors" sortKey={sortKey} sortDesc={sortDesc} onSort={toggleSort} />
                                <SortHeader label="전환" col="conversions" sortKey={sortKey} sortDesc={sortDesc} onSort={toggleSort} />
                                <SortHeader label="전환율" col="conversionRate" sortKey={sortKey} sortDesc={sortDesc} onSort={toggleSort} />
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map((r) => (
                                <tr key={r.key} className="border-t">
                                    <td className="px-2 py-1.5">
                                        <div className="flex min-w-0 items-center gap-1.5">
                                            <PlatformIcon platform={r.platform} className="h-4 w-4 shrink-0" />
                                            <span className="truncate" title={r.label}>{r.label}</span>
                                        </div>
                                    </td>
                                    <td className="px-2 py-1.5 text-right tabular-nums">{r.visitors.toLocaleString()}</td>
                                    <td className="px-2 py-1.5 text-right tabular-nums">{r.conversions.toLocaleString()}</td>
                                    <td className="px-2 py-1.5 text-right font-medium tabular-nums">{formatPct(r.conversionRate)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}

function SortHeader({
    label, col, sortKey, sortDesc, onSort,
}: {
    label: string; col: SortKey; sortKey: SortKey; sortDesc: boolean; onSort: (k: SortKey) => void;
}) {
    const active = sortKey === col;
    return (
        <th className="px-2 py-1.5 text-right font-medium">
            <button
                type="button"
                onClick={() => onSort(col)}
                className={`ml-auto inline-flex items-center gap-0.5 hover:text-foreground ${active ? "text-foreground" : ""}`}
            >
                {label}
                {active && (sortDesc ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />)}
            </button>
        </th>
    );
}
