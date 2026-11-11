import useSWR from "swr";
import { defaultFetcher } from "@/lib/swr-fetcher";
import type { ActionItem, Meeting } from "../types";

/** 영업 리드의 미팅 기록 + 액션플랜 */
export function useMeetings(recordId: number | null) {
    const { data, isLoading, mutate } = useSWR<{ success: boolean; data: { meetings: Meeting[]; actionItems: ActionItem[] } }>(
        recordId ? `/api/records/${recordId}/meetings` : null,
        defaultFetcher,
    );
    return { meetings: data?.data.meetings ?? [], actionItems: data?.data.actionItems ?? [], isLoading, mutate };
}
