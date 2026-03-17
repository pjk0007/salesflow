"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAutoPersonalizedEmail, type AutoPersonalizedLink } from "@/hooks/useAutoPersonalizedEmail";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
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
import { toast } from "sonner";
import { Loader2, Plus, Pencil, Trash2, Copy } from "lucide-react";

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
    const router = useRouter();
    const [selectedPartitionId, setSelectedPartitionId] = useState<number | null>(
        partitions[0]?.id ?? null
    );
    const [deleteTarget, setDeleteTarget] = useState<AutoPersonalizedLink | null>(null);

    const { links, isLoading, createLink, updateLink, deleteLink } =
        useAutoPersonalizedEmail(selectedPartitionId);

    const handleCreate = () => {
        if (!selectedPartitionId) return;
        router.push(`/email/ai-auto/new?partitionId=${selectedPartitionId}`);
    };

    const handleEdit = (linkId: number) => {
        router.push(`/email/ai-auto/${linkId}?partitionId=${selectedPartitionId}`);
    };

    const handleDuplicate = async (link: AutoPersonalizedLink) => {
        if (!selectedPartitionId) return;
        const result = await createLink({
            partitionId: selectedPartitionId,
            productId: link.productId,
            recipientField: link.recipientField,
            companyField: link.companyField,
            prompt: link.prompt ?? undefined,
            tone: link.tone ?? undefined,
            format: link.format,
            triggerType: link.triggerType as "on_create" | "on_update",
            triggerCondition: link.triggerCondition?.field ? link.triggerCondition as { field: string; operator: string; value: string } : null,
            autoResearch: link.autoResearch,
            useSignaturePersona: link.useSignaturePersona,
            followupConfig: link.followupConfig ?? undefined,
            isActive: 0,
        });
        if (result.success) toast.success("규칙이 복제되었습니다. (비활성 상태)");
        else toast.error("복제에 실패했습니다.");
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
                        <Button size="sm" onClick={handleCreate} disabled={!selectedPartitionId}>
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
                                        {link.followupConfig && (
                                            <Badge variant="outline">
                                                후속 {link.followupConfig.delayDays}일
                                            </Badge>
                                        )}
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
                                        title="복제"
                                        onClick={() => handleDuplicate(link)}
                                    >
                                        <Copy className="h-4 w-4" />
                                    </Button>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        title="수정"
                                        onClick={() => handleEdit(link.id)}
                                    >
                                        <Pencil className="h-4 w-4" />
                                    </Button>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        title="삭제"
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
