"use client";

import { useState } from "react";
import { ArrowUp, Check, Pencil, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useSession } from "@/contexts/SessionContext";
import { useMemos, type MemoItem } from "@/components/records/hooks/useMemos";
import { formatDateTime } from "../utils/lead-fields";

/** Enter로 보내고 Shift+Enter는 줄바꿈 — 한글 조합 중 Enter는 무시 */
function isSubmitKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    return e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing;
}

function Avatar({ name }: { name: string | null }) {
    return (
        <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium">
            {(name ?? "?").slice(0, 1)}
        </div>
    );
}

function CommentItem({
    memo,
    canEdit,
    onUpdate,
    onDelete,
}: {
    memo: MemoItem;
    canEdit: boolean;
    onUpdate: (content: string) => Promise<void>;
    onDelete: () => Promise<void>;
}) {
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState(memo.content);

    const save = async () => {
        if (!draft.trim()) return;
        try {
            await onUpdate(draft);
            setEditing(false);
        } catch (e) {
            toast.error((e as Error).message || "수정에 실패했습니다.");
        }
    };

    return (
        <div className="group relative flex gap-2.5 rounded-md px-2 py-2 hover:bg-muted/50">
            <Avatar name={memo.userName} />
            <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-xs">
                    <span className="font-medium">{memo.userName ?? "알 수 없음"}</span>
                    <span className="text-muted-foreground">{formatDateTime(memo.createdAt)}</span>
                </div>
                {editing ? (
                    <div className="mt-1 space-y-1.5">
                        <Textarea
                            value={draft}
                            onChange={(e) => setDraft(e.target.value)}
                            onKeyDown={(e) => {
                                if (isSubmitKey(e)) {
                                    e.preventDefault();
                                    save();
                                }
                            }}
                            rows={3}
                            autoFocus
                        />
                        <div className="flex justify-end gap-1">
                            <Button size="icon" variant="ghost" className="size-7" onClick={() => setEditing(false)}>
                                <X className="h-3.5 w-3.5" />
                            </Button>
                            <Button size="icon" variant="ghost" className="size-7" onClick={save}>
                                <Check className="h-3.5 w-3.5" />
                            </Button>
                        </div>
                    </div>
                ) : (
                    <p className="mt-0.5 whitespace-pre-wrap break-words text-sm">{memo.content}</p>
                )}
            </div>
            {canEdit && !editing && (
                <div className="absolute right-1 top-1 flex opacity-0 group-hover:opacity-100">
                    <Button
                        size="icon"
                        variant="ghost"
                        className="size-7"
                        onClick={() => {
                            setDraft(memo.content);
                            setEditing(true);
                        }}
                    >
                        <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                        size="icon"
                        variant="ghost"
                        className="size-7 text-destructive"
                        onClick={() => onDelete().catch((e) => toast.error((e as Error).message || "삭제에 실패했습니다."))}
                    >
                        <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                </div>
            )}
        </div>
    );
}

/** 댓글(메모) 목록 — 최신순 */
export function LeadCommentList({ recordId }: { recordId: number }) {
    const { user } = useSession();
    const { memos, isLoading, updateMemo, deleteMemo } = useMemos(recordId);

    return (
        <section className="space-y-2 border-t pt-4">
            <h3 className="text-xs font-semibold text-muted-foreground">
                댓글 <span className="font-normal">{memos.length}</span>
            </h3>
            {isLoading ? (
                <p className="px-2 text-sm text-muted-foreground">불러오는 중…</p>
            ) : memos.length === 0 ? (
                <p className="px-2 text-sm text-muted-foreground">아직 댓글이 없습니다. 아래에서 대응 내용을 남겨주세요.</p>
            ) : (
                <div className="space-y-0.5">
                    {memos.map((memo) => (
                        <CommentItem
                            key={memo.id}
                            memo={memo}
                            canEdit={memo.createdBy === user?.id}
                            onUpdate={(content) => updateMemo(memo.id, content)}
                            onDelete={() => deleteMemo(memo.id)}
                        />
                    ))}
                </div>
            )}
        </section>
    );
}

/** 패널 아래에 붙는 댓글 입력창 */
export function LeadCommentComposer({ recordId, onAdded }: { recordId: number; onAdded?: () => void }) {
    const { addMemo } = useMemos(recordId);
    const [value, setValue] = useState("");
    const [sending, setSending] = useState(false);

    const submit = async () => {
        if (!value.trim() || sending) return;
        setSending(true);
        try {
            await addMemo(value);
            setValue("");
            onAdded?.();
        } catch (e) {
            toast.error((e as Error).message || "댓글 등록에 실패했습니다.");
        } finally {
            setSending(false);
        }
    };

    return (
        <div className="rounded-lg border bg-background focus-within:ring-1 focus-within:ring-ring">
            <Textarea
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={(e) => {
                    if (isSubmitKey(e)) {
                        e.preventDefault();
                        submit();
                    }
                }}
                rows={3}
                placeholder="댓글 · 메모 입력… (Enter 등록 · Shift+Enter 줄바꿈)"
                className="min-h-[68px] resize-none border-0 bg-transparent px-3 py-2.5 shadow-none focus-visible:ring-0"
            />
            <div className="flex items-center justify-end px-2 pb-2">
                <Button size="icon" className="size-8 rounded-full" disabled={!value.trim() || sending} onClick={submit} aria-label="등록">
                    <ArrowUp className="h-4 w-4" />
                </Button>
            </div>
        </div>
    );
}
