"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import WorkspaceLayout from "@/components/layouts/WorkspaceLayout";
import TemplateFormEditor, { type TemplateFormState } from "@/components/alimtalk/TemplateFormEditor";
import TemplatePreview from "@/components/alimtalk/TemplatePreview";
import AiAlimtalkPanel from "@/components/alimtalk/AiAlimtalkPanel";
import { useAlimtalkSenders } from "@/hooks/useAlimtalkSenders";
import { useAlimtalkTemplateManage } from "@/hooks/useAlimtalkTemplateManage";
import { Button } from "@/components/ui/button";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { PageContainer } from "@/components/common/page-container";
import { ArrowLeft, Sparkles, Loader2 } from "lucide-react";
import type { NhnTemplateButton } from "@/lib/nhn-alimtalk";

const DEFAULT_FORM: TemplateFormState = {
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
    templateImageName: "",
    templateImageUrl: "",
    templateItem: null,
    templateItemHighlight: null,
    templateRepresentLink: null,
};

function NewAlimtalkTemplateContent() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const senderKeyParam = searchParams.get("senderKey");
    const cloneFrom = searchParams.get("cloneFrom");
    const { senders } = useAlimtalkSenders();
    const [selectedSenderKey, setSelectedSenderKey] = useState<string | null>(senderKeyParam);
    const senderKey = selectedSenderKey;
    const [form, setForm] = useState<TemplateFormState>(DEFAULT_FORM);
    const [showAi, setShowAi] = useState(false);

    // 복제 시 원본 템플릿 데이터 로드
    useEffect(() => {
        if (!cloneFrom || !senderKey) return;
        fetch(`/api/alimtalk/templates/${encodeURIComponent(cloneFrom)}?senderKey=${encodeURIComponent(senderKey)}`)
            .then((res) => res.json())
            .then((result) => {
                if (!result.success || !result.data) return;
                const tpl = result.data;
                setForm({
                    ...DEFAULT_FORM,
                    templateCode: `${tpl.templateCode}_copy`,
                    templateName: `${tpl.templateName} (복사본)`,
                    templateContent: tpl.templateContent ?? "",
                    templateMessageType: tpl.templateMessageType ?? "BA",
                    templateEmphasizeType: tpl.templateEmphasizeType ?? "NONE",
                    templateExtra: tpl.templateExtra ?? "",
                    templateTitle: tpl.templateTitle ?? "",
                    templateSubtitle: tpl.templateSubtitle ?? "",
                    templateHeader: tpl.templateHeader ?? "",
                    securityFlag: !!tpl.securityFlag,
                    categoryCode: tpl.categoryCode ?? "",
                    buttons: tpl.buttons ?? [],
                    quickReplies: tpl.quickReplies ?? [],
                    interactionType: tpl.quickReplies?.length ? "quickReplies" : "buttons",
                    templateImageName: tpl.templateImageName ?? "",
                    templateImageUrl: tpl.templateImageUrl ?? "",
                    templateItem: tpl.templateItem ?? null,
                    templateItemHighlight: tpl.templateItemHighlight ?? null,
                    templateRepresentLink: tpl.templateRepresentLink ?? null,
                });
            });
    }, [cloneFrom, senderKey]);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const { createTemplate } = useAlimtalkTemplateManage(senderKey);

    const handleAiGenerated = (result: {
        templateName: string;
        templateContent: string;
        templateMessageType: string;
        buttons: NhnTemplateButton[];
    }) => {
        setForm((prev) => ({
            ...prev,
            templateName: result.templateName,
            templateContent: result.templateContent,
            templateMessageType: result.templateMessageType,
            buttons: result.buttons,
            interactionType: "buttons",
        }));
        setShowAi(false);
    };

    const handleSubmit = async () => {
        setError(null);
        if (!form.templateCode || !form.templateName || !form.templateContent) {
            setError("템플릿 코드, 이름, 본문은 필수입니다.");
            return;
        }
        if (!senderKey) {
            setError("발신프로필 정보가 없습니다.");
            return;
        }

        setSubmitting(true);
        try {
            const payload = {
                senderKey,
                templateCode: form.templateCode,
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

            const result = await createTemplate(payload);
            if (result.success) {
                router.push("/alimtalk?tab=templates");
            } else {
                setError(result.error || "등록에 실패했습니다.");
            }
        } catch {
            setError("요청 중 오류가 발생했습니다.");
        } finally {
            setSubmitting(false);
        }
    };

    if (!senderKey) {
        return (
            <PageContainer>
                <div className="flex items-center gap-3 mb-6">
                    <Button variant="ghost" size="icon" onClick={() => router.push("/alimtalk?tab=templates")}>
                        <ArrowLeft className="h-4 w-4" />
                    </Button>
                    <h2 className="text-lg font-semibold">알림톡 템플릿 등록</h2>
                </div>
                <div className="flex flex-col items-center justify-center p-12 border rounded-lg border-dashed gap-4">
                    <p className="text-muted-foreground">템플릿을 등록할 발신프로필을 선택하세요.</p>
                    <Select onValueChange={setSelectedSenderKey}>
                        <SelectTrigger className="w-[300px]">
                            <SelectValue placeholder="발신프로필 선택" />
                        </SelectTrigger>
                        <SelectContent>
                            {senders.map((s) => (
                                <SelectItem key={s.senderKey} value={s.senderKey}>
                                    {s.plusFriendId} ({s.senderKey.slice(0, 8)}...)
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
            </PageContainer>
        );
    }

    return (
        <PageContainer>
            {/* 상단 헤더 */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <Button variant="ghost" size="icon" onClick={() => router.push("/alimtalk?tab=templates")}>
                        <ArrowLeft className="h-4 w-4" />
                    </Button>
                    <h2 className="text-lg font-semibold">알림톡 템플릿 등록</h2>
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
                        {submitting ? "등록 중..." : "등록"}
                    </Button>
                </div>
            </div>

            {/* AI 패널 */}
            {showAi && <AiAlimtalkPanel onGenerated={handleAiGenerated} />}

            {error && <p className="text-sm text-destructive">{error}</p>}

            {/* 2-column: 폼 + 미리보기 */}
            <div className="grid grid-cols-2 gap-6">
                <div className="overflow-y-auto max-h-[calc(100vh-200px)]">
                    <TemplateFormEditor value={form} onChange={setForm} mode="create" />
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

export default function NewAlimtalkTemplatePage() {
    return (
        <WorkspaceLayout>
            <Suspense fallback={<div className="flex items-center justify-center h-64"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>}>
                <NewAlimtalkTemplateContent />
            </Suspense>
        </WorkspaceLayout>
    );
}
