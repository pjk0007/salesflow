import useSWR from "swr";
import { defaultFetcher } from "@/lib/swr-fetcher";
import type { AssessedLead } from "../types";
export function useKeyLeads() {
    const { data, error, isLoading, mutate } = useSWR<{ success: boolean; data?: { leads: AssessedLead[]; criteria: string; asOf: string }; error?: string }>(
        "/api/analytics/key-leads", defaultFetcher, { refreshInterval: 60_000 });
    return { leads: data?.data?.leads ?? [], criteria: data?.data?.criteria, asOf: data?.data?.asOf, isLoading, reload: () => mutate(),
        error: error ? "핵심 리드를 불러오지 못했습니다." : data?.success === false ? data.error : null };
}
