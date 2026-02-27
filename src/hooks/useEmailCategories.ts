import useSWR from "swr";

export interface NhnCategory {
    categoryId: number;
    categoryName: string;
    categoryDesc: string;
}

interface CategoriesResponse {
    success: boolean;
    data?: NhnCategory[];
}

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export function useEmailCategories() {
    const { data, isLoading, mutate } = useSWR<CategoriesResponse>(
        "/api/email/categories",
        fetcher
    );

    const createCategory = async (catData: { categoryName: string; categoryDesc?: string }) => {
        const res = await fetch("/api/email/categories", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(catData),
        });
        const result = await res.json();
        if (result.success) mutate();
        return result;
    };

    const updateCategory = async (categoryId: number, catData: { categoryName?: string; categoryDesc?: string }) => {
        const res = await fetch(`/api/email/categories/${categoryId}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(catData),
        });
        const result = await res.json();
        if (result.success) mutate();
        return result;
    };

    const deleteCategory = async (categoryId: number) => {
        const res = await fetch(`/api/email/categories/${categoryId}`, {
            method: "DELETE",
        });
        const result = await res.json();
        if (result.success) mutate();
        return result;
    };

    return {
        categories: data?.data ?? [],
        isLoading,
        mutate,
        createCategory,
        updateCategory,
        deleteCategory,
    };
}
