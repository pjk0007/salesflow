"use client";

import { useState, useCallback, useEffect } from "react";
import dynamic from "next/dynamic";
import WorkspaceLayout from "@/components/layouts/WorkspaceLayout";
import { useWorkspaces } from "@/hooks/useWorkspaces";
import { useFields } from "@/hooks/useFields";
import { usePartitions } from "@/hooks/usePartitions";
import { useDashboards } from "@/hooks/useDashboards";
import { useDashboardData } from "@/hooks/useDashboardData";
import WidgetConfigDialog from "@/components/dashboard/WidgetConfigDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { Plus, Pencil, Link2, Trash2, Globe, Lock, Sparkles, Filter } from "lucide-react";
import type { DashboardWidget } from "@/lib/db";

// Dynamic import for react-grid-layout (client-only)
const DashboardGrid = dynamic(
    () => import("@/components/dashboard/DashboardGrid"),
    { ssr: false }
);

export default function DashboardsPage() {
    const [workspaceId, setWorkspaceId] = useState<number | null>(null);
    const { workspaces } = useWorkspaces();
    const { fields } = useFields(workspaceId);
    const { partitionTree } = usePartitions(workspaceId);
    const { dashboards, createDashboard, updateDashboard, deleteDashboard, mutate: mutateDashboards } = useDashboards(workspaceId);

    const [selectedDashboardId, setSelectedDashboardId] = useState<number | null>(null);
    const [isEditing, setIsEditing] = useState(false);

    // 인라인 생성
    const [showCreate, setShowCreate] = useState(false);
    const [newName, setNewName] = useState("");
    const [aiPrompt, setAiPrompt] = useState("");
    const [creating, setCreating] = useState(false);

    // 위젯 설정
    const [widgetConfigOpen, setWidgetConfigOpen] = useState(false);
    const [editingWidget, setEditingWidget] = useState<DashboardWidget | null>(null);

    // 대시보드 상세 + 위젯 데이터
    const selectedDashboard = dashboards.find((d) => d.id === selectedDashboardId);
    const [widgets, setWidgets] = useState<DashboardWidget[]>([]);
    const { widgetData, isLoading: dataLoading, mutate: mutateData } = useDashboardData(
        selectedDashboardId,
        isEditing ? undefined : selectedDashboard?.refreshInterval
    );

    // 첫 번째 워크스페이스 자동 선택
    useEffect(() => {
        if (!workspaceId && workspaces.length > 0) {
            setWorkspaceId(workspaces[0].id);
        }
    }, [workspaces, workspaceId]);

    // 대시보드 목록 로드 시 첫 번째 선택
    useEffect(() => {
        if (dashboards.length > 0 && !selectedDashboardId) {
            setSelectedDashboardId(dashboards[0].id);
        }
    }, [dashboards, selectedDashboardId]);

    // 대시보드 선택 시 위젯 목록 로드
    useEffect(() => {
        if (!selectedDashboardId) {
            setWidgets([]);
            return;
        }
        fetch(`/api/dashboards/${selectedDashboardId}`)
            .then((r) => r.json())
            .then((json) => {
                if (json.success) {
                    setWidgets(json.data.widgets ?? []);
                }
            });
    }, [selectedDashboardId]);

    const hasAi = !!aiPrompt.trim();

    // 파티션 범위 관련
    const scopeIds = selectedDashboard?.partitionIds as number[] | null;
    const scopeLabel = !scopeIds || scopeIds.length === 0
        ? "전체"
        : `${scopeIds.length}개 파티션`;

    const handleScopeChange = useCallback(
        async (partitionId: number, checked: boolean) => {
            if (!selectedDashboard) return;
            const current = (selectedDashboard.partitionIds as number[] | null) || [];
            let next: number[];
            if (checked) {
                next = [...current, partitionId];
            } else {
                next = current.filter((id) => id !== partitionId);
            }
            // 빈 배열 → null (전체)
            await updateDashboard(selectedDashboard.id, {
                partitionIds: next.length > 0 ? next : null,
            });
            mutateData();
        },
        [selectedDashboard, updateDashboard, mutateData]
    );

    const handleScopeAll = useCallback(async () => {
        if (!selectedDashboard) return;
        await updateDashboard(selectedDashboard.id, { partitionIds: null });
        mutateData();
    }, [selectedDashboard, updateDashboard, mutateData]);

    const handleScopeFolder = useCallback(
        async (folderPartitionIds: number[], checked: boolean) => {
            if (!selectedDashboard) return;
            const current = (selectedDashboard.partitionIds as number[] | null) || [];
            let next: number[];
            if (checked) {
                next = [...new Set([...current, ...folderPartitionIds])];
            } else {
                const removeSet = new Set(folderPartitionIds);
                next = current.filter((id) => !removeSet.has(id));
            }
            await updateDashboard(selectedDashboard.id, {
                partitionIds: next.length > 0 ? next : null,
            });
            mutateData();
        },
        [selectedDashboard, updateDashboard, mutateData]
    );

    const handleCreate = useCallback(async () => {
        if (!workspaceId) return;
        if (!hasAi && !newName) return;
        setCreating(true);

        // 1. 대시보드 생성
        const result = await createDashboard({
            name: newName || aiPrompt.trim().slice(0, 30),
            workspaceId,
        });
        if (!result.success) {
            toast.error(result.error || "생성에 실패했습니다.");
            setCreating(false);
            return;
        }

        const dashboardId = result.data.id;

        // 2. AI 프롬프트가 있으면 위젯 자동 생성
        if (hasAi) {
            try {
                const aiRes = await fetch("/api/ai/generate-dashboard", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        prompt: aiPrompt.trim(),
                        workspaceFields: fields.map((f) => ({
                            key: f.key,
                            label: f.label,
                            fieldType: f.fieldType,
                        })),
                    }),
                });
                const aiJson = await aiRes.json();
                if (aiJson.success) {
                    const data = aiJson.data;
                    // AI가 생성한 이름으로 대시보드 이름 업데이트
                    if (data.name) {
                        await updateDashboard(dashboardId, { name: data.name });
                    }
                    // 위젯 일괄 추가
                    for (const w of data.widgets) {
                        await fetch(`/api/dashboards/${dashboardId}/widgets`, {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify(w),
                        });
                    }
                    // 위젯 목록 다시 로드
                    const widgetRes = await fetch(`/api/dashboards/${dashboardId}`);
                    const widgetJson = await widgetRes.json();
                    if (widgetJson.success) {
                        setWidgets(widgetJson.data.widgets ?? []);
                    }
                    toast.success(`${data.widgets.length}개 위젯이 AI로 생성되었습니다.`);
                } else {
                    toast.error(aiJson.error || "AI 생성에 실패했습니다.");
                }
            } catch {
                toast.error("AI 생성 중 오류가 발생했습니다.");
            }
        } else {
            toast.success("대시보드가 생성되었습니다.");
        }

        // 3. 정리 + 새 대시보드 선택
        setShowCreate(false);
        setNewName("");
        setAiPrompt("");
        setCreating(false);
        setSelectedDashboardId(dashboardId);
        mutateDashboards();
    }, [newName, aiPrompt, hasAi, workspaceId, fields, createDashboard, updateDashboard, mutateDashboards]);

    const handleDelete = useCallback(async () => {
        if (!selectedDashboardId || !confirm("정말 삭제하시겠습니까?")) return;
        const result = await deleteDashboard(selectedDashboardId);
        if (result.success) {
            toast.success("대시보드가 삭제되었습니다.");
            setSelectedDashboardId(null);
            setIsEditing(false);
        }
    }, [selectedDashboardId, deleteDashboard]);

    const handleTogglePublic = useCallback(async () => {
        if (!selectedDashboard) return;
        const result = await updateDashboard(selectedDashboard.id, {
            isPublic: selectedDashboard.isPublic ? 0 : 1,
        });
        if (result.success) {
            toast.success(selectedDashboard.isPublic ? "비공개로 전환되었습니다." : "공개로 전환되었습니다.");
            mutateDashboards();
        }
    }, [selectedDashboard, updateDashboard, mutateDashboards]);

    const handleCopyLink = useCallback(() => {
        if (!selectedDashboard) return;
        navigator.clipboard.writeText(
            `${window.location.origin}/dashboard/${selectedDashboard.slug}`
        );
        toast.success("링크가 복사되었습니다.");
    }, [selectedDashboard]);

    const handleLayoutChange = useCallback(
        async (layouts: Array<{ id: number; x: number; y: number; w: number; h: number }>) => {
            if (!selectedDashboardId) return;
            // 로컬 상태 즉시 반영 (스냅백 방지)
            setWidgets((prev) =>
                prev.map((w) => {
                    const l = layouts.find((lay) => lay.id === w.id);
                    return l ? { ...w, layoutX: l.x, layoutY: l.y, layoutW: l.w, layoutH: l.h } : w;
                })
            );
            // 서버에 저장
            await fetch(`/api/dashboards/${selectedDashboardId}/widgets`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    widgets: layouts.map((l) => ({
                        id: l.id,
                        layoutX: l.x,
                        layoutY: l.y,
                        layoutW: l.w,
                        layoutH: l.h,
                    })),
                }),
            });
        },
        [selectedDashboardId]
    );

    const handleAddWidget = useCallback(
        async (config: {
            title: string;
            widgetType: string;
            dataColumn: string;
            aggregation: string;
            groupByColumn: string;
            stackByColumn: string;
        }) => {
            if (!selectedDashboardId) return;
            const res = await fetch(
                `/api/dashboards/${selectedDashboardId}/widgets`,
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(config),
                }
            );
            const result = await res.json();
            if (result.success) {
                setWidgets((prev) => [...prev, result.data]);
                mutateData();
                toast.success("위젯이 추가되었습니다.");
            }
        },
        [selectedDashboardId, mutateData]
    );

    const handleUpdateWidget = useCallback(
        async (config: {
            title: string;
            widgetType: string;
            dataColumn: string;
            aggregation: string;
            groupByColumn: string;
            stackByColumn: string;
        }) => {
            if (!selectedDashboardId || !editingWidget) return;
            await fetch(`/api/dashboards/${selectedDashboardId}/widgets`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    widgets: [{ id: editingWidget.id, ...config }],
                }),
            });
            setWidgets((prev) =>
                prev.map((w) =>
                    w.id === editingWidget.id ? { ...w, ...config } : w
                )
            );
            mutateData();
            setEditingWidget(null);
            toast.success("위젯이 수정되었습니다.");
        },
        [selectedDashboardId, editingWidget, mutateData]
    );

    const handleDeleteWidget = useCallback(
        async (widgetId: number) => {
            if (!confirm("위젯을 삭제하시겠습니까?")) return;
            setWidgets((prev) => prev.filter((w) => w.id !== widgetId));
            await fetch(`/api/dashboards/${selectedDashboardId}/widgets`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ widgets: [] }),
            });
            toast.success("위젯이 삭제되었습니다.");
        },
        [selectedDashboardId]
    );

    return (
        <WorkspaceLayout>
            <div className="p-6 space-y-4">
                {/* Header */}
                <div className="flex items-center justify-between">
                    <h1 className="text-2xl font-bold">대시보드</h1>
                    <div className="flex items-center gap-3">
                        {workspaces.length > 1 && (
                            <Select
                                value={workspaceId ? String(workspaceId) : ""}
                                onValueChange={(v) => {
                                    setWorkspaceId(Number(v));
                                    setSelectedDashboardId(null);
                                }}
                            >
                                <SelectTrigger className="w-[180px]">
                                    <SelectValue placeholder="워크스페이스" />
                                </SelectTrigger>
                                <SelectContent>
                                    {workspaces.map((ws) => (
                                        <SelectItem key={ws.id} value={String(ws.id)}>
                                            {ws.name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        )}
                        <Button onClick={() => setShowCreate(!showCreate)}>
                            <Plus className="h-4 w-4 mr-1" /> 새 대시보드
                        </Button>
                    </div>
                </div>

                {/* 인라인 생성 영역 */}
                {showCreate && (
                    <div className="border rounded-lg p-4 space-y-3">
                        <div className="space-y-2">
                            <Label>대시보드 이름</Label>
                            <Input
                                value={newName}
                                onChange={(e) => setNewName(e.target.value)}
                                placeholder="대시보드 이름"
                            />
                        </div>
                        <div className="space-y-2">
                            <Label className="flex items-center gap-1">
                                <Sparkles className="h-4 w-4" /> AI 위젯 자동 생성
                                <span className="text-muted-foreground font-normal">(선택)</span>
                            </Label>
                            <Textarea
                                value={aiPrompt}
                                onChange={(e) => setAiPrompt(e.target.value)}
                                placeholder="예: 영업 현황 대시보드, 월별 매출 분석"
                                rows={2}
                            />
                            <p className="text-xs text-muted-foreground">
                                입력하면 대시보드 이름과 위젯을 AI가 자동으로 구성합니다.
                            </p>
                        </div>
                        <div className="flex gap-2">
                            <Button
                                onClick={handleCreate}
                                disabled={creating || (!newName && !hasAi)}
                            >
                                {creating ? (hasAi ? "AI 생성 중..." : "생성 중...") : (hasAi ? "AI로 생성" : "생성")}
                            </Button>
                            <Button variant="outline" onClick={() => { setShowCreate(false); setNewName(""); setAiPrompt(""); }}>
                                취소
                            </Button>
                        </div>
                    </div>
                )}

                {/* Dashboard tabs */}
                {dashboards.length > 0 && (
                    <Tabs
                        value={selectedDashboardId ? String(selectedDashboardId) : ""}
                        onValueChange={(v) => {
                            setSelectedDashboardId(Number(v));
                            setIsEditing(false);
                        }}
                    >
                        <TabsList>
                            {dashboards.map((d) => (
                                <TabsTrigger key={d.id} value={String(d.id)}>
                                    {d.name}
                                </TabsTrigger>
                            ))}
                        </TabsList>
                    </Tabs>
                )}

                {/* Toolbar */}
                {selectedDashboard && (
                    <div className="flex items-center gap-2 border-b pb-3">
                        <Button
                            variant={isEditing ? "default" : "outline"}
                            size="sm"
                            onClick={() => setIsEditing(!isEditing)}
                        >
                            <Pencil className="h-3 w-3 mr-1" />
                            {isEditing ? "편집 완료" : "편집"}
                        </Button>
                        {isEditing && (
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => {
                                    setEditingWidget(null);
                                    setWidgetConfigOpen(true);
                                }}
                            >
                                <Plus className="h-3 w-3 mr-1" /> 위젯 추가
                            </Button>
                        )}
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={handleTogglePublic}
                        >
                            {selectedDashboard.isPublic ? (
                                <Globe className="h-3 w-3 mr-1" />
                            ) : (
                                <Lock className="h-3 w-3 mr-1" />
                            )}
                            {selectedDashboard.isPublic ? "공개" : "비공개"}
                        </Button>
                        {selectedDashboard.isPublic && (
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={handleCopyLink}
                            >
                                <Link2 className="h-3 w-3 mr-1" /> 링크 복사
                            </Button>
                        )}
                        <Popover>
                            <PopoverTrigger asChild>
                                <Button variant="ghost" size="sm">
                                    <Filter className="h-3 w-3 mr-1" />
                                    데이터 범위: {scopeLabel}
                                </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-64 max-h-80 overflow-y-auto" align="start">
                                <div className="space-y-3">
                                    <div className="flex items-center gap-2">
                                        <Checkbox
                                            id="scope-all"
                                            checked={!scopeIds || scopeIds.length === 0}
                                            onCheckedChange={() => handleScopeAll()}
                                        />
                                        <label htmlFor="scope-all" className="text-sm font-medium">전체</label>
                                    </div>
                                    {partitionTree && (
                                        <>
                                            {partitionTree.folders.map((folder) => {
                                                const folderPIds = folder.partitions.map((p) => p.id);
                                                const allChecked = scopeIds ? folderPIds.every((id) => scopeIds.includes(id)) : false;
                                                const someChecked = scopeIds ? folderPIds.some((id) => scopeIds.includes(id)) : false;
                                                return (
                                                    <div key={folder.id}>
                                                        <div className="flex items-center gap-2">
                                                            <Checkbox
                                                                id={`folder-${folder.id}`}
                                                                checked={allChecked ? true : someChecked ? "indeterminate" : false}
                                                                onCheckedChange={(checked) => handleScopeFolder(folderPIds, !!checked)}
                                                            />
                                                            <label htmlFor={`folder-${folder.id}`} className="text-sm font-medium">{folder.name}</label>
                                                        </div>
                                                        <div className="ml-6 space-y-1 mt-1">
                                                            {folder.partitions.map((p) => (
                                                                <div key={p.id} className="flex items-center gap-2">
                                                                    <Checkbox
                                                                        id={`part-${p.id}`}
                                                                        checked={scopeIds ? scopeIds.includes(p.id) : false}
                                                                        onCheckedChange={(checked) => handleScopeChange(p.id, !!checked)}
                                                                    />
                                                                    <label htmlFor={`part-${p.id}`} className="text-sm text-muted-foreground">{p.name}</label>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                            {partitionTree.ungrouped.length > 0 && (
                                                <div className="space-y-1">
                                                    {partitionTree.ungrouped.map((p) => (
                                                        <div key={p.id} className="flex items-center gap-2">
                                                            <Checkbox
                                                                id={`part-${p.id}`}
                                                                checked={scopeIds ? scopeIds.includes(p.id) : false}
                                                                onCheckedChange={(checked) => handleScopeChange(p.id, !!checked)}
                                                            />
                                                            <label htmlFor={`part-${p.id}`} className="text-sm text-muted-foreground">{p.name}</label>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </>
                                    )}
                                </div>
                            </PopoverContent>
                        </Popover>
                        <div className="ml-auto">
                            <Badge variant="outline">
                                갱신: {selectedDashboard.refreshInterval}초
                            </Badge>
                        </div>
                        <Button
                            variant="ghost"
                            size="sm"
                            className="text-destructive"
                            onClick={handleDelete}
                        >
                            <Trash2 className="h-3 w-3" />
                        </Button>
                    </div>
                )}

                {/* Grid */}
                {selectedDashboard ? (
                    <DashboardGrid
                        widgets={widgets}
                        widgetData={widgetData}
                        isDataLoading={dataLoading}
                        isEditing={isEditing}
                        onLayoutChange={handleLayoutChange}
                        onConfigureWidget={(w) => {
                            setEditingWidget(w);
                            setWidgetConfigOpen(true);
                        }}
                        onDeleteWidget={handleDeleteWidget}
                    />
                ) : (
                    <div className="text-center py-20 text-muted-foreground">
                        <p className="text-lg mb-1">대시보드를 선택하거나 새로 만드세요</p>
                    </div>
                )}
            </div>

            {/* 위젯 설정 다이얼로그 */}
            <WidgetConfigDialog
                open={widgetConfigOpen}
                onOpenChange={(open) => {
                    setWidgetConfigOpen(open);
                    if (!open) setEditingWidget(null);
                }}
                fields={fields}
                onSubmit={editingWidget ? handleUpdateWidget : handleAddWidget}
                initial={
                    editingWidget
                        ? {
                              title: editingWidget.title,
                              widgetType: editingWidget.widgetType,
                              dataColumn: editingWidget.dataColumn,
                              aggregation: editingWidget.aggregation,
                              groupByColumn: editingWidget.groupByColumn || "",
                              stackByColumn: editingWidget.stackByColumn || "",
                          }
                        : undefined
                }
            />
        </WorkspaceLayout>
    );
}
