import useSWR from "swr";
import type { EmailTemplate } from "@/lib/db";

interface TemplatesResponse {
    success: boolean;
    data?: EmailTemplate[];
    totalCount?: number;
}

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export function useEmailTemplates() {
    const { data, error, isLoading, mutate } = useSWR<TemplatesResponse>(
        "/api/email/templates",
        fetcher
    );

    const createTemplate = async (templateData: {
        name: string;
        subject: string;
        htmlBody: string;
        templateType?: string;
        status?: "draft" | "published";
        categoryId?: number | null;
    }) => {
        const res = await fetch("/api/email/templates", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(templateData),
        });
        const result = await res.json();
        if (result.success) mutate();
        return result;
    };

    const updateTemplate = async (
        id: number,
        templateData: {
            name?: string;
            subject?: string;
            htmlBody?: string;
            templateType?: string;
            isActive?: number;
            status?: "draft" | "published";
            categoryId?: number | null;
        }
    ) => {
        const res = await fetch(`/api/email/templates/${id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(templateData),
        });
        const result = await res.json();
        if (result.success) mutate();
        return result;
    };

    const deleteTemplate = async (id: number) => {
        const res = await fetch(`/api/email/templates/${id}`, {
            method: "DELETE",
        });
        const result = await res.json();
        if (result.success) mutate();
        return result;
    };

    return {
        templates: data?.data ?? [],
        totalCount: data?.totalCount ?? 0,
        isLoading,
        error,
        mutate,
        createTemplate,
        updateTemplate,
        deleteTemplate,
    };
}
