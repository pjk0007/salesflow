import { useState, useMemo } from "react";
import useSWR from "swr";
import { useRouter } from "next/navigation";
import { useAlimtalkSenders } from "@/hooks/useAlimtalkSenders";
import { useAlimtalkTemplates } from "@/hooks/useAlimtalkTemplates";
import { useAlimtalkTemplateManage } from "@/hooks/useAlimtalkTemplateManage";
import { defaultFetcher } from "@/lib/swr-fetcher";
import type { NhnTemplate } from "@/lib/nhn-alimtalk";
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
import { Eye, Plus, MoreHorizontal, Pencil, Trash, Send, SendHorizontal, Copy } from "lucide-react";
import TemplateDetailDialog from "./TemplateDetailDialog";
import TestSendDialog from "./TestSendDialog";

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
    TSC01: "outline",       // 생성
    TSC02: "secondary",     // 검수중
    TSC03: "default",       // 승인
    TSC04: "destructive",   // 반려
    TSC05: "destructive",   // 중단
};

export default function TemplateList() {
    const router = useRouter();
    const { senders } = useAlimtalkSenders();
    const [selectedSenderKey, setSelectedSenderKey] = useState<string>("__all__");
    const isAll = selectedSenderKey === "__all__";
    const singleSenderKey = isAll ? null : selectedSenderKey;

    // 단일 발신프로필 선택 시
    const { templates: singleTemplates, isLoading: singleLoading } = useAlimtalkTemplates(singleSenderKey);

    // 전체 선택 시 — 모든 sender 병렬 조회
    const allSenderKeys = useMemo(() => senders.map((s) => s.senderKey), [senders]);
    const { data: allData, isLoading: allLoading } = useSWR(
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

    const [detailTemplate, setDetailTemplate] = useState<{
        senderKey: string;
        templateCode: string;
    } | null>(null);

    // 테스트 발송
    const [testSendTemplate, setTestSendTemplate] = useState<{
        senderKey: string;
        templateCode: string;
        templateContent: string;
    } | null>(null);

    // 삭제 확인
    const [deleteTarget, setDeleteTarget] = useState<{ senderKey: string; templateCode: string; templateName: string } | null>(null);
    const [deleting, setDeleting] = useState(false);

    // 검수 요청
    const [commentTarget, setCommentTarget] = useState<{ senderKey: string; templateCode: string; templateName: string } | null>(null);
    const [commentText, setCommentText] = useState("");
    const [commenting, setCommenting] = useState(false);

    const handleDelete = async () => {
        if (!deleteTarget) return;
        setDeleting(true);
        await deleteTemplate(deleteTarget.templateCode, deleteTarget.senderKey);
        setDeleting(false);
        setDeleteTarget(null);
    };

    const handleComment = async () => {
        if (!commentTarget || !commentText.trim()) return;
        setCommenting(true);
        await commentTemplate(commentTarget.templateCode, commentTarget.senderKey, commentText);
        setCommenting(false);
        setCommentTarget(null);
        setCommentText("");
    };

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <h3 className="text-lg font-medium">템플릿 목록</h3>
                <div className="flex items-center gap-2">
                    {!isAll && (
                        <Button onClick={() => router.push(`/alimtalk/templates/new?senderKey=${encodeURIComponent(selectedSenderKey)}`)}>
                            <Plus className="h-4 w-4 mr-1" /> 템플릿 등록
                        </Button>
                    )}
                    <Select
                        value={selectedSenderKey}
                        onValueChange={setSelectedSenderKey}
                    >
                        <SelectTrigger className="w-[280px]">
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
                <div className="border rounded-lg">
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
                                                            onClick={() => setTestSendTemplate({
                                                                senderKey: tpl.senderKey,
                                                                templateCode: tpl.templateCode,
                                                                templateContent: tpl.templateContent,
                                                            })}
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
                    senderKey={testSendTemplate.senderKey}
                    templateCode={testSendTemplate.templateCode}
                    templateContent={testSendTemplate.templateContent}
                />
            )}

            {/* 삭제 확인 */}
            <AlertDialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>템플릿 삭제</AlertDialogTitle>
                        <AlertDialogDescription>
                            &quot;{deleteTarget?.templateName}&quot; 템플릿을 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={deleting}>취소</AlertDialogCancel>
                        <AlertDialogAction onClick={handleDelete} disabled={deleting}>
                            {deleting ? "삭제 중..." : "삭제"}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            {/* 검수 요청 다이얼로그 */}
            <Dialog open={!!commentTarget} onOpenChange={() => { setCommentTarget(null); setCommentText(""); }}>
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
                    <div className="flex justify-end gap-2">
                        <Button variant="outline" onClick={() => { setCommentTarget(null); setCommentText(""); }} disabled={commenting}>
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
