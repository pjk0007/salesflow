"use client";

import { useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { MessageSquareText, Trash2, ArrowUp } from "lucide-react";
import { toast } from "sonner";
import { useMemos } from "./hooks/useMemos";

interface MemoPopoverProps {
    recordId: number;
    memoCount: number;
    onMemoChange?: () => void;
}

function getInitial(name: string | null) {
    if (!name) return "?";
    return name.charAt(0).toUpperCase();
}

export default function MemoPopover({ recordId, memoCount, onMemoChange }: MemoPopoverProps) {
    const [open, setOpen] = useState(false);
    const { memos, addMemo, deleteMemo } = useMemos(open ? recordId : null);
    const [content, setContent] = useState("");
    const [isSubmitting, setIsSubmitting] = useState(false);

    const handleSubmit = async () => {
        if (!content.trim() || isSubmitting) return;
        setIsSubmitting(true);
        try {
            await addMemo(content.trim());
            setContent("");
            onMemoChange?.();
        } catch {
            toast.error("댓글 추가에 실패했습니다.");
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleDelete = async (memoId: number) => {
        try {
            await deleteMemo(memoId);
            onMemoChange?.();
        } catch {
            toast.error("댓글 삭제에 실패했습니다.");
        }
    };

    const formatDate = (dateStr: string) => {
        return new Intl.DateTimeFormat("ko-KR", {
            month: "long",
            day: "numeric",
        }).format(new Date(dateStr));
    };

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <span
                    className="inline-flex items-center gap-0.5 text-xs text-muted-foreground cursor-pointer hover:text-foreground"
                    onClick={(e) => e.stopPropagation()}
                >
                    <MessageSquareText className="h-3.5 w-3.5" />
                    {memoCount > 0 && memoCount}
                </span>
            </PopoverTrigger>
            <PopoverContent
                className="w-80 p-0 rounded-xl shadow-lg"
                align="end"
                onClick={(e) => e.stopPropagation()}
            >
                {/* 댓글 히스토리 */}
                <div className="max-h-72 overflow-y-auto">
                    {memos.length === 0 ? (
                        <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                            댓글이 없습니다
                        </div>
                    ) : (
                        <div className="py-2">
                            {memos.map((memo) => (
                                <div key={memo.id} className="px-4 py-2 group/memo hover:bg-muted/30">
                                    <div className="flex gap-2.5">
                                        {/* 아바타 */}
                                        <div className="h-7 w-7 rounded-full bg-muted flex items-center justify-center shrink-0 text-xs font-medium text-muted-foreground">
                                            {getInitial(memo.userName)}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            {/* 이름 + 날짜 + 삭제 */}
                                            <div className="flex items-center gap-1.5">
                                                <span className="text-sm font-medium">
                                                    {memo.userName || "알 수 없음"}
                                                </span>
                                                <span className="text-xs text-muted-foreground">
                                                    {formatDate(memo.createdAt)}
                                                </span>
                                                <button
                                                    type="button"
                                                    className="ml-auto opacity-0 group-hover/memo:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
                                                    onClick={() => handleDelete(memo.id)}
                                                >
                                                    <Trash2 className="h-3 w-3" />
                                                </button>
                                            </div>
                                            {/* 본문 */}
                                            <p className="text-sm mt-0.5 whitespace-pre-wrap text-foreground/90">
                                                {memo.content}
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* 입력창 — 노션 스타일 */}
                <div className="border-t px-4 py-3">
                    <div className="flex items-end gap-2">
                        <div className="flex-1 relative">
                            <Textarea
                                value={content}
                                onChange={(e) => setContent(e.target.value)}
                                placeholder="댓글 추가"
                                className="min-h-9 max-h-20 text-sm resize-none pr-10 rounded-lg border-muted-foreground/20"
                                onKeyDown={(e) => {
                                    if (e.key === "Enter" && !e.shiftKey) {
                                        e.preventDefault();
                                        handleSubmit();
                                    }
                                }}
                            />
                            <button
                                type="button"
                                className={`absolute right-2 bottom-1.5 h-6 w-6 rounded-full flex items-center justify-center transition-colors ${
                                    content.trim()
                                        ? "bg-primary text-primary-foreground"
                                        : "bg-muted text-muted-foreground"
                                }`}
                                disabled={!content.trim() || isSubmitting}
                                onClick={handleSubmit}
                            >
                                <ArrowUp className="h-3.5 w-3.5" />
                            </button>
                        </div>
                    </div>
                </div>
            </PopoverContent>
        </Popover>
    );
}
