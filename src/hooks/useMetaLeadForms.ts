import useSWR from "swr";
import { defaultFetcher } from "@/lib/swr-fetcher";

export interface MetaLeadForm {
    id: string;
    name: string;
    status: string;
    field_count: number;
}

interface ListResponse {
    success: boolean;
    data: MetaLeadForm[];
}

export function useMetaLeadForms(platformId?: number, pageId?: string) {
    const { data, error, isLoading, mutate } = useSWR<ListResponse>(
        platformId && pageId
            ? `/api/meta/lead-forms?platformId=${platformId}&pageId=${pageId}`
            : null,
        defaultFetcher
    );

    return {
        forms: data?.data || [],
        error,
        isLoading,
        mutate,
    };
}
