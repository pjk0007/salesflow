import { useState } from "react";
import { previousRange } from "@/lib/tracker/date-range";

export type Period = { from: string; to: string };
export const MAX_PERIODS = 3;

/** 바로 앞 같은 길이 기간 */
const before = (p: Period): Period => {
    const r = previousRange(p.from, p.to);
    return { from: r.fromYmd, to: r.toYmd };
};

/** 기간 이름 — "26.10.14 ~ 26.11.12" */
export const periodName = (p: Period) => `${p.from.slice(2).replaceAll("-", ".")} ~ ${p.to.slice(2).replaceAll("-", ".")}`;

/**
 * 기간 비교 A·B·C (2~3개) — 리드젠통계·리드통계 공통.
 * 켜면 A = 지금 보던 기간, B = 그 바로 앞 기간. 기간을 더하면 맨 끝 기간의 바로 앞 기간이 들어간다.
 */
export function usePeriodCompare() {
    const [periods, setPeriods] = useState<Period[] | null>(null);
    return {
        periods,
        start: (current: Period) => setPeriods([current, before(current)]),
        stop: () => setPeriods(null),
        set: (i: number, p: Period) => setPeriods((ps) => (ps ? ps.map((x, j) => (j === i ? p : x)) : ps)),
        add: () => setPeriods((ps) => (ps && ps.length < MAX_PERIODS ? [...ps, before(ps[ps.length - 1])] : ps)),
        remove: (i: number) => setPeriods((ps) => (ps && ps.length > 2 ? ps.filter((_, j) => j !== i) : ps)),
    };
}
export type PeriodCompare = ReturnType<typeof usePeriodCompare>;
