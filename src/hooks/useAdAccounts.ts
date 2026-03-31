import useSWR from "swr";
import { defaultFetcher } from "@/lib/swr-fetcher";
import type { AdAccountInfo } from "@/types";

interface ListResponse {
    success: boolean;
    data: AdAccountInfo[];
}

export function useAdAccounts(platformId?: number, workspaceId?: number) {
    const params = new URLSearchParams();
    if (platformId) params.set("platformId", String(platformId));
    if (workspaceId) params.set("workspaceId", String(workspaceId));
    const query = params.toString();
    const url = `/api/ad-accounts${query ? `?${query}` : ""}`;

    const { data, error, isLoading, mutate } = useSWR<ListResponse>(
        url,
        defaultFetcher
    );

    const updateAccount = async (id: number, params: {
        workspaceId?: number | null;
        name?: string;
    }) => {
        const res = await fetch(`/api/ad-accounts/${id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(params),
        });
        const result = await res.json();
        if (result.success) mutate();
        return result;
    };

    return {
        accounts: data?.data || [],
        error,
        isLoading,
        mutate,
        updateAccount,
    };
}
