"use client";

import { useState } from "react";
import { useAutoPersonalizedEmail, type AutoPersonalizedLink } from "@/hooks/useAutoPersonalizedEmail";
import { useProducts } from "@/hooks/useProducts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import {
    Dialog,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Loader2, Plus, Pencil, Trash2 } from "lucide-react";
import { useFields } from "@/hooks/useFields";

const FORMAT_OPTIONS = [
    { value: "plain", label: "간결한 텍스트" },
    { value: "designed", label: "디자인 이메일" },
];

const TONE_OPTIONS = [
    { value: "", label: "기본" },
    { value: "concise", label: "간결한 (AI 티 안 나게)" },
    { value: "professional", label: "전문적" },
    { value: "friendly", label: "친근한" },
    { value: "formal", label: "격식있는" },
];

interface AutoPersonalizedEmailConfigProps {
    partitions: Array<{ id: number; name: string; workspaceId: number }>;
}

export default function AutoPersonalizedEmailConfig({
    partitions,
}: AutoPersonalizedEmailConfigProps) {
    const [selectedPartitionId, setSelectedPartitionId] = useState<number | null>(
        partitions[0]?.id ?? null
    );
    const [dialogOpen, setDialogOpen] = useState(false);
    const [editingLink, setEditingLink] = useState<AutoPersonalizedLink | null>(null);
    const [deleteTarget, setDeleteTarget] = useState<AutoPersonalizedLink | null>(null);

    const { links, isLoading, createLink, updateLink, deleteLink } =
        useAutoPersonalizedEmail(selectedPartitionId);
    const { products } = useProducts({ activeOnly: true });
    const selectedWorkspaceId = partitions.find((p) => p.id === selectedPartitionId)?.workspaceId ?? null;
    const { fields } = useFields(selectedWorkspaceId);

    // Dialog form state
    const [productId, setProductId] = useState<number | null>(null);
    const [triggerType, setTriggerType] = useState<"on_create" | "on_update">("on_create");
    const [recipientField, setRecipientField] = useState("");
    const [companyField, setCompanyField] = useState("");
    const [prompt, setPrompt] = useState("");
    const [tone, setTone] = useState("");
    const [format, setFormat] = useState<"plain" | "designed">("plain");
    const [autoResearch, setAutoResearch] = useState(true);
    const [useSignaturePersona, setUseSignaturePersona] = useState(false);
    const [conditionEnabled, setConditionEnabled] = useState(false);
    const [conditionField, setConditionField] = useState("");
    const [conditionOperator, setConditionOperator] = useState("eq");
    const [conditionValue, setConditionValue] = useState("");
    const [submitting, setSubmitting] = useState(false);

    const resetForm = () => {
        setProductId(null);
        setTriggerType("on_create");
        setRecipientField("");
        setCompanyField("");
        setPrompt("");
        setTone("");
        setFormat("plain");
        setAutoResearch(true);
        setUseSignaturePersona(false);
        setConditionEnabled(false);
        setConditionField("");
        setConditionOperator("eq");
        setConditionValue("");
        setEditingLink(null);
    };

    const openCreateDialog = () => {
        resetForm();
        setDialogOpen(true);
    };

    const openEditDialog = (link: AutoPersonalizedLink) => {
        setEditingLink(link);
        setProductId(link.productId);
        setTriggerType(link.triggerType as "on_create" | "on_update");
        setRecipientField(link.recipientField);
        setCompanyField(link.companyField);
        setPrompt(link.prompt || "");
        setTone(link.tone || "");
        setFormat((link.format as "plain" | "designed") || "plain");
        setAutoResearch(link.autoResearch === 1);
        setUseSignaturePersona(link.useSignaturePersona === 1);
        if (link.triggerCondition?.field) {
            setConditionEnabled(true);
            setConditionField(link.triggerCondition.field);
            setConditionOperator(link.triggerCondition.operator || "eq");
            setConditionValue(link.triggerCondition.value || "");
        } else {
            setConditionEnabled(false);
            setConditionField("");
            setConditionOperator("eq");
            setConditionValue("");
        }
        setDialogOpen(true);
    };

    const handleSubmit = async () => {
        if (!selectedPartitionId || !recipientField || !companyField) return;

        setSubmitting(true);
        try {
            const triggerCondition = conditionEnabled && conditionField
                ? { field: conditionField, operator: conditionOperator, value: conditionValue }
                : null;

            if (editingLink) {
                await updateLink(editingLink.id, {
                    productId: productId,
                    triggerType,
                    recipientField,
                    companyField,
                    prompt: prompt || undefined,
                    tone: tone || undefined,
                    format,
                    autoResearch: autoResearch ? 1 : 0,
                    useSignaturePersona: useSignaturePersona ? 1 : 0,
                    triggerCondition,
                });
            } else {
                await createLink({
                    partitionId: selectedPartitionId,
                    productId: productId,
                    triggerType,
                    recipientField,
                    companyField,
                    prompt: prompt || undefined,
                    tone: tone || undefined,
                    format,
                    autoResearch: autoResearch ? 1 : 0,
                    useSignaturePersona: useSignaturePersona ? 1 : 0,
                    triggerCondition,
                });
            }
            setDialogOpen(false);
            resetForm();
        } finally {
            setSubmitting(false);
        }
    };

    const handleToggleActive = async (link: AutoPersonalizedLink) => {
        await updateLink(link.id, { isActive: link.isActive === 1 ? 0 : 1 });
    };

    const handleDelete = async () => {
        if (!deleteTarget) return;
        await deleteLink(deleteTarget.id);
        setDeleteTarget(null);
    };

    return (
        <Card>
            <CardHeader>
                <div className="flex items-center justify-between">
                    <CardTitle>AI 개인화 이메일 자동 발송</CardTitle>
                    <div className="flex items-center gap-2">
                        <Select
                            value={selectedPartitionId?.toString() ?? ""}
                            onValueChange={(v) => setSelectedPartitionId(Number(v))}
                        >
                            <SelectTrigger className="w-[180px]">
                                <SelectValue placeholder="파티션 선택" />
                            </SelectTrigger>
                            <SelectContent>
                                {partitions.map((p) => (
                                    <SelectItem key={p.id} value={p.id.toString()}>
                                        {p.name}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        <Button size="sm" onClick={openCreateDialog} disabled={!selectedPartitionId}>
                            <Plus className="h-4 w-4 mr-1" />
                            규칙 추가
                        </Button>
                    </div>
                </div>
            </CardHeader>
            <CardContent>
                {!selectedPartitionId ? (
                    <p className="text-sm text-muted-foreground">파티션을 선택해주세요.</p>
                ) : isLoading ? (
                    <div className="flex justify-center py-8">
                        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                    </div>
                ) : links.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-8">
                        등록된 자동 발송 규칙이 없습니다.
                    </p>
                ) : (
                    <div className="space-y-3">
                        {links.map((link) => (
                            <div
                                key={link.id}
                                className="border rounded-lg p-4 flex items-start justify-between gap-4"
                            >
                                <div className="flex-1 space-y-1">
                                    <div className="flex items-center gap-2">
                                        <Badge variant={link.isActive === 1 ? "default" : "secondary"}>
                                            {link.productName || "제품 미지정"}
                                        </Badge>
                                        <Badge variant="outline">
                                            {link.triggerType === "on_create" ? "생성 시" : "수정 시"}
                                        </Badge>
                                        <Badge variant="outline">
                                            {FORMAT_OPTIONS.find((f) => f.value === link.format)?.label || "간결한 텍스트"}
                                        </Badge>
                                    </div>
                                    <p className="text-sm text-muted-foreground">
                                        수신: {link.recipientField} | 회사: {link.companyField}
                                    </p>
                                    <p className="text-sm text-muted-foreground">
                                        자동 조사: {link.autoResearch === 1 ? "ON" : "OFF"}
                                        {link.useSignaturePersona === 1 && " | 페르소나: ON"}
                                        {link.tone && ` | 톤: ${TONE_OPTIONS.find((t) => t.value === link.tone)?.label || link.tone}`}
                                    </p>
                                </div>
                                <div className="flex items-center gap-2">
                                    <Switch
                                        checked={link.isActive === 1}
                                        onCheckedChange={() => handleToggleActive(link)}
                                    />
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        onClick={() => openEditDialog(link)}
                                    >
                                        <Pencil className="h-4 w-4" />
                                    </Button>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        onClick={() => setDeleteTarget(link)}
                                    >
                                        <Trash2 className="h-4 w-4" />
                                    </Button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </CardContent>

            {/* 생성/수정 Dialog */}
            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle>
                            {editingLink ? "AI 개인화 발송 규칙 수정" : "AI 개인화 발송 규칙 추가"}
                        </DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4">
                        <div className="space-y-2">
                            <Label>제품</Label>
                            <Select
                                value={productId?.toString() ?? "none"}
                                onValueChange={(v) => setProductId(v === "none" ? null : Number(v))}
                            >
                                <SelectTrigger>
                                    <SelectValue placeholder="제품 선택 (선택사항)" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="none">선택 안함</SelectItem>
                                    {products.map((p) => (
                                        <SelectItem key={p.id} value={p.id.toString()}>
                                            {p.name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="space-y-2">
                            <Label>트리거</Label>
                            <Select
                                value={triggerType}
                                onValueChange={(v) => setTriggerType(v as "on_create" | "on_update")}
                            >
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="on_create">레코드 생성 시</SelectItem>
                                    <SelectItem value="on_update">레코드 수정 시</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="space-y-2">
                            <Label>수신자 이메일 필드</Label>
                            <Select value={recipientField} onValueChange={setRecipientField}>
                                <SelectTrigger>
                                    <SelectValue placeholder="필드 선택" />
                                </SelectTrigger>
                                <SelectContent>
                                    {fields.map((f) => (
                                        <SelectItem key={f.key} value={f.key}>
                                            {f.label}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="space-y-2">
                            <Label>회사명 필드</Label>
                            <Select value={companyField} onValueChange={setCompanyField}>
                                <SelectTrigger>
                                    <SelectValue placeholder="필드 선택" />
                                </SelectTrigger>
                                <SelectContent>
                                    {fields.map((f) => (
                                        <SelectItem key={f.key} value={f.key}>
                                            {f.label}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="space-y-2">
                            <Label>AI 지시사항 (선택)</Label>
                            <Textarea
                                value={prompt}
                                onChange={(e) => setPrompt(e.target.value)}
                                placeholder="예: 이 회사에 적합한 제품 소개 이메일을 작성해주세요."
                                rows={3}
                            />
                        </div>

                        <div className="space-y-2">
                            <Label>이메일 형식</Label>
                            <Select value={format} onValueChange={(v) => setFormat(v as "plain" | "designed")}>
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {FORMAT_OPTIONS.map((f) => (
                                        <SelectItem key={f.value} value={f.value}>
                                            {f.label}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            <p className="text-xs text-muted-foreground">
                                {format === "plain" ? "편지처럼 간결한 텍스트 이메일" : "헤더, CTA 버튼 등 디자인 포함 이메일"}
                            </p>
                        </div>

                        <div className="space-y-2">
                            <Label>톤</Label>
                            <Select value={tone} onValueChange={setTone}>
                                <SelectTrigger>
                                    <SelectValue placeholder="기본" />
                                </SelectTrigger>
                                <SelectContent>
                                    {TONE_OPTIONS.map((t) => (
                                        <SelectItem key={t.value || "default"} value={t.value || "default"}>
                                            {t.label}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="flex items-center justify-between">
                            <div>
                                <Label>발송 조건</Label>
                                <p className="text-xs text-muted-foreground">특정 조건을 만족할 때만 발송</p>
                            </div>
                            <Switch checked={conditionEnabled} onCheckedChange={setConditionEnabled} />
                        </div>

                        {conditionEnabled && (
                            <div className="grid grid-cols-3 gap-2">
                                <Select value={conditionField} onValueChange={setConditionField}>
                                    <SelectTrigger>
                                        <SelectValue placeholder="필드" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {fields.map((f) => (
                                            <SelectItem key={f.key} value={f.key}>
                                                {f.label}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                                <Select value={conditionOperator} onValueChange={setConditionOperator}>
                                    <SelectTrigger>
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="eq">같음</SelectItem>
                                        <SelectItem value="ne">같지 않음</SelectItem>
                                        <SelectItem value="contains">포함</SelectItem>
                                    </SelectContent>
                                </Select>
                                <Input
                                    value={conditionValue}
                                    onChange={(e) => setConditionValue(e.target.value)}
                                    placeholder="값"
                                />
                            </div>
                        )}

                        <div className="flex items-center justify-between">
                            <div>
                                <Label>서명 발신자 페르소나</Label>
                                <p className="text-xs text-muted-foreground">이메일 서명의 이름/직함으로 발신자 톤을 설정</p>
                            </div>
                            <Switch checked={useSignaturePersona} onCheckedChange={setUseSignaturePersona} />
                        </div>

                        <div className="flex items-center justify-between">
                            <div>
                                <Label>회사 자동 조사</Label>
                                <p className="text-xs text-muted-foreground">AI 웹 검색으로 회사 정보를 자동 조사</p>
                            </div>
                            <Switch checked={autoResearch} onCheckedChange={setAutoResearch} />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setDialogOpen(false)}>
                            취소
                        </Button>
                        <Button
                            onClick={handleSubmit}
                            disabled={submitting || !recipientField || !companyField}
                        >
                            {submitting && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
                            {editingLink ? "수정" : "저장"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* 삭제 확인 */}
            <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>규칙 삭제</AlertDialogTitle>
                        <AlertDialogDescription>
                            이 자동 발송 규칙을 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>취소</AlertDialogCancel>
                        <AlertDialogAction onClick={handleDelete}>삭제</AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </Card>
    );
}
