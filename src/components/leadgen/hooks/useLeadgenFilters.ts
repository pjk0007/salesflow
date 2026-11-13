import { useState } from "react";
import { format } from "date-fns";
import { periodRange } from "@/components/email/dashboard/utils/period";
import type { StatsQuery } from "@/components/email/dashboard/types";
import { usePeriodCompare } from "@/components/leads/hooks/usePeriodCompare";

/** 빠른 기간 (발송 통계는 366일까지) */
export const LEADGEN_RANGES = [
    { value: "7", label: "7일" },
    { value: "30", label: "30일" },
    { value: "90", label: "90일" },
    { value: "180", label: "6개월" },
    { value: "365", label: "1년" },
];
const DEFAULT_RANGE = "30";
export const MAX_GROUPS = 3;

/**
 * 리드젠통계 — 사업부 탭(null = 전체) + 빠른 기간 또는 직접 고른 날짜 + 메일.
 * 메일: 전체(빈 목록) 또는 고른 메일들(합쳐서). 비교를 켜면 메일 묶음 2~3개(A·B·C — 묶음마다 메일 여러 개)를 나란히 본다.
 * 기간 비교를 켜면 고른 메일을 기간 2~3개(A·B·C)로 나란히 본다. 메일 비교와 기간 비교는 하나만 켠다.
 */
export function useLeadgenFilters() {
    const [workspaceId, setWorkspace] = useState<number | null>(null);
    const [range, setRange] = useState(DEFAULT_RANGE);
    const [custom, setCustom] = useState<{ from?: Date; to?: Date }>({});
    // 고른 메일들 (비어 있으면 전체 메일) — 여러 개면 합쳐서 본다
    const [campaign, setCampaign] = useState<string[]>([]);
    const [compare, setCompare] = useState<string[][] | null>(null);
    const pc = usePeriodCompare();

    const isCustom = range === "custom" && !!custom.from && !!custom.to;
    const period = isCustom
        ? {
              from: format(custom.from!, "yyyy-MM-dd"),
              to: format(custom.to!, "yyyy-MM-dd"),
          }
        : periodRange(Number(range === "custom" ? DEFAULT_RANGE : range), new Date());
    const base: StatsQuery = { ...period, workspaceId, campaign: null };
    const query: StatsQuery = {
        ...base,
        campaign: campaign.length ? campaign.join(",") : null,
    };
    // 비교: 메일을 고른 묶음이 두 개 이상일 때만 (빈 묶음은 건너뛴다)
    const filled = (compare ?? []).map((keys, i) => ({ index: i, keys })).filter((g) => g.keys.length > 0);
    const groups =
        filled.length >= 2
            ? filled.map((g) => ({
                  index: g.index,
                  keys: g.keys,
                  query: { ...base, campaign: g.keys.join(",") },
              }))
            : null;
    const periodGroups = pc.periods
        ? pc.periods.map((p, i) => ({
              index: i,
              keys: campaign,
              query: { ...query, ...p },
          }))
        : null;

    return {
        base,
        query,
        workspaceId,
        // 사업부를 바꾸면 메일 고르기는 처음부터
        setWorkspaceId: (id: number | null) => {
            setWorkspace(id);
            setCampaign([]);
            setCompare((c) => (c ? [[], []] : null));
        },
        range,
        isCustom,
        custom,
        selectRange: (v: string) => {
            setRange(v);
            setCustom({});
        },
        selectCustom: (v: { from?: Date; to?: Date }) => {
            setCustom(v);
            setRange("custom");
        },
        reset: () => {
            setCustom({});
            setRange(DEFAULT_RANGE);
        },
        // 지금 보고 있는 기간 (직전 기간 대비 숫자는 카드마다 따로 나온다)
        periodText: `${period.from} ~ ${period.to}`,
        campaign,
        setCampaign,
        compare,
        groups,
        toggleCompare: () => {
            pc.stop();
            setCompare((c) => (c ? null : [campaign, []]));
        },
        // 기간 비교 — A는 지금 보던 기간
        periods: pc,
        periodGroups,
        startPeriods: () => {
            setCompare(null);
            pc.start(period);
        },
        setGroup: (i: number, keys: string[]) => setCompare((c) => (c ? c.map((g, j) => (j === i ? keys : g)) : c)),
        addGroup: () => setCompare((c) => (c && c.length < MAX_GROUPS ? [...c, []] : c)),
        removeGroup: (i: number) => setCompare((c) => (c && c.length > 2 ? c.filter((_, j) => j !== i) : c)),
    };
}
export type LeadgenFilters = ReturnType<typeof useLeadgenFilters>;
