"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import RecordTable from "./RecordTable";
import type { FieldDefinition } from "@/types";
import type { DbRecord } from "@/lib/db";

interface RecordGroupProps {
    statusValue: string;
    statusLabel: string;
    statusColor?: string;
    count: number;
    records: DbRecord[];
    fields: FieldDefinition[];
    visibleFieldKeys: string[] | null;
    selectedIds: Set<number>;
    onSelectionChange: (ids: Set<number>) => void;
    onUpdateRecord: (id: number, data: Record<string, unknown>) => void;
    onRecordClick?: (record: DbRecord) => void;
    sortField: string;
    sortOrder: "asc" | "desc";
    onSortChange: (field: string, order: "asc" | "desc") => void;
    duplicateHighlight?: { color: string; ids: Set<number> } | null;
    onCreateWithStatus?: (statusValue: string) => void;
    defaultCollapsed?: boolean;
    isSquare?: boolean;
}

export default function RecordGroup({
    statusValue,
    statusLabel,
    statusColor,
    count,
    records,
    fields,
    visibleFieldKeys,
    selectedIds,
    onSelectionChange,
    onUpdateRecord,
    onRecordClick,
    sortField,
    sortOrder,
    onSortChange,
    duplicateHighlight,
    onCreateWithStatus,
    defaultCollapsed = false,
    isSquare,
}: RecordGroupProps) {
    const [collapsed, setCollapsed] = useState(defaultCollapsed);

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
                <span className="text-xs text-muted-foreground">{count}</span>
            </button>

            {/* 그룹 바디 */}
            {!collapsed && (
                <div className="border-x border-b rounded-b">
                    {records.length > 0 ? (
                        <RecordTable
                            records={records}
                            fields={fields}
                            visibleFieldKeys={visibleFieldKeys}
                            isLoading={false}
                            selectedIds={selectedIds}
                            onSelectionChange={onSelectionChange}
                            onUpdateRecord={onUpdateRecord}
                            onRecordClick={onRecordClick}
                            sortField={sortField}
                            sortOrder={sortOrder}
                            onSortChange={onSortChange}
                            page={1}
                            totalPages={1}
                            total={count}
                            pageSize={count}
                            onPageChange={() => {}}
                            duplicateHighlight={duplicateHighlight}
                            compact
                        />
                    ) : (
                        <div className="px-4 py-3 text-sm text-muted-foreground">
                            레코드가 없습니다
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
