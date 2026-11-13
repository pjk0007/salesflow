"use client";

import { CalendarRange, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import { cn } from "@/lib/utils";
import { LeadWorkspaceTabs } from "@/components/leads/ui/LeadWorkspaceTabs";
import { RangePills } from "@/components/leads/ui/stats/RangePills";
import { KpiGrid } from "@/components/email/dashboard/ui/KpiGrid";
import { TrendPanel } from "@/components/email/dashboard/ui/TrendPanel";
import { CompareTable } from "@/components/email/dashboard/ui/CompareTable";
import { StatsFreshness } from "@/components/email/dashboard/ui/StatsFreshness";
import { LEADGEN_RANGES, useLeadgenFilters } from "../hooks/useLeadgenFilters";
import { useCampaignOptions } from "../hooks/useCampaignOptions";
import { useLeadgenWorkspaces } from "../hooks/useLeadgenWorkspaces";
import { CampaignPicker } from "./CampaignPicker";
import { CompareKpiGrid } from "./CompareKpiGrid";
import { CompareTrend } from "./CompareTrend";
import { groupName } from "../utils/groups";
import { PeriodCompareBar } from "@/components/leads/ui/stats/PeriodCompareBar";
import { periodName } from "@/components/leads/hooks/usePeriodCompare";

/** 리드젠통계 — 사업부별 콜드메일 발송·도달·오픈·클릭·방문·회신 (리드통계와 같은 틀) */
export function LeadgenStatsPage() {
    const f = useLeadgenFilters();
    const campaigns = useCampaignOptions(f.base);
    const tabs = useLeadgenWorkspaces();
    return (
        <div className="flex min-h-0 flex-1 flex-col">
            <LeadWorkspaceTabs
                value={f.workspaceId}
                onChange={f.setWorkspaceId}
                items={tabs.items}
                loading={tabs.isLoading}
                allTab={{ onSelect: () => f.setWorkspaceId(null) }}
                prefKey="leadgen-stats"
            />
            <div className="min-h-0 flex-1 overflow-y-auto">
                <div className="space-y-3 px-8 py-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                            <h1 className="text-2xl font-semibold tracking-tight">리드젠통계</h1>
                            <StatsFreshness query={f.query} />
                        </div>
                        {f.periods.periods ? (
                            <PeriodCompareBar pc={f.periods} />
                        ) : (
                            <div className="flex flex-wrap items-center gap-2">
                                <RangePills ranges={LEADGEN_RANGES} value={f.range} onChange={f.selectRange} />
                                <DateRangePicker
                                    from={f.custom.from}
                                    to={f.custom.to}
                                    maxDate={new Date()}
                                    placeholder="날짜 직접 선택"
                                    align="end"
                                    triggerClassName={cn("bg-background", f.isCustom && "border-primary/40 text-primary")}
                                    onChange={f.selectCustom}
                                />
                                {f.isCustom && (
                                    <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={f.reset}>
                                        <RotateCcw className="mr-1 h-3.5 w-3.5" />
                                        초기화
                                    </Button>
                                )}
                                <Button variant="outline" size="sm" onClick={f.startPeriods}>
                                    <CalendarRange className="mr-1 h-4 w-4" />
                                    기간 비교
                                </Button>
                            </div>
                        )}
                    </div>
                    <div className="flex flex-wrap items-end justify-between gap-3">
                        <CampaignPicker f={f} options={campaigns.options} />
                        {!f.periodGroups && <p className="text-xs text-muted-foreground">{f.periodText}</p>}
                    </div>
                    {f.periodGroups ? (
                        <>
                            <CompareKpiGrid groups={f.periodGroups} />
                            <CompareTrend groups={f.periodGroups} names={f.periods.periods!.map(periodName)} byDay />
                        </>
                    ) : f.compare ? (
                        f.groups ? (
                            <>
                                <CompareKpiGrid groups={f.groups} />
                                <CompareTrend groups={f.groups} names={f.groups.map((g) => groupName(g.keys, campaigns.nameOf))} />
                            </>
                        ) : (
                            <p className="rounded-lg border border-border/40 bg-card p-8 text-center text-sm text-muted-foreground">
                                비교할 메일 묶음을 두 개 이상 골라 주세요.
                            </p>
                        )
                    ) : (
                        <>
                            <KpiGrid query={f.query} />
                            <TrendPanel query={f.query} />
                        </>
                    )}
                    {/* 기간 비교 중에는 A 기간 기준 */}
                    <CompareTable query={f.periodGroups ? f.periodGroups[0].query : f.compare ? f.base : f.query} />
                </div>
            </div>
        </div>
    );
}
