import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Loader2, Sparkles, Code, Eye, ArrowLeft, Save } from "lucide-react";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { extractEmailVariables } from "@/lib/email-utils";
import { useAiConfig } from "@/hooks/useAiConfig";
import { useEmailCategories } from "@/hooks/useEmailCategories";
import AiEmailPanel from "@/components/email/AiEmailPanel";
import { toast } from "sonner";
import type { EmailTemplate } from "@/lib/db";

interface SaveData {
    name: string;
    subject: string;
    htmlBody: string;
    templateType?: string;
    status?: "draft" | "published";
    categoryId?: number | null;
}

interface SaveResult {
    success: boolean;
    data?: EmailTemplate;
    error?: string;
}

interface EmailTemplateEditorProps {
    template: EmailTemplate | null;
    onSave: (data: SaveData) => Promise<SaveResult>;
    onCancel: () => void;
}

export default function EmailTemplateEditor({ template, onSave, onCancel }: EmailTemplateEditorProps) {
    const [name, setName] = useState("");
    const [subject, setSubject] = useState("");
    const [htmlBody, setHtmlBody] = useState("");
    const [templateType, setTemplateType] = useState("");
    const [categoryId, setCategoryId] = useState<number | null>(null);
    const [saving, setSaving] = useState(false);
    const [showAiPanel, setShowAiPanel] = useState(false);
    const [editMode, setEditMode] = useState<"visual" | "code">("visual");
    const editorRef = useRef<HTMLDivElement>(null);
    const iframeRef = useRef<HTMLIFrameElement>(null);
    const { config: aiConfig } = useAiConfig();
    const { categories } = useEmailCategories();
    const initialized = useRef(false);

    // Auto-save state
    const [autoSaveStatus, setAutoSaveStatus] = useState<"idle" | "saving" | "saved" | "unsaved">("idle");
    const lastSavedRef = useRef<{ name: string; subject: string; htmlBody: string } | null>(null);
    const autoSaveTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const savingRef = useRef(false);

    // 초기화 (한 번만)
    useEffect(() => {
        if (initialized.current) return;
        initialized.current = true;
        if (template) {
            setName(template.name);
            setSubject(template.subject);
            setHtmlBody(template.htmlBody);
            setTemplateType(template.templateType || "");
            setCategoryId(template.categoryId ?? null);
            lastSavedRef.current = { name: template.name, subject: template.subject, htmlBody: template.htmlBody };
        }
    }, [template]);

    // contenteditable 초기 로드
    useEffect(() => {
        if (editMode === "visual" && editorRef.current && htmlBody && !editorRef.current.innerHTML) {
            editorRef.current.innerHTML = htmlBody;
        }
    }, [editMode, htmlBody]);

    const variables = extractEmailVariables(subject + " " + htmlBody);

    // contenteditable → state 동기화
    const handleVisualInput = useCallback(() => {
        if (editorRef.current) {
            setHtmlBody(editorRef.current.innerHTML);
        }
    }, []);

    // 모드 전환
    const handleModeChange = useCallback((mode: "visual" | "code") => {
        if (mode === "visual" && editorRef.current) {
            editorRef.current.innerHTML = htmlBody;
        } else if (mode === "code" && editorRef.current) {
            setHtmlBody(editorRef.current.innerHTML);
        }
        setEditMode(mode);
    }, [htmlBody]);

    // AI 스트리밍 상태
    const [isStreaming, setIsStreaming] = useState(false);
    const [streamingHtml, setStreamingHtml] = useState("");

    // AI 스트리밍 중간 결과 — subject와 htmlBody를 실시간 파싱
    const handleAiStream = useCallback((fullText: string) => {
        setIsStreaming(true);

        // subject 추출 (완성된 값만)
        const subjectMatch = fullText.match(/"subject"\s*:\s*"((?:[^"\\]|\\.)*)"/);
        if (subjectMatch) {
            setSubject(subjectMatch[1].replace(/\\n/g, "\n").replace(/\\"/g, '"'));
        }

        // htmlBody 스트리밍 추출 — 시작 위치 이후 모든 내용
        const bodyMarker = fullText.match(/"htmlBody"\s*:\s*"/);
        if (bodyMarker && bodyMarker.index !== undefined) {
            const valueStart = bodyMarker.index + bodyMarker[0].length;
            let html = "";
            let i = valueStart;
            while (i < fullText.length) {
                if (fullText[i] === "\\" && i + 1 < fullText.length) {
                    const next = fullText[i + 1];
                    if (next === "n") { html += "\n"; i += 2; continue; }
                    if (next === "t") { html += "\t"; i += 2; continue; }
                    if (next === '"') { html += '"'; i += 2; continue; }
                    if (next === "\\") { html += "\\"; i += 2; continue; }
                    html += next; i += 2; continue;
                }
                if (fullText[i] === '"') break; // 정상 종료
                html += fullText[i];
                i++;
            }
            setStreamingHtml(html);
        }
    }, []);

    // AI 생성 최종 결과 반영
    const handleAiGenerated = useCallback((result: { subject: string; htmlBody: string }) => {
        setIsStreaming(false);
        setStreamingHtml("");
        setSubject(result.subject);
        setHtmlBody(result.htmlBody);
        if (editorRef.current && editMode === "visual") {
            editorRef.current.innerHTML = result.htmlBody;
        }
    }, [editMode]);

    // 미리보기 — iframe contentDocument에 직접 주입 (스크롤 유지)
    const previewBodyHtml = useMemo(() => {
        const displayHtml = isStreaming && streamingHtml ? streamingHtml : htmlBody;
        return displayHtml.replace(
            /##(\w+)##/g,
            '<span style="background:#fef3c7;padding:0 4px;border-radius:2px;color:#92400e">[$1]</span>'
        );
    }, [htmlBody, isStreaming, streamingHtml]);

    // iframe 초기화 (한 번만)
    const iframeInitialized = useRef(false);
    useEffect(() => {
        const iframe = iframeRef.current;
        if (!iframe) return;
        const initIframe = () => {
            const doc = iframe.contentDocument;
            if (!doc || iframeInitialized.current) return;
            iframeInitialized.current = true;
            doc.open();
            doc.write(`<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;padding:16px;margin:0;color:#333;line-height:1.6}</style>
</head><body></body></html>`);
            doc.close();
        };
        if (iframe.contentDocument?.readyState === "complete") {
            initIframe();
        } else {
            iframe.addEventListener("load", initIframe, { once: true });
        }
    }, []);

    // body 내용만 업데이트 (스크롤 유지)
    useEffect(() => {
        const doc = iframeRef.current?.contentDocument;
        if (!doc?.body) return;
        doc.body.innerHTML = previewBodyHtml;
    }, [previewBodyHtml]);

    // Dirty 체크
    const isDirty = useCallback(() => {
        const saved = lastSavedRef.current;
        if (!saved) return !!(name || subject || htmlBody);
        return name !== saved.name || subject !== saved.subject || htmlBody !== saved.htmlBody;
    }, [name, subject, htmlBody]);

    // 변경 감지 → unsaved 표시
    useEffect(() => {
        if (initialized.current && isDirty() && autoSaveStatus !== "saving") {
            setAutoSaveStatus("unsaved");
        }
    }, [name, subject, htmlBody, isDirty, autoSaveStatus]);

    // 30초 자동저장
    useEffect(() => {
        autoSaveTimerRef.current = setInterval(async () => {
            if (!isDirty() || savingRef.current) return;
            if (!name && !subject && !htmlBody) return;

            savingRef.current = true;
            setAutoSaveStatus("saving");
            try {
                const result = await onSave({
                    name: name || "(제목 없음)",
                    subject: subject || "",
                    htmlBody: htmlBody || "",
                    templateType: templateType || undefined,
                    status: "draft",
                    categoryId,
                });
                if (result.success) {
                    lastSavedRef.current = { name, subject, htmlBody };
                    setAutoSaveStatus("saved");
                }
            } catch {
                setAutoSaveStatus("unsaved");
            } finally {
                savingRef.current = false;
            }
        }, 30000);

        return () => {
            if (autoSaveTimerRef.current) clearInterval(autoSaveTimerRef.current);
        };
    }, [name, subject, htmlBody, templateType, categoryId, isDirty, onSave]);

    // 임시저장 (수동)
    const handleSaveDraft = async () => {
        if (!name && !subject && !htmlBody) return;
        setSaving(true);
        savingRef.current = true;
        try {
            const result = await onSave({
                name: name || "(제목 없음)",
                subject: subject || "",
                htmlBody: htmlBody || "",
                templateType: templateType || undefined,
                status: "draft",
                categoryId,
            });
            if (result.success) {
                lastSavedRef.current = { name, subject, htmlBody };
                setAutoSaveStatus("saved");
                toast.success("임시저장되었습니다.");
            } else {
                toast.error(result.error || "저장에 실패했습니다.");
            }
        } finally {
            setSaving(false);
            savingRef.current = false;
        }
    };

    // 발행
    const handlePublish = async () => {
        if (!name || !subject || !htmlBody) return;
        setSaving(true);
        savingRef.current = true;
        try {
            const result = await onSave({
                name,
                subject,
                htmlBody,
                templateType: templateType || undefined,
                status: "published",
                categoryId,
            });
            if (!result.success) {
                toast.error(result.error || "발행에 실패했습니다.");
            }
        } finally {
            setSaving(false);
            savingRef.current = false;
        }
    };

    return (
        <div className="flex flex-col h-[calc(100vh-theme(spacing.14))]">
            {/* Header */}
            <div className="flex items-center justify-between px-6 h-14 border-b shrink-0">
                <div className="flex items-center gap-3">
                    <Button variant="ghost" size="icon" onClick={onCancel}>
                        <ArrowLeft className="h-4 w-4" />
                    </Button>
                    <h2 className="text-lg font-semibold">
                        {template ? "템플릿 편집" : "새 템플릿"}
                    </h2>
                    {template?.status === "draft" && (
                        <Badge variant="outline" className="text-amber-600 border-amber-300">임시저장</Badge>
                    )}
                </div>
                <div className="flex items-center gap-2">
                    {/* 자동저장 상태 */}
                    {autoSaveStatus === "saving" && (
                        <span className="text-xs text-muted-foreground flex items-center gap-1">
                            <Loader2 className="h-3 w-3 animate-spin" />
                            저장 중...
                        </span>
                    )}
                    {autoSaveStatus === "saved" && (
                        <span className="text-xs text-green-600">임시저장됨</span>
                    )}
                    {autoSaveStatus === "unsaved" && (
                        <span className="text-xs text-amber-600">변경사항 있음</span>
                    )}

                    {aiConfig && (
                        <Button
                            variant={showAiPanel ? "default" : "outline"}
                            size="sm"
                            onClick={() => setShowAiPanel(!showAiPanel)}
                        >
                            <Sparkles className="h-4 w-4 mr-1" />
                            AI
                        </Button>
                    )}
                    <Button variant="outline" size="sm" onClick={onCancel}>
                        취소
                    </Button>
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={handleSaveDraft}
                        disabled={saving || (!name && !subject && !htmlBody)}
                    >
                        {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                        <Save className="h-4 w-4 mr-1" />
                        임시저장
                    </Button>
                    <Button
                        size="sm"
                        onClick={handlePublish}
                        disabled={saving || !name || !subject || !htmlBody}
                    >
                        {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                        {template?.status === "draft" ? "발행" : template ? "수정" : "발행"}
                    </Button>
                </div>
            </div>

            {/* Body */}
            <div className="flex flex-1 min-h-0">
                {/* 좌측 패널 */}
                <div className="w-1/2 flex flex-col border-r min-h-0">
                    {/* 메타 정보 */}
                    <div className="shrink-0 p-4 space-y-3 border-b">
                        <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1">
                                <Label htmlFor="tmpl-name" className="text-xs">이름</Label>
                                <Input
                                    id="tmpl-name"
                                    value={name}
                                    onChange={(e) => setName(e.target.value)}
                                    placeholder="환영 이메일"
                                    className="h-8 text-sm"
                                />
                            </div>
                            <div className="space-y-1">
                                <Label className="text-xs">카테고리 (선택)</Label>
                                <Select
                                    value={categoryId ? String(categoryId) : "none"}
                                    onValueChange={(v) => setCategoryId(v === "none" ? null : Number(v))}
                                >
                                    <SelectTrigger className="h-8 text-sm">
                                        <SelectValue placeholder="미분류" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="none">미분류</SelectItem>
                                        {categories.map((cat) => (
                                            <SelectItem key={cat.categoryId} value={String(cat.categoryId)}>
                                                {cat.categoryName}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>
                        <div className="space-y-1">
                            <Label htmlFor="tmpl-subject" className="text-xs">제목</Label>
                            <Input
                                id="tmpl-subject"
                                value={subject}
                                onChange={(e) => setSubject(e.target.value)}
                                placeholder="##name##님, 환영합니다!"
                                className="h-8 text-sm"
                            />
                        </div>
                    </div>

                    {/* AI 패널 (접이식) */}
                    {showAiPanel && (
                        <div className="shrink-0 p-4 border-b">
                            <AiEmailPanel onGenerated={handleAiGenerated} onStream={handleAiStream} />
                        </div>
                    )}

                    {/* 편집 모드 탭 */}
                    <div className="shrink-0 flex items-center gap-1 px-4 py-2 border-b bg-muted/30">
                        <button
                            type="button"
                            onClick={() => handleModeChange("visual")}
                            className={`inline-flex items-center gap-1 px-3 py-1.5 text-sm rounded-md transition-colors ${
                                editMode === "visual"
                                    ? "bg-background shadow-sm font-medium"
                                    : "text-muted-foreground hover:text-foreground"
                            }`}
                        >
                            <Eye className="h-3.5 w-3.5" />
                            비주얼
                        </button>
                        <button
                            type="button"
                            onClick={() => handleModeChange("code")}
                            className={`inline-flex items-center gap-1 px-3 py-1.5 text-sm rounded-md transition-colors ${
                                editMode === "code"
                                    ? "bg-background shadow-sm font-medium"
                                    : "text-muted-foreground hover:text-foreground"
                            }`}
                        >
                            <Code className="h-3.5 w-3.5" />
                            코드
                        </button>
                    </div>

                    {/* 편집 영역 */}
                    <div className="flex-1 overflow-auto min-h-0">
                        {editMode === "visual" ? (
                            <div
                                ref={editorRef}
                                contentEditable
                                suppressContentEditableWarning
                                onInput={handleVisualInput}
                                className="p-4 min-h-full outline-none text-sm leading-relaxed [&_h1]:text-2xl [&_h1]:font-bold [&_h1]:mb-2 [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:mb-2 [&_p]:mb-2 [&_a]:text-blue-600 [&_a]:underline [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:mb-1 [&_table]:border-collapse [&_td]:border [&_td]:p-2 [&_th]:border [&_th]:p-2 [&_th]:bg-muted"
                            />
                        ) : (
                            <textarea
                                value={htmlBody}
                                onChange={(e) => setHtmlBody(e.target.value)}
                                placeholder="<h1>환영합니다, ##name##님!</h1>"
                                className="w-full h-full font-mono text-sm p-4 resize-none border-0 outline-none bg-transparent"
                            />
                        )}
                    </div>
                </div>

                {/* 우측 패널 */}
                <div className="w-1/2 flex flex-col min-h-0">
                    {/* 미리보기 헤더 */}
                    <div className="shrink-0 flex items-center justify-between px-4 py-2 border-b bg-muted/30">
                        <span className="text-sm font-medium text-muted-foreground">
                            {isStreaming ? "AI 생성 중..." : "미리보기"}
                        </span>
                        {isStreaming && (
                            <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                        )}
                    </div>

                    {/* iframe 미리보기 */}
                    <div className="flex-1 min-h-0 bg-white">
                        <iframe
                            ref={iframeRef}
                            className="w-full h-full border-0"
                            title="이메일 미리보기"
                        />
                    </div>

                    {/* 변수 영역 */}
                    {variables.length > 0 && (
                        <div className="shrink-0 px-4 py-3 border-t">
                            <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-xs text-muted-foreground">변수:</span>
                                {variables.map((v) => (
                                    <Badge key={v} variant="secondary" className="text-xs">
                                        {v}
                                    </Badge>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
