import useSWR from "swr";
import type { NhnTemplateCategoryGroup } from "@/lib/nhn-alimtalk";
import { defaultFetcher } from "@/lib/swr-fetcher";

interface CategoriesResponse {
    success: boolean;
    data?: { groups: NhnTemplateCategoryGroup[] };
}


export function useAlimtalkTemplateCategories() {
    const { data, error, isLoading, mutate } = useSWR<CategoriesResponse>(
        "/api/alimtalk/template-categories",
        defaultFetcher
    );

    return {
        categoryGroups: data?.data?.groups ?? [],
        isLoading,
        error,
        mutate,
    };
}
