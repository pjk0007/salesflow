"use client";

import { useRef, useState } from "react";
import { ArrowUp, Check, ChevronDown, FileText, Loader2, Paperclip, Pencil, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Textarea } from "@/components/ui/textarea";
import { DatePicker } from "@/components/ui/date-picker";
import { cn } from "@/lib/utils";
import { useSession } from "@/contexts/SessionContext";
import { useMemos, type MemoAttachmentItem, type MemoItem } from "@/components/records/hooks/useMemos";
import { isMemoSubmitKey } from "@/components/records/utils/memo-input";
import { canEditMemo } from "@/lib/memo-permissions";
import { formatDate, formatDateTime } from "../utils/lead-fields";
import { MEMO_KIND_OPTIONS, memoKindOf, NextContactIcon, type MemoKindValue } from "../utils/memo-kinds";

function Avatar({ name }: { name: string | null }) {
    return (
        <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium">
            {(name ?? "?").slice(0, 1)}
        </div>
    );
}

function formatSize(bytes: number) {
    if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))}KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

function AttachmentList({ items, onRemove }: { items: MemoAttachmentItem[]; onRemove?: (i: number) => void }) {
    return (
        <div className="mt-1.5 flex flex-wrap gap-1.5">
            {items.map((a, i) =>
                a.type.startsWith("image/") && !onRemove ? (
                    <a key={a.url} href={a.url} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-md border">
                        {/* eslint-disable-next-line @next/next/no-img-element -- 외부 저장소 첨부 미리보기 */}
                        <img src={a.url} alt={a.name} className="h-20 w-auto max-w-40 object-cover" />
                    </a>
                ) : (
                    <span key={a.url} className="inline-flex max-w-full items-center gap-1 rounded-md border bg-muted/40 px-2 py-1 text-xs">
                        <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        {onRemove ? (
                            <span className="truncate">{a.name}</span>
                        ) : (
                            <a href={a.url} target="_blank" rel="noreferrer" className="truncate hover:underline">
                                {a.name}
                            </a>
                        )}
                        <span className="shrink-0 text-muted-foreground">{formatSize(a.size)}</span>
                        {onRemove && (
                            <button type="button" onClick={() => onRemove(i)} aria-label="첨부 빼기" className="text-muted-foreground hover:text-foreground">
                                <X className="h-3 w-3" />
                            </button>
                        )}
                    </span>
                ),
            )}
        </div>
    );
}

