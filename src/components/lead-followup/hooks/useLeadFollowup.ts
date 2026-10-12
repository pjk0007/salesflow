import useSWR, { useSWRConfig } from "swr";
import { defaultFetcher } from "@/lib/swr-fetcher";
import { FollowupApiError, saveFollowup } from "../api/followupApi";
import type { FollowupDetail, FollowupPatch } from "../types";

export function useLeadFollowup(recordId: number) {
    const { mutate: refresh } = useSWRConfig();
    const { data, error, isLoading, mutate } = useSWR<{ success: boolean; data?: FollowupDetail; error?: string }>(
        `/api/records/${recordId}/lead-followup`, defaultFetcher, { refreshInterval: 60_000 });
    return { detail: data?.data, error: error ? "후속 대응 상태를 불러오지 못했습니다." : data?.success === false ? data.error : null,
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
