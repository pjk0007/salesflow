import { useState } from "react";
import useSWR from "swr";
import type { CompareData, CompareAxis, StatsQuery } from "../types";
import { fetchStats, statsUrl, STATS_SWR } from "../api/emailStatsApi";
import { AXIS_OPTIONS, compareColumns, compareRowModel, sortRows, type SortKey } from "../utils/compare";

export function useEmailStatsCompare(query: StatsQuery) {
    const [picked, setPicked] = useState<CompareAxis>("campaign");
    // 메일 하나를 골랐으면 그 메일의 후속 단계별로만 본다
    const axis: CompareAxis = query.campaign ? "step" : picked;
    const [sort, setSort] = useState<{
        key: SortKey;
        direction: "asc" | "desc";
    }>({ key: "accepted", direction: "desc" });
    const { data, error, isLoading, mutate } = useSWR<CompareData>(statsUrl("compare", query, axis), fetchStats, STATS_SWR);
    const columns = compareColumns(axis, data?.connections ?? { reply: false, site: false, journey: false });
    return {
        axis,
        axes: query.campaign ? AXIS_OPTIONS.filter((a) => a.value === "step") : AXIS_OPTIONS,
        handleAxis: (value: string) => setPicked(value as CompareAxis),
        isLoading,
        error,
        isEmpty: data?.total.counts.accepted === 0,
        columns: columns.map(column => ({
            ...column,
            sortLabel: column.key === sort.key ? (sort.direction === "asc" ? " ↑" : " ↓") : "",
            onClick: () => setSort({
                key: column.key,
                direction: sort.key === column.key && sort.direction === "desc" ? "asc" : "desc"
            }),
        })),
        rows: data ? sortRows(data.rows, sort.key, sort.direction).map(row => compareRowModel(row, columns)) : [],
        total: data ? [compareRowModel(data.total, columns)] : [],
        handleRetry: () => { void mutate(); },
    };
}
