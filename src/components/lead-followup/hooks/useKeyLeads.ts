import useSWR from "swr";
import { defaultFetcher, requestErrorMessage } from "@/lib/swr-fetcher";
import type { AssessedLead } from "../types";
export function useKeyLeads() {
    const { data, error, isLoading, mutate } = useSWR<{ success: boolean; data?: { leads: AssessedLead[]; criteria: string; asOf: string }; error?: string }>(
        "/api/analytics/key-leads", defaultFetcher, { refreshInterval: 60_000 });
    // 이미 보여준 목록은 주기 갱신이 실패해도 유지한다(전역 알림만 표시)
    return { leads: data?.data?.leads ?? [], criteria: data?.data?.criteria, asOf: data?.data?.asOf, isLoading, reload: () => mutate(),
        error: error && !data ? requestErrorMessage(error, "핵심 리드를 불러오지 못했습니다.") : null };
}