/** 댓글 종류 고르기 — 입력창 안 작은 버튼 + 드롭다운 */
function KindPicker({ value, onChange }: { value: string | null; onChange: (v: MemoKindValue) => void }) {
    const current = memoKindOf(value) ?? memoKindOf("etc")!;
    return (
        <DropdownMenu>
            <DropdownMenuTrigger className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground outline-none hover:bg-accent">
                <current.icon className="h-3.5 w-3.5" />
                {current.label}
                <ChevronDown className="h-3 w-3" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="min-w-32">
                {MEMO_KIND_OPTIONS.map((k) => (
                    <DropdownMenuItem key={k.value} onClick={() => onChange(k.value)}>
                        <k.icon className="h-4 w-4" />
                        {k.label}
                        {current.value === k.value && <Check className="ml-auto h-4 w-4" />}
                    </DropdownMenuItem>
                ))}
            </DropdownMenuContent>
        </DropdownMenu>
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
    onUpdate: (content: string, kind: string | null) => Promise<void>;
    onDelete: () => Promise<void>;
}) {
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState(memo.content);
    const [draftKind, setDraftKind] = useState<string | null>(memo.kind ?? null);
    const kind = memoKindOf(memo.kind);

    const save = async () => {
        if (!draft.trim()) return;
        try {
            await onUpdate(draft, draftKind);
            setEditing(false);
        } catch (e) {
            toast.error((e as Error).message || "수정에 실패했습니다.");
        }
    };

    return (
        <div className="group relative flex gap-2.5 rounded-md px-2 py-2 hover:bg-muted/50">
            <Avatar name={memo.userName} />
            <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="font-medium">{memo.userName ?? "알 수 없음"}</span>
                    <span className="text-muted-foreground">{formatDateTime(memo.createdAt)}</span>
                    {kind && <span className={cn("rounded px-1 text-[10px] leading-4", kind.className)}>{kind.label}</span>}
                    {memo.nextContactAt && (
                        <span className="inline-flex items-center gap-0.5 text-[11px] text-muted-foreground">
                            <NextContactIcon className="h-3 w-3" />
                            다음 연락 {formatDate(memo.nextContactAt)}
                        </span>
                    )}
                </div>
                {editing ? (
                    <div className="mt-1 space-y-1.5">
                        <Textarea
                            value={draft}
                            onChange={(e) => setDraft(e.target.value)}
                            onKeyDown={(e) => {
                                if (isMemoSubmitKey(e)) {
                                    e.preventDefault();
                                    save();
                                }
                            }}
                            rows={3}
                            autoFocus
                        />
                        <div className="flex items-center justify-end gap-1">
                            <KindPicker value={draftKind} onChange={setDraftKind} />
                            <span className="flex-1" />
                            <Button size="icon" variant="ghost" className="size-7" onClick={() => setEditing(false)} aria-label="취소">
                                <X className="h-3.5 w-3.5" />
                            </Button>
                            <Button size="icon" variant="ghost" className="size-7" onClick={save} aria-label="저장">
                                <Check className="h-3.5 w-3.5" />
                            </Button>
                        </div>
                    </div>
                ) : (
                    memo.content && <p className="mt-0.5 whitespace-pre-wrap break-words text-sm">{memo.content}</p>
                )}
                {memo.attachments && memo.attachments.length > 0 && <AttachmentList items={memo.attachments} />}
            </div>
            {canEdit && !editing && (
                <div className="absolute right-1 top-1 flex opacity-0 group-hover:opacity-100">
                    <Button
                        size="icon"
                        variant="ghost"
                        className="size-7"
                        aria-label="수정"
                        onClick={() => {
                            setDraft(memo.content);
                            setDraftKind(memo.kind ?? null);
                            setEditing(true);
                        }}
                    >
                        <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                        size="icon"
                        variant="ghost"
                        className="size-7 text-destructive"
                        aria-label="삭제"
                        onClick={() => onDelete().catch((e) => toast.error((e as Error).message || "삭제에 실패했습니다."))}
                    >
                        <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                </div>
            )}
        </div>
    );
}

/** 댓글(메모) 목록 — 최신순. 수정·삭제는 쓴 사람만 */
export function LeadCommentList({ recordId }: { recordId: number }) {
    const { user } = useSession();
    const { memos, isLoading, updateMemo, deleteMemo } = useMemos(recordId);
    const counts = MEMO_KIND_OPTIONS.map((k) => ({ ...k, n: memos.filter((m) => m.kind === k.value).length })).filter((k) => k.n > 0);

    return (
        <section className="space-y-2 border-t pt-4">
            <h3 className="flex flex-wrap items-center gap-2 text-xs font-semibold text-muted-foreground">
                댓글 <span className="font-normal">{memos.length}</span>
                {counts.length > 0 && (
                    <span className="font-normal">· {counts.map((k) => `${k.label} ${k.n}`).join(" · ")}</span>
                )}
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
                            canEdit={!!user && canEditMemo(memo, { userId: user.id, role: user.role })}
                            onUpdate={(content, kind) => updateMemo(memo.id, content, kind)}
                            onDelete={() => deleteMemo(memo.id)}
                        />
                    ))}
                </div>
            )}
        </section>
    );
}

