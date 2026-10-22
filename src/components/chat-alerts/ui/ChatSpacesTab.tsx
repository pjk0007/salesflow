import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
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
import { Loader2, Pencil, Plus, Send, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useChatSpaces } from "../hooks/useChatSpaces";
import { testChatSpace } from "../api";
import type { ChatSpaceItem } from "../types";

type EditTarget = { mode: "create" } | { mode: "edit"; space: ChatSpaceItem };

export default function ChatSpacesTab() {
    const { spaces, isLoading, create, update, remove } = useChatSpaces();
    const [editTarget, setEditTarget] = useState<EditTarget | null>(null);
    const [name, setName] = useState("");
    const [webhookUrl, setWebhookUrl] = useState("");
    const [saving, setSaving] = useState(false);
    const [testingId, setTestingId] = useState<number | null>(null);
    const [deleteTarget, setDeleteTarget] = useState<ChatSpaceItem | null>(null);

    const openEditor = (target: EditTarget) => {
        setEditTarget(target);
        setName(target.mode === "edit" ? target.space.name : "");
        setWebhookUrl("");
    };

    const handleSave = async () => {
        if (!editTarget) return;
        if (!name.trim()) {
            toast.error("스페이스 이름을 입력해주세요.");
            return;
        }
        if (editTarget.mode === "create" && !webhookUrl.trim()) {
            toast.error("웹훅 주소를 입력해주세요.");
            return;
        }
        setSaving(true);
        const input = { name: name.trim(), webhookUrl: webhookUrl.trim() || undefined };
        const result = editTarget.mode === "create" ? await create(input) : await update(editTarget.space.id, input);
        setSaving(false);
        if (result.success) {
            toast.success(editTarget.mode === "create" ? "스페이스를 등록했습니다. 시험 전송으로 확인해보세요." : "스페이스를 수정했습니다.");
            setEditTarget(null);
        } else {
            toast.error(result.error || "저장에 실패했습니다.");
        }
    };

    const handleTest = async (space: ChatSpaceItem) => {
        setTestingId(space.id);
        const result = await testChatSpace(space.id);
        setTestingId(null);
        if (result.success) toast.success(`'${space.name}' 스페이스에 시험 메시지를 보냈습니다.`);
        else toast.error(result.error || "시험 전송에 실패했습니다.");
    };

    const handleDelete = async () => {
        if (!deleteTarget) return;
        const result = await remove(deleteTarget.id);
        if (result.success) toast.success("스페이스를 삭제했습니다.");
        else toast.error(result.error || "삭제에 실패했습니다.");
        setDeleteTarget(null);
    };

    if (isLoading) {
        return <div className="text-muted-foreground py-8 text-center">로딩 중...</div>;
    }

    return (
        <div className="space-y-6">
            <Card>
                <CardHeader>
                    <CardTitle>구글챗 알림 스페이스</CardTitle>
                    <CardDescription>
                        웹폼·외부 API·광고로 리드가 들어오면 알릴 구글챗 스페이스를 등록합니다. 파티션 설정에서 스페이스를 고르면 알림이 켜집니다.
                    </CardDescription>
                    <CardAction>
                        <Button onClick={() => openEditor({ mode: "create" })}>
                            <Plus className="h-4 w-4 mr-2" />
                            스페이스 등록
                        </Button>
                    </CardAction>
                </CardHeader>
                <CardContent>
                    {spaces.length === 0 ? (
                        <div className="text-center py-8 text-muted-foreground text-sm">등록된 스페이스가 없습니다.</div>
                    ) : (
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>이름</TableHead>
                                    <TableHead>웹훅</TableHead>
                                    <TableHead>사용 파티션</TableHead>
                                    <TableHead className="w-[1%]" />
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {spaces.map((space) => (
                                    <TableRow key={space.id}>
                                        <TableCell className="font-medium">{space.name}</TableCell>
                                        <TableCell className="text-muted-foreground font-mono text-xs">{space.webhookHint}</TableCell>
                                        <TableCell>{space.partitionCount}개</TableCell>
                                        <TableCell>
                                            <div className="flex gap-1">
                                                <Button variant="outline" size="sm" onClick={() => handleTest(space)} disabled={testingId === space.id}>
                                                    {testingId === space.id ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Send className="h-3.5 w-3.5 mr-1" />}
                                                    시험 전송
                                                </Button>
                                                <Button variant="ghost" size="icon" onClick={() => openEditor({ mode: "edit", space })} aria-label="수정">
                                                    <Pencil className="h-3.5 w-3.5" />
                                                </Button>
                                                <Button variant="ghost" size="icon" onClick={() => setDeleteTarget(space)} aria-label="삭제">
                                                    <Trash2 className="h-3.5 w-3.5 text-destructive" />
                                                </Button>
                                            </div>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    )}
                </CardContent>
            </Card>

            <Dialog open={!!editTarget} onOpenChange={(open) => !open && setEditTarget(null)}>
                <DialogContent className="max-w-lg">
                    <DialogHeader>
                        <DialogTitle>{editTarget?.mode === "edit" ? "스페이스 수정" : "스페이스 등록"}</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4">
                        <div className="space-y-1.5">
                            <Label>이름</Label>
                            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="예: 제조 리드 알림" />
                        </div>
                        <div className="space-y-1.5">
                            <Label>웹훅 주소</Label>
                            <Input
                                value={webhookUrl}
                                onChange={(e) => setWebhookUrl(e.target.value)}
                                placeholder={editTarget?.mode === "edit" ? "바꿀 때만 입력 (비우면 기존 주소 유지)" : "https://chat.googleapis.com/v1/spaces/..."}
                            />
                            <p className="text-xs text-muted-foreground leading-relaxed">
                                구글챗에서 스페이스 이름 → 앱 및 통합 → 웹훅 추가로 만든 주소를 붙여넣으세요. 저장 뒤에는 주소 전체를 다시 보여주지 않습니다.
                            </p>
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setEditTarget(null)} disabled={saving}>
                            취소
                        </Button>
                        <Button onClick={handleSave} disabled={saving}>
                            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                            저장
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>스페이스 삭제</AlertDialogTitle>
                        <AlertDialogDescription>
                            &apos;{deleteTarget?.name}&apos; 스페이스를 삭제합니다.
                            {deleteTarget && deleteTarget.partitionCount > 0 && ` 이 스페이스를 쓰는 파티션 ${deleteTarget.partitionCount}개의 알림이 꺼집니다.`}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>취소</AlertDialogCancel>
                        <AlertDialogAction onClick={handleDelete}>삭제</AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
}
