import { useState } from "react";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useAlimtalkTemplateManage } from "@/hooks/useAlimtalkTemplateManage";
import TemplateFormEditor, { type TemplateFormState } from "./TemplateFormEditor";
import TemplatePreview from "./TemplatePreview";
import type { NhnTemplate } from "@/lib/nhn-alimtalk";

interface TemplateCreateDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    senderKey: string;
    mode: "create" | "edit";
    template?: NhnTemplate;
}

function getInitialState(mode: "create" | "edit", template?: NhnTemplate): TemplateFormState {
    if (mode === "edit" && template) {
        const hasButtons = (template.buttons?.length ?? 0) > 0;
        return {
            templateCode: template.templateCode,
            templateName: template.templateName,
            templateContent: template.templateContent,
            templateMessageType: template.templateMessageType || "BA",
            templateEmphasizeType: template.templateEmphasizeType || "NONE",
            templateExtra: template.templateExtra || "",
            templateTitle: template.templateTitle || "",
            templateSubtitle: template.templateSubtitle || "",
            templateHeader: template.templateHeader || "",
            securityFlag: template.securityFlag || false,
            categoryCode: template.categoryCode || "",
            buttons: template.buttons || [],
            quickReplies: template.quickReplies || [],
            interactionType: hasButtons || (template.quickReplies?.length ?? 0) === 0 ? "buttons" : "quickReplies",
        };
    }
    return {
        templateCode: "",
        templateName: "",
        templateContent: "",
        templateMessageType: "BA",
        templateEmphasizeType: "NONE",
        templateExtra: "",
        templateTitle: "",
        templateSubtitle: "",
        templateHeader: "",
        securityFlag: false,
        categoryCode: "",
        buttons: [],
        quickReplies: [],
        interactionType: "buttons",
    };
}

export default function TemplateCreateDialog({
    open,
    onOpenChange,
    senderKey,
    mode,
    template,
}: TemplateCreateDialogProps) {
    const [form, setForm] = useState<TemplateFormState>(() => getInitialState(mode, template));
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const { createTemplate, updateTemplate } = useAlimtalkTemplateManage(senderKey);

    const handleSubmit = async () => {
        setError(null);

        if (!form.templateCode || !form.templateName || !form.templateContent) {
            setError("템플릿 코드, 이름, 본문은 필수입니다.");
            return;
        }

        setSubmitting(true);
        try {
            const payload = {
                senderKey,
                templateName: form.templateName,
                templateContent: form.templateContent,
                templateMessageType: form.templateMessageType,
                templateEmphasizeType: form.templateEmphasizeType,
                ...(form.templateExtra && { templateExtra: form.templateExtra }),
                ...(form.templateTitle && { templateTitle: form.templateTitle }),
                ...(form.templateSubtitle && { templateSubtitle: form.templateSubtitle }),
                ...(form.templateHeader && { templateHeader: form.templateHeader }),
                ...(form.securityFlag && { securityFlag: true }),
                ...(form.categoryCode && { categoryCode: form.categoryCode }),
                ...(form.interactionType === "buttons" && form.buttons.length > 0 && { buttons: form.buttons }),
                ...(form.interactionType === "quickReplies" && form.quickReplies.length > 0 && { quickReplies: form.quickReplies }),
            };

            let result;
            if (mode === "create") {
                result = await createTemplate({ ...payload, templateCode: form.templateCode });
            } else {
                result = await updateTemplate(form.templateCode, payload);
            }

            if (result.success) {
                onOpenChange(false);
            } else {
                setError(result.error || "처리에 실패했습니다.");
            }
        } catch {
            setError("요청 중 오류가 발생했습니다.");
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-5xl max-h-[90vh] flex flex-col">
                <DialogHeader>
                    <DialogTitle>
                        {mode === "create" ? "템플릿 등록" : "템플릿 수정"}
                    </DialogTitle>
                </DialogHeader>

                <div className="flex-1 grid grid-cols-2 gap-6 overflow-hidden min-h-0">
                    {/* 좌측: 폼 */}
                    <div className="overflow-y-auto">
                        <TemplateFormEditor
                            value={form}
                            onChange={setForm}
                            mode={mode}
                        />
                    </div>

                    {/* 우측: 미리보기 */}
                    <div className="overflow-y-auto">
                        <TemplatePreview
                            templateContent={form.templateContent}
                            templateMessageType={form.templateMessageType}
                            templateEmphasizeType={form.templateEmphasizeType}
                            templateTitle={form.templateTitle}
                            templateSubtitle={form.templateSubtitle}
                            templateHeader={form.templateHeader}
                            templateExtra={form.templateExtra}
                            buttons={form.buttons}
                            quickReplies={form.quickReplies}
                            interactionType={form.interactionType}
                        />
                    </div>
                </div>

                {error && (
                    <p className="text-sm text-destructive">{error}</p>
                )}

                <div className="flex justify-end gap-2 pt-2 border-t">
                    <Button
                        variant="outline"
                        onClick={() => onOpenChange(false)}
                        disabled={submitting}
                    >
                        취소
                    </Button>
                    <Button onClick={handleSubmit} disabled={submitting}>
                        {submitting ? "처리 중..." : mode === "create" ? "등록" : "수정"}
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
}
