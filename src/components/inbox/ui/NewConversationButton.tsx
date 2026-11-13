"use client";
import { useState } from "react";
import { MessageSquarePlus } from "lucide-react";
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
import { Hint } from "@/components/ui/hint";
import { inboxWrite } from "../api";

/** 같은 고객과 새 대화 열기 — 지난 상담이 끝났어도 우리가 먼저 다시 이야기할 때 (회원으로 확인된 고객만) */
export function NewConversationButton({
    conversationId,
    customerName,
    available,
    onOpened,
}: {
    conversationId: string;
    customerName: string;
    available: boolean;
    onOpened: (id: string) => void;
}) {
    const [open, setOpen] = useState(false);
    const [busy, setBusy] = useState(false);
    return (
        <>
            <Hint label={available ? "상담 새로 열기" : "고객이 상담창에서 나가 다시 연락할 수 없어요"}>
                <button
                    type="button"
                    aria-label="상담 새로 열기"
                    disabled={!available}
                    onClick={() => setOpen(true)}
                    className="flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground hover:bg-muted disabled:opacity-40"
                >
                    <MessageSquarePlus size={17} />
                </button>
            </Hint>
            <AlertDialog open={open} onOpenChange={(o) => !busy && setOpen(o)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>{customerName}님과 새 대화를 열까요?</AlertDialogTitle>
                        <AlertDialogDescription>
                            고객 상담창에 새 대화가 열리고, 보내는 첫 메시지가 고객에게 새 답변으로 알려져요. 지금 대화는 지난 대화로 남아요.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={busy}>취소</AlertDialogCancel>
                        <AlertDialogAction
                            disabled={busy}
                            onClick={async (e) => {
                                e.preventDefault();
                                setBusy(true);
                                try {
                                    const created = await inboxWrite<{ id: string }>(`/api/inbox/conversations/${conversationId}`, {
                                        action: "new-conversation",
                                    });
                                    setOpen(false);
                                    onOpened(created.id);
                                    toast.success("새 대화를 열었어요. 첫 메시지를 보내주세요.");
                                } catch (err) {
                                    toast.error((err as Error).message);
                                } finally {
                                    setBusy(false);
                                }
                            }}
                        >
                            {busy ? "여는 중…" : "새 대화 열기"}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </>
    );
}
