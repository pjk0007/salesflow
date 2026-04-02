"use client";

import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ChevronLeft, ChevronRight } from "lucide-react";
import RecordGroup from "./RecordGroup";
import type { FieldDefinition } from "@/types";
import type { DbRecord } from "@/lib/db";

interface StatusGroup {
    statusValue: string;
    statusLabel: string;
    statusColor?: string;
    records: DbRecord[];
    count: number;
}

interface GroupedRecordViewProps {
    records: DbRecord[];
    fields: FieldDefinition[];
    visibleFieldKeys: string[] | null;
    isLoading: boolean;
    selectedIds: Set<number>;
    onSelectionChange: (ids: Set<number>) => void;
    onUpdateRecord: (id: number, data: Record<string, unknown>) => void;
    onRecordClick?: (record: DbRecord) => void;
    groupByField: FieldDefinition;
    sortField: string;
    sortOrder: "asc" | "desc";
    onSortChange: (field: string, order: "asc" | "desc") => void;
    // 페이지네이션
    page: number;
    totalPages: number;
    total: number;
    pageSize: number;
    onPageChange: (page: number) => void;
    duplicateHighlight?: { color: string; ids: Set<number> } | null;
    onCreateWithStatus?: (statusValue: string) => void;
}

// 상태 옵션별 기본 색상 (options에 색상이 없을 때)
const DEFAULT_COLORS = [
    "#f59e0b", "#3b82f6", "#10b981", "#8b5cf6", "#ef4444",
    "#ec4899", "#06b6d4", "#84cc16", "#f97316", "#6366f1",
];

function groupRecordsByStatus(
    records: DbRecord[],
    field: FieldDefinition,
): StatusGroup[] {
    const options = field.options ?? [];
    const fieldKey = field.key;

    // 옵션별 그룹 초기화
    const groupMap = new Map<string, DbRecord[]>();
    for (const opt of options) {
        groupMap.set(opt, []);
    }

    const uncategorized: DbRecord[] = [];

    for (const record of records) {
        const data = record.data as Record<string, unknown>;
        const val = data[fieldKey] != null ? String(data[fieldKey]) : "";

        if (val && groupMap.has(val)) {
            groupMap.get(val)!.push(record);
        } else if (val) {
            // options에 없는 값
            if (!groupMap.has(val)) groupMap.set(val, []);
            groupMap.get(val)!.push(record);
        } else {
            uncategorized.push(record);
        }
    }

    const groups: StatusGroup[] = [];

    // 옵션 순서대로 그룹 생성
    for (let i = 0; i < options.length; i++) {
        const opt = options[i];
        const recs = groupMap.get(opt) ?? [];
        if (recs.length === 0) continue;
        groups.push({
            statusValue: opt,
            statusLabel: opt,
            statusColor: DEFAULT_COLORS[i % DEFAULT_COLORS.length],
            records: recs,
            count: recs.length,
        });
    }

    // options에 없는 값들의 그룹 추가
    for (const [val, recs] of groupMap) {
        if (options.includes(val) || recs.length === 0) continue;
        groups.push({
            statusValue: val,
            statusLabel: val,
            statusColor: "#9ca3af",
            records: recs,
            count: recs.length,
        });
    }

    // 미분류 그룹
    if (uncategorized.length > 0) {
        groups.push({
            statusValue: "",
            statusLabel: "미분류",
            statusColor: "#d1d5db",
            records: uncategorized,
            count: uncategorized.length,
        });
    }

    return groups;
}

export default function GroupedRecordView({
    records,
    fields,
    visibleFieldKeys,
    isLoading,
    selectedIds,
    onSelectionChange,
    onUpdateRecord,
    onRecordClick,
    groupByField,
    sortField,
    sortOrder,
    onSortChange,
    page,
    totalPages,
    total,
    pageSize,
    onPageChange,
    duplicateHighlight,
    onCreateWithStatus,
}: GroupedRecordViewProps) {
    const groups = useMemo(
        () => groupRecordsByStatus(records, groupByField),
        [records, groupByField],
    );

    if (isLoading) {
        return (
            <div className="p-4 space-y-3">
                {Array.from({ length: 5 }).map((_, i) => (
                    <Skeleton key={i} className="h-10 w-full" />
                ))}
            </div>
        );
    }

    if (records.length === 0) {
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
                        key={group.statusValue}
                        statusValue={group.statusValue}
                        statusLabel={group.statusLabel}
                        statusColor={group.statusColor}
                        count={group.count}
                        records={group.records}
                        fields={fields}
                        visibleFieldKeys={visibleFieldKeys}
                        selectedIds={selectedIds}
                        onSelectionChange={onSelectionChange}
                        onUpdateRecord={onUpdateRecord}
                        onRecordClick={onRecordClick}
                        sortField={sortField}
                        sortOrder={sortOrder}
                        onSortChange={onSortChange}
                        duplicateHighlight={duplicateHighlight}
                        onCreateWithStatus={onCreateWithStatus}
                    />
                ))}
            </div>

            {/* 페이지네이션 */}
            {totalPages > 1 && (
                <div className="flex items-center justify-between px-4 py-3 border-t">
                    <p className="text-sm text-muted-foreground">
                        총 {total.toLocaleString()}건 중 {((page - 1) * pageSize + 1).toLocaleString()}-
                        {Math.min(page * pageSize, total).toLocaleString()}건
                    </p>
                    <div className="flex items-center gap-1">
                        <Button
                            variant="outline"
                            size="icon"
                            className="h-8 w-8"
                            disabled={page <= 1}
                            onClick={() => onPageChange(page - 1)}
                        >
                            <ChevronLeft className="h-4 w-4" />
                        </Button>
                        <span className="text-sm px-2">
                            {page} / {totalPages}
                        </span>
                        <Button
                            variant="outline"
                            size="icon"
                            className="h-8 w-8"
                            disabled={page >= totalPages}
                            onClick={() => onPageChange(page + 1)}
                        >
                            <ChevronRight className="h-4 w-4" />
                        </Button>
                    </div>
                </div>
            )}
        </div>
    );
}
