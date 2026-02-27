import type { CreateFieldInput, UpdateFieldInput } from "@/types";
import { FIELD_TEMPLATES } from "@/lib/field-templates";

export function useFieldManagement(workspaceId: number | null, mutate: () => void) {
    const createField = async (input: CreateFieldInput) => {
        const res = await fetch(`/api/workspaces/${workspaceId}/fields`, {
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
        const res = await fetch(`/api/workspaces/${workspaceId}/fields/reorder`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ fieldIds }),
        });
        const result = await res.json();
        if (result.success) mutate();
        return result;
    };

    const applyTemplate = async (templateId: string) => {
        const template = FIELD_TEMPLATES.find((t) => t.id === templateId);
        if (!template) return { success: false, error: "템플릿을 찾을 수 없습니다." };

        const res = await fetch(`/api/workspaces/${workspaceId}/fields/bulk`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ fields: template.fields }),
        });
        const result = await res.json();
        if (result.success) mutate();
        return result;
    };

    return { createField, updateField, deleteField, reorderFields, applyTemplate };
}
