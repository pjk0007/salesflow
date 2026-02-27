import { useEffect, useState } from "react";
import { useAlimtalkSenders } from "@/hooks/useAlimtalkSenders";
import { useAlimtalkConfig } from "@/hooks/useAlimtalkConfig";
import { useAlimtalkTemplates } from "@/hooks/useAlimtalkTemplates";
import { useAlimtalkTemplateManage } from "@/hooks/useAlimtalkTemplateManage";
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
import { Eye, Link2, MessageSquare, Plus, MoreHorizontal, Pencil, Trash, Send } from "lucide-react";
import TemplateDetailDialog from "./TemplateDetailDialog";
import TemplateLinkDialog from "./TemplateLinkDialog";
import TemplateCreateDialog from "./TemplateCreateDialog";
import type { NhnTemplate } from "@/lib/nhn-alimtalk";

const STATUS_BADGE: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
    TSC: { label: "생성", variant: "outline" },
    APR: { label: "승인", variant: "default" },
    REJ: { label: "반려", variant: "destructive" },
    REQ: { label: "검수요청", variant: "secondary" },
    STP: { label: "중단", variant: "destructive" },
};

export default function TemplateList() {
    const { senders } = useAlimtalkSenders();
    const { config } = useAlimtalkConfig();
    const [selectedSenderKey, setSelectedSenderKey] = useState<string | null>(null);
    const { templates, isLoading } = useAlimtalkTemplates(selectedSenderKey);

    // 기본 발신프로필 자동 선택
    useEffect(() => {
        if (selectedSenderKey) return;
        if (config?.defaultSenderKey && senders.some((s) => s.senderKey === config.defaultSenderKey)) {
            setSelectedSenderKey(config.defaultSenderKey);
        }
    }, [config?.defaultSenderKey, senders, selectedSenderKey]);
    const { deleteTemplate, commentTemplate } = useAlimtalkTemplateManage(selectedSenderKey);

    const [detailTemplate, setDetailTemplate] = useState<{
        senderKey: string;
        templateCode: string;
    } | null>(null);

    const [linkTemplate, setLinkTemplate] = useState<{
        senderKey: string;
        templateCode: string;
        templateName: string;
        templateContent: string;
    } | null>(null);

    // 생성/수정 다이얼로그
    const [createDialogOpen, setCreateDialogOpen] = useState(false);
    const [editTemplate, setEditTemplate] = useState<NhnTemplate | null>(null);

    // 삭제 확인
    const [deleteTarget, setDeleteTarget] = useState<{ templateCode: string; templateName: string } | null>(null);
    const [deleting, setDeleting] = useState(false);

    // 검수 요청
    const [commentTarget, setCommentTarget] = useState<{ templateCode: string; templateName: string } | null>(null);
    const [commentText, setCommentText] = useState("");
    const [commenting, setCommenting] = useState(false);

    const handleDelete = async () => {
        if (!deleteTarget || !selectedSenderKey) return;
        setDeleting(true);
        await deleteTemplate(deleteTarget.templateCode, selectedSenderKey);
        setDeleting(false);
        setDeleteTarget(null);
    };

    const handleComment = async () => {
        if (!commentTarget || !selectedSenderKey || !commentText.trim()) return;
        setCommenting(true);
        await commentTemplate(commentTarget.templateCode, selectedSenderKey, commentText);
        setCommenting(false);
        setCommentTarget(null);
        setCommentText("");
    };

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <h3 className="text-lg font-medium">템플릿 목록</h3>
                <div className="flex items-center gap-2">
                    {selectedSenderKey && (
                        <Button onClick={() => setCreateDialogOpen(true)}>
                            <Plus className="h-4 w-4 mr-1" /> 템플릿 등록
                        </Button>
                    )}
                    <Select
                        value={selectedSenderKey || ""}
                        onValueChange={(v) => setSelectedSenderKey(v || null)}
                    >
                        <SelectTrigger className="w-[280px]">
                            <SelectValue placeholder="발신프로필 선택" />
                        </SelectTrigger>
                        <SelectContent>
                            {senders.map((sender) => (
                                <SelectItem key={sender.senderKey} value={sender.senderKey}>
                                    {sender.plusFriendId} ({sender.senderKey.slice(0, 8)}...)
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
            </div>

            {!selectedSenderKey ? (
                <div className="flex flex-col items-center justify-center p-12 text-muted-foreground border rounded-lg border-dashed">
                    <MessageSquare className="h-10 w-10 mb-3" />
                    <p>발신프로필을 선택하면 템플릿 목록이 표시됩니다.</p>
                </div>
            ) : isLoading ? (
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
                                const statusInfo = STATUS_BADGE[tpl.templateStatus] || {
                                    label: tpl.templateStatusName || tpl.templateStatus,
                                    variant: "outline" as const,
                                };
                                const isApproved = tpl.templateStatus === "APR";
                                const canEdit = ["TSC", "APR", "REJ"].includes(tpl.templateStatus);
                                const canDelete = ["TSC", "REQ", "REJ"].includes(tpl.templateStatus);
                                const canComment = ["TSC", "REJ"].includes(tpl.templateStatus);

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
                                            <Badge variant={statusInfo.variant}>
                                                {statusInfo.label}
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
                                                            senderKey: selectedSenderKey,
                                                            templateCode: tpl.templateCode,
                                                        })
                                                    }
                                                >
                                                    <Eye className="h-4 w-4" />
                                                </Button>
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    className="h-8 w-8"
                                                    disabled={!isApproved}
                                                    onClick={() =>
                                                        setLinkTemplate({
                                                            senderKey: selectedSenderKey,
                                                            templateCode: tpl.templateCode,
                                                            templateName: tpl.templateName,
                                                            templateContent: tpl.templateContent,
                                                        })
                                                    }
                                                >
                                                    <Link2 className="h-4 w-4" />
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
                                                            onClick={() => setEditTemplate(tpl)}
                                                        >
                                                            <Pencil className="h-4 w-4 mr-2" /> 수정
                                                        </DropdownMenuItem>
                                                        <DropdownMenuItem
                                                            disabled={!canDelete}
                                                            onClick={() => setDeleteTarget({ templateCode: tpl.templateCode, templateName: tpl.templateName })}
                                                        >
                                                            <Trash className="h-4 w-4 mr-2" /> 삭제
                                                        </DropdownMenuItem>
                                                        <DropdownMenuItem
                                                            disabled={!canComment}
                                                            onClick={() => setCommentTarget({ templateCode: tpl.templateCode, templateName: tpl.templateName })}
                                                        >
                                                            <Send className="h-4 w-4 mr-2" /> 검수 요청
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
                    onEdit={(tpl) => { setDetailTemplate(null); setEditTemplate(tpl); }}
                    onDelete={(code) => { setDetailTemplate(null); setDeleteTarget({ templateCode: code, templateName: code }); }}
                />
            )}

            {linkTemplate && (
                <TemplateLinkDialog
                    open={!!linkTemplate}
                    onOpenChange={() => setLinkTemplate(null)}
                    senderKey={linkTemplate.senderKey}
                    templateCode={linkTemplate.templateCode}
                    templateName={linkTemplate.templateName}
                    templateContent={linkTemplate.templateContent}
                    mode="create"
                />
            )}

            {/* 생성 다이얼로그 */}
            {selectedSenderKey && createDialogOpen && (
                <TemplateCreateDialog
                    open={createDialogOpen}
                    onOpenChange={setCreateDialogOpen}
                    senderKey={selectedSenderKey}
                    mode="create"
                />
            )}

            {/* 수정 다이얼로그 */}
            {selectedSenderKey && editTemplate && (
                <TemplateCreateDialog
                    open={!!editTemplate}
                    onOpenChange={() => setEditTemplate(null)}
                    senderKey={selectedSenderKey}
                    mode="edit"
                    template={editTemplate}
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