/** 패널 아래에 붙는 댓글 입력창 — 종류 선택, 첨부(끌어놓기·붙여넣기·클립), 다음 연락일 */
export function LeadCommentComposer({ recordId, onAdded }: { recordId: number; onAdded?: () => void }) {
    const { addMemo } = useMemos(recordId);
    const [value, setValue] = useState("");
    const [kind, setKind] = useState<MemoKindValue>("etc");
    const [nextContact, setNextContact] = useState("");
    const [files, setFiles] = useState<MemoAttachmentItem[]>([]);
    const [uploading, setUploading] = useState(0);
    const [dragging, setDragging] = useState(false);
    const [sending, setSending] = useState(false);
    const fileInput = useRef<HTMLInputElement>(null);

    const upload = async (list: FileList | File[] | null) => {
        const picked = Array.from(list ?? []);
        if (picked.length === 0) return;
        if (files.length + picked.length > 10) {
            toast.error("첨부파일은 10개까지 올릴 수 있습니다.");
            return;
        }
        setUploading((n) => n + picked.length);
        await Promise.all(
            picked.map(async (file) => {
                try {
                    const form = new FormData();
                    form.append("file", file);
                    const res = await fetch(`/api/records/${recordId}/memos/attachments`, { method: "POST", body: form });
                    const json = await res.json();
                    if (!json.success) throw new Error(json.error);
                    setFiles((prev) => [...prev, json.data]);
                } catch (e) {
                    toast.error(`${file.name}: ${(e as Error).message || "업로드에 실패했습니다."}`);
                } finally {
                    setUploading((n) => n - 1);
                }
            }),
        );
    };

    const canSubmit = (value.trim().length > 0 || files.length > 0) && uploading === 0 && !sending;

    const submit = async () => {
        if (!canSubmit) return;
        setSending(true);
        try {
            await addMemo({
                content: value,
                kind,
                attachments: files,
                // 날짜만 고르므로 한국 시간 오전 9시로 저장
                nextContactAt: nextContact ? `${nextContact}T09:00:00+09:00` : null,
            });
            setValue("");
            setFiles([]);
            setNextContact("");
            onAdded?.();
        } catch (e) {
            toast.error((e as Error).message || "댓글 등록에 실패했습니다.");
        } finally {
            setSending(false);
        }
    };

    return (
        <div
            onDragOver={(e) => {
                if (!e.dataTransfer.types.includes("Files")) return;
                e.preventDefault();
                setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
                if (!e.dataTransfer.files.length) return;
                e.preventDefault();
                setDragging(false);
                upload(e.dataTransfer.files);
            }}
            className={cn(
                "rounded-lg border bg-background focus-within:ring-1 focus-within:ring-ring",
                dragging && "border-dashed border-primary bg-primary/5",
            )}
        >
            <Textarea
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onPaste={(e) => {
                    if (e.clipboardData.files.length > 0) {
                        e.preventDefault();
                        upload(e.clipboardData.files);
                    }
                }}
                onKeyDown={(e) => {
                    if (isMemoSubmitKey(e)) {
                        e.preventDefault();
                        submit();
                    }
                }}
                rows={3}
                placeholder="대응 내용 입력… (Enter 등록 · Shift+Enter 줄바꿈 · 파일은 끌어다 놓거나 붙여넣기)"
                className="min-h-[68px] resize-none border-0 bg-transparent px-3 py-2.5 shadow-none focus-visible:ring-0"
            />
            {(files.length > 0 || uploading > 0) && (
                <div className="px-3">
                    {files.length > 0 && <AttachmentList items={files} onRemove={(i) => setFiles((prev) => prev.filter((_, j) => j !== i))} />}
                    {uploading > 0 && (
                        <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                            <Loader2 className="h-3 w-3 animate-spin" /> 파일 {uploading}개 올리는 중…
                        </p>
                    )}
                </div>
            )}
            <div className="flex items-center justify-between gap-2 px-2 pb-2 pt-1">
                <div className="flex min-w-0 flex-wrap items-center gap-1">
                    <button
                        type="button"
                        onClick={() => fileInput.current?.click()}
                        className="flex items-center rounded-md p-1.5 text-muted-foreground hover:bg-accent"
                        title="파일 첨부"
                        aria-label="파일 첨부"
                    >
                        <Paperclip className="h-3.5 w-3.5" />
                    </button>
                    <input
                        ref={fileInput}
                        type="file"
                        multiple
                        className="hidden"
                        onChange={(e) => {
                            upload(e.target.files);
                            e.target.value = "";
                        }}
                    />
                    <KindPicker value={kind} onChange={setKind} />
                    <DatePicker
                        value={nextContact}
                        onChange={setNextContact}
                        placeholder="다음 연락 지정"
                        clearable
                        compact
                        triggerClassName="h-7 w-auto gap-1.5 border-0 px-2 text-xs shadow-none hover:bg-accent"
                    />
                </div>
                <Button size="icon" className="size-8 shrink-0 rounded-full" disabled={!canSubmit} onClick={submit} aria-label="등록">
                    <ArrowUp className="h-4 w-4" />
                </Button>
            </div>
        </div>
    );
}
