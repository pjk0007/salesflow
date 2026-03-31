import useSWR from "swr";
import { defaultFetcher } from "@/lib/swr-fetcher";

export interface MetaLeadFormField {
    key: string;
    label: string;
    type: string;
}

interface ApiResponse {
    success: boolean;
    data: {
        id: string;
        name: string;
        fields: MetaLeadFormField[];
    };
}

export function useMetaLeadFormFields(platformId?: number, formId?: string) {
    const { data, error, isLoading, mutate } = useSWR<ApiResponse>(
        platformId && formId
            ? `/api/meta/lead-form-fields?platformId=${platformId}&formId=${formId}`
            : null,
        defaultFetcher
    );

    return {
        fields: data?.data?.fields || [],
        error,
        isLoading,
        mutate,
    };
}
