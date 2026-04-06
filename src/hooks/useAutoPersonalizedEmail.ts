import useSWR from "swr";
import { defaultFetcher } from "@/lib/swr-fetcher";


export interface AutoPersonalizedLink {
    id: number;
    orgId: string;
    partitionId: number;
    productId: number | null;
    productName: string | null;
    recipientField: string;
    companyField: string;
    prompt: string | null;
    tone: string | null;
    format: string;
    triggerType: string;
    triggerCondition: {
        field?: string;
        operator?: "eq" | "ne" | "contains";
        value?: string;
    } | null;
    autoResearch: number;
    useSignaturePersona: number;
    preventDuplicate: number;
    followupConfig: {
        delayDays: number;
        onOpened?: { prompt: string };
        onNotOpened?: { prompt: string };
    } | null;
    isActive: number;
    createdAt: string;
    updatedAt: string;
}

interface CreateInput {
    partitionId: number;
    productId?: number | null;
    recipientField: string;
    companyField: string;
    prompt?: string;
    tone?: string;
    format?: string;
    triggerType: "on_create" | "on_update";
    triggerCondition?: { field: string; operator: string; value: string } | null;
    autoResearch?: number;
    useSignaturePersona?: number;
    followupConfig?: {
        delayDays: number;
        onOpened?: { prompt: string };
        onNotOpened?: { prompt: string };
    } | null;
    isActive?: number;
    preventDuplicate?: number;
    senderProfileId?: number | null;
    signatureId?: number | null;
}

interface UpdateInput {
    productId?: number | null;
    recipientField?: string;
    companyField?: string;
    prompt?: string;
    tone?: string;
    format?: string;
    triggerType?: string;
    triggerCondition?: { field: string; operator: string; value: string } | null;
    autoResearch?: number;
    useSignaturePersona?: number;
    followupConfig?: {
        delayDays: number;
        onOpened?: { prompt: string };
        onNotOpened?: { prompt: string };
    } | null;
    isActive?: number;
    preventDuplicate?: number;
    senderProfileId?: number | null;
    signatureId?: number | null;
}

export function useAutoPersonalizedEmail(partitionId: number | null) {
    const { data, error, isLoading, mutate } = useSWR(
        partitionId ? `/api/email/auto-personalized?partitionId=${partitionId}` : null,
        defaultFetcher
    );

    const createLink = async (input: CreateInput) => {
        const res = await fetch("/api/email/auto-personalized", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(input),
        });
        const result = await res.json();
        if (result.success) mutate();
        return result;
    };

    const updateLink = async (id: number, input: UpdateInput) => {
        const res = await fetch(`/api/email/auto-personalized/${id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(input),
        });
        const result = await res.json();
        if (result.success) mutate();
        return result;
    };

    const deleteLink = async (id: number) => {
        const res = await fetch(`/api/email/auto-personalized/${id}`, {
            method: "DELETE",
        });
        const result = await res.json();
        if (result.success) mutate();
        return result;
    };

    return {
        links: (data?.data ?? []) as AutoPersonalizedLink[],
        isLoading,
        error,
        createLink,
        updateLink,
        deleteLink,
    };
}
