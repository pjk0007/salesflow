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
import DashboardCreateForm from "@/components/dashboard/DashboardCreateForm";
import DashboardToolbar from "@/components/dashboard/DashboardToolbar";
import { Button } from "@/components/ui/button";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import type { DashboardWidget } from "@/lib/db";

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

    // 파티션 범위 관련
    const scopeIds = selectedDashboard?.partitionIds as number[] | null;
    const scopeLabel = !scopeIds || scopeIds.length === 0
        ? "전체"
        : `${scopeIds.length}개 파티션`;

    const handleScopeChange = useCallback(
        async (partitionId: number, checked: boolean) => {
            if (!selectedDashboard) return;
            const current = (selectedDashboard.partitionIds as number[] | null) || [];
            const next = checked
                ? [...current, partitionId]
                : current.filter((id) => id !== partitionId);
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
            const next = checked
                ? [...new Set([...current, ...folderPartitionIds])]
                : current.filter((id) => !new Set(folderPartitionIds).has(id));
            await updateDashboard(selectedDashboard.id, {
                partitionIds: next.length > 0 ? next : null,
            });
            mutateData();
        },
        [selectedDashboard, updateDashboard, mutateData]
    );

    const hasAi = !!aiPrompt.trim();

    const handleCreate = useCallback(async () => {
        if (!workspaceId) return;
        if (!hasAi && !newName) return;
        setCreating(true);

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
                    if (data.name) {
                        await updateDashboard(dashboardId, { name: data.name });
                    }
                    for (const w of data.widgets) {
                        await fetch(`/api/dashboards/${dashboardId}/widgets`, {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify(w),
                        });
                    }
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
            setWidgets((prev) =>
                prev.map((w) => {
                    const l = layouts.find((lay) => lay.id === w.id);
                    return l ? { ...w, layoutX: l.x, layoutY: l.y, layoutW: l.w, layoutH: l.h } : w;
                })
            );
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
                    <DashboardCreateForm
                        newName={newName}
                        onNewNameChange={setNewName}
                        aiPrompt={aiPrompt}
                        onAiPromptChange={setAiPrompt}
                        creating={creating}
                        onSubmit={handleCreate}
                        onCancel={() => { setShowCreate(false); setNewName(""); setAiPrompt(""); }}
                    />
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
                    <DashboardToolbar
                        isEditing={isEditing}
                        onToggleEdit={() => setIsEditing(!isEditing)}
                        onAddWidget={() => {
                            setEditingWidget(null);
                            setWidgetConfigOpen(true);
                        }}
                        isPublic={!!selectedDashboard.isPublic}
                        onTogglePublic={handleTogglePublic}
                        onCopyLink={handleCopyLink}
                        refreshInterval={selectedDashboard.refreshInterval}
                        onDelete={handleDelete}
                        scopeIds={scopeIds}
                        scopeLabel={scopeLabel}
                        partitionTree={partitionTree}
                        onScopeChange={handleScopeChange}
                        onScopeAll={handleScopeAll}
                        onScopeFolder={handleScopeFolder}
                    />
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
