import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useEmailTemplateLinks } from "@/hooks/useEmailTemplateLinks";
import { useFields } from "@/hooks/useFields";
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
import { Loader2, Plus, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";

interface Partition {
    id: number;
    name: string;
    workspaceId: number;
}

interface EmailTemplateLinkListProps {
    partitions: Partition[];
}

const TRIGGER_LABELS: Record<string, string> = {
    manual: "수동",
    on_create: "생성 시",
    on_update: "수정 시",
};

export default function EmailTemplateLinkList({ partitions }: EmailTemplateLinkListProps) {
    const router = useRouter();
    const [selectedPartitionId, setSelectedPartitionId] = useState<number | "all">("all");
    const [deleteTarget, setDeleteTarget] = useState<number | null>(null);

    const { templateLinks, isLoading, updateLink, deleteLink } = useEmailTemplateLinks(selectedPartitionId);
    const selectedPartition = selectedPartitionId !== "all" ? partitions.find((p) => p.id === selectedPartitionId) : null;
    const { fields } = useFields(selectedPartition?.workspaceId ?? null);
    const partitionMap = useMemo(() => Object.fromEntries(partitions.map((p) => [p.id, p.name])), [partitions]);
    const fieldLabelMap = useMemo(() => {
        const map: Record<string, string> = {};
        for (const f of fields) map[f.key] = f.label;
        return map;
    }, [fields]);

    const handleCreate = () => {
        const params = selectedPartitionId !== "all" ? `?partitionId=${selectedPartitionId}` : "";
        router.push(`/email/links/new${params}`);
    };

    const handleEdit = (linkId: number, partId?: number) => {
        const pId = partId || (selectedPartitionId !== "all" ? selectedPartitionId : null);
        router.push(`/email/links/${linkId}?partitionId=${pId}`);
    };

    const handleToggleActive = async (link: { id: number; isActive: number }) => {
        const result = await updateLink(link.id, { isActive: link.isActive === 1 ? 0 : 1 });
        if (result.success) {
            toast.success(link.isActive === 1 ? "비활성화되었습니다." : "활성화되었습니다.");
        }
    };

    const handleDelete = async () => {
        if (!deleteTarget) return;
        const result = await deleteLink(deleteTarget);
        if (result.success) toast.success("규칙이 삭제되었습니다.");
        else toast.error(result.error || "삭제에 실패했습니다.");
        setDeleteTarget(null);
    };

    return (
        <Card>
            <CardHeader>
                <div className="flex items-center justify-between">
                    <CardTitle>템플릿 자동발송</CardTitle>
                    <div className="flex items-center gap-2">
                        <Select
                            value={String(selectedPartitionId)}
                            onValueChange={(v) => setSelectedPartitionId(v === "all" ? "all" : Number(v))}
                        >
                            <SelectTrigger className="w-[180px]">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">전체</SelectItem>
                                {partitions.map((p) => (
                                    <SelectItem key={p.id} value={p.id.toString()}>
                                        {p.name}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        <Button size="sm" onClick={handleCreate}>
                            <Plus className="h-4 w-4 mr-1" />
                            규칙 추가
                        </Button>
                    </div>
                </div>
            </CardHeader>
            <CardContent>
                {isLoading ? (
                    <div className="flex justify-center py-8">
                        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                    </div>
                ) : templateLinks.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-8">
                        등록된 자동 발송 규칙이 없습니다.
                    </p>
                ) : (
                    <div className="space-y-3">
                        {templateLinks.map((link) => (
                            <div
                                key={link.id}
                                className="border rounded-lg p-4 flex items-start justify-between gap-4"
                            >
                                <div className="flex-1 space-y-1">
                                    <div className="flex items-center gap-2">
                                        <Badge variant={link.isActive ? "default" : "secondary"}>
                                            {link.name}
                                        </Badge>
                                        {selectedPartitionId === "all" && (
                                            <Badge variant="secondary" className="text-xs">
                                                {(link as Record<string, unknown>).partitionName as string || partitionMap[link.partitionId] || ""}
                                            </Badge>
                                        )}
                                        <Badge variant="outline">
                                            {TRIGGER_LABELS[link.triggerType] || link.triggerType}
                                        </Badge>
                                        {link.preventDuplicate === 1 && (
                                            <Badge variant="outline" className="text-orange-600 border-orange-300">
                                                중복방지
                                            </Badge>
                                        )}
                                        {link.followupConfig && (
                                            <Badge variant="outline">
                                                후속 {(link.followupConfig as { delayDays: number }).delayDays}일
                                            </Badge>
                                        )}
                                    </div>
                                    <p className="text-sm text-muted-foreground">
                                        수신: {fieldLabelMap[link.recipientField] || link.recipientField}
                                    </p>
                                </div>
                                <div className="flex items-center gap-2">
                                    <Switch
                                        checked={!!link.isActive}
                                        onCheckedChange={() => handleToggleActive(link)}
                                    />
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        title="수정"
                                        onClick={() => handleEdit(link.id, link.partitionId)}
                                    >
                                        <Pencil className="h-4 w-4" />
                                    </Button>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        title="삭제"
                                        onClick={() => setDeleteTarget(link.id)}
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
            <AlertDialog open={deleteTarget !== null} onOpenChange={(o) => !o && setDeleteTarget(null)}>
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
