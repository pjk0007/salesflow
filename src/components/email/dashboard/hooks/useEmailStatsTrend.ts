import { useState } from "react";
import useSWR from "swr";
import type { TrendData, StatsQuery } from "../types";
import { fetchStats, statsUrl, STATS_SWR } from "../api/emailStatsApi";
import { trendModel } from "../utils/trend";

export function useEmailStatsTrend(query: StatsQuery) {
    const [tab, setTab] = useState("response");
    const { data, error, isLoading, mutate } = useSWR<TrendData>(statsUrl("trend", query), fetchStats, STATS_SWR);
    return {
        tab,
        handleTab: setTab,
        isLoading,
        error,
        model: data ? trendModel(data) : null,
        handleRetry: () => { void mutate(); }
    };
}
