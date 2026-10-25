"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter, useParams } from "next/navigation";
import WorkspaceLayout from "@/components/layouts/WorkspaceLayout";
import { useResolvedFields } from "@/hooks/useResolvedFields";
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
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { AI_MODELS, DEFAULT_MODEL_ID } from "@/lib/ai/models";
import { useAsyncConfirm } from "@/components/ui/alert-dialog";
import { unlinkedFields, webFormEditorSnapshot, type WebFormEditorValues } from "@/components/web-forms/utils/editor-snapshot";

export default function EditWebFormPage() {
    const { confirm, confirmationDialog } = useAsyncConfirm();
    const router = useRouter();
    const params = useParams();
    const formId = Number(params.id);

    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const savingRef = useRef(false);
    const [wsId, setWsId] = useState<number | null>(null);
    const [partitionId, setPartitionId] = useState<number | null>(null);

    // 폼 빌더 상태
    const [formName, setFormName] = useState("");
    const [formTitle, setFormTitle] = useState("");
    const [formDescription, setFormDescription] = useState("");
    const [completionTitle, setCompletionTitle] = useState("");
    const [completionMessage, setCompletionMessage] = useState("");
    const [completionButtonText, setCompletionButtonText] = useState("");
    const [completionButtonUrl, setCompletionButtonUrl] = useState("");
    const [coverImageUrl, setCoverImageUrl] = useState("");
    const [coverColor, setCoverColor] = useState("");
    const [defaultValues, setDefaultValues] = useState<{ field: string; value: string }[]>([]);
    const [formFields, setFormFields] = useState<FormFieldItem[]>([]);
    const [slug, setSlug] = useState("");
    // 마지막으로 불러오거나 저장한 내용 — 현재 값과 다르면 미저장 변경이 있다 (UX-048)
    const [savedSnapshot, setSavedSnapshot] = useState<string | null>(null);

    // 임베드 다이얼로그
    const [embedOpen, setEmbedOpen] = useState(false);

    // AI 생성
    const [aiOpen, setAiOpen] = useState(false);
    const [aiPrompt, setAiPrompt] = useState("");
    const [aiModel, setAiModel] = useState(DEFAULT_MODEL_ID);
    const [aiGenerating, setAiGenerating] = useState(false);

    const { fields: workspaceFields } = useResolvedFields(partitionId);
    const { updateForm } = useWebForms(wsId);

    useEffect(() => {
        if (!formId) return;
        (async () => {
            try {
                const res = await fetch(`/api/web-forms/${formId}`);
                const json = await res.json();
                if (json.success) {
                    const form = json.data;
                    const loaded: WebFormEditorValues = {
                        name: form.name,
                        title: form.title,
                        description: form.description || "",
                        completionTitle: form.completionTitle || "제출이 완료되었습니다",
                        completionMessage: form.completionMessage || "",
                        completionButtonText: form.completionButtonText || "",
                        completionButtonUrl: form.completionButtonUrl || "",
                        coverImageUrl: form.coverImageUrl || "",
                        coverColor: form.coverColor || "",
                        defaultValues: form.defaultValues || [],
                        fields: (form.fields || []).map((f: any) => ({
                            tempId: crypto.randomUUID(),
                            id: f.id,
                            label: f.label,
                            description: f.description || "",
                            placeholder: f.placeholder || "",
                            fieldType: f.fieldType,
                            linkedFieldKey: f.linkedFieldKey || "",
                            isRequired: !!f.isRequired,
                            options: f.options || [],
                        })),
                    };
                    setWsId(form.workspaceId);
                    setPartitionId(form.partitionId);
                    setFormName(loaded.name);
                    setFormTitle(loaded.title);
                    setFormDescription(loaded.description);
                    setCompletionTitle(loaded.completionTitle);
                    setCompletionMessage(loaded.completionMessage);
                    setCompletionButtonText(loaded.completionButtonText);
                    setCompletionButtonUrl(loaded.completionButtonUrl);
                    setCoverImageUrl(loaded.coverImageUrl);
                    setCoverColor(loaded.coverColor);
                    setDefaultValues(loaded.defaultValues);
                    setSlug(form.slug);
                    setFormFields(loaded.fields);
                    setSavedSnapshot(webFormEditorSnapshot(loaded));
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

    const editorValues: WebFormEditorValues = {
        name: formName, title: formTitle, description: formDescription,
        completionTitle, completionMessage, completionButtonText, completionButtonUrl,
        coverImageUrl, coverColor, defaultValues, fields: formFields,
    };
    const currentSnapshot = webFormEditorSnapshot(editorValues);
    const dirty = savedSnapshot !== null && currentSnapshot !== savedSnapshot;

    // 저장하지 않은 채 새로고침·탭 닫기를 하면 브라우저 확인을 띄운다 (UX-048)
    useEffect(() => {
        if (!dirty) return;
        const warn = (e: BeforeUnloadEvent) => {
            e.preventDefault();
            e.returnValue = "";
        };
        window.addEventListener("beforeunload", warn);
        return () => window.removeEventListener("beforeunload", warn);
    }, [dirty]);

    /** 저장 — 실패하면 한국어 안내를 던지고 입력 내용은 그대로 둔다 */
    const persist = useCallback(async () => {
        if (!formId || savingRef.current) return;
        savingRef.current = true;
        setSaving(true);
        const sentSnapshot = currentSnapshot;
        try {
            let result;
            try {
                result = await updateForm(formId, {
                    name: formName,
                    title: formTitle,
                    description: formDescription,
                    completionTitle,
                    completionMessage,
                    completionButtonText,
                    completionButtonUrl,
                    coverImageUrl,
                    coverColor,
                    defaultValues,
                    fields: formFields.map((f) => ({
                        id: f.id,
                        label: f.label,
                        description: f.description,
                        placeholder: f.placeholder,
                        fieldType: f.fieldType,
                        linkedFieldKey: f.linkedFieldKey,
                        isRequired: f.isRequired,
                        options: f.options,
                    })),
                });
            } catch {
                throw new Error("폼 저장에 실패했습니다. 입력 내용은 유지됩니다. 다시 시도해주세요.");
            }
            if (!result.success) throw new Error(result.error || "저장에 실패했습니다.");
            const ids = new Map(formFields.map((f, i) => [f.tempId, result.data.fields[i]?.id as number | undefined]));
            setFormFields((current) => current.map((f) => ({ ...f, id: ids.get(f.tempId) ?? f.id })));
            setSavedSnapshot(sentSnapshot);
            toast.success("폼이 저장되었습니다.");
        } finally {
            savingRef.current = false;
            setSaving(false);
        }
    }, [
        formId, formName, formTitle, formDescription,
        completionTitle, completionMessage, completionButtonText, completionButtonUrl,
        coverImageUrl, coverColor, defaultValues, formFields, updateForm, currentSnapshot,
    ]);

    const handleSave = useCallback(async () => {
        // 연결 속성이 없는 질문의 답은 레코드에 저장되지 않으므로 저장 전에 알린다 (UX-045)
        const unlinked = unlinkedFields(formFields);
        if (unlinked.length > 0) {
            const names = unlinked.map((f) => `"${f.label || "이름 없는 질문"}"`).join(", ");
            confirm({
                title: "연결 속성이 없는 질문",
                description: `${names} 질문은 연결 속성이 없어 방문자가 입력한 답이 레코드에 저장되지 않습니다.\n그래도 저장할까요?`,
                confirmLabel: "그대로 저장",
                onConfirm: persist,
            });
            return;
        }
        try {
            await persist();
        } catch (cause) {
            toast.error(cause instanceof Error ? cause.message : "저장에 실패했습니다.");
        }
    }, [formFields, confirm, persist]);

    const leaveToList = useCallback(() => {
        if (!dirty) {
            router.push("/web-forms");
            return;
        }
        confirm({
            title: "저장하지 않은 변경",
            description: "저장하지 않은 변경 내용(AI로 바꾼 질문 포함)이 사라집니다. 목록으로 나갈까요?",
            confirmLabel: "나가기",
            onConfirm: async () => { router.push("/web-forms"); },
        });
    }, [dirty, confirm, router]);

    const handleAiGenerate = useCallback(async () => {
        if (!aiPrompt.trim()) return;
        const generate = async () => {
            setAiGenerating(true);
            try {
                let json;
                try {
                    const res = await fetch("/api/ai/generate-webform", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            prompt: aiPrompt.trim(),
                            workspaceFields: workspaceFields.map((f) => ({ key: f.key, label: f.label })),
                            model: aiModel,
                        }),
                    });
                    json = await res.json();
                } catch {
                    // 연결·응답 해석 실패만 고정 문구로 바꾸고, 서버 안내는 아래에서 그대로 보여준다
                    throw new Error("AI 생성 중 오류가 발생했습니다.");
                }
                if (!json.success) throw new Error(json.error || "AI 생성에 실패했습니다.");
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
            } finally {
                setAiGenerating(false);
            }
        };
        if (formFields.length > 0) {
            confirm({
                title: "웹 폼 필드 교체",
                confirmLabel: "생성",
                description: "기존 필드가 AI 생성 결과로 대체됩니다. 계속하시겠습니까?",
                onConfirm: generate,
            });
        } else {
            try { await generate(); }
            catch (cause) { toast.error(cause instanceof Error && /[가-힣]/.test(cause.message) ? cause.message : "AI 생성 중 오류가 발생했습니다."); }
        }
    }, [aiPrompt, aiModel, formFields.length, workspaceFields, confirm]);

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
            {confirmationDialog}
            <div className="flex flex-col h-[calc(100vh-64px)]">
                {/* 헤더 */}
                {/* 좁은 화면에서는 제목과 작업 버튼을 두 줄로 나누고 버튼은 줄바꿈한다 (UX-294) */}
                <div className="border-b px-4 sm:px-6 py-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between shrink-0">
                    <div className="flex min-w-0 items-center gap-3">
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={leaveToList}
                        >
                            <ArrowLeft className="h-4 w-4 mr-1" /> 목록
                        </Button>
                        <span className="min-w-0 truncate text-lg font-semibold" title={formName || "새 폼"}>
                            {formName || "새 폼"}
                        </span>
                        {dirty && <span className="shrink-0 text-xs text-muted-foreground">저장 안 됨</span>}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
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
                                    <Select value={aiModel} onValueChange={setAiModel}>
                                        <SelectTrigger>
                                            <SelectValue placeholder="AI 모델 선택" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {AI_MODELS.map((m) => (
                                                <SelectItem key={m.id} value={m.id}>
                                                    {m.label}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
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
                {/* 넓은 화면: 편집기·미리보기 나란히, 좁은 화면: 같은 인스턴스를 위아래로 쌓고 함께 스크롤 (UX-294) */}
                <div className="flex flex-1 flex-col overflow-y-auto lg:flex-row lg:overflow-hidden">
                    <div className="min-w-0 flex-1 p-4 sm:p-6 lg:overflow-y-auto">
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
                            coverImageUrl={coverImageUrl}
                            onCoverImageUrlChange={setCoverImageUrl}
                            coverColor={coverColor}
                            onCoverColorChange={setCoverColor}
                            defaultValues={defaultValues}
                            onDefaultValuesChange={setDefaultValues}
                            fields={formFields}
                            onFieldsChange={setFormFields}
                            workspaceFields={workspaceFields}
                            slug={slug}
                        />
                    </div>
                    <div className="w-full border-t p-4 sm:p-6 lg:w-[400px] lg:shrink-0 lg:border-l lg:border-t-0 lg:overflow-y-auto">
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
