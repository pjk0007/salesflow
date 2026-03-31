import useSWR from "swr";
import { defaultFetcher } from "@/lib/swr-fetcher";
import type { AdLeadIntegrationInfo } from "@/types";

interface ListResponse {
    success: boolean;
    data: AdLeadIntegrationInfo[];
}

export function useAdLeadIntegrations(accountId?: number) {
    const url = accountId
        ? `/api/ad-lead-integrations?accountId=${accountId}`
        : "/api/ad-lead-integrations";

    const { data, error, isLoading, mutate } = useSWR<ListResponse>(
        url,
        defaultFetcher
    );

    const createIntegration = async (params: {
        adAccountId: number;
        name: string;
        partitionId: number;
        formId: string;
        formName?: string;
        fieldMappings: Record<string, string>;
        defaultValues?: Record<string, unknown>;
    }) => {
        const res = await fetch("/api/ad-lead-integrations", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(params),
        });
        const result = await res.json();
        if (result.success) mutate();
        return result;
    };

    const updateIntegration = async (id: number, params: {
        name?: string;
        partitionId?: number;
        fieldMappings?: Record<string, string>;
        defaultValues?: Record<string, unknown>;
        isActive?: number;
    }) => {
        const res = await fetch(`/api/ad-lead-integrations/${id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(params),
        });
        const result = await res.json();
        if (result.success) mutate();
        return result;
    };

    const deleteIntegration = async (id: number) => {
        const res = await fetch(`/api/ad-lead-integrations/${id}`, { method: "DELETE" });
        const result = await res.json();
        if (result.success) mutate();
        return result;
    };

    return {
        integrations: data?.data || [],
        error,
        isLoading,
        mutate,
        createIntegration,
        updateIntegration,
        deleteIntegration,
    };
}
