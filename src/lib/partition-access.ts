import { and, eq, or } from "drizzle-orm";
import {
    db,
    folders,
    memberScopes,
    organizationMembers,
    partitions,
    records,
    workspaces,
    type Folder,
    type Partition,
    type Workspace,
} from "@/lib/db";
import type { JWTPayload } from "@/types";
import {
    canAccessPartition,
    canCreateInWorkspace,
    type Permission,
    type ScopeLike,
    type ScopePermissions,
    type ScopeType,
} from "./partition-access-rules";

export {
    canAccessPartition,
    canCreateInWorkspace,
    scopeCoversPartition,
    filterAccessiblePartitions,
} from "./partition-access-rules";
export type {
    Permission,
    ScopeType,
    ScopePermissions,
    ScopeLike,
    PartitionLocation,
    AccessUser,
} from "./partition-access-rules";

type RecordRow = typeof records.$inferSelect;

/** 권한 판정에 필요한 요청자 정보. */
type RequestUser = Pick<JWTPayload, "userId" | "orgId" | "role">;

export type AccessResult =
    | { ok: true; partition: Partition; workspace: Workspace }
    | { ok: false; status: 404 | 403; error: string };

export type RecordAccessResult =
    | { ok: true; record: RecordRow; partition: Partition }
    | { ok: false; status: 404 | 403; error: string };

const NOT_FOUND = "파티션을 찾을 수 없습니다." as const;
const FORBIDDEN = "이 파티션에 대한 권한이 없습니다." as const;

/**
 * 특정 파티션을 덮을 수 있는 scope만 조회한다.
 * 전체 org scope를 끌어오지 않고 org/workspace/folder/partition 4가지 경우로 좁힌다.
 */
async function loadCoveringScopes(
    orgId: string,
    partition: { id: number; folderId: number | null; workspaceId: number }
): Promise<ScopeLike[]> {
    const folderCondition =
        partition.folderId !== null
            ? [and(eq(memberScopes.scopeType, "folder"), eq(memberScopes.scopeId, partition.folderId))]
            : [];

    return db
        .select({
            userId: memberScopes.userId,
            scopeType: memberScopes.scopeType,
            scopeId: memberScopes.scopeId,
            permissions: memberScopes.permissions,
        })
        .from(memberScopes)
        .where(
            and(
                eq(memberScopes.orgId, orgId),
                or(
                    eq(memberScopes.scopeType, "org"),
                    and(
                        eq(memberScopes.scopeType, "workspace"),
                        eq(memberScopes.scopeId, partition.workspaceId)
                    ),
                    and(eq(memberScopes.scopeType, "partition"), eq(memberScopes.scopeId, partition.id)),
                    ...folderCondition
                )
            )
        );
}

/** 조직의 member scope 전량. 목록 API에서 1회만 호출해 N+1을 피한다. */
export async function loadOrgScopes(orgId: string): Promise<ScopeLike[]> {
    return db
        .select({
            userId: memberScopes.userId,
            scopeType: memberScopes.scopeType,
            scopeId: memberScopes.scopeId,
            permissions: memberScopes.permissions,
        })
        .from(memberScopes)
        .where(eq(memberScopes.orgId, orgId));
}

export type WorkspaceCreateResult =
    | { ok: true; workspace: Workspace }
    | { ok: false; status: 404 | 403; error: string };

/**
 * 워크스페이스 안에 파티션·폴더를 만들 수 있는지 검증한다.
 * 데이터 접근과 달리 allow 기본이 아니라서, 권한이 없는 member는 기존처럼 403을 받는다.
 */
export async function requireWorkspaceCreateAccess(
    user: RequestUser,
    workspaceId: number
): Promise<WorkspaceCreateResult> {
    const [workspace] = await db
        .select()
        .from(workspaces)
        .where(and(eq(workspaces.id, workspaceId), eq(workspaces.orgId, user.orgId)));

    if (!workspace) {
        return { ok: false, status: 404, error: "워크스페이스를 찾을 수 없습니다." };
    }

    if (user.role !== "member") return { ok: true, workspace };

    const orgScopes = await db
        .select({
            userId: memberScopes.userId,
            scopeType: memberScopes.scopeType,
            scopeId: memberScopes.scopeId,
            permissions: memberScopes.permissions,
        })
        .from(memberScopes)
        .where(and(eq(memberScopes.orgId, user.orgId), eq(memberScopes.userId, user.userId)));

    if (!canCreateInWorkspace({ user, workspaceId, orgScopes })) {
        return { ok: false, status: 403, error: "이 워크스페이스에 만들 권한이 없습니다." };
    }

    return { ok: true, workspace };
}

export type FolderAccessResult =
    | { ok: true; folder: Folder; workspace: Workspace }
    | { ok: false; status: 404 | 403; error: string };

