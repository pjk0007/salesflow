"use client";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Pencil, Plus, Globe, Lock, Link2, Trash2 } from "lucide-react";
import ScopePopover from "./ScopePopover";

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

interface DashboardToolbarProps {
    isEditing: boolean;
    onToggleEdit: () => void;
    onAddWidget: () => void;
    isPublic: boolean;
    onTogglePublic: () => void;
    onCopyLink: () => void;
    refreshInterval: number;
    onDelete: () => void;
    scopeIds: number[] | null;
    scopeLabel: string;
    partitionTree: PartitionTree | null;
    onScopeChange: (partitionId: number, checked: boolean) => void;
    onScopeAll: () => void;
    onScopeFolder: (folderPartitionIds: number[], checked: boolean) => void;
}

export default function DashboardToolbar({
    isEditing,
    onToggleEdit,
    onAddWidget,
    isPublic,
    onTogglePublic,
    onCopyLink,
    refreshInterval,
    onDelete,
    scopeIds,
    scopeLabel,
    partitionTree,
    onScopeChange,
    onScopeAll,
    onScopeFolder,
}: DashboardToolbarProps) {
    return (
        <div className="flex items-center gap-2 border-b pb-3">
            <Button
                variant={isEditing ? "default" : "outline"}
                size="sm"
                onClick={onToggleEdit}
            >
                <Pencil className="h-3 w-3 mr-1" />
                {isEditing ? "편집 완료" : "편집"}
            </Button>
            {isEditing && (
                <Button variant="outline" size="sm" onClick={onAddWidget}>
                    <Plus className="h-3 w-3 mr-1" /> 위젯 추가
                </Button>
            )}
            <Button variant="ghost" size="sm" onClick={onTogglePublic}>
                {isPublic ? (
                    <Globe className="h-3 w-3 mr-1" />
                ) : (
                    <Lock className="h-3 w-3 mr-1" />
                )}
                {isPublic ? "공개" : "비공개"}
            </Button>
            {isPublic && (
                <Button variant="ghost" size="sm" onClick={onCopyLink}>
                    <Link2 className="h-3 w-3 mr-1" /> 링크 복사
                </Button>
            )}
            <ScopePopover
                scopeIds={scopeIds}
                scopeLabel={scopeLabel}
                partitionTree={partitionTree}
                onScopeChange={onScopeChange}
                onScopeAll={onScopeAll}
                onScopeFolder={onScopeFolder}
            />
            <div className="ml-auto">
                <Badge variant="outline">
                    갱신: {refreshInterval}초
                </Badge>
            </div>
            <Button
                variant="ghost"
                size="sm"
                className="text-destructive"
                onClick={onDelete}
            >
                <Trash2 className="h-3 w-3" />
            </Button>
        </div>
    );
}
