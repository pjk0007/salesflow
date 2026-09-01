import { useMemo, useState } from "react";
import { toast } from "sonner";
import { useWorkspaces } from "@/hooks/useWorkspaces";
import {
    useMemberScopes,
    type MemberScopeItem,
    type MemberScopeType,
    type ScopePermissions,
} from "@/hooks/useMemberScopes";
import { defaultFetcher } from "@/lib/swr-fetcher";
import useSWR from "swr";
import type { Folder, Partition } from "@/lib/db";

/** 권한 조합을 이름 있는 단계로 묶는다 — 체크박스 4개를 매번 고르지 않게. */
export type PermissionLevel = "full" | "edit" | "read" | "custom";

export const PERMISSION_LEVELS: { value: PermissionLevel; label: string; hint: string }[] = [
    { value: "full", label: "모든 권한", hint: "조회·생성·수정·삭제" },
    { value: "edit", label: "편집 가능", hint: "조회·생성·수정 (삭제 불가)" },
    { value: "read", label: "조회만", hint: "보기만 가능" },
];

/**
 * 새 파티션·폴더를 만들 수 있는 것은 워크스페이스 권한뿐이다.
 * 폴더·파티션 scope의 "생성"은 그 안의 레코드 생성만 뜻한다 — 화면에서 구분해 보여준다.
 */
export function createHint(scopeType: MemberScopeType): string | null {
    return scopeType === "workspace"
        ? "'생성'에 파티션·폴더 만들기가 포함됩니다"
        : "'생성'은 레코드 추가만 해당됩니다";
}

const LEVEL_PERMISSIONS: Record<Exclude<PermissionLevel, "custom">, ScopePermissions> = {
    full: { read: true, create: true, update: true, delete: true },
    edit: { read: true, create: true, update: true, delete: false },
    read: { read: true, create: false, update: false, delete: false },
};

export function permissionsToLevel(p: ScopePermissions): PermissionLevel {
    for (const [level, preset] of Object.entries(LEVEL_PERMISSIONS)) {
        if (
            preset.read === p.read &&
            preset.create === p.create &&
            preset.update === p.update &&
            preset.delete === p.delete
        ) {
            return level as PermissionLevel;
        }
    }
    return "custom";
}

export function levelToPermissions(level: Exclude<PermissionLevel, "custom">): ScopePermissions {
    return LEVEL_PERMISSIONS[level];
}

interface PartitionTree {
    folders: (Folder & { partitions: Partition[] })[];
    ungrouped: Partition[];
}

export interface TreeNode {
    key: string;
    scopeType: MemberScopeType;
    scopeId: number;
    name: string;
    depth: number;
    /** 이 노드에 직접 걸린 scope. 없으면 null. */
    scope: MemberScopeItem | null;
    /** 상위에서 상속받아 이미 접근 가능한지 (직접 scope가 없어도). */
    inheritedFrom: string | null;
}

/**
 * 방금 부여한 상위 scope에 흡수되는 하위 scope를 찾는다.
 * workspace를 주면 그 안의 폴더·파티션 scope가, folder를 주면 그 폴더의 파티션 scope가 대상이다.
 */
function findRedundantScopes(
    granted: TreeNode,
    scopes: MemberScopeItem[],
    treeMap: Record<number, PartitionTree> | undefined
): MemberScopeItem[] {
    if (granted.scopeType === "partition") return [];

    if (granted.scopeType === "folder") {
        const partitionIds = new Set(
            Object.values(treeMap ?? {})
                .flatMap((t) => t.folders)
                .filter((f) => f.id === granted.scopeId)
                .flatMap((f) => f.partitions.map((p) => p.id))
        );
        return scopes.filter((s) => s.scopeType === "partition" && partitionIds.has(s.scopeId));
    }

    const tree = treeMap?.[granted.scopeId];
    if (!tree) return [];
    const folderIds = new Set(tree.folders.map((f) => f.id));
    const partitionIds = new Set([
        ...tree.folders.flatMap((f) => f.partitions.map((p) => p.id)),
        ...tree.ungrouped.map((p) => p.id),
    ]);
    return scopes.filter(
        (s) =>
            (s.scopeType === "folder" && folderIds.has(s.scopeId)) ||
            (s.scopeType === "partition" && partitionIds.has(s.scopeId))
    );
}

