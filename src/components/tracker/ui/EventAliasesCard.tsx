"use client";

import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tags, Plus, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useEventAliases, deleteEventAlias } from "../hooks/useEventAliases";
import { EventAliasEditorDialog } from "./EventAliasEditorDialog";
import type { EventAliasRow, EventAliasType } from "../types/event-alias";

interface Props {
    siteId: number;
}

const FILTERS: Array<{ value: "all" | EventAliasType; label: string }> = [
    { value: "all", label: "전체" },
    { value: "SECTION_VIEW", label: "섹션 노출" },
    { value: "CLICK", label: "클릭" },
];

/**
 * 트래커 설정 탭 — 이벤트 이름 별칭 관리.
 * 사이트에서 실제 발생한 SECTION_VIEW/CLICK 이벤트 목록을 표로 보여주고
 * 운영자가 한글 라벨을 매핑할 수 있게 한다.
 */
export function EventAliasesCard({ siteId }: Props) {
    const { data, isLoading, mutate } = useEventAliases(siteId);
    const [filter, setFilter] = useState<"all" | EventAliasType>("all");
    const [editorOpen, setEditorOpen] = useState(false);
    const [initial, setInitial] = useState<EventAliasRow | null>(null);

    const filtered = useMemo(() => {
        return filter === "all" ? data : data.filter((r) => r.eventType === filter);
    }, [data, filter]);

    const openCreate = () => {
        setInitial(null);
        setEditorOpen(true);
    };
    const openPrefill = (row: EventAliasRow) => {
        // 신규 등록인데 type/name 미리 채움
        setInitial({ ...row, id: null });
        setEditorOpen(true);
    };
    const openEdit = (row: EventAliasRow) => {
        setInitial(row);
        setEditorOpen(true);
    };
    const handleDelete = async (row: EventAliasRow) => {
        if (!row.id) return;
        if (!confirm(`"${row.label || row.eventName}" 별칭을 삭제하시겠습니까?\n분석 화면에서는 raw 이름으로 표시됩니다.`)) return;
        try {
            await deleteEventAlias(row.id);
            toast.success("삭제되었습니다.");
            mutate();
        } catch (err) {
            toast.error(err instanceof Error ? err.message : "삭제 실패");
        }
    };

    return (
        <Card>
            <CardHeader className="pb-3">
                <CardTitle className="flex items-center justify-between text-base">
                    <span className="inline-flex items-center gap-2">
                        <Tags className="h-4 w-4 text-muted-foreground" />
                        이벤트 라벨
                    </span>
                    <Button size="sm" variant="outline" onClick={openCreate}>
                        <Plus className="mr-1 h-3.5 w-3.5" />
                        별칭 등록
                    </Button>
                </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
                <p className="text-xs text-muted-foreground">
                    페이지에 박은 raw 이름(예: <code className="rounded bg-muted px-1 text-[11px]">hero</code>)에
                    한글 라벨을 매핑하면 마케팅 탭의 페이지 인게이지먼트에서 라벨로 표시됩니다.
                </p>

                <div className="inline-flex rounded-md border bg-muted/30 p-0.5 text-[11px]">
                    {FILTERS.map((f) => (
                        <button
                            key={f.value}
                            type="button"
                            onClick={() => setFilter(f.value)}
                            className={
                                filter === f.value
                                    ? "rounded bg-background px-2 py-0.5 font-medium shadow-sm"
                                    : "rounded px-2 py-0.5 text-muted-foreground hover:text-foreground"
                            }
                        >
                            {f.label}
                        </button>
                    ))}
                </div>

                {isLoading ? (
                    <p className="text-sm text-muted-foreground">불러오는 중...</p>
                ) : filtered.length === 0 ? (
                    <div className="rounded-md border border-dashed bg-muted/30 p-4 text-center text-[12px] text-muted-foreground">
                        아직 추적된 이벤트가 없습니다. 페이지에 <code className="font-mono">data-track-section</code> /{" "}
                        <code className="font-mono">data-track-click</code> 속성을 박은 후 방문이 발생하면 여기에 표시됩니다.
                    </div>
                ) : (
                    <div className="rounded-md border text-xs">
                        <table className="w-full">
                            <thead className="bg-muted/50">
                                <tr>
                                    <th className="px-2 py-1.5 text-left font-medium">타입</th>
                                    <th className="px-2 py-1.5 text-left font-medium">이름</th>
                                    <th className="px-2 py-1.5 text-left font-medium">라벨</th>
                                    <th className="px-2 py-1.5 text-right font-medium">발생</th>
                                    <th className="px-2 py-1.5 text-right font-medium">액션</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filtered.map((r) => {
                                    const hasLabel = !!(r.label && r.label.trim());
                                    return (
                                        <tr key={`${r.eventType}-${r.eventName}`} className="border-t">
                                            <td className="px-2 py-1.5 font-mono text-[11px] text-muted-foreground">
                                                {r.eventType === "SECTION_VIEW" ? "섹션" : "클릭"}
                                            </td>
                                            <td className="px-2 py-1.5 font-mono">{r.eventName}</td>
                                            <td className="px-2 py-1.5">
                                                {hasLabel ? (
                                                    <span>{r.label}</span>
                                                ) : (
                                                    <span className="text-muted-foreground">(미설정)</span>
                                                )}
                                            </td>
                                            <td className="px-2 py-1.5 text-right tabular-nums">
                                                {r.occurrences.toLocaleString()}
                                            </td>
                                            <td className="px-2 py-1.5 text-right">
                                                {r.id ? (
                                                    <div className="inline-flex gap-1">
                                                        <Button size="sm" variant="ghost" onClick={() => openEdit(r)} title="편집">
                                                            <Pencil className="h-3.5 w-3.5" />
                                                        </Button>
                                                        <Button
                                                            size="sm"
                                                            variant="ghost"
                                                            onClick={() => handleDelete(r)}
                                                            className="text-rose-600 hover:text-rose-700"
                                                            title="삭제"
                                                        >
                                                            <Trash2 className="h-3.5 w-3.5" />
                                                        </Button>
                                                    </div>
                                                ) : (
                                                    <Button size="sm" variant="outline" onClick={() => openPrefill(r)}>
                                                        <Plus className="mr-1 h-3 w-3" />
                                                        추가
                                                    </Button>
                                                )}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </CardContent>
            <EventAliasEditorDialog
                open={editorOpen}
                onOpenChange={setEditorOpen}
                siteId={siteId}
                initial={initial}
                onSaved={() => mutate()}
            />
        </Card>
    );
}
