import useSWR from "swr";
import type { WebForm } from "@/lib/db";

interface WebFormWithFieldCount extends WebForm {
    fieldCount: number;
}

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export function useWebForms(workspaceId?: number | null) {
    const key = workspaceId
        ? `/api/web-forms?workspaceId=${workspaceId}`
        : null;

    const { data, error, isLoading, mutate } = useSWR<{
        success: boolean;
        data: WebFormWithFieldCount[];
    }>(key, fetcher);

    const createForm = async (input: {
        name: string;
        workspaceId: number;
        partitionId: number;
        title: string;
        description?: string;
    }) => {
        const res = await fetch("/api/web-forms", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(input),
        });
        const result = await res.json();
        if (result.success) mutate();
        return result;
    };

    const updateForm = async (id: number, input: Record<string, unknown>) => {
        const res = await fetch(`/api/web-forms/${id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(input),
        });
        const result = await res.json();
        if (result.success) mutate();
        return result;
    };

    const deleteForm = async (id: number) => {
        const res = await fetch(`/api/web-forms/${id}`, { method: "DELETE" });
        const result = await res.json();
        if (result.success) mutate();
        return result;
    };

    return {
        forms: data?.data ?? [],
        isLoading,
        error,
        createForm,
        updateForm,
        deleteForm,
        mutate,
    };
}
