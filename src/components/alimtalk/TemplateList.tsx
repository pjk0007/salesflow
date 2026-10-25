import { QueryErrorState } from "@/components/layouts/WorkspaceLayout";
import { useState, useMemo } from "react";
import useSWR from "swr";
import { useRouter } from "next/navigation";
import { useAlimtalkSenders } from "@/hooks/useAlimtalkSenders";
import { useAlimtalkConfig } from "@/hooks/useAlimtalkConfig";
import { useAlimtalkTemplates } from "@/hooks/useAlimtalkTemplates";
import { useAlimtalkTemplateManage } from "@/hooks/useAlimtalkTemplateManage";
import { apiRequest, blockingError, defaultFetcher, requestErrorMessage } from "@/lib/swr-fetcher";
import type { NhnTemplate } from "@/lib/nhn-alimtalk";
import type { AlimtalkTemplateDraft } from "@/lib/db";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { AsyncAlertDialog, useAsyncConfirm } from "@/components/ui/alert-dialog";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Eye, Plus, MoreHorizontal, Pencil, Trash, Send, SendHorizontal, Copy, FileEdit, X } from "lucide-react";
import { toast } from "sonner";
import TemplateDetailDialog from "./TemplateDetailDialog";
import TemplatePreview, { type TemplatePreviewProps } from "./TemplatePreview";
import TestSendDialog from "./TestSendDialog";
import AlimtalkSetupRequired from "./AlimtalkSetupRequired";

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
    TSC01: "outline",       // 생성
    TSC02: "secondary",     // 검수중
    TSC03: "default",       // 승인
    TSC04: "destructive",   // 반려
    TSC05: "destructive",   // 중단
};

