import { useState } from "react";
import { ChevronRight, FolderOpen, FileText, Plus, MoreHorizontal, Pencil, Trash2, Shuffle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import {
    Collapsible,
    CollapsibleContent,
    CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { useWorkspaces } from "@/hooks/useWorkspaces";
import { getIconComponent } from "@/components/ui/icon-picker";
import { Skeleton } from "@/components/ui/skeleton";
import type { PartitionTree } from "@/hooks/usePartitions";

interface PartitionNavProps {
    workspaceId: number | null;
    selectedPartitionId: number | null;
    partitionTree: PartitionTree | null;
    isLoading: boolean;
    onWorkspaceChange: (workspaceId: number) => void;
    onPartitionSelect: (partitionId: number) => void;
    onCreatePartition: () => void;
    onCreateFolder: () => void;
    onRenamePartition: (id: number, currentName: string) => void;
    onRenameFolder: (id: number, currentName: string) => void;
    onDeletePartition: (id: number, name: string) => void;
    onDeleteFolder: (id: number, name: string) => void;
    onDistributionSettings?: (id: number, name: string) => void;
}

export default function PartitionNav({
    workspaceId,
    selectedPartitionId,
    partitionTree,
    isLoading: ptLoading,
    onWorkspaceChange,
    onPartitionSelect,
    onCreatePartition,
    onCreateFolder,
    onRenamePartition,
    onRenameFolder,
    onDeletePartition,
    onDeleteFolder,
    onDistributionSettings,
}: PartitionNavProps) {
    const { workspaces, isLoading: wsLoading } = useWorkspaces();
    const [openFolders, setOpenFolders] = useState<Set<number>>(new Set());

    const toggleFolder = (folderId: number) => {
        setOpenFolders((prev) => {
            const next = new Set(prev);
            if (next.has(folderId)) next.delete(folderId);
            else next.add(folderId);
            return next;
        });
    };

    return (
        <div className="w-60 border-r bg-muted/30 flex flex-col">
            {/* 워크스페이스 선택 */}
            <div className="p-3 border-b">
                {wsLoading ? (
                    <Skeleton className="h-9 w-full" />
                ) : (
                    <Select
                        value={workspaceId ? String(workspaceId) : undefined}
                        onValueChange={(v) => onWorkspaceChange(Number(v))}
                    >
                        <SelectTrigger className="w-full">
                            <SelectValue placeholder="워크스페이스 선택" />
                        </SelectTrigger>
                        <SelectContent>
                            {workspaces.map((ws) => {
                                const Icon = ws.icon ? getIconComponent(ws.icon) : null;
                                return (
                                    <SelectItem key={ws.id} value={String(ws.id)}>
                                        <span className="flex items-center gap-2">
                                            {Icon && <Icon className="h-4 w-4 text-muted-foreground shrink-0" />}
                                            {ws.name}
                                        </span>
                                    </SelectItem>
                                );
                            })}
                        </SelectContent>
                    </Select>
                )}
            </div>

            {/* 생성 버튼 */}
            {workspaceId && (
                <div className="flex gap-1 px-3 py-2 border-b">
                    <Button
                        variant="ghost"
                        size="sm"
                        className="flex-1 justify-start gap-1 text-xs"
                        onClick={onCreateFolder}
                    >
                        <Plus className="h-3 w-3" />
                        폴더
                    </Button>
                    <Button
                        variant="ghost"
                        size="sm"
                        className="flex-1 justify-start gap-1 text-xs"
                        onClick={onCreatePartition}
                    >
                        <Plus className="h-3 w-3" />
                        파티션
                    </Button>
                </div>
            )}

            {/* 파티션 트리 */}
            <div className="flex-1 overflow-auto p-2 space-y-1">
                {ptLoading ? (
                    <div className="space-y-2 p-2">
                        {Array.from({ length: 5 }).map((_, i) => (
                            <Skeleton key={i} className="h-8 w-full" />
                        ))}
                    </div>
                ) : !partitionTree ? (
                    <p className="text-sm text-muted-foreground p-2">
                        워크스페이스를 선택해주세요.
                    </p>
                ) : (
                    <>
                        {/* 폴더 + 파티션 */}
                        {partitionTree.folders.map((folder) => (
                            <Collapsible
                                key={folder.id}
                                open={openFolders.has(folder.id)}
                                onOpenChange={() => toggleFolder(folder.id)}
                            >
                                <div className="flex items-center group">
                                    <CollapsibleTrigger asChild>
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            className="flex-1 justify-start gap-1.5 font-medium min-w-0"
                                        >
                                            <ChevronRight
                                                className={cn(
                                                    "h-3.5 w-3.5 shrink-0 transition-transform",
                                                    openFolders.has(folder.id) && "rotate-90"
                                                )}
                                            />
                                            <FolderOpen className="h-4 w-4 shrink-0 text-muted-foreground" />
                                            <span className="truncate">{folder.name}</span>
                                        </Button>
                                    </CollapsibleTrigger>
                                    <DropdownMenu>
                                        <DropdownMenuTrigger asChild>
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                className="h-6 w-6 shrink-0 opacity-0 group-hover:opacity-100"
                                                onClick={(e) => e.stopPropagation()}
                                            >
                                                <MoreHorizontal className="h-3.5 w-3.5" />
                                            </Button>
                                        </DropdownMenuTrigger>
                                        <DropdownMenuContent align="end">
                                            <DropdownMenuItem onClick={() => onRenameFolder(folder.id, folder.name)}>
                                                <Pencil className="h-3.5 w-3.5 mr-2" />
                                                이름 변경
                                            </DropdownMenuItem>
                                            <DropdownMenuItem
                                                className="text-destructive"
                                                onClick={() => onDeleteFolder(folder.id, folder.name)}
                                            >
                                                <Trash2 className="h-3.5 w-3.5 mr-2" />
                                                삭제
                                            </DropdownMenuItem>
                                        </DropdownMenuContent>
                                    </DropdownMenu>
                                </div>
                                <CollapsibleContent className="pl-4 space-y-0.5">
                                    {folder.partitions.map((pt) => (
                                        <div key={pt.id} className="flex items-center group/pt">
                                            <Button
                                                variant={
                                                    selectedPartitionId === pt.id
                                                        ? "secondary"
                                                        : "ghost"
                                                }
                                                size="sm"
                                                className="flex-1 justify-start gap-1.5 min-w-0"
                                                onClick={() => onPartitionSelect(pt.id)}
                                            >
                                                <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                                                <span className="truncate">{pt.name}</span>
                                            </Button>
                                            <DropdownMenu>
                                                <DropdownMenuTrigger asChild>
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        className="h-6 w-6 shrink-0 opacity-0 group-hover/pt:opacity-100"
                                                    >
                                                        <MoreHorizontal className="h-3.5 w-3.5" />
                                                    </Button>
                                                </DropdownMenuTrigger>
                                                <DropdownMenuContent align="end">
                                                    <DropdownMenuItem onClick={() => onRenamePartition(pt.id, pt.name)}>
                                                        <Pencil className="h-3.5 w-3.5 mr-2" />
                                                        이름 변경
                                                    </DropdownMenuItem>
                                                    {onDistributionSettings && (
                                                        <DropdownMenuItem onClick={() => onDistributionSettings(pt.id, pt.name)}>
                                                            <Shuffle className="h-3.5 w-3.5 mr-2" />
                                                            배분 설정
                                                        </DropdownMenuItem>
                                                    )}
                                                    <DropdownMenuItem
                                                        className="text-destructive"
                                                        onClick={() => onDeletePartition(pt.id, pt.name)}
                                                    >
                                                        <Trash2 className="h-3.5 w-3.5 mr-2" />
                                                        삭제
                                                    </DropdownMenuItem>
                                                </DropdownMenuContent>
                                            </DropdownMenu>
                                        </div>
                                    ))}
                                </CollapsibleContent>
                            </Collapsible>
                        ))}

                        {/* 미분류 파티션 */}
                        {partitionTree.ungrouped.map((pt) => (
                            <div key={pt.id} className="flex items-center group">
                                <Button
                                    variant={
                                        selectedPartitionId === pt.id ? "secondary" : "ghost"
                                    }
                                    size="sm"
                                    className="flex-1 justify-start gap-1.5 min-w-0"
                                    onClick={() => onPartitionSelect(pt.id)}
                                >
                                    <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                                    <span className="truncate">{pt.name}</span>
                                </Button>
                                <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className="h-6 w-6 shrink-0 opacity-0 group-hover:opacity-100"
                                        >
                                            <MoreHorizontal className="h-3.5 w-3.5" />
                                        </Button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent align="end">
                                        <DropdownMenuItem onClick={() => onRenamePartition(pt.id, pt.name)}>
                                            <Pencil className="h-3.5 w-3.5 mr-2" />
                                            이름 변경
                                        </DropdownMenuItem>
                                        {onDistributionSettings && (
                                            <DropdownMenuItem onClick={() => onDistributionSettings(pt.id, pt.name)}>
                                                <Shuffle className="h-3.5 w-3.5 mr-2" />
                                                배분 설정
                                            </DropdownMenuItem>
                                        )}
                                        <DropdownMenuItem
                                            className="text-destructive"
                                            onClick={() => onDeletePartition(pt.id, pt.name)}
                                        >
                                            <Trash2 className="h-3.5 w-3.5 mr-2" />
                                            삭제
                                        </DropdownMenuItem>
                                    </DropdownMenuContent>
                                </DropdownMenu>
                            </div>
                        ))}

                        {partitionTree.folders.length === 0 &&
                            partitionTree.ungrouped.length === 0 && (
                                <p className="text-sm text-muted-foreground p-2">
                                    파티션이 없습니다.
                                </p>
                            )}
                    </>
                )}
            </div>
        </div>
    );
}
