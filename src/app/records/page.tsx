"use client";

import { recordExportFileName, RECORD_EXPORT_LIMIT } from "@/lib/record-export";
import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import WorkspaceLayout, { QueryErrorState } from "@/components/layouts/WorkspaceLayout";
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
import CreateRecordDialog from "@/components/records/CreateRecordDialog";
import DeleteConfirmDialog from "@/components/records/DeleteConfirmDialog";
import SendAlimtalkDialog from "@/components/alimtalk/SendAlimtalkDialog";
import SendEmailDialog from "@/components/records/SendEmailDialog";
import ImportDialog from "@/components/records/ImportDialog";
import ScheduledRegistrationDialog from "@/components/records/scheduled-registration/ui/ScheduledRegistrationDialog";
import ConditionDeleteDialog from "@/components/records/ConditionDeleteDialog";
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
import { useAsyncConfirm } from "@/components/ui/alert-dialog";
import { updatePartitionSettings } from "@/components/records/api/partition-settings";
import { toggleVisibleField } from "@/lib/visible-fields";
import { importDuplicatePolicy } from "@/components/records/utils/duplicate-policy";
import { apiRequest, requestErrorMessage } from "@/lib/swr-fetcher";
import { useSession } from "@/contexts/SessionContext";
import { useRecordListQuery } from "@/components/records/hooks/useRecordListQuery";
import { recordsStorageKey, resolvePartitionSelection } from "@/components/records/utils/list-query";
import PartitionHoldBanner from "@/components/email/send-health/ui/PartitionHoldBanner";

