"use client";

import { useState } from "react";
import { format } from "date-fns";
import { Info, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { LEAD_STATUS_COLORS } from "@/lib/leads/statuses";
import { useLeadStats } from "../../hooks/useLeadStats";
import { LeadWorkspaceTabs } from "../LeadWorkspaceTabs";
import { StatusBadge } from "../StatusBadge";
import { BigNumber, StatCard } from "./Card";
import { KindList } from "./KindList";
import { MonthlyChart } from "./MonthlyChart";
import { Ring } from "./Ring";
import { StripeBar } from "./StripeBar";

const RANGES = [
    { value: "30", label: "30일" },
    { value: "90", label: "90일" },
    { value: "180", label: "6개월" },
    { value: "365", label: "1년" },
    { value: "all", label: "전체" },
];

const pct = (v: number | null) => (v === null ? "-" : `${(v * 100).toFixed(1)}%`);
const dayText = (v: number | null) => (v === null ? "-" : v < 1 ? "1일 미만" : v.toFixed(1));
const hourText = (v: number | null): [string, string] =>
    v === null ? ["-", ""] : v < 1 ? [String(Math.round(v * 60)), "분"] : v < 48 ? [v.toFixed(1), "시간"] : [(v / 24).toFixed(1), "일"];

/** 기간 고르기 — 묶음 버튼 */
function RangePills({ value, onChange }: { value: string; onChange: (v: string) => void }) {
    return (
        <div className="flex h-9 items-center gap-0.5 rounded-md bg-muted p-1">
            {RANGES.map((r) => (
                <button
                    key={r.value}
                    type="button"
                    onClick={() => onChange(r.value)}
                    className={cn(
                        "flex h-7 items-center rounded px-3 text-xs transition-colors",
                        value === r.value ? "bg-background font-semibold text-foreground" : "text-muted-foreground hover:text-foreground",
                    )}
                >
                    {r.label}
                </button>
            ))}
        </div>
    );
}

/** 리드 통계 — 사업(워크스페이스)별 유입·전환·응답 KPI */
export function LeadStatsPage() {
    const [workspaceId, setWorkspaceId] = useState<number | null>(null);
    // 빠른 기간(30일 등) 또는 직접 고른 날짜 — 날짜를 고르면 빠른 기간 선택은 풀린다
    const [range, setRange] = useState("90");
    const [custom, setCustom] = useState<{ from?: Date; to?: Date }>({});
    const isCustom = range === "custom" && custom.from && custom.to;
    const { stats, isLoading } = useLeadStats(
        workspaceId,
        isCustom
            ? { from: format(custom.from!, "yyyy-MM-dd"), to: format(custom.to!, "yyyy-MM-dd") }
            : { days: range === "all" || range === "custom" ? null : Number(range) },
    );
    const t = stats?.totals;
    const c = stats?.conversion;
    const r = stats?.response;
    const [respValue, respUnit] = hourText(r?.medianFirstResponseHours ?? null);

    return (
        <div className="flex min-h-0 flex-1 flex-col">
            <LeadWorkspaceTabs value={workspaceId} onChange={setWorkspaceId} />
            <div className="min-h-0 flex-1 overflow-y-auto">
                <div className="space-y-3 px-8 py-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <h1 className="text-2xl font-semibold tracking-tight">리드통계</h1>
                        <div className="flex flex-wrap items-center gap-2">
                            <RangePills
                                value={range}
                                onChange={(v) => {
                                    setRange(v);
                                    setCustom({});
                                }}
                            />
                            <DateRangePicker
                                from={custom.from}
                                to={custom.to}
                                maxDate={new Date()}
                                placeholder="날짜 직접 선택"
                                align="end"
                                triggerClassName={cn("bg-background", isCustom && "border-primary/40 text-primary")}
                                onChange={({ from, to }) => {
                                    setCustom({ from, to });
                                    setRange("custom");
                                }}
                            />
                            {isCustom && (
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    className="text-muted-foreground"
                                    onClick={() => {
                                        setCustom({});
                                        setRange("90");
                                    }}
                                >
                                    <RotateCcw className="mr-1 h-3.5 w-3.5" />
                                    초기화
                                </Button>
                            )}
                        </div>
                    </div>

                    {isLoading || !stats ? (
                        <div className="grid gap-3 lg:grid-cols-3">
                            {Array.from({ length: 6 }).map((_, i) => (
                                <Skeleton key={i} className="h-44 rounded-lg" />
                            ))}
                        </div>
                    ) : (
                        <>
                            <div className="grid gap-3 lg:grid-cols-3">
                                <StatCard title="리드 스냅샷" className="lg:col-span-2">
                                    <BigNumber value={t!.leads.toLocaleString()} unit="건 유입" />
                                    <div className="mt-5">
                                        <StripeBar
                                            segments={[
                                                { label: "진행 중", value: t!.open, color: "var(--primary)" },
                                                { label: "전환", value: t!.converted, color: "var(--chart-3)" },
                                                { label: "종료", value: t!.closed, color: "var(--muted-foreground)" },
                                            ]}
                                        />
                                    </div>
                                </StatCard>
                                <StatCard title="전환율">
                                    <Ring ratio={t!.conversionRate} label="전환" sub={`전환 ${t!.converted}건 / 유입 ${t!.leads}건`} />
                                </StatCard>
                            </div>

                            <div className="grid gap-3 lg:grid-cols-3">
                                <StatCard title="월별 유입" className="lg:col-span-2">
                                    <MonthlyChart data={stats.monthly} />
                                </StatCard>
                                <div className="grid gap-3">
                                    <StatCard title="전환까지 걸린 기간">
                                        <BigNumber
                                            value={dayText(c!.medianDays)}
                                            unit={c!.medianDays !== null && c!.medianDays >= 1 ? "일 (중앙값)" : undefined}
                                            sub={c!.averageDays !== null ? `평균 ${dayText(c!.averageDays)}일` : "전환된 리드가 없습니다"}
                                        />
                                    </StatCard>
                                    <StatCard title="첫 응답까지">
                                        <BigNumber
                                            value={respValue}
                                            unit={respUnit ? `${respUnit} (중앙값)` : undefined}
                                            sub={
                                                r!.responded && t!.leads
                                                    ? `24시간 안 응답 ${Math.round((r!.respondedWithin24h / t!.leads) * 100)}%`
                                                    : "댓글이 남은 리드가 없습니다"
                                            }
                                        />
                                    </StatCard>
                                </div>
                            </div>

                            <div className="grid gap-3 lg:grid-cols-3">
                                <StatCard title="전환까지 거친 연락 · 리드당 평균">
                                    <KindList
                                        format={(v) => `${v.toFixed(1)}회`}
                                        items={stats.touchesBeforeConversion.map((k) => ({ kind: k.kind, value: k.average }))}
                                    />
                                </StatCard>
                                <StatCard title="댓글 종류">
                                    <KindList format={(v) => `${v}건`} items={stats.memoKinds.map((k) => ({ kind: k.kind, value: k.count }))} />
                                </StatCard>
                                <StatCard title="대응상태">
                                    <ul className="space-y-2.5">
                                        {stats.statusCounts.map((s) => (
                                            <li key={s.status} className="flex items-center justify-between text-sm">
                                                <StatusBadge status={s.status} colors={LEAD_STATUS_COLORS} />
                                                <span className="tabular-nums">
                                                    <span className="font-semibold">{s.count}</span>
                                                    <span className="ml-1.5 text-xs text-muted-foreground">
                                                        {t!.leads ? Math.round((s.count / t!.leads) * 100) : 0}%
                                                    </span>
                                                </span>
                                            </li>
                                        ))}
                                    </ul>
                                </StatCard>
                            </div>

                            <StatCard title="파티션별 전환">
                                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                                    {stats.partitions.map((p) => (
                                        <div key={p.id} className="rounded-md bg-muted/50 p-4">
                                            <div className="truncate text-xs text-muted-foreground" title={p.name}>
                                                {p.name}
                                            </div>
                                            <div className="mt-2 text-2xl font-semibold tabular-nums">
                                                {p.leads ? pct(p.converted / p.leads) : "-"}
                                            </div>
                                            <div className="mt-0.5 text-xs text-muted-foreground">
                                                유입 {p.leads} · 전환 {p.converted}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </StatCard>

                            <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
                                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                                전환일은 대응상태를 &apos;전환&apos;으로 바꾼 기록에서 찾고({c!.fromHistory}건), 기록이 없으면 마지막 댓글 날짜로
                                봅니다({c!.inferred}건). 댓글 종류는 댓글에 달린 태그 기준입니다.
                            </p>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}
