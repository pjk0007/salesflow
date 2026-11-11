"use client";

import { useState } from "react";
import { CalendarDays, ChevronDown, Pencil, Trash2, Users, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useSession } from "@/contexts/SessionContext";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { deleteMeeting, updateMeeting } from "../api";
import { useMeetings } from "../hooks/useMeetings";
import type { ActionItem, Meeting } from "../types";
import { ActionRow, AddActionForm } from "./ActionItems";
import { MeetingDialog } from "./MeetingDialog";

const dot = (iso: string) => new Date(new Date(iso).getTime() + 9 * 3600_000).toISOString().slice(0, 10).replaceAll("-", ".");

/** 전사본 — 3줄이 넘으면 접어두고, 영역 어디를 눌러도 접었다 펼친다 (글자를 드래그해 고를 때는 그대로) */
function Transcript({ text }: { text: string }) {
    const [open, setOpen] = useState(false);
    const long = text.split("\n").length > 3 || text.length > 180;
    const toggle = () => {
        if (!long) return;
        if (window.getSelection()?.toString()) return; // 복사하려고 글자를 고른 경우
        setOpen((v) => !v);
    };
    return (
        <div
            role={long ? "button" : undefined}
            tabIndex={long ? 0 : undefined}
            aria-expanded={long ? open : undefined}
            onClick={toggle}
            onKeyDown={(e) => long && (e.key === "Enter" || e.key === " ") && (e.preventDefault(), setOpen((v) => !v))}
            className={cn("rounded-md bg-muted/40 p-4", long && "cursor-pointer transition-colors hover:bg-muted/60")}
        >
            <pre className={cn("whitespace-pre-wrap font-sans text-sm leading-relaxed", long && !open && "line-clamp-3")}>{text}</pre>
            {long && (
                <span className="mt-2 flex items-center gap-1 text-xs text-muted-foreground">
                    <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")} />
                    {open ? "접기" : "전체 보기"}
                </span>
            )}
        </div>
    );
}

/**
 * 미팅 상세 — 영업리드 상세 오른쪽 절반에 나란히 연다 (같은 기업 담당자처럼).
 * 미팅·액션플랜은 왼쪽과 같은 데이터를 써서 어디서 고쳐도 같이 바뀐다.
 */
export function MeetingDetailColumn({
    recordId,
    meetingId,
    leadData,
    onClose,
    onChanged,
}: {
    recordId: number;
    meetingId: number;
    leadData: Record<string, unknown>;
    onClose: () => void;
    onChanged: () => void;
}) {
    const { meetings, actionItems, mutate } = useMeetings(recordId);
    const meeting = meetings.find((m) => m.id === meetingId);
    const [editOpen, setEditOpen] = useState(false);
    const refresh = () => {
        mutate();
        onChanged();
    };
    if (!meeting) return null;
    return (
        <MeetingDetailBody
            key={`${meeting.id}:${meeting.summary ?? ""}`}
            recordId={recordId}
            meeting={meeting}
            items={actionItems.filter((i) => i.meetingId === meeting.id)}
            onClose={onClose}
            onEdit={() => setEditOpen(true)}
            onChanged={refresh}
            editDialog={
                editOpen && (
                    <MeetingDialog
                        open
                        onOpenChange={(v) => !v && setEditOpen(false)}
                        recordId={recordId}
                        meeting={meeting}
                        onSaved={refresh}
                        leadData={leadData}
                    />
                )
            }
        />
    );
}

