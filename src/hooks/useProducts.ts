import useSWR from "swr";
import type { Product } from "@/lib/db";

interface ApiResponse<T> {
    success: boolean;
    data?: T;
    error?: string;
}

interface UseProductsOptions {
    search?: string;
    category?: string;
    activeOnly?: boolean;
}

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export function useProducts(options?: UseProductsOptions) {
    const params = new URLSearchParams();
    if (options?.search) params.set("search", options.search);
    if (options?.category) params.set("category", options.category);
    if (options?.activeOnly) params.set("activeOnly", "true");

    const qs = params.toString();
    const key = `/api/products${qs ? `?${qs}` : ""}`;

    const { data, error, isLoading, mutate } = useSWR<ApiResponse<Product[]>>(key, fetcher);

    const createProduct = async (input: {
        name: string;
        summary?: string;
        description?: string;
        category?: string;
        price?: string;
        imageUrl?: string;
    }) => {
        const res = await fetch("/api/products", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(input),
        });
        const result = await res.json();
        if (result.success) mutate();
        return result;
    };

    const updateProduct = async (id: number, input: Record<string, unknown>) => {
        const res = await fetch(`/api/products/${id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(input),
        });
        const result = await res.json();
        if (result.success) mutate();
        return result;
    };

    const deleteProduct = async (id: number) => {
        const res = await fetch(`/api/products/${id}`, {
            method: "DELETE",
        });
        const result = await res.json();
        if (result.success) mutate();
        return result;
    };

    return {
        products: data?.data ?? [],
        isLoading,
        error,
        mutate,
        createProduct,
        updateProduct,
        deleteProduct,
    };
}