export default function TemplateList({ onConfigure }: { onConfigure?: () => void }) {
    const router = useRouter();
    const { isConfigured, isLoading: configLoading } = useAlimtalkConfig();
    const { senders, loadError: sendersError, mutate: mutateSenders } = useAlimtalkSenders();
    const [selectedSenderKey, setSelectedSenderKey] = useState<string>("__all__");
    const isAll = selectedSenderKey === "__all__";
    const singleSenderKey = isAll ? null : selectedSenderKey;

    // 단일 발신프로필 선택 시
    const { templates: singleTemplates, isLoading: singleLoading, loadError: singleError, mutate: mutateSingle } = useAlimtalkTemplates(singleSenderKey);

    // 전체 선택 시 — 모든 sender 병렬 조회
    const allSenderKeys = useMemo(() => senders.map((s) => s.senderKey), [senders]);
    const { data: allData, isLoading: allLoading, error: allError, mutate: mutateAll } = useSWR(
        isAll && allSenderKeys.length > 0
            ? allSenderKeys.map((k) => `/api/alimtalk/templates?senderKey=${encodeURIComponent(k)}`)
            : null,
        async (urls: string[]) => {
            const results = await Promise.all(urls.map((url) => defaultFetcher(url)));
            return results.flatMap((r: { data?: { templates: NhnTemplate[] } }) => r.data?.templates ?? []);
        }
    );
    const templates = isAll ? (allData ?? []) : singleTemplates;
    const isLoading = isAll ? allLoading : singleLoading;

    const { deleteTemplate, commentTemplate } = useAlimtalkTemplateManage(singleSenderKey);

    // 임시저장 목록
    const { data: draftsData, mutate: mutateDrafts, error: draftsError } = useSWR<{ success: boolean; data: AlimtalkTemplateDraft[] }>(
        "/api/alimtalk/template-drafts",
        defaultFetcher
    );
    const drafts = draftsData?.data ?? [];

    // 초안 삭제는 되돌릴 수 없다 — 확인창에서 실행하고 실패하면 창을 유지한다(UX-183)
    const { confirm, confirmationDialog } = useAsyncConfirm();
    const handleDeleteDraft = (draft: AlimtalkTemplateDraft) => confirm({
        title: "초안 삭제",
        description: `"${draft.templateName}" 임시저장 초안을 삭제합니다. 삭제한 초안은 되돌릴 수 없습니다.`,
        onConfirm: async () => {
            try {
                await apiRequest(`/api/alimtalk/template-drafts/${draft.id}`, { method: "DELETE" });
            } catch (error) {
                throw new Error(requestErrorMessage(error, "초안을 삭제하지 못했습니다. 다시 시도해주세요."));
            }
            toast.success("임시저장이 삭제되었습니다.");
            mutateDrafts();
        },
    });

    const [detailTemplate, setDetailTemplate] = useState<{
        senderKey: string;
        templateCode: string;
    } | null>(null);

    // 테스트 발송
    const [testSendTemplate, setTestSendTemplate] = useState<NhnTemplate | null>(null);

    // 삭제 확인
    const [deleteTarget, setDeleteTarget] = useState<{ senderKey: string; templateCode: string; templateName: string } | null>(null);

    // 임시저장 미리보기
    const [draftPreview, setDraftPreview] = useState<AlimtalkTemplateDraft | null>(null);

    // 검수 요청
    const [commentTarget, setCommentTarget] = useState<{ senderKey: string; templateCode: string; templateName: string } | null>(null);
    const [commentText, setCommentText] = useState("");
    const [commenting, setCommenting] = useState(false);
    const [commentError, setCommentError] = useState<string | null>(null);

    // '전체' 보기는 발신 프로필별 캐시와 다른 키를 쓴다 — 변경 뒤 현재 목록을 함께 갱신한다(UX-184)
    const refreshTemplates = () => (isAll ? mutateAll() : mutateSingle());

    const handleDelete = async () => {
        if (!deleteTarget) return;
        try {
            await deleteTemplate(deleteTarget.templateCode, deleteTarget.senderKey);
        } catch (error) {
            throw new Error(requestErrorMessage(error, "템플릿을 삭제하지 못했습니다. 다시 시도해주세요."));
        }
        toast.success("템플릿이 삭제되었습니다.");
        refreshTemplates();
    };

    // 실패하면 창과 코멘트를 그대로 두고 사유를 보여 준다(UX-179)
    const handleComment = async () => {
        if (!commentTarget || !commentText.trim() || commenting) return;
        setCommenting(true);
        setCommentError(null);
        try {
            await commentTemplate(commentTarget.templateCode, commentTarget.senderKey, commentText);
            toast.success("검수 요청을 보냈습니다.");
            refreshTemplates();
            setCommentTarget(null);
            setCommentText("");
        } catch (error) {
            setCommentError(requestErrorMessage(error, "검수 요청 결과를 확인하지 못했습니다. 템플릿 상태를 확인한 뒤 다시 시도해주세요."));
        } finally {
            setCommenting(false);
        }
    };
    const closeComment = () => {
        if (commenting) return;
        setCommentTarget(null);
        setCommentText("");
        setCommentError(null);
    };

    const loadError = sendersError || (isAll ? blockingError(allData, allError) : singleError);
    if (loadError) return <QueryErrorState error={loadError} onRetry={() => Promise.all([mutateSenders(), isAll ? mutateAll() : mutateSingle()])} />;
    // 키가 없으면 템플릿을 조회하지 않으므로 '등록된 템플릿 없음'이 아니라 설정 필요로 안내한다(UI확인-V6).
    if (!configLoading && !isConfigured) return <AlimtalkSetupRequired onConfigure={onConfigure} />;

    return (
        <div className="space-y-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <h3 className="text-lg font-medium">템플릿 목록</h3>
                <div className="flex flex-wrap items-center gap-2">
                    <Button onClick={() => {
                        const params = isAll ? "" : `?senderKey=${encodeURIComponent(selectedSenderKey)}`;
                        router.push(`/alimtalk/templates/new${params}`);
                    }}>
                        <Plus className="h-4 w-4 mr-1" /> 템플릿 등록
                    </Button>
                    <Select
                        value={selectedSenderKey}
                        onValueChange={setSelectedSenderKey}
                    >
                        <SelectTrigger className="w-full sm:w-70">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="__all__">전체</SelectItem>
                            {senders.map((sender) => (
                                <SelectItem key={sender.senderKey} value={sender.senderKey}>
                                    {sender.plusFriendId} ({sender.senderKey.slice(0, 8)}...)
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
            </div>

            {/* 임시저장 목록 — 실패해도 템플릿 목록은 그대로 보여준다 */}
            {draftsError && !draftsData && <QueryErrorState error={draftsError} onRetry={() => mutateDrafts()} />}
            {drafts.length > 0 && (
                <div className="space-y-2">
                    <h4 className="text-sm font-medium text-muted-foreground">임시저장 ({drafts.length})</h4>
                    <div className="grid gap-2">
                        {drafts.map((draft) => {
                            const sender = senders.find(s => s.senderKey === draft.senderKey);
                            return (
                                <div key={draft.id} className="flex flex-col gap-3 p-3 border rounded-lg bg-muted/30 md:flex-row md:items-center md:justify-between">
                                    <div className="flex items-start gap-3 min-w-0">
                                        <FileEdit className="h-4 w-4 shrink-0 mt-0.5 text-muted-foreground" />
                                        <div className="min-w-0 flex-1">
                                            <p className="text-sm font-medium truncate">{draft.templateName}</p>
                                            <p className="text-xs text-muted-foreground wrap-break-word">
                                                {draft.templateCode} · {sender?.plusFriendId || draft.senderKey.slice(0, 8)} · {new Date(draft.updatedAt).toLocaleString("ko-KR")}
                                            </p>
                                        </div>
                                        {/* 모바일에선 우측 상단 고정, 데스크톱에선 액션 그룹에 합류 */}
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className="h-8 w-8 shrink-0 md:hidden"
                                            aria-label="초안 삭제"
                                            onClick={() => handleDeleteDraft(draft)}
                                        >
                                            <X className="h-4 w-4" />
                                        </Button>
                                    </div>
                                    <div className="flex flex-wrap items-center gap-1 shrink-0">
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={() => router.push(`/alimtalk/templates/new?draftId=${draft.id}`)}
                                        >
                                            이어서 작성
                                        </Button>
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={() => setDraftPreview(draft)}
                                        >
                                            <Eye className="h-4 w-4 mr-1" /> 미리보기
                                        </Button>
                                        {/* 초안은 아직 공급자에 등록되지 않았다 — 코멘트가 아니라 작성 화면에서 등록(검수 요청)한다(UX-182) */}
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={() => router.push(`/alimtalk/templates/new?draftId=${draft.id}`)}
                                        >
                                            <Send className="h-4 w-4 mr-1" /> 등록·검수요청
                                        </Button>
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className="h-8 w-8 hidden md:inline-flex"
                                            aria-label="초안 삭제"
                                            onClick={() => handleDeleteDraft(draft)}
                                        >
                                            <X className="h-4 w-4" />
                                        </Button>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {isLoading ? (
                <div className="space-y-3">
                    {Array.from({ length: 5 }).map((_, i) => (
                        <Skeleton key={i} className="h-12 w-full" />
                    ))}
                </div>
            ) : templates.length === 0 ? (
                <div className="flex flex-col items-center justify-center p-12 text-muted-foreground border rounded-lg border-dashed">
                    <p className="text-lg mb-1">등록된 템플릿이 없습니다</p>
                    <p className="text-sm">NHN Cloud 콘솔에서 템플릿을 등록해주세요.</p>
                </div>
            ) : (
                <div className="border rounded-lg overflow-x-auto">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>템플릿 코드</TableHead>
                                <TableHead>템플릿명</TableHead>
                                <TableHead>메시지 타입</TableHead>
                                <TableHead>상태</TableHead>
                                <TableHead className="w-[120px]">액션</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {templates.map((tpl) => {
                                const statusVariant = STATUS_VARIANT[tpl.status] ?? "outline";
                                const statusLabel = tpl.statusName || tpl.status;
                                const isApproved = tpl.status === "TSC03";
                                const canEdit = ["TSC01", "TSC03", "TSC04"].includes(tpl.status);
                                const canDelete = ["TSC01", "TSC02", "TSC04"].includes(tpl.status);
                                const canComment = ["TSC01", "TSC04"].includes(tpl.status);

                                return (
                                    <TableRow key={tpl.templateCode}>
                                        <TableCell className="font-mono text-xs">
                                            {tpl.templateCode}
                                        </TableCell>
                                        <TableCell>{tpl.templateName}</TableCell>
                                        <TableCell className="text-sm text-muted-foreground">
                                            {tpl.templateMessageType}
                                        </TableCell>
                                        <TableCell>
                                            <Badge variant={statusVariant}>
                                                {statusLabel}
                                            </Badge>
                                        </TableCell>
                                        <TableCell>
                                            <div className="flex items-center gap-1">
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    className="h-8 w-8"
                                                    onClick={() =>
                                                        setDetailTemplate({
                                                            senderKey: tpl.senderKey,
                                                            templateCode: tpl.templateCode,
                                                        })
                                                    }
                                                >
                                                    <Eye className="h-4 w-4" />
                                                </Button>
                                                <DropdownMenu>
                                                    <DropdownMenuTrigger asChild>
                                                        <Button variant="ghost" size="icon" className="h-8 w-8">
                                                            <MoreHorizontal className="h-4 w-4" />
                                                        </Button>
                                                    </DropdownMenuTrigger>
                                                    <DropdownMenuContent align="end">
                                                        <DropdownMenuItem
                                                            disabled={!canEdit}
                                                            onClick={() => router.push(`/alimtalk/templates/${encodeURIComponent(tpl.templateCode)}?senderKey=${encodeURIComponent(tpl.senderKey)}`)}
                                                        >
                                                            <Pencil className="h-4 w-4 mr-2" /> 수정
                                                        </DropdownMenuItem>
                                                        <DropdownMenuItem
                                                            disabled={!canDelete}
                                                            onClick={() => setDeleteTarget({ senderKey: tpl.senderKey, templateCode: tpl.templateCode, templateName: tpl.templateName })}
                                                        >
                                                            <Trash className="h-4 w-4 mr-2" /> 삭제
                                                        </DropdownMenuItem>
                                                        <DropdownMenuItem
                                                            disabled={!canComment}
                                                            onClick={() => setCommentTarget({ senderKey: tpl.senderKey, templateCode: tpl.templateCode, templateName: tpl.templateName })}
                                                        >
                                                            <Send className="h-4 w-4 mr-2" /> 검수 요청
                                                        </DropdownMenuItem>
                                                        <DropdownMenuItem
                                                            onClick={() => {
                                                                const params = new URLSearchParams({
                                                                    senderKey: tpl.senderKey,
                                                                    cloneFrom: tpl.templateCode,
                                                                });
                                                                router.push(`/alimtalk/templates/new?${params.toString()}`);
                                                            }}
                                                        >
                                                            <Copy className="h-4 w-4 mr-2" /> 복제
                                                        </DropdownMenuItem>
                                                        <DropdownMenuItem
                                                            disabled={!isApproved}
                                                            onClick={() => setTestSendTemplate(tpl)}
                                                        >
                                                            <SendHorizontal className="h-4 w-4 mr-2" /> 테스트 발송
                                                        </DropdownMenuItem>
                                                    </DropdownMenuContent>
                                                </DropdownMenu>
                                            </div>
                                        </TableCell>
                                    </TableRow>
                                );
                            })}
                        </TableBody>
                    </Table>
                </div>
            )}

            {detailTemplate && (
                <TemplateDetailDialog
                    open={!!detailTemplate}
                    onOpenChange={() => setDetailTemplate(null)}
                    senderKey={detailTemplate.senderKey}
                    templateCode={detailTemplate.templateCode}
                    onEdit={(tpl) => { setDetailTemplate(null); router.push(`/alimtalk/templates/${encodeURIComponent(tpl.templateCode)}?senderKey=${encodeURIComponent(detailTemplate.senderKey)}`); }}
                    onDelete={(code) => { setDetailTemplate(null); setDeleteTarget({ senderKey: detailTemplate.senderKey, templateCode: code, templateName: code }); }}
                />
            )}

            {testSendTemplate && (
                <TestSendDialog
                    open={!!testSendTemplate}
                    onOpenChange={() => setTestSendTemplate(null)}
                    template={testSendTemplate}
                />
            )}

            {/* 삭제 확인 — 성공해야 닫히고 실패하면 사유를 보여 준다(UX-179) */}
            <AsyncAlertDialog
                open={!!deleteTarget}
                onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
                title="템플릿 삭제"
                description={`"${deleteTarget?.templateName ?? ""}" 템플릿을 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.`}
                onConfirm={handleDelete}
                pendingLabel="삭제 중..."
            />
            {confirmationDialog}

            {/* 임시저장 미리보기 다이얼로그 */}
            <Dialog open={!!draftPreview} onOpenChange={() => setDraftPreview(null)}>
                <DialogContent className="sm:max-w-sm">
                    <DialogHeader>
                        <DialogTitle>미리보기 — {draftPreview?.templateName}</DialogTitle>
                    </DialogHeader>
                    {draftPreview && (() => {
                        const fd = draftPreview.formData as Record<string, unknown>;
                        return (
                            <TemplatePreview
                                templateContent={(fd.templateContent as string) ?? ""}
                                templateMessageType={(fd.templateMessageType as string) ?? "BA"}
                                templateEmphasizeType={(fd.templateEmphasizeType as string) ?? "NONE"}
                                templateTitle={(fd.templateTitle as string) ?? ""}
                                templateSubtitle={(fd.templateSubtitle as string) ?? ""}
                                templateHeader={(fd.templateHeader as string) ?? ""}
                                templateExtra={(fd.templateExtra as string) ?? ""}
                                templateImageUrl={(fd.templateImageUrl as string) ?? ""}
                                templateImageName={(fd.templateImageName as string) ?? ""}
                                templateItemHighlight={fd.templateItemHighlight as TemplatePreviewProps["templateItemHighlight"]}
                                templateItem={fd.templateItem as TemplatePreviewProps["templateItem"]}
                                templateRepresentLink={fd.templateRepresentLink as TemplatePreviewProps["templateRepresentLink"]}
                                buttons={(fd.buttons as TemplatePreviewProps["buttons"]) ?? []}
                                quickReplies={(fd.quickReplies as TemplatePreviewProps["quickReplies"]) ?? []}
                                interactionType={(fd.interactionType as "buttons" | "quickReplies") ?? "buttons"}
                            />
                        );
                    })()}
                </DialogContent>
            </Dialog>

            {/* 검수 요청 다이얼로그 */}
            <Dialog open={!!commentTarget} onOpenChange={(open) => { if (!open) closeComment(); }}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>검수 요청 — {commentTarget?.templateName}</DialogTitle>
                    </DialogHeader>
                    <Textarea
                        placeholder="검수 요청 코멘트를 입력하세요."
                        value={commentText}
                        onChange={(e) => setCommentText(e.target.value)}
                        rows={4}
                    />
                    {commentError && <p role="alert" className="text-sm text-destructive">{commentError}</p>}
                    <div className="flex justify-end gap-2">
                        <Button variant="outline" onClick={closeComment} disabled={commenting}>
                            취소
                        </Button>
                        <Button onClick={handleComment} disabled={commenting || !commentText.trim()}>
                            {commenting ? "전송 중..." : "검수 요청"}
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    );
}
