import { useAlimtalkTemplates } from "./useAlimtalkTemplates";
import type { NhnTemplateButton, NhnTemplateQuickReply } from "@/lib/nhn-alimtalk";

interface TemplateData {
    senderKey: string;
    templateCode?: string;
    templateName: string;
    templateContent: string;
    templateMessageType?: string;
    templateEmphasizeType?: string;
    templateExtra?: string;
    templateTitle?: string;
    templateSubtitle?: string;
    templateHeader?: string;
    securityFlag?: boolean;
    categoryCode?: string;
    buttons?: NhnTemplateButton[];
    quickReplies?: NhnTemplateQuickReply[];
}

export function useAlimtalkTemplateManage(senderKey: string | null) {
    const { mutate } = useAlimtalkTemplates(senderKey);

    const createTemplate = async (data: TemplateData) => {
        const res = await fetch("/api/alimtalk/templates", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(data),
        });
        const result = await res.json();
        if (result.success) mutate();
        return result;
    };

    const updateTemplate = async (templateCode: string, data: Omit<TemplateData, "templateCode">) => {
        const res = await fetch(`/api/alimtalk/templates/${encodeURIComponent(templateCode)}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(data),
        });
        const result = await res.json();
        if (result.success) mutate();
        return result;
    };

    const deleteTemplate = async (templateCode: string, skKey: string) => {
        const res = await fetch(
            `/api/alimtalk/templates/${encodeURIComponent(templateCode)}?senderKey=${encodeURIComponent(skKey)}`,
            { method: "DELETE" }
        );
        const result = await res.json();
        if (result.success) mutate();
        return result;
    };

    const commentTemplate = async (templateCode: string, skKey: string, comment: string) => {
        const res = await fetch(
            `/api/alimtalk/templates/${encodeURIComponent(templateCode)}/comments`,
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ senderKey: skKey, comment }),
            }
        );
        const result = await res.json();
        if (result.success) mutate();
        return result;
    };

    return { createTemplate, updateTemplate, deleteTemplate, commentTemplate };
}