function MeetingDetailBody({
    recordId,
    meeting,
    items,
    onClose,
    onEdit,
    onChanged,
    editDialog,
}: {
    recordId: number;
    meeting: Meeting;
    items: ActionItem[];
    onClose: () => void;
    onEdit: () => void;
    onChanged: () => void;
    editDialog: React.ReactNode;
}) {
    const { user } = useSession();
    const [summary, setSummary] = useState(meeting.summary ?? "");
    const [saving, setSaving] = useState(false);
    const dirty = summary !== (meeting.summary ?? "");

    const saveSummary = async () => {
        setSaving(true);
        try {
            const r = await updateMeeting(meeting.id, {
                metAt: meeting.metAt,
                title: meeting.title ?? "",
                attendees: meeting.attendees ?? "",
                notes: meeting.notes ?? "",
                transcript: meeting.transcript ?? "",
                summary,
                audioUrl: meeting.audioUrl,
                actionItems: [],
            });
            if (!r.success) {
                toast.error(r.error || "저장하지 못했습니다.");
                return;
            }
            toast.success("요약을 저장했어요.");
            onChanged();
        } finally {
            setSaving(false);
        }
    };

    return (
        <>
            <div className="flex min-w-0 flex-1 flex-col">
                <div className="flex h-14 shrink-0 items-center justify-between border-b px-4">
                    <span className="text-xs font-semibold text-muted-foreground">미팅 상세</span>
                    <div className="flex items-center gap-1">
                        <Button size="xs" variant="ghost" onClick={onEdit}>
                            <Pencil className="mr-1 h-3 w-3" />
                            수정
                        </Button>
                        {meeting.createdBy === user?.id && (
                            <Button
                                size="xs"
                                variant="ghost"
                                className="text-muted-foreground hover:text-destructive"
                                onClick={async () => {
                                    const r = await deleteMeeting(meeting.id);
                                    if (!r.success) {
                                        toast.error(r.error || "삭제하지 못했습니다.");
                                        return;
                                    }
                                    toast.success("미팅 기록을 지웠어요.");
                                    onChanged();
                                    onClose();
                                }}
                            >
                                <Trash2 className="mr-1 h-3 w-3" />
                                삭제
                            </Button>
                        )}
                        <Button variant="ghost" size="icon" className="size-8" onClick={onClose} aria-label="닫기">
                            <X className="h-4 w-4" />
                        </Button>
                    </div>
                </div>
                <div className="min-h-0 flex-1 space-y-6 overflow-y-auto p-6 scrollbar-thin">
                    <div>
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                            <CalendarDays className="h-4 w-4" />
                            {dot(meeting.metAt)}
                            <span>· 작성 {meeting.createdByName ?? "알 수 없음"}</span>
                        </div>
                        <h2 className="mt-1 text-xl font-semibold">{meeting.title || "(제목 없음)"}</h2>
                        {meeting.attendees && (
                            <p className="mt-1 flex items-center gap-1 text-sm text-muted-foreground">
                                <Users className="h-3.5 w-3.5" />
                                {meeting.attendees}
                            </p>
                        )}
                    </div>

                    <section className="space-y-1.5">
                        <div className="flex h-6 items-center justify-between">
                            <h3 className="text-xs font-semibold text-muted-foreground">요약</h3>
                            {dirty && (
                                <Button size="xs" disabled={saving} onClick={saveSummary}>
                                    저장
                                </Button>
                            )}
                        </div>
                        <Textarea
                            value={summary}
                            onChange={(e) => setSummary(e.target.value)}
                            // Enter 저장, Shift+Enter 줄바꿈 (한글 조합 중 Enter는 무시)
                            onKeyDown={(e) => {
                                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                                    e.preventDefault();
                                    if (dirty && !saving) saveSummary();
                                }
                            }}
                            rows={5}
                            placeholder="요약이 없어요."
                        />
                    </section>

                    <section className="space-y-1.5">
                        <h3 className="text-xs font-semibold text-muted-foreground">녹음/전사본</h3>
                        {meeting.audioUrl && (
                            <audio controls src={meeting.audioUrl} className="h-9 w-full">
                                <track kind="captions" />
                            </audio>
                        )}
                        {meeting.transcript ? (
                            <Transcript text={meeting.transcript} />
                        ) : (
                            <p className="text-sm text-muted-foreground">전사본이 없어요.</p>
                        )}
                    </section>
                    <section className="space-y-1.5">
                        <h3 className="text-xs font-semibold text-muted-foreground">액션플랜</h3>
                        <ul className="space-y-0.5">
                            {items.map((i) => (
                                <ActionRow key={i.id} item={i} onChanged={onChanged} />
                            ))}
                        </ul>
                        <AddActionForm recordId={recordId} meetingId={meeting.id} onChanged={onChanged} />
                    </section>

                </div>
            </div>
            {editDialog}
        </>
    );
}
