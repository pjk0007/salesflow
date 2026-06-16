"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import FilterBuilder from "./FilterBuilder";
import { AlertTriangle, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { FieldDefinition, FilterCondition } from "@/types";

const NO_VALUE_OPS = new Set(["is_empty", "is_not_empty", "is_true", "is_false"]);
const OP_LABEL: Record<string, string> = {
    contains: "포함", equals: "같음", not_equals: "같지 않음",
    gt: ">", gte: ">=", lt: "<", lte: "<=",
    before: "이전", after: "이후", between: "사이",
    is_empty: "비어있음", is_not_empty: "비어있지 않음",
    is_true: "체크됨", is_false: "체크 안됨",
};

function isComplete(c: FilterCondition): boolean {
    if (NO_VALUE_OPS.has(c.operator)) return true;
    if (c.value === null || c.value === undefined || c.value === "") return false;
    if (c.operator === "between") return c.valueTo !== undefined && c.valueTo !== null && c.valueTo !== "";
    return true;
}

interface Props {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    partitionId: number | null;
    fields: FieldDefinition[];
    onDeleted: () => void;
}

export default function ConditionDeleteDialog({ open, onOpenChange, partitionId, fields, onDeleted }: Props) {
    const [filters, setFilters] = useState<FilterCondition[]>([]);
    const [count, setCount] = useState<number | null>(null);
    const [counting, setCounting] = useState(false);
    const [deleting, setDeleting] = useState(false);

    const completeFilters = useMemo(() => filters.filter(isComplete), [filters]);
    const filtersKey = useMemo(() => JSON.stringify(completeFilters), [completeFilters]);

    const labelOf = useCallback(
        (key: string) => fields.find((f) => f.key === key)?.label ?? key,
        [fields],
    );

    const handleOpenChange = (v: boolean) => {
        if (!v) {
            setFilters([]);
            setCount(null);
            setDeleting(false);
        }
        onOpenChange(v);
    };

    // 조건 변경 시 매칭 개수 조회 (디바운스)
    useEffect(() => {
        if (!open || !partitionId || completeFilters.length === 0) {
            setCount(null);
            return;
        }
        let cancelled = false;
        setCounting(true);
        const t = setTimeout(async () => {
            try {
                const qs = new URLSearchParams({ pageSize: "1", filters: filtersKey });
                const res = await fetch(`/api/partitions/${partitionId}/records?${qs.toString()}`);
                const json = await res.json();
                if (!cancelled) setCount(json?.total ?? 0);
            } catch {
                if (!cancelled) setCount(null);
            } finally {
                if (!cancelled) setCounting(false);
            }
        }, 350);
        return () => { cancelled = true; clearTimeout(t); };
    }, [open, partitionId, filtersKey, completeFilters.length]);

    const handleDelete = async () => {
        if (!partitionId || completeFilters.length === 0) return;
        if (!confirm(`정말 ${count?.toLocaleString() ?? ""}건을 삭제할까요? 되돌릴 수 없습니다.`)) return;
        setDeleting(true);
        try {
            const res = await fetch(`/api/partitions/${partitionId}/records/delete-all`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ filters: completeFilters }),
            });
            const json = await res.json();
            if (json.success) {
                toast.success(`${json.data.deletedCount.toLocaleString()}건이 삭제되었습니다.`);
                onDeleted();
                handleOpenChange(false);
            } else {
                toast.error(json.error ?? "삭제 실패");
            }
        } catch {
            toast.error("삭제 중 오류가 발생했습니다.");
        } finally {
            setDeleting(false);
        }
    };

    if (!partitionId) return null;

    const canDelete = completeFilters.length > 0 && (count ?? 0) > 0 && !counting && !deleting;

    return (
        <Dialog open={open} onOpenChange={handleOpenChange}>
            <DialogContent className="sm:max-w-lg">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2 text-destructive">
                        <Trash2 className="h-5 w-5" />
                        조건 삭제
                    </DialogTitle>
                    <DialogDescription>
                        지정한 조건에 맞는 레코드를 한 번에 삭제합니다. 조건을 1개 이상 지정해야 합니다.
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-3 py-1">
                    <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">삭제 조건</span>
                        <FilterBuilder fields={fields} filters={filters} onFiltersChange={setFilters} />
                    </div>

                    {completeFilters.length === 0 ? (
                        <p className="text-sm text-muted-foreground">위 버튼으로 삭제할 조건을 추가하세요.</p>
                    ) : (
                        <div className="rounded-md border bg-muted/30 p-3 space-y-1.5">
                            <p className="text-xs font-medium text-muted-foreground">선택한 조건 (모두 만족)</p>
                            <ul className="space-y-1 text-sm">
                                {completeFilters.map((c, i) => (
                                    <li key={i} className="flex gap-1.5">
                                        <span className="font-medium">{labelOf(c.field)}</span>
                                        <span className="text-muted-foreground">{OP_LABEL[c.operator] ?? c.operator}</span>
                                        {!NO_VALUE_OPS.has(c.operator) && (
                                            <span className="text-foreground">
                                                {String(c.value)}{c.operator === "between" ? ` ~ ${String(c.valueTo)}` : ""}
                                            </span>
                                        )}
                                    </li>
                                ))}
                            </ul>
                            <div className="flex items-center gap-1.5 pt-1 text-sm">
                                {counting ? (
                                    <><Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" /><span className="text-muted-foreground">개수 확인 중…</span></>
                                ) : (
                                    <span className={count && count > 0 ? "font-semibold text-destructive" : "text-muted-foreground"}>
                                        매칭 {count?.toLocaleString() ?? 0}건
                                    </span>
                                )}
                            </div>
                        </div>
                    )}

                    {(count ?? 0) > 0 && (
                        <div className="flex items-start gap-1.5 text-xs text-destructive">
                            <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                            <span>삭제된 레코드는 복구할 수 없습니다.</span>
                        </div>
                    )}
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={deleting}>
                        취소
                    </Button>
                    <Button variant="destructive" onClick={handleDelete} disabled={!canDelete}>
                        {deleting ? <><Loader2 className="h-4 w-4 mr-1 animate-spin" />삭제 중…</> : `${(count ?? 0).toLocaleString()}건 삭제`}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
