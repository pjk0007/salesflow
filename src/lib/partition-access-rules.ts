import type { OrgRole } from "@/types";

export type Permission = "read" | "create" | "update" | "delete";
export type ScopeType = "org" | "workspace" | "folder" | "partition";

export interface ScopePermissions {
    read: boolean;
    create: boolean;
    update: boolean;
    delete: boolean;
}

/** 판정에 필요한 scope의 최소 형태. DB row(MemberScope)가 구조적으로 이 타입을 만족한다. */
export interface ScopeLike {
    userId: string;
    scopeType: string;
    scopeId: number;
    permissions: ScopePermissions;
}

/** 판정 대상 파티션의 계층 위치. */
export interface PartitionLocation {
    id: number;
    folderId: number | null;
    workspaceId: number;
}

export interface AccessUser {
    userId: string;
    role: OrgRole;
}

export interface AccessInput {
    user: AccessUser;
    partition: PartitionLocation;
    permission: Permission;
    /**
     * true면 allow 기본을 끈다 — 덮는 scope가 없어도 통과시키지 않는다.
     * 구조 변경(파티션·폴더의 이름 변경·삭제)에 쓴다. 데이터 접근과 달리
     * "아무도 권한을 안 걸었으니 누구나 지워도 된다"는 성립하지 않는다.
     */
    denyByDefault?: boolean;
    /**
     * 이 파티션을 덮을 가능성이 있는 조직 내 scope 전부 (사용자 필터 없음).
     * allow 기본은 "이 파티션을 덮는 scope가 조직에 하나도 없으면 통과"라서
     * 타인의 scope까지 있어야 판정할 수 있다.
     * 이 목록은 이미 org 경계로 걸러진 상태여야 한다 — 이 함수는 org를 검사하지 않는다.
     */
    orgScopes: readonly ScopeLike[];
}

/** scope 한 건이 특정 파티션을 덮는지. 계층 상속 규칙의 단일 정의. */
export function scopeCoversPartition(scope: ScopeLike, partition: PartitionLocation): boolean {
    switch (scope.scopeType) {
        case "org":
            return true;
        case "workspace":
            return partition.workspaceId === scope.scopeId;
        case "folder":
            // 미분류 파티션이 scopeId 0인 folder scope와 맞물리지 않도록 null을 먼저 배제
            return partition.folderId !== null && partition.folderId === scope.scopeId;
        case "partition":
            return partition.id === scope.scopeId;
        default:
            return false;
    }
}

/**
 * 파티션 접근 허용 여부. DB를 보지 않는 순수 함수.
 *
 * 1) owner/admin → 통과
 * 2) 이 파티션을 덮는 scope가 조직에 하나도 없음 → 통과 (allow 기본)
 * 3) 덮는 scope 중 내 것이면서 해당 permission 비트가 켜진 게 있음 → 통과
 * 4) 그 외 → 차단
 */
export function canAccessPartition({
    user,
    partition,
    permission,
    orgScopes,
    denyByDefault = false,
}: AccessInput): boolean {
    if (user.role === "owner" || user.role === "admin") return true;

    let covered = false;
    for (const scope of orgScopes) {
        if (!scopeCoversPartition(scope, partition)) continue;
        // 누가 가진 scope든 이 파티션을 제한 모드로 전환시킨다
        covered = true;
        if (scope.userId === user.userId && scope.permissions[permission]) return true;
    }

    return denyByDefault ? false : !covered;
}

export interface CreateInWorkspaceInput {
    user: AccessUser;
    workspaceId: number;
    /** 조직 내 scope 전부. 여기서는 "내 scope"만 보므로 타인 것이 섞여 있어도 무해하다. */
    orgScopes: readonly ScopeLike[];
}

/**
 * 워크스페이스 안에 구조(파티션·폴더)를 새로 만들 수 있는지.
 *
 * canAccessPartition과 달리 **allow 기본이 아니다.** 대상이 아직 존재하지 않으므로
 * "덮는 scope가 없으면 통과" 규칙을 적용할 수 없고, 적용하면 권한을 받지 않은
 * member 전원이 파티션을 만들 수 있게 된다. 명시적으로 받은 사람만 통과시킨다.
 *
 * 워크스페이스에 무언가를 추가하는 일이므로 org 또는 그 workspace scope만 인정한다 —
 * 개별 파티션·폴더 권한은 그 대상 안에서의 권한이지 상위에 추가할 권한이 아니다.
 */
export function canCreateInWorkspace({ user, workspaceId, orgScopes }: CreateInWorkspaceInput): boolean {
    if (user.role === "owner" || user.role === "admin") return true;

    return orgScopes.some(
        (scope) =>
            scope.userId === user.userId &&
            scope.permissions.create &&
            (scope.scopeType === "org" ||
                (scope.scopeType === "workspace" && scope.scopeId === workspaceId))
    );
}

/** 목록에서 접근 가능한 파티션만 남긴다. canAccessPartition을 건별 호출한 것과 결과가 같다. */
export function filterAccessiblePartitions<T extends PartitionLocation>({
    user,
    partitions,
    permission,
    orgScopes,
}: {
    user: AccessUser;
    partitions: readonly T[];
    permission: Permission;
    orgScopes: readonly ScopeLike[];
}): T[] {
    if (user.role === "owner" || user.role === "admin") return [...partitions];

    return partitions.filter((partition) =>
        canAccessPartition({ user, partition, permission, orgScopes })
    );
}
