import { QueryErrorState } from "@/components/layouts/WorkspaceLayout";
import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useEmailTemplateLinks } from "@/hooks/useEmailTemplateLinks";
import { useFields } from "@/hooks/useFields";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { RuleReplyBadge } from "@/components/email/replies/ui/RuleReplyBadge";
import { followupBadgeLabel } from "@/components/email/sender-profiles/utils/ruleSummary";
import { Switch } from "@/components/ui/switch";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { AsyncAlertDialog } from "@/components/ui/alert-dialog";
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
    // 활성 전환 요청 중인 규칙 — 같은 행 중복 조작을 막는다 (UX-148)
    const [pendingIds, setPendingIds] = useState<Set<number>>(() => new Set());

    const { templateLinks, isLoading, updateLink, deleteLink, loadError, mutate } = useEmailTemplateLinks(selectedPartitionId);
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

    // 서버 거부·응답 유실을 모두 안내한다 (UX-148)
    const handleToggleActive = async (link: { id: number; isActive: number }) => {
        if (pendingIds.has(link.id)) return;
        const stopping = link.isActive === 1;
        setPendingIds((prev) => new Set(prev).add(link.id));
        try {
            const result = await updateLink(link.id, { isActive: stopping ? 0 : 1 });
            if (result?.success) {
                toast.success(stopping ? "비활성화되었습니다." : "활성화되었습니다.");
            } else {
                toast.error(result?.error || (stopping ? "비활성화에 실패했습니다. 자동 발송이 계속될 수 있습니다." : "활성화에 실패했습니다."));
            }
        } catch {
            toast.error("결과를 확인하지 못했습니다. 목록을 새로고침해 실제 상태를 확인해주세요.");
            void mutate();
        } finally {
            setPendingIds((prev) => {
                const next = new Set(prev);
                next.delete(link.id);
                return next;
            });
        }
    };

    const handleDelete = async () => {
        if (!deleteTarget) return;
        let result;
        try {
            result = await deleteLink(deleteTarget);
        } catch {
            throw new Error("삭제 결과를 확인하지 못했습니다. 목록을 새로고침해 확인해주세요.");
        }
        if (!result?.success) throw new Error(result?.error || "삭제에 실패했습니다.");
        toast.success("규칙이 삭제되었습니다.");
    };

    return (
        <Card>
            <CardHeader>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <CardTitle className="whitespace-nowrap">템플릿 자동발송</CardTitle>
                    <div className="flex flex-wrap items-center gap-2">
                        <Select
                            value={String(selectedPartitionId)}
                            onValueChange={(v) => setSelectedPartitionId(v === "all" ? "all" : Number(v))}
                        >
                            <SelectTrigger className="w-full sm:w-45">
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
                        <Button size="sm" onClick={handleCreate} className="shrink-0">
                            <Plus className="h-4 w-4 mr-1" />
                            규칙 추가
                        </Button>
                    </div>
                </div>
            </CardHeader>
            <CardContent>
                {loadError ? (
                    <QueryErrorState error={loadError} onRetry={() => mutate()} />
                ) : isLoading ? (
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
                                        {/* 배열(현재)·객체(예전) 모두 읽는다 — AI 규칙 목록과 같은 배지 (UX-153) */}
                                        {followupBadgeLabel(link.followupConfig) && (
                                            link.triggerType === "manual" ? (
                                                // 예전에 저장된 수동 연결의 후속 설정 — 수동 발송은 후속을 보내지 않는다 (UX-229)
                                                <Badge
                                                    variant="outline"
                                                    className="text-muted-foreground"
                                                    title="수동 발송 연결은 후속 메일을 보내지 않습니다. 연결을 열어 저장하면 후속 설정이 정리됩니다."
                                                >
                                                    후속 미적용(수동)
                                                </Badge>
                                            ) : (
                                                <Badge variant="outline">{followupBadgeLabel(link.followupConfig)}</Badge>
                                            )
                                        )}
                                        <RuleReplyBadge kind="template" ruleId={link.id} />
                                    </div>
                                    <p className="text-sm text-muted-foreground">
                                        수신: {fieldLabelMap[link.recipientField] || link.recipientField}
                                    </p>
                                </div>
                                <div className="flex items-center gap-2">
                                    <Switch
                                        checked={!!link.isActive}
                                        onCheckedChange={() => handleToggleActive(link)}
                                        disabled={pendingIds.has(link.id)}
                                        aria-label={link.isActive ? "자동 발송 중지" : "자동 발송 켜기"}
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
            {/* 실패하면 창을 닫지 않고 오류를 보여준다 (UX-148) */}
            <AsyncAlertDialog
                open={deleteTarget !== null}
                onOpenChange={(o) => { if (!o) setDeleteTarget(null); }}
                title="규칙 삭제"
                description="이 자동 발송 규칙을 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다."
                onConfirm={handleDelete}
            />
        </Card>
    );
}
