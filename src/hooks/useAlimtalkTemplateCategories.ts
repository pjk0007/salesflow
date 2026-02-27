import useSWR from "swr";
import type { NhnTemplateCategoryGroup } from "@/lib/nhn-alimtalk";

interface CategoriesResponse {
    success: boolean;
    data?: { groups: NhnTemplateCategoryGroup[] };
}

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export function useAlimtalkTemplateCategories() {
    const { data, isLoading } = useSWR<CategoriesResponse>(
        "/api/alimtalk/template-categories",
        fetcher
    );

    return {
        categoryGroups: data?.data?.groups ?? [],
        isLoading,
    };
}
