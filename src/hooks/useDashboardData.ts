import useSWR from "swr";
import { defaultFetcher } from "@/lib/swr-fetcher";


export function useDashboardData(
    dashboardId: number | null,
    refreshInterval?: number
) {
    const key = dashboardId
        ? `/api/dashboards/${dashboardId}/data`
        : null;

    const { data, error, isLoading, mutate } = useSWR<{
        success: boolean;
        data: Record<number, unknown>;
    }>(key, defaultFetcher, {
        refreshInterval: refreshInterval ? refreshInterval * 1000 : undefined,
    });

    return {
        widgetData: data?.data ?? {},
        isLoading,
        error,
        mutate,
    };
}
