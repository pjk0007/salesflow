import { useState } from "react";
import { useAlimtalkSenders } from "@/hooks/useAlimtalkSenders";
import { useAlimtalkConfig } from "@/hooks/useAlimtalkConfig";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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
import { Skeleton } from "@/components/ui/skeleton";
import { MoreHorizontal, Plus, Star, Trash2, MessageSquare } from "lucide-react";
import { toast } from "sonner";
import SenderProfileRegisterDialog from "./SenderProfileRegisterDialog";

export default function SenderProfileList() {
    const { senders, isLoading, deleteSender } = useAlimtalkSenders();
    const { config, setDefaultSender } = useAlimtalkConfig();
    const [registerOpen, setRegisterOpen] = useState(false);
    const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

    const handleSetDefault = async (senderKey: string) => {
        const result = await setDefaultSender(senderKey);
        if (result.success) {
            toast.success("기본 발신프로필이 설정되었습니다.");
        } else {
            toast.error(result.error || "설정에 실패했습니다.");
        }
    };

    const handleDelete = async () => {
        if (!deleteTarget) return;
        const result = await deleteSender(deleteTarget);
        if (result.success) {
            toast.success("발신프로필이 삭제되었습니다.");
        } else {
            toast.error(result.error || "삭제에 실패했습니다.");
        }
        setDeleteTarget(null);
    };

    if (isLoading) {
        return (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {Array.from({ length: 3 }).map((_, i) => (
                    <Skeleton key={i} className="h-32" />
                ))}
            </div>
        );
    }

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <h3 className="text-lg font-medium">발신프로필 목록</h3>
                <Button onClick={() => setRegisterOpen(true)}>
                    <Plus className="h-4 w-4 mr-2" />
                    발신프로필 등록
                </Button>
            </div>

            {senders.length === 0 ? (
                <div className="flex flex-col items-center justify-center p-12 text-muted-foreground border rounded-lg border-dashed">
                    <MessageSquare className="h-10 w-10 mb-3" />
                    <p className="text-lg mb-1">등록된 발신프로필이 없습니다</p>
                    <p className="text-sm">카카오 채널을 등록하여 알림톡을 발송해보세요.</p>
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {senders.map((sender) => {
                        const isDefault = config?.defaultSenderKey === sender.senderKey;
                        return (
                            <Card key={sender.senderKey}>
                                <CardContent className="p-4">
                                    <div className="flex items-start justify-between">
                                        <div className="space-y-1">
                                            <div className="flex items-center gap-2">
                                                <span className="font-medium">
                                                    {sender.plusFriendId}
                                                </span>
                                                {isDefault && (
                                                    <Badge variant="default" className="text-xs">
                                                        <Star className="h-3 w-3 mr-1" />
                                                        기본
                                                    </Badge>
                                                )}
                                            </div>
                                            <p className="text-xs text-muted-foreground font-mono">
                                                {sender.senderKey}
                                            </p>
                                        </div>
                                        <DropdownMenu>
                                            <DropdownMenuTrigger asChild>
                                                <Button variant="ghost" size="icon" className="h-8 w-8">
                                                    <MoreHorizontal className="h-4 w-4" />
                                                </Button>
                                            </DropdownMenuTrigger>
                                            <DropdownMenuContent align="end">
                                                {!isDefault && (
                                                    <DropdownMenuItem
                                                        onClick={() => handleSetDefault(sender.senderKey)}
                                                    >
                                                        <Star className="h-4 w-4 mr-2" />
                                                        기본으로 설정
                                                    </DropdownMenuItem>
                                                )}
                                                <DropdownMenuItem
                                                    className="text-destructive"
                                                    onClick={() => setDeleteTarget(sender.senderKey)}
                                                >
                                                    <Trash2 className="h-4 w-4 mr-2" />
                                                    삭제
                                                </DropdownMenuItem>
                                            </DropdownMenuContent>
                                        </DropdownMenu>
                                    </div>

                                    <div className="flex items-center gap-2 mt-3">
                                        <Badge variant={sender.status === "YSC" ? "default" : "secondary"}>
                                            {sender.statusName || sender.status}
                                        </Badge>
                                        {sender.alimtalk && (
                                            <Badge variant="outline" className="text-xs">
                                                알림톡
                                            </Badge>
                                        )}
                                    </div>

                                    <p className="text-xs text-muted-foreground mt-2">
                                        등록일: {sender.createDate}
                                    </p>
                                </CardContent>
                            </Card>
                        );
                    })}
                </div>
            )}

            <SenderProfileRegisterDialog
                open={registerOpen}
                onOpenChange={setRegisterOpen}
            />

            <AlertDialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>발신프로필 삭제</AlertDialogTitle>
                        <AlertDialogDescription>
                            이 발신프로필을 삭제하시겠습니까? 삭제 후 복구할 수 없습니다.
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
