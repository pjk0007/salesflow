import useSWR from "swr";
import { useAlimtalkConfig } from "./useAlimtalkConfig";
import type { NhnSenderCategory } from "@/lib/nhn-alimtalk";

interface CategoriesResponse {
    success: boolean;
    data?: NhnSenderCategory[];
    error?: string;
}

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export function useAlimtalkCategories() {
    const { isConfigured } = useAlimtalkConfig();

    const { data, error, isLoading } = useSWR<CategoriesResponse>(
        isConfigured ? "/api/alimtalk/sender-categories" : null,
        fetcher,
        { revalidateOnFocus: false }
    );

    return {
        categories: data?.success ? (data.data ?? []) : [],
        isLoading,
        error: error || (data && !data.success ? data.error : null),
    };
}
