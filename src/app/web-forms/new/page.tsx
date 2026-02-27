"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import WorkspaceLayout from "@/components/layouts/WorkspaceLayout";
import { useWorkspaces } from "@/hooks/useWorkspaces";
import { usePartitions } from "@/hooks/usePartitions";
import { useFields } from "@/hooks/useFields";
import { useWebForms } from "@/hooks/useWebForms";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { ArrowLeft, Sparkles } from "lucide-react";

export default function NewWebFormPage() {
    const router = useRouter();
    const { workspaces } = useWorkspaces();
    const [workspaceId, setWorkspaceId] = useState<number | null>(null);
    const { partitionTree } = usePartitions(workspaceId);
    const { fields: workspaceFields } = useFields(workspaceId);
    const { createForm, updateForm } = useWebForms(workspaceId);

    const [name, setName] = useState("");
    const [title, setTitle] = useState("");
    const [partitionId, setPartitionId] = useState<number | null>(null);
    const [creating, setCreating] = useState(false);
    const [aiPrompt, setAiPrompt] = useState("");

    useEffect(() => {
        if (!workspaceId && workspaces.length > 0) {
            setWorkspaceId(workspaces[0].id);
        }
    }, [workspaces, workspaceId]);

    const allPartitions = partitionTree
        ? [
              ...partitionTree.folders.flatMap((f) => f.partitions),
              ...partitionTree.ungrouped,
          ]
        : [];

    const hasAi = !!aiPrompt.trim();

    const handleCreate = async () => {
        if (!partitionId || !workspaceId) return;
        if (!hasAi && (!name || !title)) return;
        setCreating(true);
        const result = await createForm({
            name: name || aiPrompt.trim().slice(0, 30),
            workspaceId,
            partitionId,
            title: title || aiPrompt.trim().slice(0, 50),
        });
        if (!result.success) {
            toast.error(result.error || "생성에 실패했습니다.");
            setCreating(false);
            return;
        }

        const formId = result.data.id;

        // AI 프롬프트가 있으면 필드 자동 생성 후 저장
        if (aiPrompt.trim()) {
            try {
                const aiRes = await fetch("/api/ai/generate-webform", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        prompt: aiPrompt.trim(),
                        workspaceFields: workspaceFields.map((f) => ({ key: f.key, label: f.label })),
                    }),
                });
                const aiJson = await aiRes.json();
                if (aiJson.success) {
                    const data = aiJson.data;
                    await updateForm(formId, {
                        name: data.name || name,
                        title: data.title,
                        description: data.description,
                        fields: data.fields.map((f: any) => ({
                            label: f.label,
                            description: f.description || "",
                            placeholder: f.placeholder || "",
                            fieldType: f.fieldType,
                            linkedFieldKey: f.linkedFieldKey || "",
                            isRequired: !!f.isRequired,
                            options: f.options || [],
                        })),
                    });
                    toast.success(`${data.fields.length}개 필드가 AI로 생성되었습니다.`);
                } else {
                    toast.error(aiJson.error || "AI 생성에 실패했습니다. 편집 페이지에서 다시 시도하세요.");
                }
            } catch {
                toast.error("AI 생성 중 오류가 발생했습니다. 편집 페이지에서 다시 시도하세요.");
            }
        }

        router.push(`/web-forms/${formId}`);
    };

    return (
        <WorkspaceLayout>
            <div className="p-6 max-w-lg mx-auto space-y-6">
                <Button variant="ghost" size="sm" asChild>
                    <Link href="/web-forms">
                        <ArrowLeft className="h-4 w-4 mr-1" /> 웹 폼 목록
                    </Link>
                </Button>

                <Card>
                    <CardHeader>
                        <CardTitle>새 웹 폼</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        {workspaces.length > 1 && (
                            <div className="space-y-2">
                                <Label>워크스페이스</Label>
                                <Select
                                    value={workspaceId ? String(workspaceId) : ""}
                                    onValueChange={(v) => {
                                        setWorkspaceId(Number(v));
                                        setPartitionId(null);
                                    }}
                                >
                                    <SelectTrigger>
                                        <SelectValue placeholder="워크스페이스 선택" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {workspaces.map((ws) => (
                                            <SelectItem key={ws.id} value={String(ws.id)}>
                                                {ws.name}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                        )}
                        <div className="space-y-2">
                            <Label>폼 이름</Label>
                            <Input
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                placeholder="예: 신규 문의"
                            />
                        </div>
                        <div className="space-y-2">
                            <Label>폼 제목</Label>
                            <Input
                                value={title}
                                onChange={(e) => setTitle(e.target.value)}
                                placeholder="예: 문의하기"
                            />
                        </div>
                        <div className="space-y-2">
                            <Label>연결 파티션</Label>
                            <Select
                                value={partitionId ? String(partitionId) : ""}
                                onValueChange={(v) => setPartitionId(Number(v))}
                            >
                                <SelectTrigger>
                                    <SelectValue placeholder="파티션 선택" />
                                </SelectTrigger>
                                <SelectContent>
                                    {allPartitions.map((p) => (
                                        <SelectItem key={p.id} value={String(p.id)}>
                                            {p.name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-2">
                            <Label className="flex items-center gap-1">
                                <Sparkles className="h-4 w-4" /> AI 폼 필드 생성
                                <span className="text-muted-foreground font-normal">(선택)</span>
                            </Label>
                            <Textarea
                                value={aiPrompt}
                                onChange={(e) => setAiPrompt(e.target.value)}
                                placeholder="예: B2B SaaS 무료 체험 신청 폼"
                                rows={2}
                            />
                            <p className="text-xs text-muted-foreground">
                                입력하면 폼 이름, 제목, 필드를 AI가 자동으로 생성합니다.
                            </p>
                        </div>
                        <Button
                            className="w-full"
                            onClick={handleCreate}
                            disabled={!partitionId || creating || (!hasAi && (!name || !title))}
                        >
                            {creating ? (hasAi ? "AI 생성 중..." : "생성 중...") : (hasAi ? "AI로 생성" : "생성")}
                        </Button>
                    </CardContent>
                </Card>
            </div>
        </WorkspaceLayout>
    );
}
