import { useCallback, useMemo } from "react";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ChevronLeft, ChevronRight, ArrowUp, ArrowDown, ArrowUpDown } from "lucide-react";
import InlineEditCell from "./InlineEditCell";
import type { FieldDefinition } from "@/types";
import type { DbRecord } from "@/lib/db";

interface RecordTableProps {
    records: DbRecord[];
    fields: FieldDefinition[];
    visibleFieldKeys: string[] | null;
    isLoading: boolean;
    selectedIds: Set<number>;
    onSelectionChange: (ids: Set<number>) => void;
    onUpdateRecord: (id: number, data: Record<string, unknown>) => void;
    onRecordClick?: (record: DbRecord) => void;
    // 정렬
    sortField: string;
    sortOrder: "asc" | "desc";
    onSortChange: (field: string, order: "asc" | "desc") => void;
    // 페이지네이션
    page: number;
    totalPages: number;
    total: number;
    pageSize: number;
    onPageChange: (page: number) => void;
}

export default function RecordTable({
    records,
    fields,
    visibleFieldKeys,
    isLoading,
    selectedIds,
    onSelectionChange,
    onUpdateRecord,
    onRecordClick,
    sortField,
    sortOrder,
    onSortChange,
    page,
    totalPages,
    total,
    pageSize,
    onPageChange,
}: RecordTableProps) {
    // 표시할 필드 결정
    const displayFields = useMemo(() => {
        if (visibleFieldKeys && visibleFieldKeys.length > 0) {
            return visibleFieldKeys
                .map((key) => fields.find((f) => f.key === key))
                .filter((f): f is FieldDefinition => f !== undefined);
        }
        return fields;
    }, [fields, visibleFieldKeys]);

    const allSelected = records.length > 0 && records.every((r) => selectedIds.has(r.id));

    const toggleAll = () => {
        if (allSelected) {
            onSelectionChange(new Set());
        } else {
            onSelectionChange(new Set(records.map((r) => r.id)));
        }
    };

    const toggleOne = (id: number) => {
        const next = new Set(selectedIds);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        onSelectionChange(next);
    };

    const handleSort = (field: string) => {
        if (sortField === field) {
            onSortChange(field, sortOrder === "asc" ? "desc" : "asc");
        } else {
            onSortChange(field, "desc");
        }
    };

    const renderSortIcon = (field: string) => {
        if (sortField !== field) return <ArrowUpDown className="h-3 w-3 text-muted-foreground/50" />;
        return sortOrder === "asc"
            ? <ArrowUp className="h-3 w-3" />
            : <ArrowDown className="h-3 w-3" />;
    };

    const handleCellSave = useCallback(
        (recordId: number, fieldKey: string, value: unknown) => {
            onUpdateRecord(recordId, { [fieldKey]: value });
        },
        [onUpdateRecord]
    );

    if (isLoading) {
        return (
            <div className="p-4 space-y-3">
                {Array.from({ length: 10 }).map((_, i) => (
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
        <div className="flex flex-col flex-1">
            <div className="flex-1 overflow-auto">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead className="w-10">
                                <Checkbox
                                    checked={allSelected}
                                    onCheckedChange={toggleAll}
                                />
                            </TableHead>
                            <TableHead
                                className="w-[120px] cursor-pointer select-none"
                                onClick={() => handleSort("integratedCode")}
                            >
                                <span className="flex items-center gap-1">
                                    통합코드
                                    {renderSortIcon("integratedCode")}
                                </span>
                            </TableHead>
                            {displayFields.map((field) => (
                                <TableHead
                                    key={field.key}
                                    style={{ minWidth: field.minWidth, width: field.defaultWidth }}
                                >
                                    {field.label}
                                </TableHead>
                            ))}
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {records.map((record) => {
                            const data = record.data as Record<string, unknown>;
                            return (
                                <TableRow
                                    key={record.id}
                                    data-state={selectedIds.has(record.id) ? "selected" : undefined}
                                >
                                    <TableCell>
                                        <Checkbox
                                            checked={selectedIds.has(record.id)}
                                            onCheckedChange={() => toggleOne(record.id)}
                                        />
                                    </TableCell>
                                    <TableCell
                                        className="font-mono text-xs text-muted-foreground cursor-pointer hover:text-foreground hover:underline"
                                        onClick={() => onRecordClick?.(record)}
                                    >
                                        {record.integratedCode}
                                    </TableCell>
                                    {displayFields.map((field) => (
                                        <TableCell key={field.key} className="p-1">
                                            <InlineEditCell
                                                field={field}
                                                value={data[field.key]}
                                                onSave={(val) =>
                                                    handleCellSave(record.id, field.key, val)
                                                }
                                            />
                                        </TableCell>
                                    ))}
                                </TableRow>
                            );
                        })}
                    </TableBody>
                </Table>
            </div>

            {/* 페이지네이션 */}
            {totalPages > 1 && (
                <div className="flex items-center justify-between px-4 py-3 border-t">
                    <p className="text-sm text-muted-foreground">
                        총 {total.toLocaleString()}건 중{" "}
                        {((page - 1) * pageSize + 1).toLocaleString()}-
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
