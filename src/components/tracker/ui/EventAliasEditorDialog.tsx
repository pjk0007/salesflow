"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { createEventAlias, updateEventAlias } from "../hooks/useEventAliases";
import { useEventNameOptions } from "../hooks/useEventNameOptions";
import type { EventAliasType, EventAliasRow } from "../types/event-alias";

interface Props {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    siteId: number;
    // editing row (id 있으면 편집, null이면 신규) — eventType/eventName prefill 용
    initial: EventAliasRow | null;
    onSaved: () => void;
}

/**
 * 신규/편집 다이얼로그.
 * - editing(initial.id != null) 시: eventType/eventName 비활성, label만 수정
 * - 신규 시: eventType/eventName 입력 + label 입력
 * - prefill (initial이 있고 id가 null) 시: eventType/eventName 채워둔 채 신규 등록
 */
export function EventAliasEditorDialog({ open, onOpenChange, siteId, initial, onSaved }: Props) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            {open && (
                <EventAliasEditorBody
                    key={initial?.id ?? `${initial?.eventType ?? "new"}-${initial?.eventName ?? ""}`}
                    siteId={siteId}
                    initial={initial}
                    onSaved={onSaved}
                    onClose={() => onOpenChange(false)}
                />
            )}
        </Dialog>
    );
}

function EventAliasEditorBody({
    siteId,
    initial,
    onSaved,
    onClose,
}: {
    siteId: number;
    initial: EventAliasRow | null;
    onSaved: () => void;
    onClose: () => void;
}) {
    const isEdit = !!initial?.id;
    const [eventType, setEventType] = useState<EventAliasType>(initial?.eventType ?? "SECTION_VIEW");
    const [eventName, setEventName] = useState(initial?.eventName ?? "");
    const [label, setLabel] = useState(initial?.label ?? "");
    const [saving, setSaving] = useState(false);

    // 신규 등록 시 자동완성 — 사이트에서 실제 발생한 이벤트 이름 제공
    const { data: nameOptions } = useEventNameOptions(siteId);
    const filteredOptions = nameOptions.filter((o) => o.eventType === eventType);
    const datalistId = `event-name-options-${siteId}`;

    const canSave = isEdit
        ? true // 빈 라벨도 허용 (Plan 결정 2)
        : eventName.trim().length > 0;

    const handleSave = async () => {
        setSaving(true);
        try {
            if (isEdit && initial?.id) {
                await updateEventAlias(initial.id, label);
                toast.success("저장되었습니다.");
            } else {
                await createEventAlias({
                    siteId,
                    eventType,
                    eventName: eventName.trim(),
                    label,
                });
                toast.success("별칭이 등록되었습니다.");
            }
            onSaved();
            onClose();
        } catch (err) {
            toast.error(err instanceof Error ? err.message : "저장 실패");
        } finally {
            setSaving(false);
        }
    };

    return (
        <DialogContent className="sm:max-w-md">
            <DialogHeader>
                <DialogTitle>{isEdit ? "라벨 편집" : "별칭 등록"}</DialogTitle>
            </DialogHeader>
            <div className="space-y-3 py-2">
                <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">이벤트 타입</label>
                    <Select
                        value={eventType}
                        onValueChange={(v) => {
                            setEventType(v as EventAliasType);
                            setEventName(""); // 타입 바뀌면 이름 초기화
                        }}
                        disabled={isEdit}
                    >
                        <SelectTrigger className="h-9 text-sm">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="SECTION_VIEW">SECTION_VIEW (섹션 노출)</SelectItem>
                            <SelectItem value="CLICK">CLICK (클릭)</SelectItem>
                            <SelectItem value="CUSTOM">CUSTOM (직접 정의 이벤트)</SelectItem>
                        </SelectContent>
                    </Select>
                </div>
                <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">이벤트 이름 (raw)</label>
                    {/* datalist로 실제 발생 이벤트 자동완성 제공, 직접 입력도 허용 */}
                    <datalist id={datalistId}>
                        {filteredOptions.map((o) => (
                            <option key={o.eventName} value={o.eventName}>
                                {o.eventName} ({o.occurrences.toLocaleString()}회)
                            </option>
                        ))}
                    </datalist>
                    <Input
                        list={isEdit ? undefined : datalistId}
                        placeholder={eventType === "CUSTOM" ? "예: subscribe_step_2" : "예: hero, service-cta, hero-free-trial"}
                        value={eventName}
                        onChange={(e) => setEventName(e.target.value)}
                        disabled={isEdit}
                        className="h-9 text-sm font-mono"
                    />
                </div>
                {eventType === "CUSTOM" && eventName.trim() && (
                    <div className="rounded-md border bg-muted/40 p-2 text-[11px]">
                        <span className="text-muted-foreground">사이트에 심을 코드: </span>
                        <code className="font-mono">sendb.track(&apos;{eventName.trim()}&apos;)</code>
                    </div>
                )}
                <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">라벨 (운영자 표시용)</label>
                    <Input
                        placeholder="예: 메인 소개, 가격 → 가입 CTA"
                        value={label}
                        onChange={(e) => setLabel(e.target.value)}
                        className="h-9 text-sm"
                    />
                    <p className="text-[11px] text-muted-foreground">
                        비워두면 raw 이름이 그대로 표시됩니다.
                    </p>
                </div>
            </div>
            <DialogFooter>
                <Button variant="ghost" onClick={onClose} disabled={saving}>취소</Button>
                <Button onClick={handleSave} disabled={!canSave || saving}>
                    {saving ? "저장 중..." : "저장"}
                </Button>
            </DialogFooter>
        </DialogContent>
    );
}
