"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Target, Plus, Star, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { FunnelEditorDialog } from "./FunnelEditorDialog";
import { useTrackerFunnels, deleteFunnel, updateFunnel } from "../hooks/useTrackerFunnels";
import type { FunnelDefinition } from "../types/funnel";

interface Props {
    siteId: number;
}

/**
 * 트래커 설정 탭 — 사이트의 사용자정의 퍼널 관리.
 * 방문/리드는 자동 단계라 여기서 정의 안 함. 3단부터 운영자가 입력.
 */
export function FunnelManagerCard({ siteId }: Props) {
    const { funnels, isLoading, mutate } = useTrackerFunnels(siteId);
    const [editing, setEditing] = useState<FunnelDefinition | null>(null);
    const [open, setOpen] = useState(false);

    const handleAdd = () => {
        setEditing(null);
        setOpen(true);
    };
    const handleEdit = (f: FunnelDefinition) => {
        setEditing(f);
        setOpen(true);
    };
    const handleDelete = async (f: FunnelDefinition) => {
        if (!confirm(`"${f.name}" 퍼널을 삭제하시겠습니까?`)) return;
        try {
            await deleteFunnel(f.id);
            toast.success("삭제되었습니다.");
            mutate();
        } catch (err) {
            toast.error(err instanceof Error ? err.message : "삭제 실패");
        }
    };
    const setAsDefault = async (f: FunnelDefinition) => {
        try {
            await updateFunnel(f.id, { isDefault: true });
            toast.success(`"${f.name}"이(가) 메인 퍼널로 설정되었습니다.`);
            mutate();
        } catch (err) {
            toast.error(err instanceof Error ? err.message : "변경 실패");
        }
    };

    return (
        <Card>
            <CardHeader className="pb-3">
                <CardTitle className="flex items-center justify-between text-base">
                    <span className="inline-flex items-center gap-2">
                        <Target className="h-4 w-4 text-muted-foreground" />
                        퍼널 관리
                    </span>
                    <Button size="sm" variant="outline" onClick={handleAdd}>
                        <Plus className="mr-1 h-3.5 w-3.5" />
                        퍼널 추가
                    </Button>
                </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
                <p className="text-xs text-muted-foreground">
                    방문 → 리드까지는 자동 단계입니다. 그 다음 단계를 사이트에 맞게 정의하세요.
                    메인 퍼널은 개요 탭의 깔때기 위젯에 표시됩니다.
                </p>
                {isLoading ? (
                    <p className="text-sm text-muted-foreground">불러오는 중...</p>
                ) : funnels.length === 0 ? (
                    <p className="rounded-md border border-dashed bg-muted/30 p-4 text-center text-sm text-muted-foreground">
                        정의된 퍼널이 없습니다. "퍼널 추가"로 시작하세요.
                    </p>
                ) : (
                    <ul className="space-y-2">
                        {funnels.map((f) => (
                            <li key={f.id} className="rounded-md border bg-card p-3">
                                <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0 flex-1">
                                        <div className="flex items-center gap-1.5">
                                            {f.isDefault ? <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-500" /> : <span className="w-3.5" />}
                                            <span className="text-sm font-medium">{f.name}</span>
                                            {f.isDefault === 1 && (
                                                <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
                                                    메인
                                                </span>
                                            )}
                                        </div>
                                        <p className="mt-1 text-xs text-muted-foreground">
                                            방문 → 리드 → {f.stages.map((s) => s.label).join(" → ") || "(단계 미정의)"}
                                        </p>
                                    </div>
                                    <div className="flex shrink-0 gap-1">
                                        {!f.isDefault && (
                                            <Button size="sm" variant="ghost" onClick={() => setAsDefault(f)} title="메인으로">
                                                <Star className="h-3.5 w-3.5" />
                                            </Button>
                                        )}
                                        <Button size="sm" variant="ghost" onClick={() => handleEdit(f)}>
                                            <Pencil className="h-3.5 w-3.5" />
                                        </Button>
                                        <Button size="sm" variant="ghost" onClick={() => handleDelete(f)} className="text-rose-600 hover:text-rose-700">
                                            <Trash2 className="h-3.5 w-3.5" />
                                        </Button>
                                    </div>
                                </div>
                            </li>
                        ))}
                    </ul>
                )}
            </CardContent>
            <FunnelEditorDialog
                open={open}
                onOpenChange={setOpen}
                siteId={siteId}
                funnel={editing}
                onSaved={() => mutate()}
            />
        </Card>
    );
}
