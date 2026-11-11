"use client";

import { useMemo, useState } from "react";
import { Plus, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { DatePicker } from "@/components/ui/date-picker";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { FieldDefinition } from "@/types";
import { createLead } from "../api";
import { resolveBaseSlots } from "../utils/lead-fields";

interface CreateLeadDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    partitionId: number;
    fields: FieldDefinition[];
    onCreated: () => void;
}

function FieldInput({
    field,
    multiline,
    value,
    onChange,
}: {
    field: FieldDefinition | null;
    multiline?: boolean;
    value: string;
    onChange: (v: string) => void;
}) {
    if (field?.fieldType === "select" && field.options?.length) {
        return (
            <Select value={value || undefined} onValueChange={onChange}>
                <SelectTrigger className="w-full">
                    <SelectValue placeholder="선택" />
                </SelectTrigger>
                <SelectContent>
                    {field.options.map((o) => (
                        <SelectItem key={o} value={o}>
                            {o}
                        </SelectItem>
                    ))}
                </SelectContent>
            </Select>
        );
    }
    if (multiline || field?.fieldType === "textarea") {
        return <Textarea value={value} onChange={(e) => onChange(e.target.value)} rows={3} />;
    }
    if (field?.fieldType === "date") {
        return <DatePicker value={value} onChange={onChange} clearable />;
    }
    const type = field?.fieldType === "number" ? "number" : "text";
    return <Input type={type} value={value} onChange={(e) => onChange(e.target.value)} />;
}

/** 리드 추가 — 기본 항목만 보이고, 나머지는 "항목 추가"로 골라서 넣는다 */
export function CreateLeadDialog({ open, onOpenChange, partitionId, fields, onCreated }: CreateLeadDialogProps) {
    const slots = useMemo(() => resolveBaseSlots(fields), [fields]);
    const slotKeys = useMemo(() => new Set(slots.map((s) => s.key)), [slots]);
    const extraOptions = fields.filter((f) => !slotKeys.has(f.key) && !f.isSystem);

    const statusSlot = slots.find((s) => s.id === "status");
    const defaultStatus = statusSlot?.field?.options?.[0] ?? "";

    const [values, setValues] = useState<Record<string, string>>({});
    const [addedKeys, setAddedKeys] = useState<string[]>([]);
    const [saving, setSaving] = useState(false);

    const reset = () => {
        setValues({});
        setAddedKeys([]);
    };
    const set = (key: string, v: string) => setValues((prev) => ({ ...prev, [key]: v }));
    const valueOf = (key: string) => values[key] ?? (statusSlot && key === statusSlot.key ? defaultStatus : "");

    const submit = async () => {
        const data: Record<string, unknown> = {};
        for (const key of [...slots.map((s) => s.key), ...addedKeys]) {
            const v = valueOf(key).trim();
            if (v) data[key] = v;
        }
        if (Object.keys(data).length === 0) {
            toast.error("내용을 하나 이상 입력해주세요.");
            return;
        }
        setSaving(true);
        try {
            const result = await createLead(partitionId, data);
            if (!result.success) {
                toast.error(result.error || "리드 추가에 실패했습니다.");
                return;
            }
            toast.success("리드를 추가했습니다.");
            reset();
            onOpenChange(false);
            onCreated();
        } finally {
            setSaving(false);
        }
    };

    return (
        <Dialog
            open={open}
            onOpenChange={(v) => {
                if (!v) reset();
                onOpenChange(v);
            }}
        >
            <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
                <DialogHeader>
                    <DialogTitle>리드 추가</DialogTitle>
                </DialogHeader>
                <div className="space-y-3">
                    {slots.map((slot) => (
                        <div key={slot.id} className="space-y-1.5">
                            <Label className="text-xs text-muted-foreground">{slot.label}</Label>
                            <FieldInput
                                field={slot.field}
                                multiline={slot.id === "request"}
                                value={valueOf(slot.key)}
                                onChange={(v) => set(slot.key, v)}
                            />
                        </div>
                    ))}
                    {addedKeys.map((key) => {
                        const field = fields.find((f) => f.key === key) ?? null;
                        return (
                            <div key={key} className="space-y-1.5">
                                <div className="flex items-center justify-between">
                                    <Label className="text-xs text-muted-foreground">{field?.label ?? key}</Label>
                                    <button
                                        type="button"
                                        className="text-muted-foreground hover:text-foreground"
                                        onClick={() => setAddedKeys((prev) => prev.filter((k) => k !== key))}
                                        aria-label="항목 빼기"
                                    >
                                        <X className="h-3.5 w-3.5" />
                                    </button>
                                </div>
                                <FieldInput field={field} value={valueOf(key)} onChange={(v) => set(key, v)} />
                            </div>
                        );
                    })}
                    {extraOptions.some((f) => !addedKeys.includes(f.key)) && (
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button variant="outline" size="sm" className="w-full border-dashed">
                                    <Plus className="mr-1 h-4 w-4" />
                                    항목 추가
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent className="max-h-72 overflow-y-auto">
                                {extraOptions
                                    .filter((f) => !addedKeys.includes(f.key))
                                    .map((f) => (
                                        <DropdownMenuItem key={f.key} onClick={() => setAddedKeys((prev) => [...prev, f.key])}>
                                            {f.label}
                                        </DropdownMenuItem>
                                    ))}
                            </DropdownMenuContent>
                        </DropdownMenu>
                    )}
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>
                        취소
                    </Button>
                    <Button onClick={submit} disabled={saving}>
                        추가
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
