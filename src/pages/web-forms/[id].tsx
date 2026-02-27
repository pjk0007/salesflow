import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/router";
import WorkspaceLayout from "@/components/layouts/WorkspaceLayout";
import { useFields } from "@/hooks/useFields";
import { useWebForms } from "@/hooks/useWebForms";
import FormBuilder, { type FormFieldItem } from "@/components/web-forms/FormBuilder";
import FormPreview from "@/components/web-forms/FormPreview";
import EmbedCodeDialog from "@/components/web-forms/EmbedCodeDialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover";
import { toast } from "sonner";
import { ArrowLeft, Link2, Sparkles } from "lucide-react";

export default function EditWebFormPage() {
    const router = useRouter();
    const formId = Number(router.query.id);

    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [wsId, setWsId] = useState<number | null>(null);

    // 폼 빌더 상태
    const [formName, setFormName] = useState("");
    const [formTitle, setFormTitle] = useState("");
    const [formDescription, setFormDescription] = useState("");
    const [completionTitle, setCompletionTitle] = useState("");
    const [completionMessage, setCompletionMessage] = useState("");
    const [completionButtonText, setCompletionButtonText] = useState("");
    const [completionButtonUrl, setCompletionButtonUrl] = useState("");
    const [defaultValues, setDefaultValues] = useState<{ field: string; value: string }[]>([]);
    const [formFields, setFormFields] = useState<FormFieldItem[]>([]);
    const [slug, setSlug] = useState("");

    // 임베드 다이얼로그
    const [embedOpen, setEmbedOpen] = useState(false);

    // AI 생성
    const [aiOpen, setAiOpen] = useState(false);
    const [aiPrompt, setAiPrompt] = useState("");
    const [aiGenerating, setAiGenerating] = useState(false);

    const { fields: workspaceFields } = useFields(wsId);
    const { updateForm } = useWebForms(wsId);

    useEffect(() => {
        if (!formId) return;
        (async () => {
            try {
                const res = await fetch(`/api/web-forms/${formId}`);
                const json = await res.json();
                if (json.success) {
                    const form = json.data;
                    setWsId(form.workspaceId);
                    setFormName(form.name);
                    setFormTitle(form.title);
                    setFormDescription(form.description || "");
                    setCompletionTitle(form.completionTitle || "제출이 완료되었습니다");
                    setCompletionMessage(form.completionMessage || "");
                    setCompletionButtonText(form.completionButtonText || "");
                    setCompletionButtonUrl(form.completionButtonUrl || "");
                    setDefaultValues(form.defaultValues || []);
                    setSlug(form.slug);
                    setFormFields(
                        (form.fields || []).map((f: any) => ({
                            tempId: crypto.randomUUID(),
                            label: f.label,
                            description: f.description || "",
                            placeholder: f.placeholder || "",
                            fieldType: f.fieldType,
                            linkedFieldKey: f.linkedFieldKey || "",
                            isRequired: !!f.isRequired,
                            options: f.options || [],
                        }))
                    );
                } else {
                    toast.error("폼을 찾을 수 없습니다.");
                    router.push("/web-forms");
                }
            } catch {
                toast.error("폼 데이터를 불러올 수 없습니다.");
                router.push("/web-forms");
            }
            setLoading(false);
        })();
    }, [formId]);

    const handleSave = useCallback(async () => {
        if (!formId) return;
        setSaving(true);
        const result = await updateForm(formId, {
            name: formName,
            title: formTitle,
            description: formDescription,
            completionTitle,
            completionMessage,
            completionButtonText,
            completionButtonUrl,
            defaultValues,
            fields: formFields.map((f) => ({
                label: f.label,
                description: f.description,
                placeholder: f.placeholder,
                fieldType: f.fieldType,
                linkedFieldKey: f.linkedFieldKey,
                isRequired: f.isRequired,
                options: f.options,
            })),
        });
        if (result.success) {
            toast.success("폼이 저장되었습니다.");
        } else {
            toast.error(result.error || "저장에 실패했습니다.");
        }
        setSaving(false);
    }, [
        formId, formName, formTitle, formDescription,
        completionTitle, completionMessage, completionButtonText, completionButtonUrl,
        defaultValues, formFields, updateForm,
    ]);

    const handleAiGenerate = useCallback(async () => {
        if (!aiPrompt.trim()) return;
        if (formFields.length > 0) {
            if (!confirm("기존 필드가 AI 생성 결과로 대체됩니다. 계속하시겠습니까?")) return;
        }
        setAiGenerating(true);
        try {
            const res = await fetch("/api/ai/generate-webform", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    prompt: aiPrompt.trim(),
                    workspaceFields: workspaceFields.map((f) => ({ key: f.key, label: f.label })),
                }),
            });
            const json = await res.json();
            if (json.success) {
                const data = json.data;
                if (data.name) setFormName(data.name);
                setFormTitle(data.title);
                setFormDescription(data.description);
                setFormFields(
                    data.fields.map((f: any) => ({
                        tempId: crypto.randomUUID(),
                        label: f.label,
                        description: f.description || "",
                        placeholder: f.placeholder || "",
                        fieldType: f.fieldType,
                        linkedFieldKey: f.linkedFieldKey || "",
                        isRequired: !!f.isRequired,
                        options: f.options || [],
                    }))
                );
                toast.success(`${data.fields.length}개 필드가 생성되었습니다.`);
                setAiOpen(false);
                setAiPrompt("");
            } else {
                toast.error(json.error || "AI 생성에 실패했습니다.");
            }
        } catch {
            toast.error("AI 생성 중 오류가 발생했습니다.");
        }
        setAiGenerating(false);
    }, [aiPrompt, formFields.length, workspaceFields]);

    if (loading) {
        return (
            <WorkspaceLayout>
                <div className="flex items-center justify-center h-[60vh]">
                    <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-primary" />
                </div>
            </WorkspaceLayout>
        );
    }

    return (
        <WorkspaceLayout>
            <div className="flex flex-col h-[calc(100vh-64px)]">
                {/* 헤더 */}
                <div className="border-b px-6 py-3 flex items-center justify-between shrink-0">
                    <div className="flex items-center gap-3">
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => router.push("/web-forms")}
                        >
                            <ArrowLeft className="h-4 w-4 mr-1" /> 목록
                        </Button>
                        <span className="text-lg font-semibold">
                            {formName || "새 폼"}
                        </span>
                    </div>
                    <div className="flex items-center gap-2">
                        <Popover open={aiOpen} onOpenChange={setAiOpen}>
                            <PopoverTrigger asChild>
                                <Button variant="outline" size="sm">
                                    <Sparkles className="h-4 w-4 mr-1" /> AI 생성
                                </Button>
                            </PopoverTrigger>
                            <PopoverContent align="end" className="w-80">
                                <div className="space-y-3">
                                    <p className="text-sm font-medium">AI로 폼 필드 생성</p>
                                    <Textarea
                                        value={aiPrompt}
                                        onChange={(e) => setAiPrompt(e.target.value)}
                                        placeholder="예: B2B SaaS 무료 체험 신청 폼"
                                        rows={3}
                                    />
                                    <Button
                                        className="w-full"
                                        onClick={handleAiGenerate}
                                        disabled={!aiPrompt.trim() || aiGenerating}
                                    >
                                        {aiGenerating ? "생성 중..." : "생성"}
                                    </Button>
                                </div>
                            </PopoverContent>
                        </Popover>
                        {slug && (
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setEmbedOpen(true)}
                            >
                                <Link2 className="h-4 w-4 mr-1" /> 임베드
                            </Button>
                        )}
                        <Button onClick={handleSave} disabled={saving}>
                            {saving ? "저장 중..." : "저장"}
                        </Button>
                    </div>
                </div>

                {/* 본문 */}
                <div className="flex flex-1 overflow-hidden">
                    <div className="flex-1 overflow-y-auto p-6">
                        <FormBuilder
                            name={formName}
                            onNameChange={setFormName}
                            title={formTitle}
                            onTitleChange={setFormTitle}
                            description={formDescription}
                            onDescriptionChange={setFormDescription}
                            completionTitle={completionTitle}
                            onCompletionTitleChange={setCompletionTitle}
                            completionMessage={completionMessage}
                            onCompletionMessageChange={setCompletionMessage}
                            completionButtonText={completionButtonText}
                            onCompletionButtonTextChange={setCompletionButtonText}
                            completionButtonUrl={completionButtonUrl}
                            onCompletionButtonUrlChange={setCompletionButtonUrl}
                            defaultValues={defaultValues}
                            onDefaultValuesChange={setDefaultValues}
                            fields={formFields}
                            onFieldsChange={setFormFields}
                            workspaceFields={workspaceFields}
                            slug={slug}
                        />
                    </div>
                    <div className="w-[400px] border-l p-6 overflow-y-auto">
                        <h3 className="text-sm font-medium mb-3">미리보기</h3>
                        <FormPreview
                            title={formTitle}
                            description={formDescription}
                            fields={formFields}
                        />
                    </div>
                </div>
            </div>

            {slug && (
                <EmbedCodeDialog
                    open={embedOpen}
                    onOpenChange={setEmbedOpen}
                    slug={slug}
                />
            )}
        </WorkspaceLayout>
    );
}
