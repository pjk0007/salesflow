import type { CompareAxis, StatsQuery } from "../types";
export const STATS_SWR = { refreshInterval: 900000, revalidateOnFocus: false, keepPreviousData: true };
export const STATS_URL = "/api/analytics/email-stats";

export function statsUrl(view: "kpi" | "trend" | "compare", query: StatsQuery, axis?: CompareAxis) {
    const params = new URLSearchParams({ view, from: query.from, to: query.to });
    if (query.workspaceId !== null)
        params.set("workspaceId", String(query.workspaceId));
    if (axis)
        params.set("axis", axis);
    return `${STATS_URL}?${params}`;
}

export async function fetchStats<T>(url: string): Promise<T> {
    const response = await fetch(url);
    const result = await response.json();
    if (!response.ok || !result.success)
        throw new Error(result.error ?? "이메일 통계를 불러오지 못했습니다.");
    return result.data as T;
}

export async function refreshStats() {
    const response = await fetch(`${STATS_URL}/refresh`, { method: "POST" });
    const result = await response.json();
    if (!response.ok || !result.success)
        throw new Error(result.error ?? "이메일 통계를 갱신하지 못했습니다.");
    return { running: response.status === 202 };
}
