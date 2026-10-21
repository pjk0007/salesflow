import useSWR from "swr";
import type { KpiData, StatsQuery } from "../types";
import { fetchStats, statsUrl, STATS_SWR } from "../api/emailStatsApi";
import { kpiCards } from "../utils/kpiCards";
import { freshness } from "../utils/freshness";

export function useEmailStatsKpi(query: StatsQuery) {
    const { data, error, isLoading, mutate } = useSWR<KpiData>(statsUrl("kpi", query), fetchStats, STATS_SWR);
    return {
        isLoading,
        error,
        cards: data ? kpiCards(data) : [],
        freshness: data ? freshness(data, new Date()) : null,
        handleRetry: () => { void mutate(); }
    };
}
