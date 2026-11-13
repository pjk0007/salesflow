"use client";

import { toast } from "sonner";
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
import { workspaceLabel } from "@/lib/workspace-label";
import { useLeadWorkspaces } from "../hooks/useLeadWorkspaces";
import { removeLeadBox } from "../api";

/** 리드관리 탭 오른쪽 클릭 "리드함 삭제" 확인창 — 리드가 없을 때만 빈 리드함을 지워 모두의 탭에서 뺀다 */
export function LeadTabRemoveDialog({ workspaceId, onClose, onRemoved }: { workspaceId: number | null; onClose: () => void; onRemoved?: (workspaceId: number) => void }) {
    const { workspaces, mutate } = useLeadWorkspaces();
    const target = workspaces.find((w) => w.id === workspaceId);
    const name = target ? workspaceLabel(target) : "이 사업부";
    const leads = target?.leads ?? 0;

    const remove = async () => {
        if (workspaceId === null) return;
        const result = await removeLeadBox(workspaceId);
        if (!result.success) {
            toast.error(result.error || "리드함을 삭제하지 못했습니다.");
            return;
        }
        await mutate();
        onRemoved?.(workspaceId);
    };

    return (
        <AlertDialog open={workspaceId !== null} onOpenChange={(v) => !v && onClose()}>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>{leads > 0 ? "삭제할 수 없어요" : "리드함을 삭제할까요?"}</AlertDialogTitle>
                    <AlertDialogDescription>
                        {leads > 0
                            ? `${name}에 리드가 ${leads}건 있어요. 나에게만 안 보이게 하려면 "탭 숨기기"를 쓰세요.`
                            : `${name}의 빈 리드함을 지워 모든 사람의 리드관리에서 뺍니다.`}
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    {leads > 0 ? (
                        <AlertDialogCancel>확인</AlertDialogCancel>
                    ) : (
                        <>
                            <AlertDialogCancel>취소</AlertDialogCancel>
                            <AlertDialogAction variant="destructive" onClick={remove}>
                                삭제
                            </AlertDialogAction>
                        </>
                    )}
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
}
