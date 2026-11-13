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
import { cn } from "@/lib/utils";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { FieldDefinition } from "@/types";
import { createLead } from "../api";
import { AUTO_FILLED_KEYS, resolveBaseSlots } from "../utils/lead-fields";
import { useSession } from "@/contexts/SessionContext";
import { OwnerSelect } from "@/components/sales/ui/OwnerSelect";
import type { CardFields } from "@/components/sales/types";
import { createSalesLead } from "@/components/sales/api";
import { WorkspaceChips } from "@/components/sales/ui/WorkspaceChips";
import { CompanyCombobox } from "@/components/sales/ui/CompanyCombobox";

interface CreateLeadDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    partitionId: number;
    fields: FieldDefinition[];
    onCreated: () => void;
    /** sales: 영업관리 — 직책·우리 담당자, 명함에서 읽은 값(prefill)으로 미리 채운다 */
    mode?: "lead" | "sales";
    prefill?: CardFields | null;
    /** 영업관리: 지금 보고 있는 사업부 탭 (전체면 null) — 사업부 기본 선택 */
    workspaceId?: number | null;
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
export function CreateLeadDialog({ open, onOpenChange, partitionId, fields, onCreated, mode = "lead", prefill, workspaceId }: CreateLeadDialogProps) {
    const sales = mode === "sales";
    const { user } = useSession();
    const [ownerId, setOwnerId] = useState<string | null>(user?.id ?? null);
    // 영업관리: 이 리드가 속할 사업부들 (첫 번째가 등록 사업부)
    const [salesWorkspaces, setSalesWorkspaces] = useState<number[]>(workspaceId ? [workspaceId] : []);
    const slots = useMemo(() => resolveBaseSlots(fields, mode), [fields, mode]);
    const slotKeys = useMemo(() => new Set(slots.map((s) => s.key)), [slots]);
    // 캠페인·광고 소재 등은 웹폼·메타 광고가 자동으로 채우는 유입 정보라 직접 넣는 항목에서 뺀다
    const extraOptions = fields.filter((f) => !slotKeys.has(f.key) && !f.isSystem && !AUTO_FILLED_KEYS.has(f.key));

    const statusSlot = slots.find((s) => s.id === "status");
    const defaultStatus = statusSlot?.field?.options?.[0] ?? "";

    // 명함에서 읽은 값으로 시작 (창은 key로 새로 그려져 처음 한 번만 채운다)
    const [values, setValues] = useState<Record<string, string>>(() => {
        if (!prefill) return {};
        const keyOf = (id: string) => slots.find((s) => s.id === id)?.key;
        const v: Record<string, string> = {};
        const put = (id: string, value: string | null) => {
            const k = keyOf(id);
            if (k && value) v[k] = value;
        };
        put("company", prefill.companyName);
        put("contactName", prefill.name);
        put("contactTitle", prefill.title);
        put("phone", prefill.phone);
        put("email", prefill.email);
        put("address", prefill.address ?? null);
        put("memo", prefill.website ? `웹사이트: ${prefill.website}` : null);
        return v;
    });
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
        if (sales && ownerId) data.owner = ownerId;
        if (Object.keys(data).length === 0) {
            toast.error("내용을 하나 이상 입력해주세요.");
            return;
        }
        setSaving(true);
        try {
            if (sales && salesWorkspaces.length === 0) {
                toast.error("사업부를 하나 이상 골라주세요.");
                return;
            }
            const result = sales ? await createSalesLead(salesWorkspaces, data) : await createLead(partitionId, data);
            if (!result.success) {
                toast.error(result.error || "리드 추가에 실패했습니다.");
                return;
            }
            toast.success(sales ? "영업고객을 추가했습니다." : "리드를 추가했습니다.");
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
            {/* 머리·아래 버튼은 고정, 가운데만 스크롤 — 스크롤바가 창 둥근 모서리 밖으로 나가지 않게 */}
            <DialogContent className="flex max-h-[88vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
                <DialogHeader className="border-b px-6 py-4">
                    <DialogTitle>{sales ? (prefill ? "명함으로 영업고객 추가" : "영업고객 추가") : "리드 추가"}</DialogTitle>
                </DialogHeader>
                <div className="grid min-h-0 flex-1 grid-cols-1 gap-x-4 gap-y-3 overflow-y-auto px-6 py-5 scrollbar-thin sm:grid-cols-2">
                    {sales && (
                        <div className="space-y-1.5 sm:col-span-2">
                            <Label className="text-xs text-muted-foreground">사업부 (다중선택)</Label>
                            <WorkspaceChips value={salesWorkspaces} onChange={setSalesWorkspaces} />
                        </div>
                    )}
                    {sales && (
                        <div className="space-y-1.5">
                            <Label className="text-xs text-muted-foreground">담당자</Label>
                            <OwnerSelect value={ownerId} onChange={setOwnerId} field />
                        </div>
                    )}
                    {slots.map((slot) => (
                        <div key={slot.id} className={cn("space-y-1.5", (slot.id === "request" || slot.id === "memo" || slot.id === "address") && "sm:col-span-2")}>
                            <Label className="text-xs text-muted-foreground">{slot.label}</Label>
                            {sales && slot.id === "company" ? (
                                <CompanyCombobox
                                    value={valueOf(slot.key)}
                                    onChange={(v) => set(slot.key, v)}
                                    workspaceIds={salesWorkspaces}
                                    onPick={(c) => {
                                        set(slot.key, c.name);
                                        const addressKey = slots.find((s) => s.id === "address")?.key;
                                        if (addressKey && c.address) set(addressKey, c.address);
                                    }}
                                />
                            ) : (
                                <FieldInput
                                    field={slot.field}
                                    multiline={slot.id === "request" || slot.id === "memo"}
                                    value={valueOf(slot.key)}
                                    onChange={(v) => set(slot.key, v)}
                                />
                            )}
                        </div>
                    ))}
                    {addedKeys.map((key) => {
                        const field = fields.find((f) => f.key === key) ?? null;
                        return (
                            <div key={key} className={cn("space-y-1.5", field?.fieldType === "textarea" && "sm:col-span-2")}>
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
                    {!sales && extraOptions.some((f) => !addedKeys.includes(f.key)) && (
                        <div className="sm:col-span-2">
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
                        </div>
                    )}
                </div>
                <DialogFooter className="border-t px-6 py-4">
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
