import useSWR from "swr";
import { defaultFetcher } from "@/lib/swr-fetcher";
import type { AdPlatformInfo, AdPlatformCredentials, AdPlatformType } from "@/types";

interface ListResponse {
    success: boolean;
    data: AdPlatformInfo[];
}

export function useAdPlatforms() {
    const { data, error, isLoading, mutate } = useSWR<ListResponse>(
        "/api/ad-platforms",
        defaultFetcher
    );

    const createPlatform = async (params: {
        platform: AdPlatformType;
        name: string;
        credentials: AdPlatformCredentials;
    }) => {
        const res = await fetch("/api/ad-platforms", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(params),
        });
        const result = await res.json();
        if (result.success) mutate();
        return result;
    };

    const updatePlatform = async (id: number, params: {
        name?: string;
        credentials?: AdPlatformCredentials;
        status?: string;
    }) => {
        const res = await fetch(`/api/ad-platforms/${id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(params),
        });
        const result = await res.json();
        if (result.success) mutate();
        return result;
    };

    const deletePlatform = async (id: number) => {
        const res = await fetch(`/api/ad-platforms/${id}`, { method: "DELETE" });
        const result = await res.json();
        if (result.success) mutate();
        return result;
    };

    const syncAccounts = async (id: number) => {
        const res = await fetch(`/api/ad-platforms/${id}/sync`, { method: "POST" });
        const result = await res.json();
        if (result.success) mutate();
        return result;
    };

    return {
        platforms: data?.data || [],
        error,
        isLoading,
        mutate,
        createPlatform,
        updatePlatform,
        deletePlatform,
        syncAccounts,
    };
}
