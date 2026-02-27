import useSWR from "swr";
import type { AlimtalkTemplateLink } from "@/lib/db";

interface TemplateLinksResponse {
    success: boolean;
    data?: AlimtalkTemplateLink[];
}

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export function useAlimtalkTemplateLinks(partitionId: number | null) {
    const { data, error, isLoading, mutate } = useSWR<TemplateLinksResponse>(
        partitionId ? `/api/alimtalk/template-links?partitionId=${partitionId}` : null,
        fetcher
    );

    const createLink = async (linkData: {
        partitionId: number;
        name: string;
        senderKey: string;
        templateCode: string;
        templateName?: string;
        recipientField: string;
        variableMappings?: Record<string, string>;
        triggerType?: string;
        triggerCondition?: Record<string, unknown> | null;
        repeatConfig?: Record<string, unknown> | null;
    }) => {
        const res = await fetch("/api/alimtalk/template-links", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(linkData),
        });
        const result = await res.json();
        if (result.success) mutate();
        return result;
    };

    const updateLink = async (
        id: number,
        linkData: {
            name?: string;
            recipientField?: string;
            variableMappings?: Record<string, string>;
            isActive?: number;
            triggerType?: string;
            triggerCondition?: Record<string, unknown> | null;
            repeatConfig?: Record<string, unknown> | null;
        }
    ) => {
        const res = await fetch(`/api/alimtalk/template-links/${id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(linkData),
        });
        const result = await res.json();
        if (result.success) mutate();
        return result;
    };

    const deleteLink = async (id: number) => {
        const res = await fetch(`/api/alimtalk/template-links/${id}`, {
            method: "DELETE",
        });
        const result = await res.json();
        if (result.success) mutate();
        return result;
    };

    return {
        templateLinks: data?.data ?? [],
        isLoading,
        error,
        mutate,
        createLink,
        updateLink,
        deleteLink,
    };
}
