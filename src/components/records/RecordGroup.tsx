"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { ChevronDown, ChevronRight, Plus, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import RecordTable from "./RecordTable";
import { useGroupRecords } from "./hooks/useGroupRecords";
import { useInfiniteScroll } from "./hooks/useInfiniteScroll";
import type { FieldDefinition, FilterCondition } from "@/types";
import type { DbRecord } from "@/lib/db";

const GROUP_PAGE_SIZE = 50;

interface RecordGroupProps {
    partitionId: number;
    groupBy: string;
    statusValue: string;          // "" → 미분류
    statusLabel: string;
    statusColor?: string;
    count: number;                // 그룹 전체 개수
    fields: FieldDefinition[];
    visibleFieldKeys: string[] | null;
    selectedIds: Set<number>;
    onSelectionChange: (ids: Set<number>) => void;
    onUpdateRecord: (id: number, data: Record<string, unknown>) => Promise<{ success: boolean } | void> | void;
    onRecordClick?: (record: DbRecord) => void;
    search?: string;
    filters?: FilterCondition[];
    distributionOrder?: number;
    sortField: string;
    sortOrder: "asc" | "desc";
    onSortChange: (field: string, order: "asc" | "desc") => void;
    onCreateWithStatus?: (statusValue: string) => void;
    /** status 필드가 변경되어 그룹 간 이동이 일어났을 때 부모가 전체 invalidate */
    onGroupChanged?: () => void;
    defaultCollapsed?: boolean;
    isSquare?: boolean;
}

