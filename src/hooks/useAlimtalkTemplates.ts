import useSWR from "swr";
import type { NhnTemplate } from "@/lib/nhn-alimtalk";
import { defaultFetcher } from "@/lib/swr-fetcher";

interface TemplatesResponse {
    success: boolean;
    data?: {
        templates: NhnTemplate[];
        totalCount: number;
    };
}


export function useAlimtalkTemplates(senderKey: string | null) {
    const { data, error, isLoading, mutate } = useSWR<TemplatesResponse>(
        senderKey ? `/api/alimtalk/templates?senderKey=${encodeURIComponent(senderKey)}` : null,
        defaultFetcher
    );

    return {
        templates: data?.data?.templates ?? [],
        totalCount: data?.data?.totalCount ?? 0,
        isLoading,
        error,
        mutate,
    };
}
