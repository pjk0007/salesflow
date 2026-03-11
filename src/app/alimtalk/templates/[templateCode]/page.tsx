"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter, useParams, useSearchParams } from "next/navigation";
import WorkspaceLayout from "@/components/layouts/WorkspaceLayout";
import TemplateFormEditor, { type TemplateFormState } from "@/components/alimtalk/TemplateFormEditor";
import TemplatePreview from "@/components/alimtalk/TemplatePreview";
import AiAlimtalkPanel from "@/components/alimtalk/AiAlimtalkPanel";
import { useAlimtalkTemplateManage } from "@/hooks/useAlimtalkTemplateManage";
import { Button } from "@/components/ui/button";
import { PageContainer } from "@/components/common/page-container";
import { ArrowLeft, Sparkles, Loader2 } from "lucide-react";
import type { NhnTemplate, NhnTemplateButton } from "@/lib/nhn-alimtalk";

function templateToFormState(template: NhnTemplate): TemplateFormState {
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
        templateImageName: template.templateImageName || "",
        templateImageUrl: template.templateImageUrl || "",
        templateItem: template.templateItem || null,
        templateItemHighlight: template.templateItemHighlight || null,
        templateRepresentLink: template.templateRepresentLink ? {
            linkMo: template.templateRepresentLink.linkMo || "",
            linkPc: template.templateRepresentLink.linkPc || "",
            schemeIos: template.templateRepresentLink.schemeIos || "",
            schemeAndroid: template.templateRepresentLink.schemeAndroid || "",
        } : null,
    };
}

function EditAlimtalkTemplateContent() {
    const router = useRouter();
    const params = useParams();
    const searchParams = useSearchParams();
    const templateCode = params.templateCode as string;
    const senderKey = searchParams.get("senderKey");

    const [form, setForm] = useState<TemplateFormState | null>(null);
    const [loading, setLoading] = useState(true);
    const [showAi, setShowAi] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const { updateTemplate } = useAlimtalkTemplateManage(senderKey);

    useEffect(() => {
        if (!senderKey || !templateCode) return;
        fetch(`/api/alimtalk/templates/${encodeURIComponent(templateCode)}?senderKey=${encodeURIComponent(senderKey)}`)
            .then((res) => res.json())
            .then((data) => {
                if (data.success && data.data) {
                    setForm(templateToFormState(data.data));
                }
                setLoading(false);
            })
            .catch(() => setLoading(false));
    }, [templateCode, senderKey]);

    const handleAiGenerated = (result: {
        templateName: string;
        templateContent: string;
        templateMessageType: string;
        buttons: NhnTemplateButton[];
    }) => {
        setForm((prev) => prev ? ({
            ...prev,
            templateName: result.templateName,
            templateContent: result.templateContent,
            templateMessageType: result.templateMessageType,
            buttons: result.buttons,
            interactionType: "buttons",
        }) : prev);
        setShowAi(false);
    };

    const handleSubmit = async () => {
        if (!form || !senderKey) return;
        setError(null);

        if (!form.templateName || !form.templateContent) {
            setError("템플릿 이름과 본문은 필수입니다.");
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
                ...(form.templateImageUrl && { templateImageName: form.templateImageName, templateImageUrl: form.templateImageUrl }),
                ...(form.templateItem && { templateItem: form.templateItem }),
                ...(form.templateItemHighlight && { templateItemHighlight: form.templateItemHighlight }),
                ...(form.templateRepresentLink && (form.templateRepresentLink.linkMo || form.templateRepresentLink.linkPc || form.templateRepresentLink.schemeIos || form.templateRepresentLink.schemeAndroid) && { templateRepresentLink: form.templateRepresentLink }),
            };

            const result = await updateTemplate(templateCode, payload);
            if (result.success) {
                router.push("/alimtalk?tab=templates");
            } else {
                setError(result.error || "수정에 실패했습니다.");
            }
        } catch {
            setError("요청 중 오류가 발생했습니다.");
        } finally {
            setSubmitting(false);
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center h-64">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
        );
    }

    if (!form || !senderKey) {
        return (
            <div className="flex items-center justify-center h-64 text-muted-foreground">
                템플릿을 찾을 수 없습니다.
            </div>
        );
    }

    return (
        <PageContainer>
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <Button variant="ghost" size="icon" onClick={() => router.push("/alimtalk?tab=templates")}>
                        <ArrowLeft className="h-4 w-4" />
                    </Button>
                    <h2 className="text-lg font-semibold">알림톡 템플릿 수정</h2>
                </div>
                <div className="flex items-center gap-2">
                    <Button
                        variant={showAi ? "default" : "outline"}
                        size="sm"
                        onClick={() => setShowAi(!showAi)}
                    >
                        <Sparkles className="h-4 w-4 mr-1" />
                        AI 생성
                    </Button>
                    <Button variant="outline" onClick={() => router.push("/alimtalk?tab=templates")} disabled={submitting}>
                        취소
                    </Button>
                    <Button onClick={handleSubmit} disabled={submitting}>
                        {submitting ? "수정 중..." : "수정"}
                    </Button>
                </div>
            </div>

            {showAi && <AiAlimtalkPanel onGenerated={handleAiGenerated} />}

            {error && <p className="text-sm text-destructive">{error}</p>}

            <div className="grid grid-cols-2 gap-6">
                <div className="overflow-y-auto max-h-[calc(100vh-200px)]">
                    <TemplateFormEditor value={form} onChange={setForm} mode="edit" />
                </div>
                <div className="overflow-y-auto max-h-[calc(100vh-200px)]">
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
                        templateImageUrl={form.templateImageUrl}
                        templateImageName={form.templateImageName}
                        templateItemHighlight={form.templateItemHighlight}
                        templateItem={form.templateItem}
                        templateRepresentLink={form.templateRepresentLink}
                    />
                </div>
            </div>
        </PageContainer>
    );
}

export default function EditAlimtalkTemplatePage() {
    return (
        <WorkspaceLayout>
            <Suspense fallback={<div className="flex items-center justify-center h-64"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>}>
                <EditAlimtalkTemplateContent />
            </Suspense>
        </WorkspaceLayout>
    );
}
