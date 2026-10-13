"use client";
import { useId, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useLeadFollowup } from "../hooks/useLeadFollowup";
import { FOLLOWUP_LABELS, type FollowupPatch, type FollowupStatus, type FollowupDetail } from "../types";
import { fromKstInput, journeyPriorityLabel, kstDisplay, toKstInput } from "../utils/labels";

function FollowupForm({ detail, save }: { detail: FollowupDetail; save: (patch: FollowupPatch) => Promise<void> }) {
    const id = useId(), lead = detail.lead!;
    const [status, setStatus] = useState<FollowupStatus>(lead.followup.status);
    const [due, setDue] = useState(toKstInput(lead.followup.dueAt));
    const [note, setNote] = useState(lead.followup.note);
    const [saving, setSaving] = useState(false);
    const submit = async (e: FormEvent) => {
        e.preventDefault(); setSaving(true);
        try { await save({ status, dueAt: status === "planned" ? fromKstInput(due) : null, note, revision: lead.followup.revision }); toast.success("후속 대응 상태를 저장했습니다."); }
        catch (error) { toast.error(error instanceof Error ? error.message : "저장하지 못했습니다. 다시 시도해 주세요."); }
        finally { setSaving(false); }
    };
    return <form onSubmit={submit} className="space-y-3">
        <fieldset disabled={saving} className="space-y-3">
            <div className="space-y-1"><Label htmlFor={`${id}-status`}>처리 상태</Label>
                <select id={`${id}-status`} value={status} onChange={(e) => setStatus(e.target.value as FollowupStatus)} className="h-9 w-full rounded-md border bg-background px-2 text-sm">
                    {Object.entries(FOLLOWUP_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                </select></div>
            {status === "planned" && <div className="space-y-1"><Label htmlFor={`${id}-due`}>연락 예정 시각 (한국 시간)</Label>
                <Input id={`${id}-due`} type="datetime-local" required value={due} onChange={(e) => setDue(e.target.value)} />
                <p className="text-xs text-muted-foreground">핵심 리드는 이 시각이 지나면 근무시간에 담당자에게 재알림합니다.</p></div>}
            <div className="space-y-1"><Label htmlFor={`${id}-note`}>대응 메모</Label>
                <Textarea id={`${id}-note`} value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} rows={3} placeholder="연락 결과나 다음 할 일을 남겨 주세요." />
                <p className="text-xs text-muted-foreground">메모는 샌드비에 저장됩니다. 구글챗 카드에는 처리 상태와 예정 시각을 표시합니다.</p></div>
            <Button type="submit" size="sm">{saving ? "저장 중…" : "상태 저장"}</Button>
        </fieldset>
    </form>;
}

export function LeadFollowupPanel({ recordId }: { recordId: number }) {
    const { detail, error, isLoading, reload, save } = useLeadFollowup(recordId);
    const lead = detail?.lead;
    return <section id="lead-followup" className="scroll-mt-6 rounded-lg border bg-card p-4 space-y-3" aria-label="고객 여정 리드와 후속 대응">
        <h2 className="text-sm font-semibold">리드 판정 · 후속 대응</h2>
        {isLoading ? <p className="text-sm text-muted-foreground">불러오는 중…</p> : error ? <div role="alert"><p className="text-sm text-destructive">{error}</p><Button variant="outline" size="sm" onClick={() => void reload()}>다시 불러오기</Button></div>
            : !lead ? <p className="text-sm text-muted-foreground">현재 유효한 메일 유입 여정 판정이 없습니다. 새 방문의 마지막 활동 후 10분이 지나면 판정합니다. 내부·공유·완료 고객과 3초 미만 방문은 제외합니다.</p> : <>
                <div className={`rounded-md border p-3 space-y-1 ${lead.priority.tier === "urgent" ? "border-red-300 bg-red-50 dark:bg-red-950/30" : lead.priority.tier === "highlight" ? "border-orange-300 bg-orange-50 dark:bg-orange-950/30" : "bg-muted/30"}`}>
                    <p className="text-sm font-semibold">{journeyPriorityLabel(lead.priority)} · {lead.priority.score}점</p>
                    <p className="text-xs">{lead.businessName} · 담당자 {lead.ownerName || "연결 전"}</p>
                    <ul className="list-disc pl-4 text-xs space-y-1">{lead.priority.evidence.map((e) => <li key={e}>{e}</li>)}</ul>
                    <p className="text-xs text-muted-foreground">구글챗과 같은 판정 · {kstDisplay(lead.assessedAt)}</p>
                </div>
                <p className="text-sm">현재 상태: <strong>{FOLLOWUP_LABELS[lead.followup.status]}</strong>{lead.followup.updatedBy && <span className="text-xs text-muted-foreground"> · 수정 {lead.followup.updatedBy}</span>}</p>
                <FollowupForm key={`${lead.workspaceId}-${lead.customerKey}-${lead.followup.revision}`} detail={detail!} save={save} />
                <p className="text-xs text-muted-foreground">강한 핵심 리드만 미확인 24시간 후 또는 연락 기한 이후 재알림합니다. 평일 09~18시, 고객별 하루 1회·최대 3회이며 연락 완료·상담 진행이면 멈춥니다. 재방문해도 처리 상태를 유지합니다.</p>
                {lead.followup.lastRemindedAt && <p className="text-xs text-muted-foreground">최근 재알림 시도 {kstDisplay(lead.followup.lastRemindedAt)} · {lead.followup.reminderCount}/3회</p>}
                {!!detail?.history.length && <details><summary className="cursor-pointer text-sm">처리 이력 ({detail.history.length}건)</summary><ol className="mt-2 space-y-2 text-xs">
                    {detail.history.map((h, i) => <li key={`${h.at}-${i}`} className="border-l pl-3"><p>{FOLLOWUP_LABELS[h.status]} · {h.actorName} · {kstDisplay(h.at)}</p>{h.dueAt && <p>연락 예정 {kstDisplay(h.dueAt)}</p>}{h.note && <p className="whitespace-pre-wrap text-muted-foreground">{h.note}</p>}</li>)}
                </ol></details>}
            </>}
    </section>;
}
