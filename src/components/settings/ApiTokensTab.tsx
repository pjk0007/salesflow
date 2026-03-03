import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
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
import { toast } from "sonner";
import { useApiTokens } from "@/hooks/useApiTokens";
import { useSession } from "@/contexts/SessionContext";
import ApiTokenCreateDialog from "./ApiTokenCreateDialog";
import { Plus, MoreHorizontal, Pencil, Trash2, Copy, Check } from "lucide-react";

function formatRelativeTime(dateStr: string | null): string {
    if (!dateStr) return "-";
    const diff = Date.now() - new Date(dateStr).getTime();
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return "방금 전";
    if (minutes < 60) return `${minutes}분 전`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}시간 전`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `${days}일 전`;
    return new Date(dateStr).toLocaleDateString("ko-KR");
}

function formatDate(dateStr: string | null): string {
    if (!dateStr) return "무제한";
    return new Date(dateStr).toLocaleDateString("ko-KR");
}

export default function ApiTokensTab() {
    const { user } = useSession();
    const { tokens, isLoading, createToken, updateToken, deleteToken } = useApiTokens();
    const canEdit = user?.role === "owner" || user?.role === "admin";

    const [createDialogOpen, setCreateDialogOpen] = useState(false);
    const [editToken, setEditToken] = useState<(typeof tokens)[0] | null>(null);
    const [deleteTarget, setDeleteTarget] = useState<number | null>(null);
    const [createdToken, setCreatedToken] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);

    const handleCreate = async (input: Parameters<typeof createToken>[0]) => {
        const result = await createToken(input);
        if (result.success && result.data?.token) {
            setCreatedToken(result.data.token);
            toast.success("토큰이 생성되었습니다.");
        }
        return result;
    };

    const handleEdit = async (input: Parameters<typeof createToken>[0]) => {
        if (!editToken) return { success: false };
        const result = await updateToken(editToken.id, {
            name: input.name,
            scopes: input.scopes,
        });
        if (result.success) {
            toast.success("토큰이 수정되었습니다.");
        }
        return result;
    };

    const handleDelete = async () => {
        if (!deleteTarget) return;
        const result = await deleteToken(deleteTarget);
        if (result.success) {
            toast.success("토큰이 삭제되었습니다.");
        } else {
            toast.error(result.error || "삭제에 실패했습니다.");
        }
        setDeleteTarget(null);
    };

    const handleToggleActive = async (id: number, currentActive: number) => {
        const result = await updateToken(id, { isActive: currentActive === 1 ? 0 : 1 });
        if (result.success) {
            toast.success(currentActive === 1 ? "토큰이 비활성화되었습니다." : "토큰이 활성화되었습니다.");
        }
    };

    const handleCopy = async (text: string) => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    if (isLoading) {
        return <div className="text-muted-foreground py-8 text-center">로딩 중...</div>;
    }

    return (
        <div className="space-y-6">
            <Card>
                <CardHeader className="flex-row items-center justify-between space-y-0">
                    <div>
                        <CardTitle>API 토큰</CardTitle>
                        <CardDescription>외부 시스템에서 레코드 데이터에 접근하기 위한 API 토큰을 관리합니다.</CardDescription>
                    </div>
                    {canEdit && (
                        <Button onClick={() => setCreateDialogOpen(true)}>
                            <Plus className="h-4 w-4 mr-2" />
                            토큰 생성
                        </Button>
                    )}
                </CardHeader>
                <CardContent>
                    {tokens.length === 0 ? (
                        <div className="text-center py-8 text-muted-foreground text-sm">
                            등록된 API 토큰이 없습니다.
                        </div>
                    ) : (
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>이름</TableHead>
                                    <TableHead>토큰</TableHead>
                                    <TableHead>권한</TableHead>
                                    <TableHead>마지막 사용</TableHead>
                                    <TableHead>만료</TableHead>
                                    <TableHead>상태</TableHead>
                                    {canEdit && <TableHead className="w-10" />}
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {tokens.map((token) => (
                                    <TableRow key={token.id}>
                                        <TableCell className="font-medium">{token.name}</TableCell>
                                        <TableCell>
                                            <code className="text-xs font-mono bg-muted px-1.5 py-0.5 rounded">
                                                {token.tokenPreview}
                                            </code>
                                        </TableCell>
                                        <TableCell>
                                            <Badge variant="secondary">
                                                {token.scopes.length}개 범위
                                            </Badge>
                                        </TableCell>
                                        <TableCell className="text-sm text-muted-foreground">
                                            {formatRelativeTime(token.lastUsedAt)}
                                        </TableCell>
                                        <TableCell className="text-sm text-muted-foreground">
                                            {formatDate(token.expiresAt)}
                                        </TableCell>
                                        <TableCell>
                                            <Switch
                                                checked={token.isActive === 1}
                                                onCheckedChange={() => handleToggleActive(token.id, token.isActive)}
                                                disabled={!canEdit}
                                            />
                                        </TableCell>
                                        {canEdit && (
                                            <TableCell>
                                                <DropdownMenu>
                                                    <DropdownMenuTrigger asChild>
                                                        <Button variant="ghost" size="icon" className="h-8 w-8">
                                                            <MoreHorizontal className="h-4 w-4" />
                                                        </Button>
                                                    </DropdownMenuTrigger>
                                                    <DropdownMenuContent align="end">
                                                        <DropdownMenuItem onClick={() => setEditToken(token)}>
                                                            <Pencil className="h-4 w-4 mr-2" />
                                                            수정
                                                        </DropdownMenuItem>
                                                        <DropdownMenuItem
                                                            className="text-destructive"
                                                            onClick={() => setDeleteTarget(token.id)}
                                                        >
                                                            <Trash2 className="h-4 w-4 mr-2" />
                                                            삭제
                                                        </DropdownMenuItem>
                                                    </DropdownMenuContent>
                                                </DropdownMenu>
                                            </TableCell>
                                        )}
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    )}
                </CardContent>
            </Card>

            {/* 생성 다이얼로그 */}
            <ApiTokenCreateDialog
                open={createDialogOpen}
                onOpenChange={setCreateDialogOpen}
                mode="create"
                onSubmit={handleCreate}
            />

            {/* 수정 다이얼로그 */}
            {editToken && (
                <ApiTokenCreateDialog
                    open={!!editToken}
                    onOpenChange={(open) => !open && setEditToken(null)}
                    mode="edit"
                    token={editToken}
                    onSubmit={handleEdit}
                />
            )}

            {/* 삭제 확인 */}
            <AlertDialog open={deleteTarget !== null} onOpenChange={(open) => !open && setDeleteTarget(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>토큰을 삭제하시겠습니까?</AlertDialogTitle>
                        <AlertDialogDescription>
                            삭제된 토큰은 즉시 비활성화되며, 이 토큰을 사용하는 외부 시스템은 더 이상 접근할 수 없습니다.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>취소</AlertDialogCancel>
                        <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                            삭제
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            {/* 생성된 토큰 표시 */}
            <AlertDialog open={createdToken !== null} onOpenChange={(open) => !open && setCreatedToken(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>토큰이 생성되었습니다</AlertDialogTitle>
                        <AlertDialogDescription>
                            이 토큰은 다시 표시되지 않습니다. 안전한 곳에 저장해주세요.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <div className="flex items-center gap-2 p-3 bg-muted rounded-md">
                        <code className="text-sm font-mono flex-1 break-all">{createdToken}</code>
                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 shrink-0"
                            onClick={() => handleCopy(createdToken!)}
                        >
                            {copied ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
                        </Button>
                    </div>
                    <AlertDialogFooter>
                        <AlertDialogAction onClick={() => setCreatedToken(null)}>확인</AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
}
