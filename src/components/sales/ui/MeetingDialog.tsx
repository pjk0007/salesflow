"use client";

import { useState } from "react";
import { Loader2, Paperclip, Plus, Sparkles, X } from "lucide-react";
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
import { AttendeePicker, useCompanyPeople } from "./AttendeePicker";
import { cn } from "@/lib/utils";
import { isTranscriptDocument, readTranscriptFile } from "../utils/read-transcript-file";

const todayKst = () => new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
const kstDate = (iso: string) => new Date(new Date(iso).getTime() + 9 * 3600_000).toISOString().slice(0, 10);

interface MeetingDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    recordId: number;
    /** 있으면 수정 (액션플랜은 미팅 기록 화면에서 따로 고친다) */
    meeting?: Meeting | null;
    onSaved: () => void;
    /** 지금 리드 정보 — 참석자 고르기의 "이 기업 담당자" 맨 앞 */
    leadData: Record<string, unknown>;
}

/** 미팅 기록 쓰기 — 녹음 올리기(자동 전사) 또는 전사본 붙여넣기 → AI 요약·액션플랜 → 확인 후 저장 */
export function MeetingDialog({ open, onOpenChange, recordId, meeting, onSaved, leadData }: MeetingDialogProps) {
    const { user } = useSession();
    const { members } = useSalesMembers();
    const companyPeople = useCompanyPeople(recordId, leadData);
    const editing = !!meeting;
    const [date, setDate] = useState(meeting ? kstDate(meeting.metAt) : todayKst());
    const [title, setTitle] = useState(meeting?.title ?? "");
    const [attendees, setAttendees] = useState<string[]>(
        (meeting?.attendees ?? "")
            .split(",")
            .map((v) => v.trim())
            .filter(Boolean),
    );
    // 메모 칸은 없앴다 — 예전 미팅의 메모는 그대로 보존
    const notes = meeting?.notes ?? "";
    const [dragging, setDragging] = useState(false);
    const [transcript, setTranscript] = useState(meeting?.transcript ?? "");
    const [summary, setSummary] = useState(meeting?.summary ?? "");
    const [audioUrl, setAudioUrl] = useState<string | null>(meeting?.audioUrl ?? null);
    const [items, setItems] = useState<DraftActionItem[]>([]);
    const [transcribing, setTranscribing] = useState(false);
    const [analyzing, setAnalyzing] = useState(false);
    const [saving, setSaving] = useState(false);

    const transcribe = async (file: File | undefined) => {
        if (!file) return;
        // 전사본 문서(txt·docx·pdf)는 글만 읽어서 바로 요약
        if (isTranscriptDocument(file)) {
            setTranscribing(true);
            let text = "";
            try {
                text = (await readTranscriptFile(file)).trim();
            } catch {
                toast.error("파일 내용을 읽지 못했어요.");
                return;
            } finally {
                setTranscribing(false);
            }
            if (!text) {
                toast.error("파일에 글이 없어요. (스캔한 PDF는 읽을 수 없어요)");
                return;
            }
            setTranscript(text);
            await analyze(text);
            return;
        }
        if (!file.type.startsWith("audio/") && !file.type.startsWith("video/") && !/\.(m4a|mp3|wav|aac|flac|ogg|webm)$/i.test(file.name)) {
            toast.error("녹음 파일(mp3·m4a·wav)이나 전사본(txt·docx·pdf)만 올릴 수 있어요.");
            return;
        }
        setTranscribing(true);
        let result: Awaited<ReturnType<typeof transcribeRecording>>;
        try {
            result = await transcribeRecording(file);
            if (!result.success || !result.data) {
                toast.error(result.error || "녹음을 글로 바꾸지 못했습니다.");
                return;
            }
            setAudioUrl(result.data.audioUrl);
            setTranscript(result.data.transcript);
        } finally {
            setTranscribing(false);
        }
        // 전사가 끝나면 바로 요약·액션플랜까지
        await analyze(result.data!.transcript);
    };

    const analyze = async (text: string = transcript) => {
        setAnalyzing(true);
        try {
            const result = await analyzeMeeting({ transcript: text, notes, meetingDate: date, recordId: meeting?.recordId ?? recordId });
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
                attendees: attendees.join(", "),
                notes,
                transcript,
                summary,
                audioUrl,
                actionItems: items.filter((i) => i.content.trim()),
                // 참석자로 고른 같은 기업 담당자 리드에도 이 미팅이 보이게 연결 (할 일은 하나)
                linkedRecordIds: companyPeople.filter((p) => attendees.includes(p.label)).map((p) => p.recordId),
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
                    <div className="space-y-1.5">
                        <Label className="text-xs text-muted-foreground">제목</Label>
                        <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="예: 1차 도입 미팅" />
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                        <div className="space-y-1.5">
                            <Label className="text-xs text-muted-foreground">미팅 날짜</Label>
                            <DatePicker value={date} onChange={(v) => setDate(v || todayKst())} />
                        </div>
                        <div className="space-y-1.5">
                            <Label className="text-xs text-muted-foreground">참석자</Label>
                            <AttendeePicker recordId={recordId} leadData={leadData} value={attendees} onChange={setAttendees} />
                        </div>
                    </div>

                    <div className="space-y-1.5">
                        <div className="flex h-6 items-center justify-between">
                            <Label className="text-xs text-muted-foreground">녹음/전사본</Label>
                            <div className="flex items-center gap-1">
                                <Button type="button" variant="ghost" size="xs" disabled={busy} asChild>
                                    <label className={cn(!busy && "cursor-pointer")}>
                                        <Paperclip className="mr-1 h-3.5 w-3.5" />
                                        파일 올리기
                                        <input
                                            type="file"
                                            className="hidden"
                                            accept="audio/*,video/*,.m4a,.mp3,.wav,.aac,.flac,.ogg,.webm,.txt,.md,.srt,.vtt,.docx,.pdf"
                                            disabled={busy}
                                            onChange={(e) => {
                                                transcribe(e.target.files?.[0]);
                                                e.target.value = "";
                                            }}
                                        />
                                    </label>
                                </Button>
                                {transcript.trim() && !busy && (
                                    <Button type="button" variant="ghost" size="xs" onClick={() => analyze()}>
                                        <Sparkles className="mr-1 h-3.5 w-3.5" />
                                        {summary ? "다시 요약" : "AI 요약"}
                                    </Button>
                                )}
                            </div>
                        </div>
                        {/* 녹음 파일은 여기로 끌어다 놓기, 전사본 글은 붙여넣기 */}
                        <div
                            className="relative"
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
                                transcribe(e.dataTransfer.files[0]);
                            }}
                        >
                            <Textarea
                                value={transcript}
                                onChange={(e) => setTranscript(e.target.value)}
                                // 전사본을 붙여넣으면 바로 요약·액션플랜까지 (이미 요약이 있으면 "다시 요약"으로)
                                onPaste={(e) => {
                                    const pasted = e.clipboardData.getData("text");
                                    if (pasted.trim().length < 30 || summary.trim() || busy) return;
                                    const el = e.currentTarget;
                                    const next = transcript.slice(0, el.selectionStart) + pasted + transcript.slice(el.selectionEnd);
                                    setTimeout(() => analyze(next), 0);
                                }}
                                rows={6}
                                disabled={transcribing}
                                placeholder="녹음 파일(mp3·m4a·wav)이나 전사본(txt·docx·pdf)을 끌어다 놓거나, 전사본 글을 붙여넣기"
                                className={cn("h-40 resize-none overflow-y-auto text-xs [field-sizing:fixed] scrollbar-thin", dragging && "border-dashed border-primary bg-primary/5")}
                            />
                            {(transcribing || analyzing) && (
                                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 rounded-md bg-background/85 text-sm text-muted-foreground">
                                    <Loader2 className="h-5 w-5 animate-spin text-primary" />
                                    {transcribing ? "파일을 글로 바꾸는 중…" : "요약과 액션플랜을 만드는 중…"}
                                </div>
                            )}
                        </div>
                        {audioUrl && (
                            <audio controls src={audioUrl} className="mt-1 h-9 w-full">
                                <track kind="captions" />
                            </audio>
                        )}
                    </div>

                    <div className="space-y-1.5">
                        <Label className="text-xs text-muted-foreground">요약</Label>
                        <Textarea value={summary} onChange={(e) => setSummary(e.target.value)} rows={5} placeholder="녹음/전사본 기준으로 자동 생성되며 수정이 가능해요." />
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
