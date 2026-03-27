import useSWR from "swr";
import { defaultFetcher } from "@/lib/swr-fetcher";
import type { FieldDefinition, CreateFieldInput, UpdateFieldInput } from "@/types";

interface FieldsResponse {
    success: boolean;
    data?: FieldDefinition[];
}

export function useFieldTypeManagement(fieldTypeId: number | null) {
    const { data, error, isLoading, mutate } = useSWR<FieldsResponse>(
        fieldTypeId ? `/api/field-types/${fieldTypeId}/fields` : null,
        defaultFetcher
    );

    const createField = async (input: CreateFieldInput) => {
        const res = await fetch(`/api/field-types/${fieldTypeId}/fields`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(input),
        });
        const result = await res.json();
        if (result.success) mutate();
        return result;
    };

    const updateField = async (id: number, input: UpdateFieldInput) => {
        const res = await fetch(`/api/fields/${id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(input),
        });
        const result = await res.json();
        if (result.success) mutate();
        return result;
    };

    const deleteField = async (id: number) => {
        const res = await fetch(`/api/fields/${id}`, { method: "DELETE" });
        const result = await res.json();
        if (result.success) mutate();
        return result;
    };

    const reorderFields = async (fieldIds: number[]) => {
        const res = await fetch(`/api/field-types/${fieldTypeId}/fields/reorder`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ fieldIds }),
        });
        const result = await res.json();
        if (result.success) mutate();
        return result;
    };

    return {
        fields: data?.data ?? [],
        isLoading,
        error,
        mutate,
        createField,
        updateField,
        deleteField,
        reorderFields,
    };
}
