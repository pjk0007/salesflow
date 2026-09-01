"use client";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { ChevronRight, ChevronDown, Loader2, Folder, Database, Layers } from "lucide-react";
import {
    useMemberScopeTree,
    permissionsToLevel,
    PERMISSION_LEVELS,
    type PermissionLevel,
    type TreeNode,
} from "./hooks/useMemberScopeTree";
import type { ScopePermissions } from "@/hooks/useMemberScopes";

const PERMISSION_LABELS: Record<keyof ScopePermissions, string> = {
    read: "조회",
    create: "생성",
    update: "수정",
    delete: "삭제",
};

const ICONS = {
    workspace: Layers,
    folder: Folder,
    partition: Database,
} as const;

interface MemberScopeDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    userId: string;
    userName: string;
}

export function MemberScopeDialog({ open, onOpenChange, userId, userName }: MemberScopeDialogProps) {
    const {
        nodes,
        isLoading,
        busyKey,
        expanded,
        toggleExpand,
        handleToggleNode,
        handleChangeLevel,
        handleTogglePermission,
        hasAnyScope,
    } = useMemberScopeTree({ open, userId });

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-3xl">
                <DialogHeader>
                    <DialogTitle>{userName}님의 접근 권한</DialogTitle>
                    <DialogDescription>
                        체크하지 않은 곳은 <b>모든 멤버가 접근할 수 있습니다.</b> 체크하는 순간 그 대상은 권한을 받은
                        멤버에게만 열립니다. 상위를 체크하면 하위가 모두 포함됩니다.
                    </DialogDescription>
                </DialogHeader>

                <div className="max-h-[55vh] overflow-y-auto rounded-md border">
                    {isLoading ? (
                        <p className="p-6 text-sm text-muted-foreground">불러오는 중…</p>
                    ) : nodes.length === 0 ? (
                        <p className="p-6 text-sm text-muted-foreground">워크스페이스가 없습니다.</p>
                    ) : (
                        <ul className="divide-y">
                            {nodes.map((node) => (
                                <TreeRow
                                    key={node.key}
                                    node={node}
                                    busy={busyKey === node.key}
                                    isExpanded={node.scopeType === "workspace" && expanded.has(node.scopeId)}
                                    onExpand={() => toggleExpand(node.scopeId)}
                                    onToggle={() => handleToggleNode(node)}
                                    onChangeLevel={(l) => handleChangeLevel(node, l)}
                                    onTogglePermission={(k) => handleTogglePermission(node, k)}
                                />
                            ))}
                        </ul>
                    )}
                </div>

                {!hasAnyScope && !isLoading && (
                    <p className="text-xs text-muted-foreground">
                        아직 추가 권한이 없습니다 — 데이터 조회·편집은 가능하지만 파티션을 만들거나 지울 수는 없습니다.
                    </p>
                )}

                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>
                        닫기
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

interface TreeRowProps {
    node: TreeNode;
    busy: boolean;
    isExpanded: boolean;
    onExpand: () => void;
    onToggle: () => void;
    onChangeLevel: (level: Exclude<PermissionLevel, "custom">) => void;
    onTogglePermission: (key: keyof ScopePermissions) => void;
}

function TreeRow({
    node,
    busy,
    isExpanded,
    onExpand,
    onToggle,
    onChangeLevel,
    onTogglePermission,
}: TreeRowProps) {
    const Icon = ICONS[node.scopeType];
    const level = node.scope ? permissionsToLevel(node.scope.permissions) : null;
    const isWorkspace = node.scopeType === "workspace";

    return (
        <li className="px-3 py-2">
            <div className="flex items-center gap-2" style={{ paddingLeft: node.depth * 20 }}>
                {isWorkspace ? (
                    <button
                        type="button"
                        onClick={onExpand}
                        className="p-0.5 text-muted-foreground hover:text-foreground"
                        aria-label={isExpanded ? "접기" : "펼치기"}
                    >
                        {isExpanded ? (
                            <ChevronDown className="h-4 w-4" />
                        ) : (
                            <ChevronRight className="h-4 w-4" />
                        )}
                    </button>
                ) : (
                    <span className="w-5" />
                )}

                <Checkbox
                    checked={node.scope !== null || node.inheritedFrom !== null}
                    onCheckedChange={onToggle}
                    // 상위에서 상속 중이면 개별 해제가 불가능하다 — 상위를 풀어야 한다
                    disabled={busy || node.inheritedFrom !== null}
                />

                <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="truncate text-sm">{node.name}</span>

                {busy && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}

                {!node.scope && node.inheritedFrom && (
                    <span className="ml-auto text-xs text-muted-foreground">
                        {node.inheritedFrom}에서 상속됨
                    </span>
                )}

                {node.scope && (
                    <div className="ml-auto flex items-center gap-2">
                        {level === "custom" ? (
                            <div className="flex items-center gap-2">
                                {(Object.keys(PERMISSION_LABELS) as (keyof ScopePermissions)[]).map((k) => (
                                    <label key={k} className="flex items-center gap-1 text-xs">
                                        <Checkbox
                                            checked={node.scope!.permissions[k]}
                                            onCheckedChange={() => onTogglePermission(k)}
                                            disabled={busy}
                                        />
                                        {PERMISSION_LABELS[k]}
                                    </label>
                                ))}
                            </div>
                        ) : (
                            <Select
                                value={level ?? "full"}
                                onValueChange={(v) => {
                                    if (v === "full" || v === "edit" || v === "read") onChangeLevel(v);
                                }}
                            >
                                <SelectTrigger className="h-8 w-[150px] text-xs">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {PERMISSION_LEVELS.map((l) => (
                                        <SelectItem key={l.value} value={l.value}>
                                            <span className="flex flex-col items-start">
                                                <span>{l.label}</span>
                                                <span className="text-xs text-muted-foreground">{l.hint}</span>
                                            </span>
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        )}
                    </div>
                )}
            </div>
        </li>
    );
}
