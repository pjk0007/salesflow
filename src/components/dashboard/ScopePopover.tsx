"use client";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { Filter } from "lucide-react";

interface PartitionNode {
    id: number;
    name: string;
}

interface FolderNode {
    id: number;
    name: string;
    partitions: PartitionNode[];
}

interface PartitionTree {
    folders: FolderNode[];
    ungrouped: PartitionNode[];
}

interface ScopePopoverProps {
    scopeIds: number[] | null;
    scopeLabel: string;
    partitionTree: PartitionTree | null;
    onScopeChange: (partitionId: number, checked: boolean) => void;
    onScopeAll: () => void;
    onScopeFolder: (folderPartitionIds: number[], checked: boolean) => void;
}

export default function ScopePopover({
    scopeIds,
    scopeLabel,
    partitionTree,
    onScopeChange,
    onScopeAll,
    onScopeFolder,
}: ScopePopoverProps) {
    return (
        <Popover>
            <PopoverTrigger asChild>
                <Button variant="ghost" size="sm">
                    <Filter className="h-3 w-3 mr-1" />
                    데이터 범위: {scopeLabel}
                </Button>
            </PopoverTrigger>
            <PopoverContent className="w-64 max-h-80 overflow-y-auto" align="start">
                <div className="space-y-3">
                    <div className="flex items-center gap-2">
                        <Checkbox
                            id="scope-all"
                            checked={!scopeIds || scopeIds.length === 0}
                            onCheckedChange={() => onScopeAll()}
                        />
                        <label htmlFor="scope-all" className="text-sm font-medium">전체</label>
                    </div>
                    {partitionTree && (
                        <>
                            {partitionTree.folders.map((folder) => {
                                const folderPIds = folder.partitions.map((p) => p.id);
                                const allChecked = scopeIds ? folderPIds.every((id) => scopeIds.includes(id)) : false;
                                const someChecked = scopeIds ? folderPIds.some((id) => scopeIds.includes(id)) : false;
                                return (
                                    <div key={folder.id}>
                                        <div className="flex items-center gap-2">
                                            <Checkbox
                                                id={`folder-${folder.id}`}
                                                checked={allChecked ? true : someChecked ? "indeterminate" : false}
                                                onCheckedChange={(checked) => onScopeFolder(folderPIds, !!checked)}
                                            />
                                            <label htmlFor={`folder-${folder.id}`} className="text-sm font-medium">{folder.name}</label>
                                        </div>
                                        <div className="ml-6 space-y-1 mt-1">
                                            {folder.partitions.map((p) => (
                                                <div key={p.id} className="flex items-center gap-2">
                                                    <Checkbox
                                                        id={`part-${p.id}`}
                                                        checked={scopeIds ? scopeIds.includes(p.id) : false}
                                                        onCheckedChange={(checked) => onScopeChange(p.id, !!checked)}
                                                    />
                                                    <label htmlFor={`part-${p.id}`} className="text-sm text-muted-foreground">{p.name}</label>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                );
                            })}
                            {partitionTree.ungrouped.length > 0 && (
                                <div className="space-y-1">
                                    {partitionTree.ungrouped.map((p) => (
                                        <div key={p.id} className="flex items-center gap-2">
                                            <Checkbox
                                                id={`part-${p.id}`}
                                                checked={scopeIds ? scopeIds.includes(p.id) : false}
                                                onCheckedChange={(checked) => onScopeChange(p.id, !!checked)}
                                            />
                                            <label htmlFor={`part-${p.id}`} className="text-sm text-muted-foreground">{p.name}</label>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </>
                    )}
                </div>
            </PopoverContent>
        </Popover>
    );
}
