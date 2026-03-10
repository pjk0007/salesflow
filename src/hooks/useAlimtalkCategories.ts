import useSWR from "swr";
import { useAlimtalkConfig } from "./useAlimtalkConfig";
import type { NhnSenderCategory } from "@/lib/nhn-alimtalk";
import { defaultFetcher } from "@/lib/swr-fetcher";

interface CategoriesResponse {
    success: boolean;
    data?: NhnSenderCategory[];
    error?: string;
}


export function useAlimtalkCategories() {
    const { isConfigured } = useAlimtalkConfig();

    const { data, error, isLoading } = useSWR<CategoriesResponse>(
        isConfigured ? "/api/alimtalk/sender-categories" : null,
        defaultFetcher,
        { revalidateOnFocus: false }
    );

    return {
        categories: data?.success ? (data.data ?? []) : [],
        isLoading,
        error: error || (data && !data.success ? data.error : null),
    };
}
