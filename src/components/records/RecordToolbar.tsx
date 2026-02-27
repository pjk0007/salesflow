import { useState, useEffect } from "react";
import { Search, Plus, Trash2, MessageSquare, Mail, Download, Upload } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import FilterBuilder from "./FilterBuilder";
import type { FieldDefinition, FilterCondition } from "@/types";

interface RecordToolbarProps {
    onSearch: (keyword: string) => void;
    onDistributionOrderChange: (order: number | undefined) => void;
    onCreateClick: () => void;
    onBulkDelete: () => void;
    onExportClick?: () => void;
    onImportClick?: () => void;
    onAlimtalkSend?: () => void;
    onEmailSend?: () => void;
    selectedCount: number;
    totalRecords?: number;
    maxDistributionOrder?: number;
    fields: FieldDefinition[];
    filters: FilterCondition[];
    onFiltersChange: (filters: FilterCondition[]) => void;
}

export default function RecordToolbar({
    onSearch,
    onDistributionOrderChange,
    onCreateClick,
    onBulkDelete,
    onExportClick,
    onImportClick,
    onAlimtalkSend,
    onEmailSend,
    selectedCount,
    totalRecords,
    maxDistributionOrder,
    fields,
    filters,
    onFiltersChange,
}: RecordToolbarProps) {
    const [searchInput, setSearchInput] = useState("");

    // 검색 debounce
    useEffect(() => {
        const timer = setTimeout(() => {
            onSearch(searchInput);
        }, 300);
        return () => clearTimeout(timer);
    }, [searchInput, onSearch]);

    return (
        <div className="flex items-center gap-2 p-3 border-b">
            {/* 검색 */}
            <div className="relative flex-1 max-w-sm">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                    placeholder="검색..."
                    value={searchInput}
                    onChange={(e) => setSearchInput(e.target.value)}
                    className="pl-8 h-9"
                />
            </div>

            {/* 필드 필터 */}
            <FilterBuilder
                fields={fields}
                filters={filters}
                onFiltersChange={onFiltersChange}
            />

            {/* 분배순서 필터 */}
            {maxDistributionOrder && maxDistributionOrder > 0 && (
                <Select
                    onValueChange={(v) =>
                        onDistributionOrderChange(v === "all" ? undefined : Number(v))
                    }
                >
                    <SelectTrigger size="sm" className="w-[140px]">
                        <SelectValue placeholder="분배순서" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">전체</SelectItem>
                        {Array.from({ length: maxDistributionOrder }, (_, i) => (
                            <SelectItem key={i + 1} value={String(i + 1)}>
                                {i + 1}순서
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            )}

            <div className="flex-1" />

            {/* 내보내기/가져오기 */}
            {onExportClick && (
                <Button
                    variant="outline"
                    size="sm"
                    onClick={onExportClick}
                    disabled={!totalRecords}
                    className="gap-1.5"
                >
                    <Download className="h-4 w-4" />
                    내보내기
                </Button>
            )}
            {onImportClick && (
                <Button
                    variant="outline"
                    size="sm"
                    onClick={onImportClick}
                    className="gap-1.5"
                >
                    <Upload className="h-4 w-4" />
                    가져오기
                </Button>
            )}

            {/* 선택 시 액션 */}
            {selectedCount > 0 && (
                <>
                    {onAlimtalkSend && (
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={onAlimtalkSend}
                            className="gap-1.5"
                        >
                            <MessageSquare className="h-4 w-4" />
                            알림톡 발송
                        </Button>
                    )}
                    {onEmailSend && (
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={onEmailSend}
                            className="gap-1.5"
                        >
                            <Mail className="h-4 w-4" />
                            이메일 발송
                        </Button>
                    )}
                    <Button
                        variant="destructive"
                        size="sm"
                        onClick={onBulkDelete}
                        className="gap-1.5"
                    >
                        <Trash2 className="h-4 w-4" />
                        {selectedCount}건 삭제
                    </Button>
                </>
            )}

            {/* 추가 버튼 */}
            <Button size="sm" onClick={onCreateClick} className="gap-1.5">
                <Plus className="h-4 w-4" />
                추가
            </Button>
        </div>
    );
}
