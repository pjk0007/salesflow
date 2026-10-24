import useSWR, { useSWRConfig } from "swr";
import { defaultFetcher, requestErrorMessage } from "@/lib/swr-fetcher";
import { FollowupApiError, saveFollowup } from "../api/followupApi";
import type { FollowupDetail, FollowupPatch } from "../types";

export function useLeadFollowup(recordId: number) {
    const { mutate: refresh } = useSWRConfig();
    const { data, error, isLoading, mutate } = useSWR<{ success: boolean; data?: FollowupDetail; error?: string }>(
        `/api/records/${recordId}/lead-followup`, defaultFetcher, { refreshInterval: 60_000 });
    // 이미 보여준 상태는 주기 갱신이 실패해도 유지한다(전역 알림만 표시)
    return { detail: data?.data, error: error && !data ? requestErrorMessage(error, "후속 대응 상태를 불러오지 못했습니다.") : null,
        isLoading, reload: () => mutate(), save: async (patch: FollowupPatch) => {
            try {
                const detail = await saveFollowup(recordId, patch);
                await mutate({ success: true, data: detail }, false);
                void refresh((key) => typeof key === "string" && (key.startsWith("/api/analytics/key-leads") || key.startsWith(`/api/records/${recordId}/journey`)));
            } catch (err) {
                if (err instanceof FollowupApiError && err.status === 409) await mutate();
                throw err;
            }
        } };
}
