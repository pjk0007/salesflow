import useSWR from "swr";
import type { RecordAutoEnrichRule } from "@/lib/db";
import { defaultFetcher } from "@/lib/swr-fetcher";

interface ApiResponse {
    success: boolean;
    data?: RecordAutoEnrichRule[];
    error?: string;
}


export function useAutoEnrichRules(partitionId: number | null) {
    const { data, isLoading, mutate } = useSWR<ApiResponse>(
        partitionId ? `/api/records/auto-enrich?partitionId=${partitionId}` : null,
        defaultFetcher
    );

    const createRule = async (ruleData: {
        partitionId: number;
        searchField: string;
        targetFields: string[];
    }) => {
        const res = await fetch("/api/records/auto-enrich", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(ruleData),
        });
        const result = await res.json();
        if (result.success) mutate();
        return result;
    };

    const updateRule = async (id: number, ruleData: {
        searchField?: string;
        targetFields?: string[];
        isActive?: number;
    }) => {
        const res = await fetch(`/api/records/auto-enrich/${id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(ruleData),
        });
        const result = await res.json();
        if (result.success) mutate();
        return result;
    };

    const deleteRule = async (id: number) => {
        const res = await fetch(`/api/records/auto-enrich/${id}`, {
            method: "DELETE",
        });
        const result = await res.json();
        if (result.success) mutate();
        return result;
    };

    return {
        rules: data?.data ?? [],
        isLoading,
        mutate,
        createRule,
        updateRule,
        deleteRule,
    };
}