/**
 * 폴더 수정/삭제 권한 검증.
 * 그 폴더를 덮는 scope(org / 상위 workspace / 그 folder)로 판정하며, 파티션과 같은 allow 기본을 따른다.
 */
export async function requireFolderAccess(
    user: RequestUser,
    folderId: number,
    permission: Permission
): Promise<FolderAccessResult> {
    const [row] = await db
        .select({ folder: folders, workspace: workspaces })
        .from(folders)
        .innerJoin(workspaces, eq(folders.workspaceId, workspaces.id))
        .where(and(eq(folders.id, folderId), eq(workspaces.orgId, user.orgId)));

    if (!row) return { ok: false, status: 404, error: "폴더를 찾을 수 없습니다." };

    if (user.role !== "member") {
        return { ok: true, folder: row.folder, workspace: row.workspace };
    }

    const covering = await db
        .select({
            userId: memberScopes.userId,
            scopeType: memberScopes.scopeType,
            scopeId: memberScopes.scopeId,
            permissions: memberScopes.permissions,
        })
        .from(memberScopes)
        .where(
            and(
                eq(memberScopes.orgId, user.orgId),
                or(
                    eq(memberScopes.scopeType, "org"),
                    and(
                        eq(memberScopes.scopeType, "workspace"),
                        eq(memberScopes.scopeId, row.folder.workspaceId)
                    ),
                    and(eq(memberScopes.scopeType, "folder"), eq(memberScopes.scopeId, folderId))
                )
            )
        );

    // 폴더 자신을 가상의 파티션 위치로 두고 같은 판정 규칙을 태운다.
    // id를 -1로 두어도 안전한 이유: 위 쿼리가 partition 타입 scope를 아예 뽑지 않고,
    // validateMemberScopes가 실존 파티션만 저장하므로 scopeId가 음수인 행은 존재할 수 없다.
    // 폴더 수정·삭제는 구조 변경이므로 allow 기본을 끈다.
    const allowed = canAccessPartition({
        user,
        partition: { id: -1, folderId, workspaceId: row.folder.workspaceId },
        permission,
        orgScopes: covering,
        denyByDefault: true,
    });

    if (!allowed) {
        return { ok: false, status: 403, error: "이 폴더에 대한 권한이 없습니다." };
    }

    return { ok: true, folder: row.folder, workspace: row.workspace };
}

/**
 * 파티션 접근 검증의 단일 진입점.
 *
 * - 파티션이 없거나 요청자 org 밖이면 404 (존재 여부를 흘리지 않는다)
 * - org 안이지만 권한이 없으면 403
 */
export async function requirePartitionAccess(
    user: RequestUser,
    partitionId: number,
    permission: Permission,
    /** 구조 변경(이름 변경·삭제)이면 true — allow 기본을 끈다. */
    options?: { denyByDefault?: boolean }
): Promise<AccessResult> {
    const [row] = await db
        .select({ partition: partitions, workspace: workspaces })
        .from(partitions)
        .innerJoin(workspaces, eq(partitions.workspaceId, workspaces.id))
        .where(and(eq(partitions.id, partitionId), eq(workspaces.orgId, user.orgId)));

    if (!row) return { ok: false, status: 404, error: NOT_FOUND };

    // owner/admin은 어차피 통과하므로 scope 조회 자체를 건너뛴다
    if (user.role !== "member") {
        return { ok: true, partition: row.partition, workspace: row.workspace };
    }

    const location = {
        id: row.partition.id,
        folderId: row.partition.folderId,
        workspaceId: row.partition.workspaceId,
    };
    const orgScopes = await loadCoveringScopes(user.orgId, location);

    const allowed = canAccessPartition({
        user,
        partition: location,
        permission,
        orgScopes,
        denyByDefault: options?.denyByDefault,
    });
    if (!allowed) {
        return { ok: false, status: 403, error: FORBIDDEN };
    }

    return { ok: true, partition: row.partition, workspace: row.workspace };
}

/**
 * 레코드 id로 진입하는 경로의 검증.
 * org 경계는 records.orgId(FK 없는 비정규화 컬럼)가 아니라 workspaces.orgId로 판단한다 —
 * 권한 판정은 파티션 계층을 기준으로 해야 일관된다.
 */
