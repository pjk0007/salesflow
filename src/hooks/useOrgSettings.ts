import useSWR from "swr";
import type { ApiResponse, OrgInfo, UpdateOrgInput } from "@/types";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export function useOrgSettings() {
    const { data, error, isLoading, mutate } = useSWR<ApiResponse<OrgInfo>>(
        "/api/org/settings",
        fetcher
    );

    const updateOrg = async (input: UpdateOrgInput) => {
        const res = await fetch("/api/org/settings", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(input),
        });
        const result = await res.json();
        if (result.success) mutate();
        return result;
    };

    return {
        org: data?.data ?? null,
        isLoading,
        error,
        updateOrg,
    };
}
