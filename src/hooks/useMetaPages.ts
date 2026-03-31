import useSWR from "swr";
import { defaultFetcher } from "@/lib/swr-fetcher";

export interface MetaPage {
    id: string;
    name: string;
    accessToken: string;
}

interface ListResponse {
    success: boolean;
    data: MetaPage[];
}

export function useMetaPages(platformId?: number) {
    const { data, error, isLoading, mutate } = useSWR<ListResponse>(
        platformId ? `/api/meta/pages?platformId=${platformId}` : null,
        defaultFetcher
    );

    return {
        pages: data?.data || [],
        error,
        isLoading,
        mutate,
    };
}