export default function RecordGroup({
    partitionId,
    groupBy,
    statusValue,
    statusLabel,
    statusColor,
    count,
    fields,
    visibleFieldKeys,
    selectedIds,
    onSelectionChange,
    onUpdateRecord,
    onRecordClick,
    search,
    filters,
    distributionOrder,
    sortField,
    sortOrder,
    onSortChange,
    onCreateWithStatus,
    onGroupChanged,
    defaultCollapsed = false,
    isSquare,
}: RecordGroupProps) {
    const [collapsed, setCollapsed] = useState(defaultCollapsed);
    const [currentPage, setCurrentPage] = useState(1);
    // 누적된 page 1..N의 records (id 기준 dedupe + 정렬 안정성을 위해 단일 배열로 보관)
    const [accumulated, setAccumulated] = useState<DbRecord[]>([]);

    const filtersKey = filters ? JSON.stringify(filters) : "";

    // 검색/필터/정렬 변경 시 누적 리셋 (+ page=1부터 다시)
    useEffect(() => {
        setCurrentPage(1);
        setAccumulated([]);
    }, [search, filtersKey, distributionOrder, sortField, sortOrder, partitionId, groupBy, statusValue]);

    // 현재 page만 fetch — 이전 page들은 accumulated에 보관
    const {
        records: pageRecords,
        total,
        isLoading,
        mutate: pageMutate,
    } = useGroupRecords({
        partitionId,
        groupBy,
        groupValue: statusValue,
        page: currentPage,
        pageSize: GROUP_PAGE_SIZE,
        search,
        distributionOrder,
        filters,
        sortField,
        sortOrder,
        enabled: !collapsed,
    });

    // page fetch 결과를 누적에 합침
    useEffect(() => {
        if (collapsed) return;
        if (pageRecords.length === 0) return;

        setAccumulated((prev) => {
            if (currentPage === 1) {
                // page=1은 항상 최신 page 데이터로 교체 (인라인 편집 후 재반영 포함)
                return pageRecords;
            }
            // page>=2: 새 record append + 기존 record는 최신 데이터로 교체 (낙관적 업데이트 반영)
            const pageIds = new Set(pageRecords.map((r) => r.id));
            const refreshedPrev = prev.map((r) => {
                if (!pageIds.has(r.id)) return r;
                const updated = pageRecords.find((p) => p.id === r.id);
                return updated ?? r;
            });
            const seen = new Set(refreshedPrev.map((r) => r.id));
            const newOnes = pageRecords.filter((r) => !seen.has(r.id));
            return [...refreshedPrev, ...newOnes];
        });
    }, [pageRecords, currentPage, collapsed]);

    // 표시용 records — 새 page 로딩 중엔 누적분 그대로 표시
    const displayRecords = useMemo(() => {
        // page=1 도착 전엔 빈 배열 (펼친 직후 첫 로딩)
        if (accumulated.length > 0) return accumulated;
        return pageRecords;
    }, [accumulated, pageRecords]);

    const effectiveTotal = total || count;
    const hasMore = displayRecords.length < effectiveTotal;
    const isLoadingMore = isLoading && currentPage > 1;
    const isInitialLoading = isLoading && displayRecords.length === 0;

    const handleLoadMore = useCallback(() => {
        if (isLoading || !hasMore) return;
        setCurrentPage((p) => p + 1);
    }, [isLoading, hasMore]);

    const sentinelRef = useInfiniteScroll<HTMLDivElement>({
        enabled: !collapsed && hasMore && !isLoading,
        onLoadMore: handleLoadMore,
    });

    // 레코드 업데이트 래퍼: groupBy 필드가 바뀌면 그룹 간 이동 → 전체 invalidate
    const handleUpdateRecord = useCallback(
        async (id: number, data: Record<string, unknown>) => {
            const willChangeGroup = Object.prototype.hasOwnProperty.call(data, groupBy);
            await onUpdateRecord(id, data);
            if (willChangeGroup) {
                onGroupChanged?.();
            } else {
                // 현재 페이지만 갱신 (누적분 일부 갱신은 SSE/globalMutate 경로에서 처리됨)
                pageMutate();
            }
        },
        [groupBy, onUpdateRecord, onGroupChanged, pageMutate],
    );

    return (
        <div className="mb-4">
            {/* 그룹 헤더 */}
            <button
                type="button"
                className="flex items-center gap-2 w-full px-4 py-2 bg-muted/30 hover:bg-muted/50 rounded-t border text-left transition-colors"
                onClick={() => setCollapsed(!collapsed)}
            >
                {collapsed ? (
                    <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                ) : (
                    <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
                )}
                <span
                    className={`inline-flex items-center px-2.5 py-0.5 text-xs font-medium ${isSquare ? "rounded" : "rounded-full"}`}
                    style={{
                        backgroundColor: statusColor || "#9ca3af",
                        color: "#fff",
                    }}
                >
                    {statusLabel}
                </span>
                <span className="text-xs text-muted-foreground">{count.toLocaleString()}</span>
            </button>

            {/* 그룹 바디 */}
            {!collapsed && (
                <div className="border-x border-b rounded-b">
                    {displayRecords.length > 0 ? (
                        <RecordTable
                            records={displayRecords}
                            fields={fields}
                            visibleFieldKeys={visibleFieldKeys}
                            isLoading={false}
                            selectedIds={selectedIds}
                            onSelectionChange={onSelectionChange}
                            onUpdateRecord={handleUpdateRecord}
                            onRecordClick={onRecordClick}
                            sortField={sortField}
                            sortOrder={sortOrder}
                            onSortChange={onSortChange}
                            page={1}
                            totalPages={1}
                            total={displayRecords.length}
                            pageSize={displayRecords.length}
                            onPageChange={() => {}}
                            duplicateHighlight={null}
                            compact
                            onMemoChange={pageMutate}
                        />
                    ) : isInitialLoading ? (
                        <div className="flex items-center justify-center px-4 py-6 text-sm text-muted-foreground gap-2">
                            <Loader2 className="h-4 w-4 animate-spin" />
                            불러오는 중...
                        </div>
                    ) : (
                        <div className="px-4 py-3 text-sm text-muted-foreground">
                            레코드가 없습니다
                        </div>
                    )}

                    {/* 더 보기 + 무한 스크롤 sentinel */}
                    {hasMore && displayRecords.length > 0 && (
                        <div className="border-t">
                            <div ref={sentinelRef} aria-hidden className="h-px" />
                            <Button
                                variant="ghost"
                                size="sm"
                                className="w-full justify-center gap-1.5 text-muted-foreground hover:text-foreground rounded-none h-9"
                                onClick={handleLoadMore}
                                disabled={isLoadingMore}
                            >
                                {isLoadingMore ? (
                                    <>
                                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                        불러오는 중...
                                    </>
                                ) : (
                                    <>더 보기 ({(effectiveTotal - displayRecords.length).toLocaleString()}건 남음)</>
                                )}
                            </Button>
                        </div>
                    )}

                    {/* + 신규 Item 버튼 */}
                    {onCreateWithStatus && (
                        <Button
                            variant="ghost"
                            size="sm"
                            className="w-full justify-start gap-1.5 text-muted-foreground hover:text-foreground rounded-none border-t h-9"
                            onClick={() => onCreateWithStatus(statusValue)}
                        >
                            <Plus className="h-3.5 w-3.5" />
                            신규 Item
                        </Button>
                    )}
                </div>
            )}
        </div>
    );
}
