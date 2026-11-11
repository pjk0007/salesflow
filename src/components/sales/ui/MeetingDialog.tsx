"use client";

import { useRef, useState } from "react";
import { FileAudio, Loader2, Plus, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useSession } from "@/contexts/SessionContext";
import { analyzeMeeting, createMeeting, transcribeRecording, updateMeeting } from "../api";
import { useSalesMembers } from "../hooks/useSalesMembers";
import type { DraftActionItem, Meeting } from "../types";
import { OwnerSelect } from "./OwnerSelect";

const todayKst = () => new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
const kstDate = (iso: string) => new Date(new Date(iso).getTime() + 9 * 3600_000).toISOString().slice(0, 10);

interface MeetingDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    recordId: number;
    /** 있으면 수정 (액션플랜은 미팅 기록 화면에서 따로 고친다) */
    meeting?: Meeting | null;
    onSaved: () => void;
}

/** 미팅 기록 쓰기 — 녹음 올리기(자동 전사) 또는 전사본 붙여넣기 → AI 요약·액션플랜 → 확인 후 저장 */
export function MeetingDialog({ open, onOpenChange, recordId, meeting, onSaved }: MeetingDialogProps) {
    const { user } = useSession();
    const { members } = useSalesMembers();
    const editing = !!meeting;
    const [date, setDate] = useState(meeting ? kstDate(meeting.metAt) : todayKst());
    const [title, setTitle] = useState(meeting?.title ?? "");
    const [attendees, setAttendees] = useState(meeting?.attendees ?? "");
    const [notes, setNotes] = useState(meeting?.notes ?? "");
    const [transcript, setTranscript] = useState(meeting?.transcript ?? "");
    const [summary, setSummary] = useState(meeting?.summary ?? "");
    const [audioUrl, setAudioUrl] = useState<string | null>(meeting?.audioUrl ?? null);
    const [items, setItems] = useState<DraftActionItem[]>([]);
    const [transcribing, setTranscribing] = useState(false);
    const [analyzing, setAnalyzing] = useState(false);
    const [saving, setSaving] = useState(false);
    const fileInput = useRef<HTMLInputElement>(null);

    const transcribe = async (file: File | undefined) => {
        if (!file) return;
        setTranscribing(true);
        try {
            const result = await transcribeRecording(file);
            if (!result.success || !result.data) {
                toast.error(result.error || "녹음을 글로 바꾸지 못했습니다.");
                return;
            }
            setAudioUrl(result.data.audioUrl);
            setTranscript(result.data.transcript);
            toast.success("녹음을 글로 바꿨어요. 내용 확인 후 AI 요약을 눌러보세요.");
        } finally {
            setTranscribing(false);
        }
    };

    const analyze = async () => {
        setAnalyzing(true);
        try {
            const result = await analyzeMeeting({ transcript, notes, meetingDate: date });
            if (!result.success || !result.data) {
                toast.error(result.error || "요약하지 못했습니다.");
                return;
            }
            setSummary(result.data.summary);
            setItems(
                result.data.actionItems.map((i) => ({
                    content: i.content,
                    dueDate: i.dueDate ?? "",
                    ownerId: members.find((m) => m.name === i.ownerName)?.id ?? user?.id ?? null,
                })),
            );
        } finally {
            setAnalyzing(false);
        }
    };

    const save = async () => {
        setSaving(true);
        try {
            const payload = {
                metAt: `${date}T09:00:00+09:00`,
                title,
                attendees,
                notes,
                transcript,
                summary,
                audioUrl,
                actionItems: items.filter((i) => i.content.trim()),
            };
            const result = editing ? await updateMeeting(meeting!.id, payload) : await createMeeting(recordId, payload);
            if (!result.success) {
                toast.error(result.error || "저장하지 못했습니다.");
                return;
            }
            toast.success(editing ? "미팅 기록을 고쳤어요." : "미팅 기록을 남겼어요.");
            onOpenChange(false);
            onSaved();
        } finally {
            setSaving(false);
        }
    };

    const busy = transcribing || analyzing || saving;

    return (
        <Dialog open={open} onOpenChange={(v) => !busy && onOpenChange(v)}>
            <DialogContent className="flex max-h-[90vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl">
                <DialogHeader className="border-b px-6 py-4">
                    <DialogTitle>{editing ? "미팅 기록 고치기" : "미팅 기록 남기기"}</DialogTitle>
                </DialogHeader>

                <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-5 scrollbar-thin">
                    <div className="grid gap-3 sm:grid-cols-[10rem_1fr]">
                        <div className="space-y-1.5">
                            <Label className="text-xs text-muted-foreground">미팅 날짜</Label>
                            <DatePicker value={date} onChange={(v) => setDate(v || todayKst())} />
                        </div>
                        <div className="space-y-1.5">
                            <Label className="text-xs text-muted-foreground">제목</Label>
                            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="예: 1차 도입 미팅" />
                        </div>
                    </div>
                    <div className="space-y-1.5">
                        <Label className="text-xs text-muted-foreground">참석자</Label>
                        <Input value={attendees} onChange={(e) => setAttendees(e.target.value)} placeholder="예: 김OO 대표, 이OO 팀장 / 우리: 주희" />
                    </div>
                    <div className="space-y-1.5">
                        <Label className="text-xs text-muted-foreground">메모</Label>
                        <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} placeholder="미팅에서 느낀 점, 분위기, 기억할 내용" />
                    </div>

                    <div className="space-y-1.5">
                        <div className="flex items-center justify-between">
                            <Label className="text-xs text-muted-foreground">녹음 전사본</Label>
                            <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => fileInput.current?.click()}>
                                {transcribing ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <FileAudio className="mr-1 h-4 w-4" />}
                                {transcribing ? "녹음을 글로 바꾸는 중… (몇 분 걸릴 수 있어요)" : audioUrl ? "다른 녹음 올리기" : "녹음 파일 올리기"}
                            </Button>
                            <input
                                ref={fileInput}
                                type="file"
                                accept="audio/*,video/mp4,.m4a,.mp3,.wav"
                                className="hidden"
                                onChange={(e) => {
                                    transcribe(e.target.files?.[0]);
                                    e.target.value = "";
                                }}
                            />
                        </div>
                        <Textarea
                            value={transcript}
                            onChange={(e) => setTranscript(e.target.value)}
                            rows={6}
                            placeholder="녹음 파일을 올리면 자동으로 채워져요. 클로바노트 등에서 뽑은 전사본을 붙여넣어도 돼요."
                            className="text-xs"
                        />
                        {audioUrl && (
                            <audio controls src={audioUrl} className="mt-1 h-9 w-full">
                                <track kind="captions" />
                            </audio>
                        )}
                    </div>

                    <div className="flex justify-end">
                        <Button type="button" variant="outline" size="sm" disabled={busy || (!transcript.trim() && !notes.trim())} onClick={analyze}>
                            {analyzing ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Sparkles className="mr-1 h-4 w-4" />}
                            AI로 요약·액션플랜 만들기
                        </Button>
                    </div>

                    <div className="space-y-1.5">
                        <Label className="text-xs text-muted-foreground">요약</Label>
                        <Textarea value={summary} onChange={(e) => setSummary(e.target.value)} rows={4} placeholder="- 핵심 내용" />
                    </div>

                    {!editing && (
                        <div className="space-y-2">
                            <div className="flex items-center justify-between">
                                <Label className="text-xs text-muted-foreground">액션플랜 (다음에 할 일)</Label>
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => setItems((prev) => [...prev, { content: "", dueDate: "", ownerId: user?.id ?? null }])}
                                >
                                    <Plus className="mr-1 h-4 w-4" /> 추가
                                </Button>
                            </div>
                            {items.length === 0 ? (
                                <p className="text-xs text-muted-foreground">AI 요약을 누르거나 직접 추가하세요. 기한이 다가오면 &apos;중요&apos;에 떠요.</p>
                            ) : (
                                <ul className="space-y-1.5">
                                    {items.map((item, i) => (
                                        <li key={i} className="flex items-center gap-1.5 rounded-md bg-muted/40 px-2 py-1.5">
                                            <Input
                                                value={item.content}
                                                onChange={(e) => setItems((prev) => prev.map((x, j) => (j === i ? { ...x, content: e.target.value } : x)))}
                                                placeholder="할 일"
                                                className="h-8 flex-1 border-0 bg-transparent px-1 shadow-none focus-visible:ring-0"
                                            />
                                            <OwnerSelect
                                                className="w-28 shrink-0"
                                                value={item.ownerId}
                                                onChange={(id) => setItems((prev) => prev.map((x, j) => (j === i ? { ...x, ownerId: id } : x)))}
                                            />
                                            <DatePicker
                                                value={item.dueDate}
                                                onChange={(v) => setItems((prev) => prev.map((x, j) => (j === i ? { ...x, dueDate: v } : x)))}
                                                placeholder="기한"
                                                clearable
                                                compact
                                                triggerClassName="h-7 w-28 shrink-0 gap-1.5 border-0 px-2 text-xs shadow-none hover:bg-accent"
                                            />
                                            <button
                                                type="button"
                                                onClick={() => setItems((prev) => prev.filter((_, j) => j !== i))}
                                                className="rounded p-1 text-muted-foreground hover:text-foreground"
                                                aria-label="빼기"
                                            >
                                                <X className="h-3.5 w-3.5" />
                                            </button>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </div>
                    )}
                </div>

                <DialogFooter className="border-t px-6 py-4">
                    <Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
                        취소
                    </Button>
                    <Button disabled={busy} onClick={save}>
                        {saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
                        저장
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