export default function RecordsPage() {
    const { user } = useSession();
    const orgId = user?.orgId ?? null;
    const [workspaceId, setWorkspaceId] = useState<number | null>(null);
    const [partitionId, setPartitionId] = useState<number | null>(null);
    // 조직별로 저장한 마지막 워크스페이스·파티션을 복원한 조직 — 복원 전에는 자동 선택하지 않는다
    const [restoredOrgId, setRestoredOrgId] = useState<string | null>(null);
    const listQuery = useRecordListQuery();
    const {
        page,
        search,
        distributionOrder,
        selectedIds,
        filters,
        sortField,
        sortOrder,
        resetCount,
        hasConditions,
        reset: resetListQuery,
        setSelectedIds,
        clearSelection,
    } = listQuery;
    const [viewMode, setViewMode] = useState<"flat" | "grouped">(() => {
        if (typeof window === "undefined") return "flat";
        const saved = localStorage.getItem("records_view_mode") as "flat" | "grouped" | null;
        return saved || "flat";
    });
    const [createDialogOpen, setCreateDialogOpen] = useState(false);
    // 그룹 뷰 '이 상태로 추가'에서 미리 채울 값(UX-080)
    const [createInitialData, setCreateInitialData] = useState<Record<string, unknown> | undefined>();
    const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
    const [alimtalkDialogOpen, setAlimtalkDialogOpen] = useState(false);
    const [emailDialogOpen, setEmailDialogOpen] = useState(false);
    const [importDialogOpen, setImportDialogOpen] = useState(false);
    const [scheduledRegOpen, setScheduledRegOpen] = useState(false);
    const [conditionDeleteOpen, setConditionDeleteOpen] = useState(false);
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

    const { workspaces, loadError: workspacesError, mutate: mutateWorkspaces } = useWorkspaces();
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
        loadError: partitionsError,
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
        loadError: recordsError,
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

    // 조직이 정해지면 그 조직에서 마지막으로 본 워크스페이스·파티션을 복원한다(UX-082)
    useEffect(() => {
        if (!orgId || restoredOrgId === orgId) return;
        const savedWorkspace = localStorage.getItem(recordsStorageKey("workspace", orgId));
        const savedPartition = localStorage.getItem(recordsStorageKey("partition", orgId));
        setWorkspaceId(savedWorkspace ? Number(savedWorkspace) : null);
        setPartitionId(savedPartition ? Number(savedPartition) : null);
        resetListQuery();
        setRestoredOrgId(orgId);
    }, [orgId, restoredOrgId, resetListQuery]);

    // 워크스페이스 자동 선택 (저장된 값 검증 또는 첫 번째)
    useEffect(() => {
        if (!restoredOrgId || workspaces.length === 0) return;
        if (workspaceId && workspaces.some((w) => w.id === workspaceId)) return;
        // 저장된 워크스페이스가 없거나 유효하지 않으면 첫 번째 선택
        setWorkspaceId(workspaces[0].id);
        setPartitionId(null);
    }, [workspaces, workspaceId, restoredOrgId]);

    // 워크스페이스 변경 시 파티션 초기화
    const handleWorkspaceChange = useCallback((id: number) => {
        setWorkspaceId(id);
        setPartitionId(null);
        resetListQuery();
        localStorage.setItem(recordsStorageKey("workspace", orgId), String(id));
        localStorage.removeItem(recordsStorageKey("partition", orgId));
    }, [resetListQuery, orgId]);

    // URL ?id= 로 진입 시 해당 레코드 자동 열기 (트래커 → 레코드 점프 등)
    const deeplinkHandledRef = useRef(false);
    // 딥링크 레코드를 불러오는 동안에는 저장된 파티션 검증·자동 선택을 미룬다
    const [deeplinkPending, setDeeplinkPending] = useState(false);
    useEffect(() => {
        if (deeplinkHandledRef.current || !restoredOrgId) return;
        const params = new URLSearchParams(window.location.search);
        const idParam = params.get("id");
        if (!idParam) {
            deeplinkHandledRef.current = true;
            return;
        }
        deeplinkHandledRef.current = true;
        setDeeplinkPending(true);

        (async () => {
            try {
                const res = await fetch(`/api/records/${idParam}`);
                const json = await res.json();
                if (!json.success) {
                    toast.error(json.error || "레코드를 찾을 수 없습니다.");
                    return;
                }
                const rec: DbRecord = json.data;
                // 해당 레코드의 워크스페이스/파티션으로 전환
                setWorkspaceId(rec.workspaceId);
                setPartitionId(rec.partitionId);
                localStorage.setItem(recordsStorageKey("workspace", orgId), String(rec.workspaceId));
                localStorage.setItem(recordsStorageKey("partition", orgId), String(rec.partitionId));
                setDetailRecord(rec);
            } catch {
                toast.error("레코드를 불러오지 못했습니다.");
            } finally {
                setDeeplinkPending(false);
            }
        })();
    }, [restoredOrgId, orgId]);

    // 파티션 변경 시 초기화
    const handlePartitionSelect = useCallback((id: number) => {
        setPartitionId(id);
        resetListQuery();
        localStorage.setItem(recordsStorageKey("partition", orgId), String(id));
    }, [resetListQuery, orgId]);

    // 선택한(복원한) 파티션이 현재 트리에 없으면(삭제됨·다른 조직) 첫 파티션으로, 미선택이면 첫 파티션 자동 선택
    useEffect(() => {
        if (!partitionTree || deeplinkPending) return;
        const next = resolvePartitionSelection(partitionTree, partitionId);
        if (next === partitionId) return;
        if (next === null) {
            setPartitionId(null);
            localStorage.removeItem(recordsStorageKey("partition", orgId));
        } else {
            handlePartitionSelect(next);
        }
    }, [partitionId, partitionTree, deeplinkPending, handlePartitionSelect, orgId]);

    const {
        setSearch: handleSearch,
        setPage: handlePageChange,
        setDistributionOrder: handleDistributionOrderChange,
        setFilters: handleFiltersChange,
        setSort: handleSortChange,
        clearConditions,
    } = listQuery;

    const handleRecordClick = useCallback((record: DbRecord) => {
        setDetailRecord(record);
    }, []);

    // 알림톡 발송 결과의 제외·실패 레코드 열기 — 현재 페이지에 없으면(선택 후 페이지 이동) 단건 조회 (UX-181)
    const handleOpenRecordById = useCallback(async (recordId: number) => {
        const loaded = records.find((record) => record.id === recordId);
        if (loaded) {
            setDetailRecord(loaded);
            return;
        }
        try {
            const json = await apiRequest<{ data: DbRecord }>(`/api/records/${recordId}`);
            setDetailRecord(json.data);
        } catch (error) {
            toast.error(requestErrorMessage(error, "레코드를 불러오지 못했습니다."));
        }
    }, [records]);

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
            onProgress?: (p: { processed: number; total: number }) => void,
        ) => {
            const result = await bulkImport(importRecords, duplicateAction, onProgress);
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
            clearSelection();
            setDeleteDialogOpen(false);
            if (viewMode === "grouped") handleSSEChange();
        } else {
            toast.error(result.error || "삭제에 실패했습니다.");
        }
    }, [selectedIds, bulkDelete, viewMode, handleSSEChange, clearSelection]);

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

    // 폴더 삭제는 확인 후 실행한다 — 하위 파티션 수·권한 영향 안내(UX-074)
    const { confirm: confirmAction, confirmationDialog } = useAsyncConfirm();
    const handleDeleteFolder = useCallback((folderId: number) => {
        const folder = partitionTree?.folders.find((f) => f.id === folderId);
        const partitionCount = folder?.partitions.length ?? 0;
        confirmAction({
            title: "폴더 삭제",
            description: [
                `'${folder?.name ?? "폴더"}' 폴더를 삭제합니다.`,
                partitionCount > 0
                    ? `하위 파티션 ${partitionCount}개는 미분류로 이동하고 레코드는 그대로 남습니다.`
                    : "하위 파티션이 없습니다.",
                "이 폴더 단위로 준 멤버 권한은 함께 사라지며 폴더는 되돌릴 수 없습니다.",
            ].join("\n"),
            onConfirm: async () => {
                const result = await deleteFolder(folderId);
                if (!result.success) throw new Error(result.error || "폴더를 삭제하지 못했습니다.");
                toast.success("폴더가 삭제되었습니다. 하위 파티션은 미분류로 이동됩니다.");
            },
        });
    }, [partitionTree, deleteFolder, confirmAction]);

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
        clearSelection();
        localStorage.setItem("records_view_mode", mode);
    }, [clearSelection]);

    // 현재 선택된 파티션 정보
    const currentPartition = partitionTree
        ? [
              ...partitionTree.folders.flatMap((f) => f.partitions),
              ...partitionTree.ungrouped,
          ].find((p) => p.id === partitionId)
        : null;


    // 컬럼 표시/숨기기 토글
    // 컬럼 표시/숨기기 — 전체 표시(null)·마지막 열 규칙은 lib/visible-fields.ts(UX-067), 실패는 안내(UX-079)
    const handleToggleColumn = useCallback(async (fieldKey: string, visible: boolean) => {
        if (!partitionId || !currentPartition) return;
        const next = toggleVisibleField(currentPartition.visibleFields, fields.map((f) => f.key), fieldKey, visible);
        if (next === undefined) {
            toast.info("열은 하나 이상 표시해야 합니다.");
            return;
        }
        try {
            await updatePartitionSettings(partitionId, { visibleFields: next }, sessionIdRef.current);
            mutatePartitions();
        } catch (error) {
            toast.error(requestErrorMessage(error, "열 표시 설정을 저장하지 못했습니다. 다시 시도해주세요."));
        }
    }, [partitionId, currentPartition, fields, mutatePartitions]);

    // 폴더 목록 (CreatePartitionDialog용)
    const folderList = partitionTree?.folders.map((f) => ({ id: f.id, name: f.name })) ?? [];

    // 중복 레코드 하이라이트 — 서버가 파티션 전체 기준으로 표시한 isDuplicate를 쓴다(UX-081)
    const duplicateHighlight = useMemo(() => {
        const dc = currentPartition?.duplicateConfig as { field: string; highlightEnabled: boolean; highlightColor: string } | null | undefined;
        if (!dc?.highlightEnabled || !dc.field || !records.length) return null;
        const dupIds = new Set(
            records.filter((r) => (r as DbRecord & { isDuplicate?: boolean }).isDuplicate).map((r) => r.id),
        );
        return dupIds.size > 0 ? { color: dc.highlightColor || "#FEF3C7", ids: dupIds } : null;
    }, [records, currentPartition?.duplicateConfig]);

    // 내보내기 — 목록과 같은 조건(검색·필터·분배순서·정렬). 총 건수가 상한을 넘으면 먼저 확인(UX-072)
    const runExport = useCallback(async () => {
        try {
            const { blob, filename } = await exportCsv({
                search: search || undefined,
                distributionOrder,
                filters: filters.length > 0 ? filters : undefined,
                sortField,
                sortOrder,
            });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = filename ?? recordExportFileName(currentPartition?.name);
            a.click();
            URL.revokeObjectURL(url);
            toast.success(
                total > RECORD_EXPORT_LIMIT
                    ? `${total.toLocaleString()}건 중 앞 ${RECORD_EXPORT_LIMIT.toLocaleString()}건을 내보냈습니다.`
                    : "CSV 내보내기가 완료되었습니다.",
            );
        } catch (error) {
            toast.error(requestErrorMessage(error, "CSV 내보내기에 실패했습니다."));
        }
    }, [exportCsv, search, distributionOrder, filters, sortField, sortOrder, currentPartition, total]);

    const handleExport = useCallback(() => {
        if (total <= RECORD_EXPORT_LIMIT) {
            void runExport();
            return;
        }
        confirmAction({
            title: "내보내기 건수 제한",
            description: `현재 조건의 ${total.toLocaleString()}건 중 앞 ${RECORD_EXPORT_LIMIT.toLocaleString()}건만 내보냅니다.\n나머지는 검색·필터·분배순서로 나눠 내보내주세요.`,
            confirmLabel: `${RECORD_EXPORT_LIMIT.toLocaleString()}건 내보내기`,
            onConfirm: runExport,
        });
    }, [total, runExport, confirmAction]);

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

    const navError = workspacesError || partitionsError;
    if (navError) {
        return <WorkspaceLayout><QueryErrorState error={navError} onRetry={() => Promise.all([mutateWorkspaces(), mutatePartitions()])} /></WorkspaceLayout>;
    }

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
                            <PartitionHoldBanner partitionId={partitionId} />
                            <RecordToolbar
                                key={`${workspaceId}:${partitionId}:${resetCount}`}
                                distributionOrder={distributionOrder}
                                onSearch={handleSearch}
                                onDistributionOrderChange={handleDistributionOrderChange}
                                onCreateClick={() => {
                                    setCreateInitialData(undefined);
                                    setCreateDialogOpen(true);
                                }}
                                onBulkDelete={() => setDeleteDialogOpen(true)}
                                onExportClick={handleExport}
                                onImportClick={() => setImportDialogOpen(true)}
                                onScheduledRegClick={() => setScheduledRegOpen(true)}
                                onConditionDeleteClick={() => setConditionDeleteOpen(true)}
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
                                isMember={user?.role === "member"}
                                onToggleColumn={handleToggleColumn}
                            />
                            {recordsError ? (
                                <QueryErrorState error={recordsError} onRetry={() => mutateRecords()} />
                            ) : viewMode === "grouped" && statusField && partitionId ? (
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
                                    onCreateWithStatus={(statusValue) => {
                                        setCreateInitialData(statusValue ? { [statusField.key]: statusValue } : undefined);
                                        setCreateDialogOpen(true);
                                    }}
                                    hasConditions={hasConditions}
                                    onClearConditions={clearConditions}
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
                                    onPageChange={handlePageChange}
                                    duplicateHighlight={duplicateHighlight}
                                    onMemoChange={() => mutateRecords()}
                                    hasConditions={hasConditions}
                                    onClearConditions={clearConditions}
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
                    key={JSON.stringify(createInitialData ?? {})}
                    initialData={createInitialData}
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
                    onEditRecord={handleOpenRecordById}
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
                duplicatePolicy={importDuplicatePolicy(currentPartition, fields)}
                onImport={handleBulkImport}
            />
            <ScheduledRegistrationDialog
                open={scheduledRegOpen}
                onOpenChange={setScheduledRegOpen}
                partitionId={partitionId}
                fields={fields}
            />
            <ConditionDeleteDialog
                open={conditionDeleteOpen}
                onOpenChange={setConditionDeleteOpen}
                partitionId={partitionId}
                fields={fields}
                onDeleted={() => { handleSSEChange(); clearSelection(); }}
            />
            <RecordDetailDialog
                open={detailRecord !== null}
                onOpenChange={(open) => { if (!open) setDetailRecord(null); }}
                record={detailRecord}
                fields={fields}
                partitionId={partitionId!}
                onRecordUpdated={handleRecordUpdated}
                workspaceId={workspaceId}
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
                        onSave={async (data) => {
                            try {
                                await updatePartitionSettings(pt.id, data, sessionIdRef.current);
                                mutatePartitions();
                                return { success: true };
                            } catch (error) {
                                return { success: false, error: requestErrorMessage(error, "설정을 저장하지 못했습니다. 다시 시도해주세요.") };
                            }
                        }}
                    />
                );
            })()}
            {confirmationDialog}
        </WorkspaceLayout>
    );
}
