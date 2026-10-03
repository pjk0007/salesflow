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
import { Loader2, Plus, Pencil, Trash2, Copy, Send, Repeat2 } from "lucide-react";
import AiAutoTestSendDialog from "./AiAutoTestSendDialog";
import AiFollowupTestDialog from "./AiFollowupTestDialog";
import { linkSenderPool } from "@/lib/email-sender-limit-rules";
import { useSenderProfiles } from "@/components/email/sender-profiles/hooks/useSenderProfiles";
import { splitKnownSenderIds } from "@/components/email/sender-profiles/utils/senderPool";
import { followupBadgeLabel } from "@/components/email/sender-profiles/utils/ruleSummary";

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
    const [selectedPartitionId, setSelectedPartitionId] = useState<number | "all">("all");
    const [deleteTarget, setDeleteTarget] = useState<AutoPersonalizedLink | null>(null);
    const [testTarget, setTestTarget] = useState<AutoPersonalizedLink | null>(null);
    const [followupTestTarget, setFollowupTestTarget] = useState<AutoPersonalizedLink | null>(null);

    const { links, isLoading, createLink, updateLink, deleteLink } =
        useAutoPersonalizedEmail(selectedPartitionId);
    // 복제할 때 지워진 발신 프로필을 묶음에서 빼려고 지금 프로필 목록을 본다
    const { profiles: senderProfiles, isLoading: senderProfilesLoading, loadFailed: senderProfilesLoadFailed } =
        useSenderProfiles();

    const handleCreate = () => {
        const params = selectedPartitionId !== "all" ? `?partitionId=${selectedPartitionId}` : "";
        router.push(`/email/ai-auto/new${params}`);
    };

    const handleEdit = (linkId: number, partId?: number) => {
        const pId = partId || (selectedPartitionId !== "all" ? selectedPartitionId : null);
        router.push(`/email/ai-auto/${linkId}?partitionId=${pId}`);
    };

    const handleDuplicate = async (link: AutoPersonalizedLink) => {
        const dupPartitionId = selectedPartitionId !== "all" ? selectedPartitionId : link.partitionId;
        if (!dupPartitionId) return;
        // 발신 주소 묶음도 복제한다. 묶음 칸이 생기기 전 규칙은 senderProfileId 하나를 묶음으로 옮긴다.
        // 프로필을 지워도 규칙에는 id가 남는다 — 그대로 보내면 서버가 거절하므로 지금 있는 프로필만 남긴다.
        // 목록을 아직 못 읽었으면 거르지 않고 보낸다 (지워진 id가 있으면 서버가 이유를 알려 준다)
        const pool = linkSenderPool({
            senderProfileId: link.senderProfileId ?? null,
            senderProfileIds: link.senderProfileIds ?? null,
        });
        const canFilter = !senderProfilesLoading && !senderProfilesLoadFailed;
        const { kept, dropped } = canFilter
            ? splitKnownSenderIds(pool, senderProfiles.map((p) => p.id))
            : { kept: pool, dropped: [] as number[] };
        // 복제는 설정을 모두 그대로 옮기고 비활성으로만 바꾼다 (규칙명·CTA·서명·에셋·중복 방지·임시저장 포함)
        const result = await createLink({
            name: link.name ?? undefined,
            partitionId: dupPartitionId,
            productId: link.productId,
            ctaUrl: link.ctaUrl ?? undefined,
            recipientField: link.recipientField,
            companyField: link.companyField,
            prompt: link.prompt ?? undefined,
            tone: link.tone ?? undefined,
            model: link.model ?? undefined,
            format: link.format,
            triggerType: link.triggerType as "on_create" | "on_update",
            triggerCondition: link.triggerCondition?.field ? link.triggerCondition as { field: string; operator: string; value: string } : null,
            autoResearch: link.autoResearch,
            useSignaturePersona: link.useSignaturePersona,
            useUnsubscribe: link.useUnsubscribe,
            followupConfig: link.followupConfig ?? undefined,
            preventDuplicate: link.preventDuplicate,
            senderProfileIds: kept,
            signatureId: link.signatureId,
            assetIds: link.assetIds ?? undefined,
            isDraft: link.isDraft ?? 0,
            isActive: 0,
        });
        if (!result.success) {
            toast.error(result.error || "복제에 실패했습니다.");
            return;
        }
        if (dropped.length === 0) {
            toast.success("규칙이 복제되었습니다. (비활성 상태)");
        } else {
            // 묶음이 줄었거나 기본 발신 프로필로 바뀐 것을 알린다 — 켜기 전에 확인하게
            toast.success(
                `규칙이 복제되었습니다. (비활성 상태) 삭제된 발신 프로필 ${dropped.length}개는 빼고 복제했습니다` +
                (kept.length === 0 ? " — 기본 발신 프로필로 보냅니다." : ".")
            );
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
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <CardTitle className="whitespace-nowrap">AI 개인화 이메일 자동 발송</CardTitle>
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
                {isLoading ? (
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
                                className="border rounded-lg p-4 flex flex-col gap-3 md:flex-row md:items-start md:justify-between"
                            >
                                <div className="flex-1 space-y-1 min-w-0">
                                    {link.name && (
                                        <p className="text-sm font-semibold truncate">{link.name}</p>
                                    )}
                                    <div className="flex flex-wrap items-center gap-2">
                                        {link.isDraft === 1 && (
                                            <Badge variant="outline" className="border-amber-400 text-amber-700 bg-amber-50">
                                                임시저장
                                            </Badge>
                                        )}
                                        <Badge variant={link.isActive === 1 ? "default" : "secondary"}>
                                            {link.productName || "제품 미지정"}
                                        </Badge>
                                        {selectedPartitionId === "all" && (
                                            <Badge variant="secondary" className="text-xs">
                                                {(link as unknown as { partitionName?: string }).partitionName || ""}
                                            </Badge>
                                        )}
                                        <Badge variant="outline">
                                            {link.triggerType === "on_create" ? "생성 시" : "수정 시"}
                                        </Badge>
                                        <Badge variant="outline">
                                            {FORMAT_OPTIONS.find((f) => f.value === link.format)?.label || "간결한 텍스트"}
                                        </Badge>
                                        {followupBadgeLabel(link.followupConfig) && (
                                            <Badge variant="outline">
                                                {followupBadgeLabel(link.followupConfig)}
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
                                <div className="flex flex-wrap items-center gap-2 shrink-0">
                                    <Switch
                                        checked={link.isActive === 1}
                                        onCheckedChange={() => handleToggleActive(link)}
                                        disabled={link.isDraft === 1}
                                    />
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        title="테스트 발송"
                                        onClick={() => setTestTarget(link)}
                                    >
                                        <Send className="h-4 w-4" />
                                    </Button>
                                    {followupBadgeLabel(link.followupConfig) && (
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            title="후속 메일 테스트"
                                            onClick={() => setFollowupTestTarget(link)}
                                        >
                                            <Repeat2 className="h-4 w-4" />
                                        </Button>
                                    )}
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
                                        onClick={() => handleEdit(link.id, link.partitionId)}
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

            {/* 테스트 발송 */}
            {testTarget && (
                <AiAutoTestSendDialog
                    open={!!testTarget}
                    onOpenChange={(open) => !open && setTestTarget(null)}
                    linkId={testTarget.id}
                    linkName={testTarget.productName || "제품 미지정"}
                    recipientField={testTarget.recipientField}
                    companyField={testTarget.companyField}
                />
            )}

            {/* 후속 메일 테스트 */}
            {followupTestTarget && (
                <AiFollowupTestDialog
                    open={!!followupTestTarget}
                    onOpenChange={(open) => !open && setFollowupTestTarget(null)}
                    linkId={followupTestTarget.id}
                    linkName={followupTestTarget.name || followupTestTarget.productName || "제품 미지정"}
                />
            )}
        </Card>
    );
}
