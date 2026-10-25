"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useAsyncConfirm } from "@/components/ui/alert-dialog";
import { useSession } from "@/contexts/SessionContext";
import { canDeleteMemo } from "@/lib/memo-permissions";
import { isMemoSubmitKey, MEMO_DELETE_CONFIRM } from "../utils/memo-input";
import { Send, Trash2, User } from "lucide-react";
import { toast } from "sonner";
import { useMemos, type MemoItem } from "../hooks/useMemos";

interface MemoSectionProps {
    recordId: number;
    onMemoChange?: () => void;
}

export default function MemoSection({ recordId, onMemoChange }: MemoSectionProps) {
    const { memos, isLoading, addMemo, deleteMemo } = useMemos(recordId);
    const [content, setContent] = useState("");
    const [isSubmitting, setIsSubmitting] = useState(false);
    const { user } = useSession();
    const { confirm, confirmationDialog } = useAsyncConfirm();

    const handleSubmit = async () => {
        if (!content.trim() || isSubmitting) return;
        setIsSubmitting(true);
        try {
            await addMemo(content.trim());
            setContent("");
            toast.success("메모가 추가되었습니다.");
            onMemoChange?.();
        } catch {
            toast.error("메모 추가에 실패했습니다.");
        } finally {
            setIsSubmitting(false);
        }
    };

    // 확인 후 삭제 — 실패하면 확인창이 열린 채 서버 안내를 보여준다
    const handleDelete = (memo: MemoItem) => {
        confirm({
            ...MEMO_DELETE_CONFIRM,
            onConfirm: async () => {
                await deleteMemo(memo.id);
                toast.success("메모가 삭제되었습니다.");
                onMemoChange?.();
            },
        });
    };

    const formatDateTime = (dateStr: string) => {
        return new Intl.DateTimeFormat("ko-KR", {
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
        }).format(new Date(dateStr));
    };

    return (
        <>
            <div className="space-y-3">
                <h3 className="text-sm font-medium text-muted-foreground">
                    메모 ({memos.length})
                </h3>

                {/* 메모 입력 */}
                <div className="relative">
                    <Textarea
                        value={content}
                        onChange={(e) => setContent(e.target.value)}
                        placeholder="메모를 입력하세요... (Enter로 저장)"
                        className="min-h-[72px] text-sm resize-none pr-12 bg-muted/30"
                        onKeyDown={(e) => {
                            if (isMemoSubmitKey(e)) {
                                e.preventDefault();
                                handleSubmit();
                            }
                        }}
                    />
                    <Button
                        size="icon"
                        variant="ghost"
                        onClick={handleSubmit}
                        disabled={!content.trim() || isSubmitting}
                        className="absolute bottom-2 right-2 h-7 w-7 text-primary hover:text-primary"
                    >
                        <Send className="w-4 h-4" />
                    </Button>
                </div>

                {/* 메모 목록 (타임라인) */}
                {isLoading ? (
                    <p className="text-sm text-muted-foreground py-4 text-center">불러오는 중...</p>
                ) : memos.length === 0 ? (
                    <p className="text-sm text-muted-foreground py-4 text-center">메모가 없습니다.</p>
                ) : (
                    <div className="space-y-0">
                        {memos.map((memo) => (
                            <div key={memo.id} className="text-sm py-2 group/memo">
                                <div className="flex gap-3 items-center mb-1">
                                    <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                                        <User className="w-3 h-3 text-primary" />
                                    </div>
                                    <span className="font-medium text-sm">
                                        {memo.userName || "알 수 없음"}
                                    </span>
                                    <span className="text-xs text-muted-foreground">
                                        {formatDateTime(memo.createdAt)}
                                    </span>
                                    {user && canDeleteMemo(memo, { userId: user.id, role: user.role }) && (
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            aria-label="메모 삭제"
                                            className="ml-auto h-6 w-6 opacity-0 group-hover/memo:opacity-100 focus-visible:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
                                            onClick={() => handleDelete(memo)}
                                        >
                                            <Trash2 className="w-3 h-3" />
                                        </Button>
                                    )}
                                </div>
                                <div className="pl-6 border-l ml-3 whitespace-pre-wrap text-sm">
                                    {memo.content}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {confirmationDialog}
        </>
    );
}
