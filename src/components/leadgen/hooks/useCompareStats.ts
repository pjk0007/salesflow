import { useState } from "react";
import useSWR from "swr";
import type { KpiData, StatsQuery, TrendData } from "@/components/email/dashboard/types";
import { fetchStats, statsUrl, STATS_SWR } from "@/components/email/dashboard/api/emailStatsApi";
import { kpiCards } from "@/components/email/dashboard/utils/kpiCards";
import { countText, rateText } from "@/components/email/dashboard/utils/format";
import { compareCard } from "../utils/groups";

const COUNT_KEYS = new Set(["sent", "visits"]);
export type CompareGroup = { index: number; keys: string[]; query: StatsQuery };

/** 묶음 최대 3개 — 훅 개수를 고정하려고 세 자리를 늘 부른다 (빈 자리는 요청 안 함) */
function useThree<T>(view: "kpi" | "trend", groups: CompareGroup[]) {
    const a = useSWR<T>(groups[0] ? statsUrl(view, groups[0].query) : null, fetchStats, STATS_SWR);
    const b = useSWR<T>(groups[1] ? statsUrl(view, groups[1].query) : null, fetchStats, STATS_SWR);
    const c = useSWR<T>(groups[2] ? statsUrl(view, groups[2].query) : null, fetchStats, STATS_SWR);
    const all = [a, b, c].slice(0, groups.length);
    return {
        data: all.every((x) => x.data) ? all.map((x) => x.data!) : null,
        isLoading: all.some((x) => x.isLoading),
        error: all.find((x) => x.error)?.error,
        retry: () => all.forEach((x) => void x.mutate()),
    };
}

/** 묶음(메일 또는 기간) 비교 — 지표 카드마다 묶음별 값과 가장 나은 묶음 */
export function useCompareKpi(groups: CompareGroup[]) {
    const r = useThree<KpiData>("kpi", groups);
    const cards = r.data
        ? kpiCards(r.data[0])
              .filter((c) => c.key !== "keyLeads")
              .map((c) => {
                  const isCount = COUNT_KEYS.has(c.key);
                  return compareCard({
                      key: c.key,
                      label: c.label,
                      tooltip: c.tooltip,
                      groups: groups.map((g) => g.index),
                      values: r.data!.map((d) => d.kpi[c.key].value),
                      format: (v) => c.connection ?? (isCount ? countText(v) : rateText(v)),
                      gap: (d) => (isCount ? `${Math.round(d).toLocaleString("ko-KR")}통` : `${(Math.round(d * 10) / 10).toFixed(1)}%p`),
                      lowerIsBetter: c.lowerIsBetter,
                      // 수신거부율은 낮을수록 좋다
                      word: isCount ? "많아요" : c.lowerIsBetter ? "낮아요" : "높아요",
                  });
              })
        : [];
    return { isLoading: r.isLoading, error: r.error, cards, retry: r.retry };
}

export const COMPARE_METRICS = [
    { value: "openRate", label: "오픈율" },
    { value: "clickRate", label: "클릭률" },
    { value: "replyRate", label: "회신율" },
    { value: "bounceRate", label: "반송률" },
    { value: "unsubscribeRate", label: "수신거부율" },
] as const;
type Metric = (typeof COMPARE_METRICS)[number]["value"];

/**
 * 묶음 비교 — 날짜별 한 지표를 묶음마다 한 선으로 (g0·g1·g2).
 * byDay: 기간 비교 — 기간마다 날짜가 달라 가로축을 "N일째"로 맞춘다
 */
export function useCompareTrend(groups: CompareGroup[], byDay = false) {
    const [metric, setMetric] = useState<Metric>("openRate");
    const r = useThree<TrendData>("trend", groups);
    const points = r.data
        ? Array.from({ length: Math.max(...r.data.map((d) => d.points.length)) }, (_, idx) => {
              const row: Record<string, string | number | null> = {
                  date: byDay ? `${idx + 1}일째` : (r.data![0].points[idx]?.date ?? ""),
              };
              r.data!.forEach((d, i) => {
                  const q = d.points[idx];
                  const ok = q && q.ready && q.counts.accepted > 0 && (metric !== "replyRate" || d.connections.reply);
                  row[`g${i}`] = ok ? q.rates[metric] : null;
              });
              return row;
          })
        : [];
    return {
        metric,
        setMetric: (v: string) => setMetric(v as Metric),
        isLoading: r.isLoading,
        error: r.error,
        points,
        retry: r.retry,
    };
}
