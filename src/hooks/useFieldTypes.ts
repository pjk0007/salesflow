import useSWR from "swr";
import { defaultFetcher } from "@/lib/swr-fetcher";
import type { FieldTypeDefinition } from "@/types";

interface FieldTypesResponse {
    success: boolean;
    data?: FieldTypeDefinition[];
}

export function useFieldTypes() {
    const { data, error, isLoading, mutate } = useSWR<FieldTypesResponse>(
        "/api/field-types",
        defaultFetcher
    );

    const createType = async (input: { name: string; description?: string; icon?: string }) => {
        const res = await fetch("/api/field-types", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(input),
        });
        const result = await res.json();
        if (result.success) mutate();
        return result;
    };

    const updateType = async (id: number, input: { name?: string; description?: string; icon?: string }) => {
        const res = await fetch(`/api/field-types/${id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(input),
        });
        const result = await res.json();
        if (result.success) mutate();
        return result;
    };

    const deleteType = async (id: number) => {
        const res = await fetch(`/api/field-types/${id}`, { method: "DELETE" });
        const result = await res.json();
        if (result.success) mutate();
        return result;
    };

    return {
        fieldTypes: data?.data ?? [],
        isLoading,
        error,
        mutate,
        createType,
        updateType,
        deleteType,
    };
}
