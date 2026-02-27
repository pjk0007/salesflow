import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import {
    Collapsible,
    CollapsibleContent,
    CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ChevronRight, Plus, X, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import type { Partition } from "@/lib/db/schema";
import type { FieldDefinition } from "@/types";

type DistributionDefault = { field: string; value: string };
type DistributionDefaults = Record<number, DistributionDefault[]>;

interface Props {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    partition: Partition;
    fields: FieldDefinition[];
    onSave: (data: {
        useDistributionOrder: boolean;
        maxDistributionOrder: number;
        distributionDefaults: DistributionDefaults | null;
    }) => Promise<{ success: boolean; error?: string }>;
}

export default function DistributionSettingsDialog({
    open,
    onOpenChange,
    partition,
    fields,
    onSave,
}: Props) {
    const [enabled, setEnabled] = useState(!!partition.useDistributionOrder);
    const [maxOrder, setMaxOrder] = useState(partition.maxDistributionOrder);
    const [defaults, setDefaults] = useState<DistributionDefaults>(
        (partition.distributionDefaults as DistributionDefaults) ?? {}
    );
    const [openSections, setOpenSections] = useState<Set<number>>(new Set());
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (open) {
            setEnabled(!!partition.useDistributionOrder);
            setMaxOrder(partition.maxDistributionOrder);
            setDefaults((partition.distributionDefaults as DistributionDefaults) ?? {});
            setOpenSections(new Set());
        }
    }, [open, partition]);

    const toggleSection = (order: number) => {
        setOpenSections((prev) => {
            const next = new Set(prev);
            if (next.has(order)) next.delete(order);
            else next.add(order);
            return next;
        });
    };

    const addDefault = (order: number) => {
        setDefaults((prev) => ({
            ...prev,
            [order]: [...(prev[order] ?? []), { field: "", value: "" }],
        }));
    };

    const updateDefault = (
        order: number,
        idx: number,
        key: "field" | "value",
        val: string
    ) => {
        setDefaults((prev) => {
            const list = [...(prev[order] ?? [])];
            list[idx] = { ...list[idx], [key]: val };
            return { ...prev, [order]: list };
        });
    };

    const removeDefault = (order: number, idx: number) => {
        setDefaults((prev) => {
            const list = [...(prev[order] ?? [])];
            list.splice(idx, 1);
            return { ...prev, [order]: list };
        });
    };

    const handleSave = async () => {
        if (maxOrder < 1 || maxOrder > 99) {
            toast.error("분배 순번은 1~99 범위여야 합니다.");
            return;
        }

        // 사용하지 않는 순번의 defaults 정리
        const cleanedDefaults: DistributionDefaults = {};
        for (let i = 1; i <= maxOrder; i++) {
            const list = defaults[i]?.filter((d) => d.field && d.value);
            if (list && list.length > 0) cleanedDefaults[i] = list;
        }

        setSaving(true);
        try {
            const result = await onSave({
                useDistributionOrder: enabled,
                maxDistributionOrder: maxOrder,
                distributionDefaults:
                    Object.keys(cleanedDefaults).length > 0 ? cleanedDefaults : null,
            });
            if (result.success) {
                toast.success("배분 설정이 저장되었습니다.");
                onOpenChange(false);
            } else {
                toast.error(result.error || "저장에 실패했습니다.");
            }
        } finally {
            setSaving(false);
        }
    };

    const getFieldOptions = (fieldKey: string) => {
        const field = fields.find((f) => f.key === fieldKey);
        return field?.options ?? [];
    };

    const getFieldType = (fieldKey: string) => {
        return fields.find((f) => f.key === fieldKey)?.fieldType;
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>배분 설정 — {partition.name}</DialogTitle>
                </DialogHeader>

                <div className="space-y-4">
                    {/* 활성화 토글 */}
                    <div className="flex items-center justify-between">
                        <div>
                            <Label>자동 분배</Label>
                            <p className="text-xs text-muted-foreground">
                                신규 레코드 등록 시 자동으로 순번 배정
                            </p>
                        </div>
                        <Switch checked={enabled} onCheckedChange={setEnabled} />
                    </div>

                    {enabled && (
                        <>
                            {/* 순번 수 */}
                            <div className="space-y-1">
                                <Label>분배 순번 수</Label>
                                <Input
                                    type="number"
                                    min={1}
                                    max={99}
                                    value={maxOrder}
                                    onChange={(e) => setMaxOrder(Number(e.target.value) || 1)}
                                    className="w-24"
                                />
                                <p className="text-xs text-muted-foreground">
                                    1~{maxOrder} 순환 배정
                                </p>
                            </div>

                            {/* 순번별 기본값 */}
                            <div className="space-y-1">
                                <Label>순번별 기본값</Label>
                                <p className="text-xs text-muted-foreground">
                                    각 순번에 배정될 때 자동 입력될 필드값을 설정합니다.
                                </p>
                            </div>

                            <div className="space-y-1">
                                {Array.from({ length: maxOrder }, (_, i) => i + 1).map(
                                    (order) => {
                                        const orderDefaults = defaults[order] ?? [];
                                        return (
                                            <Collapsible
                                                key={order}
                                                open={openSections.has(order)}
                                                onOpenChange={() => toggleSection(order)}
                                            >
                                                <CollapsibleTrigger asChild>
                                                    <Button
                                                        variant="ghost"
                                                        size="sm"
                                                        className="w-full justify-start gap-2"
                                                    >
                                                        <ChevronRight
                                                            className={cn(
                                                                "h-3.5 w-3.5 transition-transform",
                                                                openSections.has(order) && "rotate-90"
                                                            )}
                                                        />
                                                        순번 {order}
                                                        {orderDefaults.length > 0 && (
                                                            <span className="text-xs text-muted-foreground ml-auto">
                                                                {orderDefaults.length}개 설정
                                                            </span>
                                                        )}
                                                    </Button>
                                                </CollapsibleTrigger>
                                                <CollapsibleContent className="pl-6 pr-2 pb-2 space-y-2">
                                                    {orderDefaults.map((d, idx) => (
                                                        <div
                                                            key={idx}
                                                            className="flex items-center gap-2"
                                                        >
                                                            <Select
                                                                value={d.field || ""}
                                                                onValueChange={(v) =>
                                                                    updateDefault(order, idx, "field", v)
                                                                }
                                                            >
                                                                <SelectTrigger className="w-36 h-8 text-sm">
                                                                    <SelectValue placeholder="필드" />
                                                                </SelectTrigger>
                                                                <SelectContent>
                                                                    {fields.map((f) => (
                                                                        <SelectItem
                                                                            key={f.key}
                                                                            value={f.key}
                                                                        >
                                                                            {f.label}
                                                                        </SelectItem>
                                                                    ))}
                                                                </SelectContent>
                                                            </Select>

                                                            {d.field &&
                                                            getFieldType(d.field) === "select" ? (
                                                                <Select
                                                                    value={d.value || ""}
                                                                    onValueChange={(v) =>
                                                                        updateDefault(
                                                                            order,
                                                                            idx,
                                                                            "value",
                                                                            v
                                                                        )
                                                                    }
                                                                >
                                                                    <SelectTrigger className="flex-1 h-8 text-sm">
                                                                        <SelectValue placeholder="값" />
                                                                    </SelectTrigger>
                                                                    <SelectContent>
                                                                        {getFieldOptions(
                                                                            d.field
                                                                        ).map((opt) => (
                                                                            <SelectItem
                                                                                key={opt}
                                                                                value={opt}
                                                                            >
                                                                                {opt}
                                                                            </SelectItem>
                                                                        ))}
                                                                    </SelectContent>
                                                                </Select>
                                                            ) : (
                                                                <Input
                                                                    value={d.value}
                                                                    onChange={(e) =>
                                                                        updateDefault(
                                                                            order,
                                                                            idx,
                                                                            "value",
                                                                            e.target.value
                                                                        )
                                                                    }
                                                                    placeholder="값"
                                                                    className="flex-1 h-8 text-sm"
                                                                />
                                                            )}

                                                            <Button
                                                                variant="ghost"
                                                                size="icon"
                                                                className="h-8 w-8 shrink-0"
                                                                onClick={() =>
                                                                    removeDefault(order, idx)
                                                                }
                                                            >
                                                                <X className="h-3.5 w-3.5" />
                                                            </Button>
                                                        </div>
                                                    ))}
                                                    <Button
                                                        variant="outline"
                                                        size="sm"
                                                        className="text-xs"
                                                        onClick={() => addDefault(order)}
                                                    >
                                                        <Plus className="h-3 w-3 mr-1" />
                                                        기본값 추가
                                                    </Button>
                                                </CollapsibleContent>
                                            </Collapsible>
                                        );
                                    }
                                )}
                            </div>
                        </>
                    )}

                    <div className="flex justify-end gap-2 pt-2">
                        <Button
                            variant="outline"
                            onClick={() => onOpenChange(false)}
                            disabled={saving}
                        >
                            취소
                        </Button>
                        <Button onClick={handleSave} disabled={saving}>
                            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                            저장
                        </Button>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}
