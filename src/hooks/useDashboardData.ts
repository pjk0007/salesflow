import useSWR from "swr";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

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
    }>(key, fetcher, {
        refreshInterval: refreshInterval ? refreshInterval * 1000 : undefined,
    });

    return {
        widgetData: data?.data ?? {},
        isLoading,
        error,
        mutate,
    };
}