export async function requireRecordAccess(
    user: RequestUser,
    recordId: number,
    permission: Permission
): Promise<RecordAccessResult> {
    const [row] = await db
        .select({ record: records, partition: partitions })
        .from(records)
        .innerJoin(partitions, eq(records.partitionId, partitions.id))
        .innerJoin(workspaces, eq(partitions.workspaceId, workspaces.id))
        .where(and(eq(records.id, recordId), eq(workspaces.orgId, user.orgId)));

    if (!row) return { ok: false, status: 404, error: "레코드를 찾을 수 없습니다." };

    if (user.role !== "member") {
        return { ok: true, record: row.record, partition: row.partition };
    }

    const location = {
        id: row.partition.id,
        folderId: row.partition.folderId,
        workspaceId: row.partition.workspaceId,
    };
    const orgScopes = await loadCoveringScopes(user.orgId, location);

    if (!canAccessPartition({ user, partition: location, permission, orgScopes })) {
        return { ok: false, status: 403, error: FORBIDDEN };
    }

    return { ok: true, record: row.record, partition: row.partition };
}

export interface MemberScopeInput {
    scopeType: string;
    scopeId: number;
    permissions: ScopePermissions;
}

export interface ValidatedMemberScope {
    scopeType: ScopeType;
    scopeId: number;
    permissions: ScopePermissions;
}

const SCOPE_TYPES: readonly string[] = ["org", "workspace", "folder", "partition"];

function isScopeType(value: string): value is ScopeType {
    return SCOPE_TYPES.includes(value);
}

function isScopePermissions(value: unknown): value is ScopePermissions {
    if (typeof value !== "object" || value === null) return false;
    const v = value as Record<string, unknown>;
    return (
        typeof v.read === "boolean" &&
        typeof v.create === "boolean" &&
        typeof v.update === "boolean" &&
        typeof v.delete === "boolean"
    );
}

/**
 * 부여/수정 시 요청 scope가 유효하고 해당 org에 속하는지 검증한다.
 * POST와 PUT이 반드시 같은 함수를 통과해야 한다 — 수정 API가 검증을 우회하는 결함을 막는다.
 */
export async function validateMemberScopes(
    scopes: MemberScopeInput[],
    orgId: string
): Promise<{ ok: true; scopes: ValidatedMemberScope[] } | { ok: false; error: string }> {
    if (scopes.length === 0) {
        return { ok: false, error: "부여할 권한 범위가 없습니다." };
    }

    const normalized: ValidatedMemberScope[] = [];

    for (const scope of scopes) {
        if (!isScopeType(scope.scopeType)) {
            return { ok: false, error: `유효하지 않은 범위 유형: ${scope.scopeType}` };
        }

        if (!isScopePermissions(scope.permissions)) {
            return { ok: false, error: "권한 값이 올바르지 않습니다." };
        }

        // org 스코프는 orgId 자체가 범위라 대상 검증이 없다
        if (scope.scopeType === "org") {
            normalized.push({ scopeType: "org", scopeId: 0, permissions: scope.permissions });
            continue;
        }

        if (!Number.isInteger(scope.scopeId)) {
            return { ok: false, error: "범위 대상이 올바르지 않습니다." };
        }

        if (scope.scopeType === "workspace") {
            const [ws] = await db
                .select({ id: workspaces.id })
                .from(workspaces)
                .where(and(eq(workspaces.id, scope.scopeId), eq(workspaces.orgId, orgId)));
            if (!ws) return { ok: false, error: "워크스페이스를 찾을 수 없습니다." };
        } else if (scope.scopeType === "folder") {
            const [f] = await db
                .select({ id: folders.id })
                .from(folders)
                .innerJoin(workspaces, eq(folders.workspaceId, workspaces.id))
                .where(and(eq(folders.id, scope.scopeId), eq(workspaces.orgId, orgId)));
            if (!f) return { ok: false, error: "폴더를 찾을 수 없습니다." };
        } else {
            const [p] = await db
                .select({ id: partitions.id })
                .from(partitions)
                .innerJoin(workspaces, eq(partitions.workspaceId, workspaces.id))
                .where(and(eq(partitions.id, scope.scopeId), eq(workspaces.orgId, orgId)));
            if (!p) return { ok: false, error: NOT_FOUND };
        }

        normalized.push({
            scopeType: scope.scopeType,
            scopeId: scope.scopeId,
            permissions: scope.permissions,
        });
    }

    return { ok: true, scopes: normalized };
}

/**
 * 권한 부여 대상 사용자가 이 조직의 member인지 검증한다.
 * 타 조직 사용자에게 scope를 심는 경로를 차단하고, 관리자에게는 부여를 막는다.
 */
export async function validateScopeTarget(
    targetUserId: string,
    orgId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
    const [member] = await db
        .select({ role: organizationMembers.role })
        .from(organizationMembers)
        .where(
            and(
                eq(organizationMembers.organizationId, orgId),
                eq(organizationMembers.userId, targetUserId)
            )
        );

    if (!member) return { ok: false, error: "조직에 속한 사용자가 아닙니다." };
    if (member.role !== "member") {
        return { ok: false, error: "관리자에게는 파티션 권한을 설정할 필요가 없습니다." };
    }

    return { ok: true };
}
