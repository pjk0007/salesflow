import useSWR from "swr";
import type { NhnTemplateCategoryGroup } from "@/lib/nhn-alimtalk";
import { defaultFetcher } from "@/lib/swr-fetcher";

interface CategoriesResponse {
    success: boolean;
    data?: { groups: NhnTemplateCategoryGroup[] };
}


export function useAlimtalkTemplateCategories() {
    const { data, isLoading , error: queryError0, mutate: retryQuery0 } = useSWR<CategoriesResponse>(
        "/api/alimtalk/template-categories",
        defaultFetcher
    );

    return {
        error: queryError0,
        mutate: retryQuery0,
        categoryGroups: data?.data?.groups ?? [],
        isLoading,
    };
}
