"use client";

import { useState } from "react";
import { CalendarDays, ChevronDown, ChevronRight, Pencil, Plus, Trash2, Users } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DatePicker } from "@/components/ui/date-picker";
import { useSession } from "@/contexts/SessionContext";
import { cn } from "@/lib/utils";
import { addActionItem, deleteActionItem, deleteMeeting, updateActionItem } from "../api";
import { useMeetings } from "../hooks/useMeetings";
import type { ActionItem, Meeting } from "../types";
import { MeetingDialog } from "./MeetingDialog";
import { OwnerSelect } from "./OwnerSelect";

const kstDate = (iso: string) => new Date(new Date(iso).getTime() + 9 * 3600_000).toISOString().slice(0, 10);
const dot = (d: string) => d.replaceAll("-", ".");
const todayKst = () => new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);

/** 액션플랜 한 줄 — 체크로 완료, 담당·기한 바로 고치기 */
function ActionRow({ item, onChanged }: { item: ActionItem; onChanged: () => void }) {
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
            <span className={cn("min-w-0 flex-1 text-sm", item.doneAt && "text-muted-foreground line-through")}>{item.content}</span>
            {/* 담당·기한 칸 너비를 고정해 줄마다 위치가 맞게 */}
            <OwnerSelect value={item.ownerId} onChange={(id) => patch({ ownerId: id })} className="w-28 shrink-0" />
            <DatePicker
                value={due}
                onChange={(v) => patch({ dueDate: v || null })}
                placeholder="기한"
                clearable
                compact
                triggerClassName={cn(
                    "h-7 w-28 shrink-0 gap-1.5 border-0 px-2 text-xs shadow-none hover:bg-accent",
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

function MeetingCard({ recordId, meeting, items, onEdit, onChanged }: { recordId: number; meeting: Meeting; items: ActionItem[]; onEdit: () => void; onChanged: () => void }) {
    const { user } = useSession();
    const [showTranscript, setShowTranscript] = useState(false);
    const [adding, setAdding] = useState("");
    const mine = meeting.createdBy === user?.id;

    return (
        <article className="rounded-lg border border-border/40 p-4">
            <header className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                    <div className="flex items-center gap-2 text-sm font-semibold">
                        <CalendarDays className="h-4 w-4 text-muted-foreground" />
                        {dot(kstDate(meeting.metAt))}
                        {meeting.title && <span className="truncate font-medium">{meeting.title}</span>}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground">
                        {meeting.attendees && (
                            <span className="inline-flex items-center gap-1">
                                <Users className="h-3 w-3" />
                                {meeting.attendees}
                            </span>
                        )}
                        <span>작성 {meeting.createdByName ?? "알 수 없음"}</span>
                    </div>
                </div>
                {mine && (
                    <div className="flex shrink-0">
                        <Button size="icon" variant="ghost" className="size-7" onClick={onEdit} aria-label="고치기">
                            <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                            size="icon"
                            variant="ghost"
                            className="size-7 text-muted-foreground hover:text-destructive"
                            aria-label="삭제"
                            onClick={async () => {
                                const r = await deleteMeeting(meeting.id);
                                if (!r.success) toast.error(r.error || "삭제하지 못했습니다.");
                                onChanged();
                            }}
                        >
                            <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                    </div>
                )}
            </header>

            {meeting.summary && <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed">{meeting.summary}</p>}
            {meeting.notes && <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">{meeting.notes}</p>}

            <div className="mt-3">
                <div className="text-xs font-semibold text-muted-foreground">액션플랜</div>
                <ul className="mt-1 space-y-0.5">
                    {items.map((i) => (
                        <ActionRow key={i.id} item={i} onChanged={onChanged} />
                    ))}
                </ul>
                <form
                    className="mt-1 flex items-center gap-1.5 px-1.5"
                    onSubmit={async (e) => {
                        e.preventDefault();
                        if (!adding.trim()) return;
                        const r = await addActionItem({ recordId, content: adding, ownerId: user?.id ?? null, dueDate: null, meetingId: meeting.id });
                        if (!r.success) toast.error(r.error || "추가하지 못했습니다.");
                        setAdding("");
                        onChanged();
                    }}
                >
                    <Plus className="h-3.5 w-3.5 text-muted-foreground" />
                    <input
                        value={adding}
                        onChange={(e) => setAdding(e.target.value)}
                        placeholder="할 일 추가 (Enter)"
                        className="h-7 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                    />
                </form>
            </div>

            {meeting.transcript && (
                <div className="mt-3">
                    <button
                        type="button"
                        onClick={() => setShowTranscript((v) => !v)}
                        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                    >
                        {showTranscript ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                        전사본 {showTranscript ? "접기" : "보기"}
                    </button>
                    {showTranscript && (
                        <pre className="mt-2 max-h-80 overflow-y-auto whitespace-pre-wrap rounded-md bg-muted/40 p-3 font-sans text-xs leading-relaxed">
                            {meeting.transcript}
                        </pre>
                    )}
                    {meeting.audioUrl && (
                        <audio controls src={meeting.audioUrl} className="mt-2 h-9 w-full">
                            <track kind="captions" />
                        </audio>
                    )}
                </div>
            )}
        </article>
    );
}

/** 상세 패널 "미팅" 탭 — 미팅 기록(최신순)과 미팅 없이 만든 할 일 */
export function SalesMeetings({ recordId, onChanged }: { recordId: number; onChanged?: () => void }) {
    const { meetings, actionItems, isLoading, mutate } = useMeetings(recordId);
    const [dialog, setDialog] = useState<{ open: boolean; meeting: Meeting | null }>({ open: false, meeting: null });
    const refresh = () => {
        mutate();
        onChanged?.();
    };
    const loose = actionItems.filter((i) => !i.meetingId);

    return (
        <section className="space-y-3">
            <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold text-muted-foreground">
                    미팅 <span className="font-normal">{meetings.length}</span>
                </h3>
                <Button size="sm" variant="outline" onClick={() => setDialog({ open: true, meeting: null })}>
                    <Plus className="mr-1 h-4 w-4" />
                    미팅 기록
                </Button>
            </div>
            {isLoading ? (
                <p className="text-sm text-muted-foreground">불러오는 중…</p>
            ) : meetings.length === 0 && loose.length === 0 ? (
                <p className="rounded-lg bg-muted/40 p-4 text-sm text-muted-foreground">
                    아직 미팅 기록이 없어요. 녹음 파일을 올리면 글로 바꾸고, AI가 요약과 액션플랜을 뽑아줘요.
                </p>
            ) : (
                <div className="space-y-3">
                    {meetings.map((m) => (
                        <MeetingCard
                            key={m.id}
                            recordId={recordId}
                            meeting={m}
                            items={actionItems.filter((i) => i.meetingId === m.id)}
                            onEdit={() => setDialog({ open: true, meeting: m })}
                            onChanged={refresh}
                        />
                    ))}
                    {loose.length > 0 && (
                        <div className="rounded-lg border border-border/40 p-4">
                            <div className="text-xs font-semibold text-muted-foreground">미팅 밖 할 일</div>
                            <ul className="mt-1 space-y-0.5">
                                {loose.map((i) => (
                                    <ActionRow key={i.id} item={i} onChanged={refresh} />
                                ))}
                            </ul>
                        </div>
                    )}
                </div>
            )}
            {dialog.open && (
                <MeetingDialog
                    key={dialog.meeting?.id ?? "new"}
                    open
                    onOpenChange={(v) => !v && setDialog({ open: false, meeting: null })}
                    recordId={recordId}
                    meeting={dialog.meeting}
                    onSaved={refresh}
                />
            )}
        </section>
    );
}
