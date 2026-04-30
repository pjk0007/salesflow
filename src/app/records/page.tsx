"use client";

import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import WorkspaceLayout from "@/components/layouts/WorkspaceLayout";
import PartitionNav from "@/components/records/PartitionNav";
import { useMobileSheet, useMobileSubtitle, useBreadcrumbOverrides } from "@/components/dashboard/breadcrumb-context";
import type { ReactNode } from "react";

/** breadcrumb 컨텍스트 안에서만 동작 (WorkspaceLayout 자식). */
function MobileBreadcrumbBridge({
    partitionNav,
    subtitle,
    closeOnChange,
}: {
    partitionNav: ReactNode;
    subtitle: string | null;
    closeOnChange: number | null;
}) {
    const { setMobileSheetOpen } = useBreadcrumbOverrides();
    useMobileSheet(partitionNav);
    useMobileSubtitle(subtitle);
    // 파티션이 바뀌면 시트 자동 닫기
    useEffect(() => {
        if (closeOnChange != null) setMobileSheetOpen(false);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [closeOnChange]);
    return null;
}
import RecordToolbar from "@/components/records/RecordToolbar";
import RecordTable from "@/components/records/RecordTable";
import GroupedRecordView from "@/components/records/GroupedRecordView";
import { SYSTEM_COLUMNS } from "@/components/records/system-columns";
import CreateRecordDialog from "@/components/records/CreateRecordDialog";
import DeleteConfirmDialog from "@/components/records/DeleteConfirmDialog";
import SendAlimtalkDialog from "@/components/alimtalk/SendAlimtalkDialog";
import SendEmailDialog from "@/components/records/SendEmailDialog";
import ImportDialog from "@/components/records/ImportDialog";
import RecordDetailDialog from "@/components/records/RecordDetailDialog";
import CreatePartitionDialog from "@/components/records/CreatePartitionDialog";
import CreateFolderDialog from "@/components/records/CreateFolderDialog";
import RenameDialog from "@/components/records/RenameDialog";
import DeletePartitionDialog from "@/components/records/DeletePartitionDialog";
import DistributionSettingsDialog from "@/components/partitions/DistributionSettingsDialog";
import { useWorkspaces } from "@/hooks/useWorkspaces";
import { usePartitions } from "@/hooks/usePartitions";
import { useFields } from "@/hooks/useFields";
import { useResolvedFields } from "@/hooks/useResolvedFields";
import { useRecords } from "@/hooks/useRecords";
import { useSSE } from "@/hooks/useSSE";
import { mutate as globalMutate } from "swr";
import { toast } from "sonner";
import type { DbRecord } from "@/lib/db";
import type { FilterCondition } from "@/types";

export default function RecordsPage() {
    const [workspaceId, setWorkspaceId] = useState<number | null>(() => {
        if (typeof window === "undefined") return null;
        const saved = localStorage.getItem("records_last_workspace");
        return saved ? Number(saved) : null;
    });
    const [partitionId, setPartitionId] = useState<number | null>(() => {
        if (typeof window === "undefined") return null;
        const saved = localStorage.getItem("records_last_partition");
        return saved ? Number(saved) : null;
    });
    const [page, setPage] = useState(1);
    const [search, setSearch] = useState("");
    const [distributionOrder, setDistributionOrder] = useState<number | undefined>();
    const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
    const [filters, setFilters] = useState<FilterCondition[]>([]);
    const [sortField, setSortField] = useState("registeredAt");
    const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
    const [viewMode, setViewMode] = useState<"flat" | "grouped">(() => {
        if (typeof window === "undefined") return "flat";
        const saved = localStorage.getItem("records_view_mode") as "flat" | "grouped" | null;
        return saved || "flat";
    });
    const [createDialogOpen, setCreateDialogOpen] = useState(false);
    const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
    const [alimtalkDialogOpen, setAlimtalkDialogOpen] = useState(false);
    const [emailDialogOpen, setEmailDialogOpen] = useState(false);
    const [importDialogOpen, setImportDialogOpen] = useState(false);
    const [detailRecord, setDetailRecord] = useState<DbRecord | null>(null);

    // 파티션/폴더 관리 다이얼로그 상태
    const [createPartitionOpen, setCreatePartitionOpen] = useState(false);
    const [createFolderOpen, setCreateFolderOpen] = useState(false);
    const [renameTarget, setRenameTarget] = useState<{
        type: "partition" | "folder";
        id: number;
        name: string;
    } | null>(null);
    const [deletePartitionTarget, setDeletePartitionTarget] = useState<{
        id: number;
        name: string;
    } | null>(null);
    const [distributionSettingsPartitionId, setDistributionSettingsPartitionId] = useState<number | null>(null);

    const sessionIdRef = useRef(
        typeof crypto !== "undefined" ? crypto.randomUUID() : Math.random().toString(36).slice(2)
    );

    const { workspaces } = useWorkspaces();
    const {
        partitionTree,
        isLoading: ptLoading,
        createPartition,
        movePartition,
        renamePartition,
        deletePartition,
        createFolder,
        renameFolder,
        deleteFolder,
        mutate: mutatePartitions,
    } = usePartitions(workspaceId);
    const { fields: workspaceFields } = useFields(workspaceId);
    const { fields: resolvedFields } = useResolvedFields(partitionId);
    const fields = resolvedFields.length > 0 ? resolvedFields : workspaceFields;
    const {
        records,
        total,
        page: currentPage,
        pageSize,
        totalPages,
        isLoading: recordsLoading,
        createRecord,
        updateRecord,
        bulkDelete,
        exportCsv,
        bulkImport,
        mutate: mutateRecords,
    } = useRecords({
        partitionId,
        page,
        search: search || undefined,
        distributionOrder,
        filters: filters.length > 0 ? filters : undefined,
        sortField,
        sortOrder,
        sessionId: sessionIdRef.current,
    });

    // SSE 실시간 동기화 — viewMode에 따라 mutate 대상 분기
    const handleSSEChange = useCallback(() => {
        if (viewMode === "grouped" && partitionId) {
            // 그룹뷰: 모든 그룹 records + group-counts SWR 키 일괄 invalidate
            globalMutate(
                (key) =>
                    typeof key === "string" &&
                    (key.startsWith(`/api/partitions/${partitionId}/records?`) ||
                        key.startsWith(`/api/partitions/${partitionId}/records/group-counts?`)),
            );
        } else {
            mutateRecords();
        }
    }, [viewMode, partitionId, mutateRecords]);

    useSSE({
        partitionId,
        onAnyChange: handleSSEChange,
    });

    // 워크스페이스 자동 선택 (저장된 값 검증 또는 첫 번째)
    useEffect(() => {
        if (workspaces.length === 0) return;
        if (workspaceId && workspaces.some((w) => w.id === workspaceId)) return;
        // 저장된 워크스페이스가 없거나 유효하지 않으면 첫 번째 선택
        setWorkspaceId(workspaces[0].id);
        setPartitionId(null);
    }, [workspaces, workspaceId]);

    // 워크스페이스 변경 시 파티션 초기화
    const handleWorkspaceChange = useCallback((id: number) => {
        setWorkspaceId(id);
        setPartitionId(null);
        setPage(1);
        setSearch("");
        setSelectedIds(new Set());
        localStorage.setItem("records_last_workspace", String(id));
        localStorage.removeItem("records_last_partition");
    }, []);

    // 파티션 미선택 시 첫 번째 파티션 자동 선택
    useEffect(() => {
        if (partitionId || !partitionTree) return;
        const allPartitions = [
            ...partitionTree.ungrouped,
            ...partitionTree.folders.flatMap((f) => f.partitions),
        ];
        if (allPartitions.length > 0) {
            handlePartitionSelect(allPartitions[0].id);
        }
    }, [partitionId, partitionTree]);

    // 파티션 변경 시 초기화
    const handlePartitionSelect = useCallback((id: number) => {
        setPartitionId(id);
        setPage(1);
        setSearch("");
        localStorage.setItem("records_last_partition", String(id));
        setSelectedIds(new Set());
        setFilters([]);
        setSortField("registeredAt");
        setSortOrder("desc");
    }, []);

    const handleSearch = useCallback((keyword: string) => {
        setSearch(keyword);
        setPage(1);
    }, []);

    const handleRecordClick = useCallback((record: DbRecord) => {
        setDetailRecord(record);
    }, []);

    const handleDistributionOrderChange = useCallback((order: number | undefined) => {
        setDistributionOrder(order);
        setPage(1);
    }, []);

    const handleFiltersChange = useCallback((newFilters: FilterCondition[]) => {
        setFilters(newFilters);
        setPage(1);
    }, []);

    const handleSortChange = useCallback((field: string, order: "asc" | "desc") => {
        setSortField(field);
        setSortOrder(order);
        setPage(1);
    }, []);

    const handleUpdateRecord = useCallback(
        async (id: number, data: Record<string, unknown>) => {
            const result = await updateRecord(id, data);
            if (!result.success) {
                toast.error(result.error || "수정에 실패했습니다.");
                return result;
            }
            // 그룹뷰는 그룹별 SWR 키가 분리되어 있어 추가 invalidate 필요
            if (viewMode === "grouped") handleSSEChange();
            return result;
        },
        [updateRecord, viewMode, handleSSEChange]
    );

    const handleCreateRecord = useCallback(
        async (recordData: Record<string, unknown>) => {
            const result = await createRecord(recordData);
            if (result?.success && viewMode === "grouped") handleSSEChange();
            return result;
        },
        [createRecord, viewMode, handleSSEChange],
    );

    const handleBulkImport = useCallback(
        async (
            importRecords: Array<Record<string, unknown>>,
            duplicateAction: "skip" | "error" = "skip",
        ) => {
            const result = await bulkImport(importRecords, duplicateAction);
            if (result?.success && viewMode === "grouped") handleSSEChange();
            return result;
        },
        [bulkImport, viewMode, handleSSEChange],
    );

    const handleRecordUpdated = useCallback(() => {
        if (viewMode === "grouped") {
            handleSSEChange();
        } else {
            mutateRecords();
        }
    }, [viewMode, handleSSEChange, mutateRecords]);

    const handleBulkDelete = useCallback(async () => {
        const ids = Array.from(selectedIds);
        const result = await bulkDelete(ids);
        if (result.success) {
            toast.success(result.message);
            setSelectedIds(new Set());
            setDeleteDialogOpen(false);
            if (viewMode === "grouped") handleSSEChange();
        } else {
            toast.error(result.error || "삭제에 실패했습니다.");
        }
    }, [selectedIds, bulkDelete, viewMode, handleSSEChange]);

    // 파티션/폴더 관리 핸들러
    const handleRenameSubmit = useCallback(async (name: string) => {
        if (!renameTarget) return { success: false };
        if (renameTarget.type === "partition") {
            return renamePartition(renameTarget.id, name);
        } else {
            return renameFolder(renameTarget.id, name);
        }
    }, [renameTarget, renamePartition, renameFolder]);

    const handleDeletePartition = useCallback(async () => {
        if (!deletePartitionTarget) return;
        const result = await deletePartition(deletePartitionTarget.id);
        if (result.success) {
            toast.success("파티션이 삭제되었습니다.");
            if (partitionId === deletePartitionTarget.id) {
                setPartitionId(null);
            }
            setDeletePartitionTarget(null);
        } else {
            toast.error(result.error || "삭제에 실패했습니다.");
        }
    }, [deletePartitionTarget, deletePartition, partitionId]);

    const handleMovePartition = useCallback(async (partitionId: number, folderId: number | null) => {
        const result = await movePartition(partitionId, folderId);
        if (result.success) {
            toast.success("파티션이 이동되었습니다.");
        } else {
            toast.error(result.error || "이동에 실패했습니다.");
        }
    }, [movePartition]);

    const handleDeleteFolder = useCallback(async (folderId: number) => {
        const result = await deleteFolder(folderId);
        if (result.success) {
            toast.success("폴더가 삭제되었습니다. 하위 파티션은 미분류로 이동됩니다.");
        } else {
            toast.error(result.error || "삭제에 실패했습니다.");
        }
    }, [deleteFolder]);

    // 그룹 기준 필드 탐색 (isGroupable이 켜진 select 필드)
    const statusField = useMemo(() =>
        fields.find(f => f.isGroupable && f.fieldType === "select" && f.options && f.options.length > 0),
        [fields]
    );

    // isGroupable 필드가 있으면 그룹 뷰 기본
    useEffect(() => {
        if (!localStorage.getItem("records_view_mode") && statusField) {
            setViewMode("grouped");
        }
    }, [statusField]);

    const handleViewModeChange = useCallback((mode: "flat" | "grouped") => {
        setViewMode(mode);
        localStorage.setItem("records_view_mode", mode);
    }, []);

    // 현재 선택된 파티션 정보
    const currentPartition = partitionTree
        ? [
              ...partitionTree.folders.flatMap((f) => f.partitions),
              ...partitionTree.ungrouped,
          ].find((p) => p.id === partitionId)
        : null;


    // 컬럼 표시/숨기기 토글
    const handleToggleColumn = useCallback(async (fieldKey: string, visible: boolean) => {
        if (!partitionId || !currentPartition) return;
        // null(전체 표시) 상태에서 처음 토글하면 모든 필드 + 시스템 컬럼을 명시적으로 풀어둔다
        const currentFields =
            (currentPartition.visibleFields as string[]) ||
            [...SYSTEM_COLUMNS.map((c) => c.key), ...fields.map((f) => f.key)];
        const newFields = visible
            ? [...currentFields, fieldKey]
            : currentFields.filter(k => k !== fieldKey);
        const res = await fetch(`/api/partitions/${partitionId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json", "x-session-id": sessionIdRef.current },
            body: JSON.stringify({ visibleFields: newFields }),
        });
        const json = await res.json();
        if (json.success) mutatePartitions();
    }, [partitionId, currentPartition, fields, mutatePartitions]);

    // 폴더 목록 (CreatePartitionDialog용)
    const folderList = partitionTree?.folders.map((f) => ({ id: f.id, name: f.name })) ?? [];

    // 중복 레코드 하이라이트 계산
    const duplicateHighlight = useMemo(() => {
        const dc = currentPartition?.duplicateConfig as { field: string; highlightEnabled: boolean; highlightColor: string } | null | undefined;
        if (!dc?.highlightEnabled || !dc.field || !records.length) return null;
        const valueMap = new Map<string, number[]>();
        for (const record of records) {
            const val = String((record.data as Record<string, unknown>)?.[dc.field] ?? "");
            if (!val) continue;
            const ids = valueMap.get(val) || [];
            ids.push(record.id);
            valueMap.set(val, ids);
        }
        const dupIds = new Set<number>();
        for (const ids of valueMap.values()) {
            if (ids.length > 1) ids.forEach((id) => dupIds.add(id));
        }
        return dupIds.size > 0 ? { color: dc.highlightColor || "#FEF3C7", ids: dupIds } : null;
    }, [records, currentPartition?.duplicateConfig]);

    const handleExport = useCallback(async () => {
        try {
            const blob = await exportCsv({
                search: search || undefined,
                filters: filters.length > 0 ? filters : undefined,
                sortField,
                sortOrder,
            });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `${currentPartition?.name || "records"}_${new Date().toISOString().split("T")[0].replace(/-/g, "")}.csv`;
            a.click();
            URL.revokeObjectURL(url);
            toast.success("CSV 내보내기가 완료되었습니다.");
        } catch {
            toast.error("CSV 내보내기에 실패했습니다.");
        }
    }, [exportCsv, search, filters, sortField, sortOrder, currentPartition]);

    const mobilePartitionNav = useMemo(
        () => (
            <PartitionNav
                workspaceId={workspaceId}
                selectedPartitionId={partitionId}
                partitionTree={partitionTree}
                isLoading={ptLoading}
                onWorkspaceChange={handleWorkspaceChange}
                onPartitionSelect={handlePartitionSelect}
                onCreatePartition={() => setCreatePartitionOpen(true)}
                onCreateFolder={() => setCreateFolderOpen(true)}
                onRenamePartition={(id, name) => setRenameTarget({ type: "partition", id, name })}
                onRenameFolder={(id, name) => setRenameTarget({ type: "folder", id, name })}
                onDeletePartition={(id, name) => setDeletePartitionTarget({ id, name })}
                onDeleteFolder={handleDeleteFolder}
                onMovePartition={handleMovePartition}
                onDistributionSettings={(id) => setDistributionSettingsPartitionId(id)}
                onMutatePartitions={mutatePartitions}
                className="w-full border-r-0 bg-transparent"
            />
        ),
        [
            workspaceId,
            partitionId,
            partitionTree,
            ptLoading,
            handleWorkspaceChange,
            handlePartitionSelect,
            handleDeleteFolder,
            handleMovePartition,
            mutatePartitions,
        ],
    );

    return (
        <WorkspaceLayout>
            <MobileBreadcrumbBridge
                partitionNav={mobilePartitionNav}
                subtitle={currentPartition?.name ?? null}
                closeOnChange={partitionId}
            />
            <div className="flex h-[calc(100vh-3.5rem)] overflow-hidden">
                {/* 좌측: 파티션 네비게이션 (데스크톱 전용) */}
                <div className="hidden md:flex">
                    <PartitionNav
                        workspaceId={workspaceId}
                        selectedPartitionId={partitionId}
                        partitionTree={partitionTree}
                        isLoading={ptLoading}
                        onWorkspaceChange={handleWorkspaceChange}
                        onPartitionSelect={handlePartitionSelect}
                        onCreatePartition={() => setCreatePartitionOpen(true)}
                        onCreateFolder={() => setCreateFolderOpen(true)}
                        onRenamePartition={(id, name) => setRenameTarget({ type: "partition", id, name })}
                        onRenameFolder={(id, name) => setRenameTarget({ type: "folder", id, name })}
                        onDeletePartition={(id, name) => setDeletePartitionTarget({ id, name })}
                        onDeleteFolder={handleDeleteFolder}
                        onMovePartition={handleMovePartition}
                        onDistributionSettings={(id) => setDistributionSettingsPartitionId(id)}
                        onMutatePartitions={mutatePartitions}
                    />
                </div>

                {/* 우측: 레코드 영역 */}
                <div className="flex-1 flex flex-col min-w-0 min-h-0">
                    {partitionId ? (
                        <>
                            <RecordToolbar
                                onSearch={handleSearch}
                                onDistributionOrderChange={handleDistributionOrderChange}
                                onCreateClick={() => setCreateDialogOpen(true)}
                                onBulkDelete={() => setDeleteDialogOpen(true)}
                                onExportClick={handleExport}
                                onImportClick={() => setImportDialogOpen(true)}
                                onAlimtalkSend={() => setAlimtalkDialogOpen(true)}
                                onEmailSend={() => setEmailDialogOpen(true)}
                                selectedCount={selectedIds.size}
                                totalRecords={total}
                                maxDistributionOrder={
                                    currentPartition?.useDistributionOrder
                                        ? currentPartition.maxDistributionOrder
                                        : undefined
                                }
                                fields={fields}
                                filters={filters}
                                onFiltersChange={handleFiltersChange}
                                viewMode={viewMode}
                                onViewModeChange={handleViewModeChange}
                                hasStatusField={!!statusField}
                                visibleFieldKeys={currentPartition?.visibleFields ?? null}
                                allFields={fields}
                                onToggleColumn={handleToggleColumn}
                            />
                            {viewMode === "grouped" && statusField && partitionId ? (
                                <GroupedRecordView
                                    partitionId={partitionId}
                                    groupByField={statusField}
                                    fields={fields}
                                    visibleFieldKeys={(currentPartition?.visibleFields as string[] | null) ?? null}
                                    selectedIds={selectedIds}
                                    onSelectionChange={setSelectedIds}
                                    onUpdateRecord={handleUpdateRecord}
                                    onRecordClick={handleRecordClick}
                                    search={search || undefined}
                                    filters={filters.length > 0 ? filters : undefined}
                                    distributionOrder={distributionOrder}
                                    sortField={sortField}
                                    sortOrder={sortOrder}
                                    onSortChange={handleSortChange}
                                    onCreateWithStatus={() => {
                                        // TODO: CreateRecordDialog에 기본 상태값 전달
                                        setCreateDialogOpen(true);
                                    }}
                                />
                            ) : (
                                <RecordTable
                                    records={records}
                                    fields={fields}
                                    visibleFieldKeys={currentPartition?.visibleFields ?? null}
                                    isLoading={recordsLoading}
                                    selectedIds={selectedIds}
                                    onSelectionChange={setSelectedIds}
                                    onUpdateRecord={handleUpdateRecord}
                                    onRecordClick={handleRecordClick}
                                    sortField={sortField}
                                    sortOrder={sortOrder}
                                    onSortChange={handleSortChange}
                                    page={currentPage}
                                    totalPages={totalPages}
                                    total={total}
                                    pageSize={pageSize}
                                    onPageChange={setPage}
                                    duplicateHighlight={duplicateHighlight}
                                    onMemoChange={() => mutateRecords()}
                                />
                            )}
                        </>
                    ) : (
                        <div className="flex-1 flex items-center justify-center p-12">
                            <div className="text-center text-muted-foreground">
                                <p className="text-lg mb-1">파티션을 선택해주세요</p>
                                <p className="text-sm">
                                    왼쪽 메뉴에서 파티션을 선택하면 레코드가 표시됩니다.
                                </p>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* 레코드 다이얼로그 */}
            {partitionId && (
                <CreateRecordDialog
                    open={createDialogOpen}
                    onOpenChange={setCreateDialogOpen}
                    partitionId={partitionId}
                    onSubmit={handleCreateRecord}
                />
            )}
            <DeleteConfirmDialog
                open={deleteDialogOpen}
                onOpenChange={setDeleteDialogOpen}
                count={selectedIds.size}
                onConfirm={handleBulkDelete}
            />
            {partitionId && (
                <SendAlimtalkDialog
                    open={alimtalkDialogOpen}
                    onOpenChange={setAlimtalkDialogOpen}
                    partitionId={partitionId}
                    recordIds={Array.from(selectedIds)}
                />
            )}
            {partitionId && (
                <SendEmailDialog
                    open={emailDialogOpen}
                    onOpenChange={setEmailDialogOpen}
                    partitionId={partitionId}
                    recordIds={Array.from(selectedIds)}
                />
            )}
            <ImportDialog
                open={importDialogOpen}
                onOpenChange={setImportDialogOpen}
                fields={fields}
                duplicateCheckField={currentPartition?.duplicateCheckField ?? undefined}
                onImport={handleBulkImport}
            />
            <RecordDetailDialog
                open={detailRecord !== null}
                onOpenChange={(open) => { if (!open) setDetailRecord(null); }}
                record={detailRecord}
                fields={fields}
                partitionId={partitionId!}
                onRecordUpdated={handleRecordUpdated}
            />

            {/* 파티션/폴더 관리 다이얼로그 */}
            <CreatePartitionDialog
                open={createPartitionOpen}
                onOpenChange={setCreatePartitionOpen}
                folders={folderList}
                onSubmit={createPartition}
            />
            <CreateFolderDialog
                open={createFolderOpen}
                onOpenChange={setCreateFolderOpen}
                onSubmit={createFolder}
            />
            <RenameDialog
                open={renameTarget !== null}
                onOpenChange={(open) => { if (!open) setRenameTarget(null); }}
                title={renameTarget?.type === "folder" ? "폴더 이름 변경" : "파티션 이름 변경"}
                currentName={renameTarget?.name ?? ""}
                onSubmit={handleRenameSubmit}
            />
            <DeletePartitionDialog
                open={deletePartitionTarget !== null}
                onOpenChange={(open) => { if (!open) setDeletePartitionTarget(null); }}
                partition={deletePartitionTarget}
                onConfirm={handleDeletePartition}
            />
            {distributionSettingsPartitionId && (() => {
                const pt = partitionTree
                    ? [...partitionTree.folders.flatMap((f) => f.partitions), ...partitionTree.ungrouped]
                        .find((p) => p.id === distributionSettingsPartitionId)
                    : null;
                if (!pt) return null;
                return (
                    <DistributionSettingsDialog
                        open={true}
                        onOpenChange={(open) => { if (!open) setDistributionSettingsPartitionId(null); }}
                        partition={pt}
                        fields={fields}
                        onSave={async (data) => {
                            const res = await fetch(`/api/partitions/${pt.id}`, {
                                method: "PATCH",
                                headers: { "Content-Type": "application/json", "x-session-id": sessionIdRef.current },
                                body: JSON.stringify(data),
                            });
                            const json = await res.json();
                            if (json.success) mutatePartitions();
                            return json;
                        }}
                    />
                );
            })()}
        </WorkspaceLayout>
    );
}
