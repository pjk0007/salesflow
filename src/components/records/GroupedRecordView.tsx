"use client";

import { useMemo } from "react";
import { mutate as globalMutate } from "swr";
import { Skeleton } from "@/components/ui/skeleton";
import RecordGroup from "./RecordGroup";
import { useGroupCounts } from "./hooks/useGroupCounts";
import type { FieldDefinition, FilterCondition } from "@/types";
import type { DbRecord } from "@/lib/db";

interface StatusGroupMeta {
    statusValue: string;       // "" → 미분류
    statusLabel: string;
    statusColor: string;
    count: number;
}

interface GroupedRecordViewProps {
    partitionId: number;
    groupByField: FieldDefinition;
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
}

const DEFAULT_COLORS = [
    "#f59e0b", "#3b82f6", "#10b981", "#8b5cf6", "#ef4444",
    "#ec4899", "#06b6d4", "#84cc16", "#f97316", "#6366f1",
];

export default function GroupedRecordView({
    partitionId,
    groupByField,
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
}: GroupedRecordViewProps) {
    const {
        counts,
        uncategorized,
        total,
        isLoading: countsLoading,
        mutate: countsMutate,
    } = useGroupCounts({
        partitionId,
        groupBy: groupByField.key,
        search,
        distributionOrder,
        filters,
    });

    const groups = useMemo<StatusGroupMeta[]>(() => {
        const options = groupByField.options ?? [];
        const colors = groupByField.optionColors ?? {};
        const result: StatusGroupMeta[] = [];

        // 옵션 순서대로
        for (let i = 0; i < options.length; i++) {
            const opt = options[i];
            const cnt = counts[opt] ?? 0;
            if (cnt === 0) continue;
            result.push({
                statusValue: opt,
                statusLabel: opt,
                statusColor: colors[opt] || DEFAULT_COLORS[i % DEFAULT_COLORS.length],
                count: cnt,
            });
        }

        // options에 없는 값 (옵션 변경 후 남아있는 레거시 값)
        for (const [val, cnt] of Object.entries(counts)) {
            if (options.includes(val) || cnt === 0) continue;
            result.push({
                statusValue: val,
                statusLabel: val,
                statusColor: colors[val] || "#9ca3af",
                count: cnt,
            });
        }

        // 미분류
        if (uncategorized > 0) {
            result.push({
                statusValue: "",
                statusLabel: "미분류",
                statusColor: "#d1d5db",
                count: uncategorized,
            });
        }

        return result;
    }, [counts, uncategorized, groupByField]);

    // status 필드 변경 시: 모든 그룹 + 카운트 일괄 invalidate
    const handleGroupChanged = () => {
        countsMutate();
        globalMutate(
            (key) => typeof key === "string" && key.startsWith(`/api/partitions/${partitionId}/records?`),
        );
    };

    if (countsLoading) {
        return (
            <div className="p-4 space-y-3">
                {Array.from({ length: 5 }).map((_, i) => (
                    <Skeleton key={i} className="h-10 w-full" />
                ))}
            </div>
        );
    }

    if (total === 0) {
        return (
            <div className="flex-1 flex items-center justify-center p-12">
                <div className="text-center text-muted-foreground">
                    <p className="text-lg mb-1">레코드가 없습니다</p>
                    <p className="text-sm">새 레코드를 추가해보세요.</p>
                </div>
            </div>
        );
    }

    return (
        <div className="flex flex-col flex-1 min-h-0">
            <div className="flex-1 min-h-0 overflow-auto p-4">
                {groups.map((group) => (
                    <RecordGroup
                        key={group.statusValue || "__uncategorized__"}
                        partitionId={partitionId}
                        groupBy={groupByField.key}
                        statusValue={group.statusValue}
                        statusLabel={group.statusLabel}
                        statusColor={group.statusColor}
                        count={group.count}
                        fields={fields}
                        visibleFieldKeys={visibleFieldKeys}
                        selectedIds={selectedIds}
                        onSelectionChange={onSelectionChange}
                        onUpdateRecord={onUpdateRecord}
                        onRecordClick={onRecordClick}
                        search={search}
                        filters={filters}
                        distributionOrder={distributionOrder}
                        sortField={sortField}
                        sortOrder={sortOrder}
                        onSortChange={onSortChange}
                        onCreateWithStatus={onCreateWithStatus}
                        onGroupChanged={handleGroupChanged}
                        isSquare={groupByField.optionStyle === "square"}
                    />
                ))}
            </div>
        </div>
    );
}
