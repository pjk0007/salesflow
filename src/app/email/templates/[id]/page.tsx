"use client";

import WorkspaceLayout from "@/components/layouts/WorkspaceLayout";
import EmailTemplateEditor from "@/components/email/EmailTemplateEditor";
import { useEmailTemplates } from "@/hooks/useEmailTemplates";
import { useRouter, useParams } from "next/navigation";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

export default function EditTemplatePage() {
    const router = useRouter();
    const params = useParams();
    const id = params.id;
    const { templates, isLoading, updateTemplate } = useEmailTemplates();
    const template = templates.find((t) => t.id === Number(id)) ?? null;

    const handleSave = async (data: {
        name: string;
        subject: string;
        htmlBody: string;
        templateType?: string;
        status?: "draft" | "published";
    }) => {
        if (!template) return { success: false, error: "템플릿을 찾을 수 없습니다." };
        const result = await updateTemplate(template.id, data);
        if (result.success && data.status === "published") {
            toast.success("템플릿이 수정되었습니다.");
            router.push("/email?tab=templates");
        }
        return result;
    };

    const handleCancel = () => router.push("/email?tab=templates");

    if (isLoading) {
        return (
            <WorkspaceLayout>
                <div className="flex items-center justify-center h-64">
                    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
            </WorkspaceLayout>
        );
    }

    if (!template) {
        return (
            <WorkspaceLayout>
                <div className="flex items-center justify-center h-64 text-muted-foreground">
                    템플릿을 찾을 수 없습니다.
                </div>
            </WorkspaceLayout>
        );
    }

    return (
        <WorkspaceLayout>
            <EmailTemplateEditor
                template={template}
                onSave={handleSave}
                onCancel={handleCancel}
            />
        </WorkspaceLayout>
    );
}