export function useMemberScopeTree({ open, userId }: { open: boolean; userId: string }) {
    const { scopes, isLoading, grantScopes, updateScope, revokeScope } = useMemberScopes(userId);
    const { workspaces } = useWorkspaces();
    const [busyKey, setBusyKey] = useState<string | null>(null);
    const [expanded, setExpanded] = useState<Set<number>>(new Set());

    // 열린 워크스페이스의 트리만 불러온다
    const { data: treeMap } = useSWR<Record<number, PartitionTree>>(
        open && workspaces.length > 0 ? ["member-scope-trees", workspaces.map((w) => w.id).join(",")] : null,
        async () => {
            const entries = await Promise.all(
                workspaces.map(async (w) => {
                    const res = await defaultFetcher(`/api/workspaces/${w.id}/partitions`);
                    return [w.id, res.data as PartitionTree] as const;
                })
            );
            return Object.fromEntries(entries);
        }
    );

    const nodes = useMemo<TreeNode[]>(() => {
        const scopeOf = (scopeType: MemberScopeType, scopeId: number) =>
            scopes.find((s) => s.scopeType === scopeType && s.scopeId === scopeId) ?? null;

        const out: TreeNode[] = [];
        for (const ws of workspaces) {
            const wsScope = scopeOf("workspace", ws.id);
            out.push({
                key: `workspace:${ws.id}`,
                scopeType: "workspace",
                scopeId: ws.id,
                name: ws.name,
                depth: 0,
                scope: wsScope,
                inheritedFrom: null,
            });

            if (!expanded.has(ws.id)) continue;
            const tree = treeMap?.[ws.id];
            if (!tree) continue;

            for (const folder of tree.folders) {
                const folderScope = scopeOf("folder", folder.id);
                out.push({
                    key: `folder:${folder.id}`,
                    scopeType: "folder",
                    scopeId: folder.id,
                    name: folder.name,
                    depth: 1,
                    scope: folderScope,
                    inheritedFrom: wsScope ? ws.name : null,
                });
                for (const p of folder.partitions) {
                    out.push({
                        key: `partition:${p.id}`,
                        scopeType: "partition",
                        scopeId: p.id,
                        name: p.name,
                        depth: 2,
                        scope: scopeOf("partition", p.id),
                        inheritedFrom: wsScope ? ws.name : folderScope ? folder.name : null,
                    });
                }
            }
            for (const p of tree.ungrouped) {
                out.push({
                    key: `partition:${p.id}`,
                    scopeType: "partition",
                    scopeId: p.id,
                    name: p.name,
                    depth: 1,
                    scope: scopeOf("partition", p.id),
                    inheritedFrom: wsScope ? ws.name : null,
                });
            }
        }
        return out;
    }, [workspaces, treeMap, scopes, expanded]);

    const toggleExpand = (workspaceId: number) => {
        setExpanded((prev) => {
            const next = new Set(prev);
            if (next.has(workspaceId)) next.delete(workspaceId);
            else next.add(workspaceId);
            return next;
        });
    };

    /**
     * 체크 = 기본 "모든 권한"으로 부여, 해제 = 회수.
     * 상위를 체크하면 하위의 개별 scope는 의미가 없어지므로 함께 정리한다 —
     * 남겨두면 상위를 해제했을 때 하위만 살아남아 화면과 실제가 어긋난다.
     */
    const handleToggleNode = async (node: TreeNode) => {
        setBusyKey(node.key);
        try {
            if (node.scope) {
                const result = await revokeScope(node.scope.id);
                if (!result.success) toast.error(result.error ?? "권한 회수에 실패했습니다.");
                return;
            }

            const result = await grantScopes(userId, [
                {
                    scopeType: node.scopeType,
                    scopeId: node.scopeId,
                    permissions: levelToPermissions("full"),
                },
            ]);
            if (!result.success) {
                toast.error(result.error ?? "권한 부여에 실패했습니다.");
                return;
            }

            // scopes는 이 렌더 시점의 스냅샷이다. 방금 부여한 상위 scope는 어차피
            // 정리 대상이 아니므로(자기 자신은 제외) 스냅샷으로 충분하다.
            const redundant = findRedundantScopes(node, scopes, treeMap);
            for (const scope of redundant) {
                const revoked = await revokeScope(scope.id);
                if (!revoked.success) {
                    toast.error(
                        revoked.error ?? `'${scope.scopeName}'의 하위 권한 정리에 실패했습니다.`
                    );
                    return;
                }
            }
        } finally {
            setBusyKey(null);
        }
    };

    const handleChangeLevel = async (node: TreeNode, level: Exclude<PermissionLevel, "custom">) => {
        if (!node.scope) return;
        setBusyKey(node.key);
        try {
            const result = await updateScope(node.scope.id, levelToPermissions(level));
            if (!result.success) toast.error(result.error ?? "권한 변경에 실패했습니다.");
        } finally {
            setBusyKey(null);
        }
    };

    const handleTogglePermission = async (node: TreeNode, key: keyof ScopePermissions) => {
        if (!node.scope) return;
        const next = { ...node.scope.permissions, [key]: !node.scope.permissions[key] };
        setBusyKey(node.key);
        try {
            const result = await updateScope(node.scope.id, next);
            if (!result.success) toast.error(result.error ?? "권한 변경에 실패했습니다.");
        } finally {
            setBusyKey(null);
        }
    };

    return {
        nodes,
        scopes,
        isLoading,
        busyKey,
        expanded,
        toggleExpand,
        handleToggleNode,
        handleChangeLevel,
        handleTogglePermission,
        hasAnyScope: scopes.length > 0,
    };
}
