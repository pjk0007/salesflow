"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import WorkspaceLayout from "@/components/layouts/WorkspaceLayout";
import PartitionNav from "@/components/records/PartitionNav";
import RecordToolbar from "@/components/records/RecordToolbar";
import RecordTable from "@/components/records/RecordTable";
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
import { useRecords } from "@/hooks/useRecords";
import { useSSE } from "@/hooks/useSSE";
import { toast } from "sonner";
import type { DbRecord } from "@/lib/db";
import type { FilterCondition } from "@/types";

export default function RecordsPage() {
    const [workspaceId, setWorkspaceId] = useState<number | null>(null);
    const [partitionId, setPartitionId] = useState<number | null>(null);
    const [page, setPage] = useState(1);
    const [search, setSearch] = useState("");
    const [distributionOrder, setDistributionOrder] = useState<number | undefined>();
    const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
    const [filters, setFilters] = useState<FilterCondition[]>([]);
    const [sortField, setSortField] = useState("registeredAt");
    const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
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
        renamePartition,
        deletePartition,
        createFolder,
        renameFolder,
        deleteFolder,
        mutate: mutatePartitions,
    } = usePartitions(workspaceId);
    const { fields } = useFields(workspaceId);
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

    // SSE 실시간 동기화
    useSSE({
        partitionId,
        onAnyChange: () => mutateRecords(),
    });

    // 첫 번째 워크스페이스 자동 선택
    useEffect(() => {
        if (!workspaceId && workspaces.length > 0) {
            setWorkspaceId(workspaces[0].id);
        }
    }, [workspaces, workspaceId]);

    // 워크스페이스 변경 시 파티션 초기화
    const handleWorkspaceChange = useCallback((id: number) => {
        setWorkspaceId(id);
        setPartitionId(null);
        setPage(1);
        setSearch("");
        setSelectedIds(new Set());
    }, []);

    // 파티션 변경 시 초기화
    const handlePartitionSelect = useCallback((id: number) => {
        setPartitionId(id);
        setPage(1);
        setSearch("");
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
            }
        },
        [updateRecord]
    );

    const handleBulkDelete = useCallback(async () => {
        const ids = Array.from(selectedIds);
        const result = await bulkDelete(ids);
        if (result.success) {
            toast.success(result.message);
            setSelectedIds(new Set());
            setDeleteDialogOpen(false);
        } else {
            toast.error(result.error || "삭제에 실패했습니다.");
        }
    }, [selectedIds, bulkDelete]);

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

    const handleDeleteFolder = useCallback(async (folderId: number) => {
        const result = await deleteFolder(folderId);
        if (result.success) {
            toast.success("폴더가 삭제되었습니다. 하위 파티션은 미분류로 이동됩니다.");
        } else {
            toast.error(result.error || "삭제에 실패했습니다.");
        }
    }, [deleteFolder]);

    // 현재 선택된 파티션 정보
    const currentPartition = partitionTree
        ? [
              ...partitionTree.folders.flatMap((f) => f.partitions),
              ...partitionTree.ungrouped,
          ].find((p) => p.id === partitionId)
        : null;

    // 폴더 목록 (CreatePartitionDialog용)
    const folderList = partitionTree?.folders.map((f) => ({ id: f.id, name: f.name })) ?? [];

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

    return (
        <WorkspaceLayout>
            <div className="flex h-full">
                {/* 좌측: 파티션 네비게이션 */}
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
                    onDistributionSettings={(id) => setDistributionSettingsPartitionId(id)}
                />

                {/* 우측: 레코드 영역 */}
                <div className="flex-1 flex flex-col min-w-0">
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
                            />
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
                            />
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
            {workspaceId && (
                <CreateRecordDialog
                    open={createDialogOpen}
                    onOpenChange={setCreateDialogOpen}
                    workspaceId={workspaceId}
                    onSubmit={createRecord}
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
                onImport={bulkImport}
            />
            <RecordDetailDialog
                open={detailRecord !== null}
                onOpenChange={(open) => { if (!open) setDetailRecord(null); }}
                record={detailRecord}
                fields={fields}
                partitionId={partitionId!}
                onRecordUpdated={() => mutateRecords()}
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
