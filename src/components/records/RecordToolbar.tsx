import { useState, useEffect } from "react";
import { Search, Plus, Trash2, MessageSquare, Mail, Download, Upload, List, LayoutList, SlidersHorizontal, Eye, EyeOff } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover";
import FilterBuilder from "./FilterBuilder";
import { SYSTEM_COLUMNS } from "./system-columns";
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
    // 뷰 모드
    viewMode?: "flat" | "grouped";
    onViewModeChange?: (mode: "flat" | "grouped") => void;
    hasStatusField?: boolean;
    // 컬럼 표시 관리
    visibleFieldKeys: string[] | null;
    allFields: FieldDefinition[];
    onToggleColumn?: (fieldKey: string, visible: boolean) => void;
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
    viewMode,
    onViewModeChange,
    hasStatusField,
    visibleFieldKeys,
    allFields,
    onToggleColumn,
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
        <div className="flex flex-wrap items-center gap-2 p-3 border-b">
            {/* 검색 */}
            <div className="relative flex-1 min-w-40 max-w-sm">
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

            {/* 뷰 모드 토글 */}
            {hasStatusField && onViewModeChange && (
                <div className="flex items-center border rounded-md">
                    <Button
                        variant="ghost"
                        size="icon"
                        className={`h-8 w-8 rounded-r-none ${viewMode === "flat" ? "bg-accent" : ""}`}
                        onClick={() => onViewModeChange("flat")}
                        title="리스트 뷰"
                    >
                        <List className="h-4 w-4" />
                    </Button>
                    <Button
                        variant="ghost"
                        size="icon"
                        className={`h-8 w-8 rounded-l-none ${viewMode === "grouped" ? "bg-accent" : ""}`}
                        onClick={() => onViewModeChange("grouped")}
                        title="그룹 뷰"
                    >
                        <LayoutList className="h-4 w-4" />
                    </Button>
                </div>
            )}

            {/* 테이블 설정 */}
            {onToggleColumn && (
                <TableSettingsPopover
                    allFields={allFields}
                    visibleFieldKeys={visibleFieldKeys}
                    onToggleColumn={onToggleColumn}
                />
            )}

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

            {/* 모바일: 줄바꿈 / 데스크톱: 좌우 분리용 spacer */}
            <div className="basis-full md:basis-auto md:flex-1" />

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

function TableSettingsPopover({
    allFields,
    visibleFieldKeys,
    onToggleColumn,
}: {
    allFields: FieldDefinition[];
    visibleFieldKeys: string[] | null;
    onToggleColumn: (fieldKey: string, visible: boolean) => void;
}) {
    const [view, setView] = useState<"menu" | "columns">("menu");

    return (
        <Popover onOpenChange={(open) => { if (!open) setView("menu"); }}>
            <PopoverTrigger asChild>
                <Button variant="outline" size="icon" className="h-8 w-8" title="테이블 설정">
                    <SlidersHorizontal className="h-4 w-4" />
                </Button>
            </PopoverTrigger>
            <PopoverContent className="w-64 p-0" align="start">
                {view === "menu" ? (
                    <div className="py-1">
                        <button
                            type="button"
                            className="flex items-center gap-2 w-full px-3 py-2 text-sm hover:bg-muted/50"
                            onClick={() => setView("columns")}
                        >
                            <Eye className="h-4 w-4 text-muted-foreground" />
                            속성 표시 여부
                        </button>
                    </div>
                ) : (
                    <>
                        <div className="flex items-center gap-2 px-3 py-2 border-b">
                            <button
                                type="button"
                                className="text-muted-foreground hover:text-foreground"
                                onClick={() => setView("menu")}
                            >
                                ←
                            </button>
                            <p className="text-sm font-medium">속성 표시 여부</p>
                        </div>
                        <div className="max-h-64 overflow-y-auto py-1">
                            {[...SYSTEM_COLUMNS, ...allFields].map((f) => {
                                const isVisible = !visibleFieldKeys || visibleFieldKeys.includes(f.key);
                                return (
                                    <button
                                        key={f.key}
                                        type="button"
                                        className="flex items-center justify-between w-full px-3 py-1.5 text-sm hover:bg-muted/50"
                                        onClick={() => onToggleColumn(f.key, !isVisible)}
                                    >
                                        <span className="truncate">{f.label}</span>
                                        {isVisible ? (
                                            <Eye className="h-4 w-4 text-muted-foreground shrink-0" />
                                        ) : (
                                            <EyeOff className="h-4 w-4 text-muted-foreground/40 shrink-0" />
                                        )}
                                    </button>
                                );
                            })}
                        </div>
                    </>
                )}
            </PopoverContent>
        </Popover>
    );
}
