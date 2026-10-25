import { useState } from "react";
import { useAlimtalkSenders } from "@/hooks/useAlimtalkSenders";
import { useAlimtalkConfig } from "@/hooks/useAlimtalkConfig";
import { useSession } from "@/contexts/SessionContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { AsyncAlertDialog } from "@/components/ui/alert-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { MoreHorizontal, Plus, Star, Trash2, MessageSquare, KeyRound } from "lucide-react";
import { toast } from "sonner";
import SenderProfileRegisterDialog from "./SenderProfileRegisterDialog";

export default function SenderProfileList() {
    const { senders, isLoading, deleteSender } = useAlimtalkSenders();
    const { config, setDefaultSender } = useAlimtalkConfig();
    const [registerOpen, setRegisterOpen] = useState(false);
    // 인증 대기(YSC02) 프로필은 등록 요청부터 다시 하지 않고 인증번호 단계로 이어간다(UX-258)
    const [resumePlusFriendId, setResumePlusFriendId] = useState<string | null>(null);
    const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
    const { user } = useSession();
    // 기본 발신프로필 변경·삭제는 조직 전체 발송에 영향을 주므로 관리자만 한다(서버도 403)
    const canManage = !!user && user.role !== "member";

    const handleSetDefault = async (senderKey: string) => {
        const result = await setDefaultSender(senderKey);
        if (result.success) {
            toast.success("기본 발신프로필이 설정되었습니다.");
        } else {
            toast.error(result.error || "설정에 실패했습니다.");
        }
    };

    // 확인창은 성공해야 닫히고 실패하면 사유를 보여 준다
    const handleDelete = async () => {
        if (!deleteTarget) return;
        const result = await deleteSender(deleteTarget);
        if (!result.success) throw new Error(result.error || "삭제에 실패했습니다.");
        toast.success("발신프로필이 삭제되었습니다.");
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
                <Button onClick={() => { setResumePlusFriendId(null); setRegisterOpen(true); }}>
                    <Plus className="h-4 w-4 mr-2" />
                    발신프로필 등록
                </Button>
            </div>

            {!canManage && senders.length > 0 && (
                <p className="text-sm text-muted-foreground">
                    기본 발신프로필 변경과 삭제는 관리자만 할 수 있습니다.
                </p>
            )}

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
                                        {canManage && (
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
                                        )}
                                    </div>

                                    <div className="flex items-center gap-2 mt-3">
                                        <Badge variant={sender.status === "YSC03" ? "default" : "secondary"}>
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
                                    {sender.status === "YSC02" && (
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            className="mt-3"
                                            onClick={() => { setResumePlusFriendId(sender.plusFriendId); setRegisterOpen(true); }}
                                        >
                                            <KeyRound className="h-4 w-4 mr-1" /> 인증번호 입력
                                        </Button>
                                    )}
                                </CardContent>
                            </Card>
                        );
                    })}
                </div>
            )}

            <SenderProfileRegisterDialog
                key={registerOpen ? resumePlusFriendId ?? "new" : "closed"}
                open={registerOpen}
                onOpenChange={setRegisterOpen}
                resumePlusFriendId={resumePlusFriendId}
            />

            <AsyncAlertDialog
                open={!!deleteTarget}
                onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
                title="발신프로필 삭제"
                description="이 발신프로필을 삭제하시겠습니까? 등록한 템플릿도 함께 삭제되며 복구할 수 없습니다."
                onConfirm={handleDelete}
            />
        </div>
    );
}
