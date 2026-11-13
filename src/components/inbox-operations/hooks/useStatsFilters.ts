import { useState } from "react";
import { format } from "date-fns";
import { periodRange } from "@/components/email/dashboard/utils/period";
import { usePeriodCompare, type Period } from "@/components/leads/hooks/usePeriodCompare";
import { previousRange } from "@/lib/tracker/date-range";
import { LEADGEN_RANGES } from "@/components/leadgen/hooks/useLeadgenFilters";

/** 빠른 기간 — 리드젠통계와 같은 묶음 (응대 성과는 1년까지 조회) */
export const STATS_RANGES = LEADGEN_RANGES;
const DEFAULT_RANGE = "30";

export type Medium = "all" | "web" | "email";
export const MEDIUMS: Array<{ value: Exclude<Medium, "all">; label: string }> = [
    { value: "web", label: "웹 상담" },
    { value: "email", label: "이메일" },
];
export const mediumName = (m: Medium) => (m === "all" ? "전체 응대" : MEDIUMS.find((x) => x.value === m)!.label);

/** 한 번에 불러오는 성과 묶음 — 기간 + 매체 */
export type StatsQuery = Period & { medium: Medium };
export type StatsGroup = { index: number; name: string; query: StatsQuery };

/**
 * 상담통계 응대 성과 필터 — 빠른 기간 또는 직접 고른 날짜 + 매체(전체·웹·이메일).
 * 기간 비교(A·B·C)와 매체 비교(웹 vs 이메일)는 하나만 켠다.
 */
export function useStatsFilters() {
    const [range, setRange] = useState(DEFAULT_RANGE);
    const [custom, setCustom] = useState<{ from?: Date; to?: Date }>({});
    const [medium, setMedium] = useState<Medium>("all");
    const [mediumCompare, setMediumCompare] = useState(false);
    const pc = usePeriodCompare();

    const isCustom = range === "custom" && !!custom.from && !!custom.to;
    const period: Period = isCustom
        ? { from: format(custom.from!, "yyyy-MM-dd"), to: format(custom.to!, "yyyy-MM-dd") }
        : periodRange(Number(range === "custom" ? DEFAULT_RANGE : range), new Date());
    const query: StatsQuery = { ...period, medium };
    const prev = previousRange(period.from, period.to);
    const previous: StatsQuery = { from: prev.fromYmd, to: prev.toYmd, medium };

    const groups: StatsGroup[] | null = pc.periods
        ? pc.periods.map((p, i) => ({ index: i, name: `${p.from} ~ ${p.to}`, query: { ...p, medium } }))
        : mediumCompare
          ? MEDIUMS.map((m, i) => ({ index: i, name: m.label, query: { ...period, medium: m.value } }))
          : null;

    return {
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
        periodText: `${period.from} ~ ${period.to}`,
        query,
        previous,
        medium,
        setMedium,
        mediumCompare,
        toggleMediumCompare: () => {
            pc.stop();
            setMediumCompare((v) => !v);
        },
        periods: pc,
        startPeriods: () => {
            setMediumCompare(false);
            pc.start(period);
        },
        /** 비교 중이면 묶음 A·B·C, 아니면 null */
        groups,
    };
}
export type StatsFilters = ReturnType<typeof useStatsFilters>;
