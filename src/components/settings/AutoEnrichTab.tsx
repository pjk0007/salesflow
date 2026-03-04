"use client";

import { useState, useMemo } from "react";
import { useAutoEnrichRules } from "@/hooks/useAutoEnrich";
import { useWorkspaces } from "@/hooks/useWorkspaces";
import { usePartitions } from "@/hooks/usePartitions";
import { useFields } from "@/hooks/useFields";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import {
    Dialog,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Loader2, Plus, Pencil, Trash2, Search, ArrowRight } from "lucide-react";
import { toast } from "sonner";
import type { RecordAutoEnrichRule } from "@/lib/db";

export default function AutoEnrichTab() {
    const { workspaces } = useWorkspaces();
    const firstWorkspaceId = workspaces?.[0]?.id ?? null;
    const { partitionTree } = usePartitions(firstWorkspaceId);
    const { fields } = useFields(firstWorkspaceId);

    const partitions = useMemo(() => {
        if (!partitionTree) return [];
        return [
            ...partitionTree.ungrouped,
            ...partitionTree.folders.flatMap((f) => f.partitions),
        ].map((p) => ({ id: p.id, name: p.name }));
    }, [partitionTree]);

    const [selectedPartitionId, setSelectedPartitionId] = useState<number | null>(null);
    const [dialogOpen, setDialogOpen] = useState(false);
    const [editingRule, setEditingRule] = useState<RecordAutoEnrichRule | null>(null);
    const [deleteTarget, setDeleteTarget] = useState<RecordAutoEnrichRule | null>(null);

    const { rules, isLoading, createRule, updateRule, deleteRule } =
        useAutoEnrichRules(selectedPartitionId);

    // Dialog form state
    const [searchField, setSearchField] = useState("");
    const [targetFields, setTargetFields] = useState<Set<string>>(new Set());
    const [submitting, setSubmitting] = useState(false);

    const fieldMap = useMemo(
        () => new Map(fields.map((f) => [f.key, f.label])),
        [fields]
    );

    const resetForm = () => {
        setSearchField("");
        setTargetFields(new Set());
        setEditingRule(null);
    };

    const openCreate = () => {
        resetForm();
        setDialogOpen(true);
    };

    const openEdit = (rule: RecordAutoEnrichRule) => {
        setEditingRule(rule);
        setSearchField(rule.searchField);
        setTargetFields(new Set((rule.targetFields ?? []) as string[]));
        setDialogOpen(true);
    };

    const handleSubmit = async () => {
        if (!searchField || targetFields.size === 0) {
            toast.error("검색 필드와 대상 필드를 선택해주세요.");
            return;
        }
        setSubmitting(true);
        try {
            const data = {
                partitionId: selectedPartitionId!,
                searchField,
                targetFields: Array.from(targetFields),
            };
            const result = editingRule
                ? await updateRule(editingRule.id, data)
                : await createRule(data);

            if (result.success) {
                toast.success(editingRule ? "규칙이 수정되었습니다." : "규칙이 생성되었습니다.");
                setDialogOpen(false);
                resetForm();
            } else {
                toast.error(result.error || "저장에 실패했습니다.");
            }
        } finally {
            setSubmitting(false);
        }
    };

    const handleDelete = async () => {
        if (!deleteTarget) return;
        const result = await deleteRule(deleteTarget.id);
        if (result.success) {
            toast.success("규칙이 삭제되었습니다.");
        } else {
            toast.error(result.error || "삭제에 실패했습니다.");
        }
        setDeleteTarget(null);
    };

    const handleToggle = async (rule: RecordAutoEnrichRule) => {
        await updateRule(rule.id, { isActive: rule.isActive === 1 ? 0 : 1 });
    };

    const toggleTargetField = (key: string) => {
        setTargetFields((prev) => {
            const next = new Set(prev);
            if (next.has(key)) {
                next.delete(key);
            } else {
                next.add(key);
            }
            return next;
        });
    };

    // 검색 필드로 선택된 것은 대상에서 제외
    const availableTargetFields = fields.filter((f) => f.key !== searchField && !f.key.startsWith("_"));

    return (
        <div className="space-y-6">
            <Card>
                <CardHeader>
                    <div className="flex items-center justify-between">
                        <div>
                            <CardTitle>자동 웹검색 보강</CardTitle>
                            <p className="text-sm text-muted-foreground mt-1">
                                레코드 등록 시 특정 필드를 이용해 웹검색하여 다른 필드를 자동으로 채웁니다.
                            </p>
                        </div>
                    </div>
                </CardHeader>
                <CardContent className="space-y-4">
                    {/* 파티션 선택 */}
                    <div className="space-y-2">
                        <Label>파티션 선택</Label>
                        <Select
                            value={selectedPartitionId?.toString() ?? ""}
                            onValueChange={(v) => setSelectedPartitionId(Number(v))}
                        >
                            <SelectTrigger className="w-[300px]">
                                <SelectValue placeholder="파티션을 선택하세요" />
                            </SelectTrigger>
                            <SelectContent>
                                {partitions.map((p) => (
                                    <SelectItem key={p.id} value={p.id.toString()}>
                                        {p.name}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    {selectedPartitionId && (
                        <>
                            <div className="flex items-center justify-between">
                                <h4 className="text-sm font-medium">
                                    규칙 목록 {!isLoading && `(${rules.length})`}
                                </h4>
                                <Button size="sm" onClick={openCreate}>
                                    <Plus className="h-4 w-4 mr-1" />
                                    규칙 추가
                                </Button>
                            </div>

                            {isLoading ? (
                                <div className="flex items-center justify-center py-8">
                                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                                </div>
                            ) : rules.length === 0 ? (
                                <div className="text-center py-8 text-muted-foreground text-sm">
                                    설정된 자동 보강 규칙이 없습니다.
                                </div>
                            ) : (
                                <div className="space-y-3">
                                    {rules.map((rule) => (
                                        <div
                                            key={rule.id}
                                            className="flex items-center justify-between p-3 border rounded-lg"
                                        >
                                            <div className="flex items-center gap-3 min-w-0">
                                                <Switch
                                                    checked={rule.isActive === 1}
                                                    onCheckedChange={() => handleToggle(rule)}
                                                />
                                                <div className="min-w-0">
                                                    <div className="flex items-center gap-2 flex-wrap">
                                                        <Badge variant="outline" className="shrink-0">
                                                            <Search className="h-3 w-3 mr-1" />
                                                            {fieldMap.get(rule.searchField) || rule.searchField}
                                                        </Badge>
                                                        <ArrowRight className="h-3 w-3 text-muted-foreground shrink-0" />
                                                        {((rule.targetFields ?? []) as string[]).map((key) => (
                                                            <Badge key={key} variant="secondary" className="text-xs">
                                                                {fieldMap.get(key) || key}
                                                            </Badge>
                                                        ))}
                                                    </div>
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-1 shrink-0 ml-2">
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    className="h-8 w-8"
                                                    onClick={() => openEdit(rule)}
                                                >
                                                    <Pencil className="h-3.5 w-3.5" />
                                                </Button>
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    className="h-8 w-8 text-destructive"
                                                    onClick={() => setDeleteTarget(rule)}
                                                >
                                                    <Trash2 className="h-3.5 w-3.5" />
                                                </Button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </>
                    )}
                </CardContent>
            </Card>

            {/* 생성/수정 Dialog */}
            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle>
                            {editingRule ? "보강 규칙 수정" : "보강 규칙 추가"}
                        </DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4">
                        <div className="space-y-2">
                            <Label>검색 필드</Label>
                            <p className="text-xs text-muted-foreground">
                                이 필드의 값으로 웹검색을 수행합니다 (예: 회사명)
                            </p>
                            <Select value={searchField} onValueChange={setSearchField}>
                                <SelectTrigger>
                                    <SelectValue placeholder="필드 선택" />
                                </SelectTrigger>
                                <SelectContent>
                                    {fields
                                        .filter((f) => !f.key.startsWith("_"))
                                        .map((f) => (
                                            <SelectItem key={f.key} value={f.key}>
                                                {f.label}
                                            </SelectItem>
                                        ))}
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="space-y-2">
                            <Label>대상 필드 (비어있을 때만 채움)</Label>
                            <p className="text-xs text-muted-foreground">
                                웹검색 결과로 자동 채울 필드를 선택하세요
                            </p>
                            <div className="border rounded-lg p-3 space-y-2 max-h-[240px] overflow-y-auto">
                                {availableTargetFields.length === 0 ? (
                                    <p className="text-sm text-muted-foreground">
                                        검색 필드를 먼저 선택하세요.
                                    </p>
                                ) : (
                                    availableTargetFields.map((f) => (
                                        <div key={f.key} className="flex items-center gap-2">
                                            <Checkbox
                                                id={`target-${f.key}`}
                                                checked={targetFields.has(f.key)}
                                                onCheckedChange={() => toggleTargetField(f.key)}
                                            />
                                            <Label
                                                htmlFor={`target-${f.key}`}
                                                className="cursor-pointer text-sm font-normal"
                                            >
                                                {f.label}
                                            </Label>
                                        </div>
                                    ))
                                )}
                            </div>
                            {targetFields.size > 0 && (
                                <p className="text-xs text-muted-foreground">
                                    {targetFields.size}개 필드 선택됨
                                </p>
                            )}
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setDialogOpen(false)}>
                            취소
                        </Button>
                        <Button
                            onClick={handleSubmit}
                            disabled={submitting || !searchField || targetFields.size === 0}
                        >
                            {submitting && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
                            {editingRule ? "수정" : "저장"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* 삭제 확인 */}
            <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>규칙 삭제</AlertDialogTitle>
                        <AlertDialogDescription>
                            이 자동 보강 규칙을 삭제하시겠습니까?
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>취소</AlertDialogCancel>
                        <AlertDialogAction onClick={handleDelete}>삭제</AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
}
