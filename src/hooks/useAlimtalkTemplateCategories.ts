import useSWR from "swr";
import type { NhnTemplateCategoryGroup } from "@/lib/nhn-alimtalk";
import { defaultFetcher } from "@/lib/swr-fetcher";

interface CategoriesResponse {
    success: boolean;
    data?: { groups: NhnTemplateCategoryGroup[] };
}


export function useAlimtalkTemplateCategories() {
    const { data, isLoading } = useSWR<CategoriesResponse>(
        "/api/alimtalk/template-categories",
        defaultFetcher
    );

    return {
        categoryGroups: data?.data?.groups ?? [],
        isLoading,
    };
}
