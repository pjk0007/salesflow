"use client";

import { useState } from "react";
import { CalendarDays, ChevronDown, Plus, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ActionRow, AddActionForm } from "./ActionItems";
import { useMeetings } from "../hooks/useMeetings";
import type { ActionItem, Meeting } from "../types";
import { MeetingDialog } from "./MeetingDialog";

const kstDate = (iso: string) => new Date(new Date(iso).getTime() + 9 * 3600_000).toISOString().slice(0, 10);
const dot = (d: string) => d.replaceAll("-", ".");
export const meetingLabelOf = (m: Meeting) => `${dot(kstDate(m.metAt))}${m.title ? ` ${m.title}` : ""}`;

/** 미팅 한 줄 — 누르면 오른쪽에 미팅 상세가 열린다 (수정·삭제·액션플랜은 상세에서) */
function MeetingCard({ meeting, items, onDetail }: { meeting: Meeting; items: ActionItem[]; onDetail: () => void }) {
    const openCount = items.filter((i) => !i.doneAt).length;
    return (
        <button type="button" onClick={onDetail} className="w-full rounded-lg border border-border/40 p-4 text-left transition-colors hover:bg-muted/40">
            <div className="flex items-center gap-2 text-sm font-semibold">
                <CalendarDays className="h-4 w-4 shrink-0 text-muted-foreground" />
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
                {openCount > 0 && <span>할 일 {openCount}</span>}
            </div>
        </button>
    );
}

/** 상세 패널 아래쪽 — [미팅] 기록 카드들 + [할 일] 체크리스트(기한 순, 미팅 액션플랜 포함) */
export function SalesMeetings({
    recordId,
    onChanged,
    leadData = {},
    onOpenDetail,
}: {
    recordId: number;
    onChanged?: () => void;
    leadData?: Record<string, unknown>;
    /** 미팅 "상세 보기" — 상세 패널 오른쪽 절반에 연다 */
    onOpenDetail?: (meetingId: number) => void;
}) {
    const { meetings, actionItems, isLoading, mutate } = useMeetings(recordId);
    const [dialog, setDialog] = useState<{ open: boolean; meeting: Meeting | null }>({ open: false, meeting: null });
    const [showDone, setShowDone] = useState(false);
    const refresh = () => {
        mutate();
        onChanged?.();
    };
    const meetingById = new Map(meetings.map((m) => [m.id, m]));
    const byDue = (a: ActionItem, b: ActionItem) => (a.dueAt ? Date.parse(a.dueAt) : Infinity) - (b.dueAt ? Date.parse(b.dueAt) : Infinity);
    const openItems = actionItems.filter((i) => !i.doneAt).sort(byDue);
    const doneItems = actionItems.filter((i) => i.doneAt);

    return (
        <div className="space-y-6">
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
                ) : meetings.length === 0 ? (
                    <p className="rounded-lg bg-muted/40 p-4 text-sm text-muted-foreground">
                        미팅 기록이 없어요.
                    </p>
                ) : (
                    <div className="space-y-2">
                        {meetings.map((m) => (
                            <MeetingCard
                                key={m.id}
                                meeting={m}
                                items={actionItems.filter((i) => i.meetingId === m.id)}
                                onDetail={() => onOpenDetail?.(m.id)}
                            />
                        ))}
                    </div>
                )}
            </section>

            {/* 할 일 — 미팅 액션플랜과 따로 만든 할 일을 기한 순으로 (어디서 체크해도 같이 바뀐다) */}
            <section className="space-y-1 border-t pt-4">
                <h3 className="text-xs font-semibold text-muted-foreground">
                    할 일 <span className="font-normal">{openItems.length}</span>
                </h3>
                <ul className="space-y-0.5">
                    {openItems.map((i) => (
                        <ActionRow key={i.id} item={i} onChanged={refresh} meetingLabel={i.meetingId ? meetingLabelOf(meetingById.get(i.meetingId)!) : null} />
                    ))}
                </ul>
                <AddActionForm recordId={recordId} onChanged={refresh} />
                {doneItems.length > 0 && (
                    <div className="pt-1">
                        <button type="button" onClick={() => setShowDone((v) => !v)} className="flex items-center gap-1 px-1.5 text-xs text-muted-foreground hover:text-foreground">
                            <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", showDone && "rotate-180")} />
                            완료한 할 일 {doneItems.length}개
                        </button>
                        {showDone && (
                            <ul className="mt-1 space-y-0.5">
                                {doneItems.map((i) => (
                                    <ActionRow key={i.id} item={i} onChanged={refresh} meetingLabel={i.meetingId ? meetingLabelOf(meetingById.get(i.meetingId)!) : null} />
                                ))}
                            </ul>
                        )}
                    </div>
                )}
            </section>

            {dialog.open && (
                <MeetingDialog
                    key={dialog.meeting?.id ?? "new"}
                    open
                    onOpenChange={(v) => !v && setDialog({ open: false, meeting: null })}
                    recordId={recordId}
                    meeting={dialog.meeting}
                    onSaved={refresh}
                    leadData={leadData}
                />
            )}
        </div>
    );
}
