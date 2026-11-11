"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Checkbox } from "@/components/ui/checkbox";
import { DatePicker } from "@/components/ui/date-picker";
import { useSession } from "@/contexts/SessionContext";
import { cn } from "@/lib/utils";
import { addActionItem, deleteActionItem, updateActionItem } from "../api";
import type { ActionItem } from "../types";
import { OwnerSelect } from "./OwnerSelect";

const kstDate = (iso: string) => new Date(new Date(iso).getTime() + 9 * 3600_000).toISOString().slice(0, 10);
const todayKst = () => new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);

/** 액션플랜 한 줄 — 체크로 완료, 담당·기한 바로 고치기 */
export function ActionRow({ item, onChanged, meetingLabel }: { item: ActionItem; onChanged: () => void; meetingLabel?: string | null }) {
    const due = item.dueAt ? kstDate(item.dueAt) : "";
    const overdue = !item.doneAt && due && due <= todayKst();
    const patch = async (input: Parameters<typeof updateActionItem>[1]) => {
        const r = await updateActionItem(item.id, input);
        if (!r.success) toast.error(r.error || "저장하지 못했습니다.");
        onChanged();
    };
    return (
        <li className="group flex items-center gap-2 rounded-md px-1.5 py-1 hover:bg-muted/50">
            <Checkbox checked={!!item.doneAt} onCheckedChange={(v) => patch({ done: v === true })} aria-label="완료" />
            <span className="min-w-0 flex-1">
                <span className={cn("block text-sm", item.doneAt && "text-muted-foreground line-through")}>{item.content}</span>
                {meetingLabel && <span className="block truncate text-[11px] text-muted-foreground">{meetingLabel}</span>}
            </span>
            {/* 담당·기한 칸 너비를 고정해 줄마다 위치가 맞게 */}
            <OwnerSelect value={item.ownerId} onChange={(id) => patch({ ownerId: id })} className="w-28 shrink-0" />
            <DatePicker
                value={due}
                onChange={(v) => patch({ dueDate: v || null })}
                placeholder="기한"
                clearable
                compact
                triggerClassName={cn(
                    "h-7 w-28 shrink-0 gap-1.5 border-0 px-2 text-xs shadow-none hover:bg-muted",
                    overdue && "text-rose-600",
                )}
            />
            <button
                type="button"
                className="rounded p-1 text-muted-foreground opacity-0 hover:text-destructive group-hover:opacity-100"
                aria-label="할 일 삭제"
                onClick={async () => {
                    const r = await deleteActionItem(item.id);
                    if (!r.success) toast.error(r.error || "삭제하지 못했습니다.");
                    onChanged();
                }}
            >
                <Trash2 className="h-3.5 w-3.5" />
            </button>
        </li>
    );
}

/** 할 일 추가 줄 — Enter로 추가 (meetingId 있으면 그 미팅의 액션플랜) */
export function AddActionForm({ recordId, meetingId, onChanged }: { recordId: number; meetingId?: number | null; onChanged: () => void }) {
    const { user } = useSession();
    const [text, setText] = useState("");
    return (
        <form
            className="mt-1 flex items-center gap-1.5 px-1.5"
            onSubmit={async (e) => {
                e.preventDefault();
                if (!text.trim()) return;
                const r = await addActionItem({ recordId, content: text, ownerId: user?.id ?? null, dueDate: null, meetingId: meetingId ?? null });
                if (!r.success) toast.error(r.error || "추가하지 못했습니다.");
                setText("");
                onChanged();
            }}
        >
            <Plus className="h-3.5 w-3.5 text-muted-foreground" />
            <input
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="할 일 추가 (Enter)"
                className="h-7 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
        </form>
    );
}

