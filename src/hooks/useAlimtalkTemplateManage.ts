import { useAlimtalkTemplates } from "./useAlimtalkTemplates";
import type { NhnTemplateButton, NhnTemplateQuickReply } from "@/lib/nhn-alimtalk";
import { apiRequest } from "@/lib/swr-fetcher";

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

    // 삭제·검수 요청은 실패하면 RequestError를 던진다(서버의 한국어 안내 유지). 호출부가 창·입력을 유지한다.
    const deleteTemplate = async (templateCode: string, skKey: string) => {
        const result = await apiRequest(
            `/api/alimtalk/templates/${encodeURIComponent(templateCode)}?senderKey=${encodeURIComponent(skKey)}`,
            { method: "DELETE" }
        );
        mutate();
        return result;
    };

    const commentTemplate = async (templateCode: string, skKey: string, comment: string) => {
        const result = await apiRequest(
            `/api/alimtalk/templates/${encodeURIComponent(templateCode)}/comments`,
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ senderKey: skKey, comment }),
            }
        );
        mutate();
        return result;
    };

    return { createTemplate, updateTemplate, deleteTemplate, commentTemplate };
}
