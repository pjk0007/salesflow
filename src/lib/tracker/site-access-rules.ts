import type { Permission, ScopePermissions } from "@/lib/partition-access-rules";

/**
 * API 토큰 스코프 → 접근 가능한 워크스페이스 판정. DB를 모르는 순수 함수.
 *
 * 트래커는 도메인(사이트) 단위라 파티션과 축이 맞지 않는다. 다만
 * tracker_sites가 workspaceId를 갖고 워크스페이스당 사이트가 1개이므로,
 * 스코프를 워크스페이스로 해석하면 곧 사이트 접근 판정이 된다.
 */

/** 판정에 필요한 scope의 최소 형태. DB row(ApiTokenScope)가 구조적으로 만족한다. */
export interface TokenScopeLike {
    /** DB가 varchar라 string. 미지 값은 default 분기에서 fail-closed로 떨어진다. */
    scopeType: string;
    scopeId: number;
    permissions: ScopePermissions;
}

/**
 * folder/partition scope의 scopeId → 그 대상이 속한 workspaceId.
 * DB 어댑터가 채운다. 키에 해당하는 행이 없으면(삭제됨) 그 scope는 아무것도 못 연다.
 */
export interface ScopeWorkspaceLookup {
    folderWorkspaceId: ReadonlyMap<number, number>;
    partitionWorkspaceId: ReadonlyMap<number, number>;
}

/**
 * 토큰이 열 수 있는 워크스페이스 범위.
 *
 * null이나 특수값을 쓰지 않는 이유: "전체"와 "없음"이 falsy로 뭉개지면 안 된다.
 * 판별 유니온이면 분기를 빠뜨렸을 때 컴파일이 실패한다.
 */
export type WorkspaceScopeResult =
    | { kind: "all" }
    | { kind: "some"; ids: ReadonlySet<number> };

/**
 * 토큰 스코프에서 접근 가능한 워크스페이스 범위를 구한다.
 *
 * folder/partition 스코프는 상위 워크스페이스로 타고 올라간다 — 파티션은
 * 워크스페이스 안에서 데이터를 세부 관리하는 단위이고 트래커 데이터는 결국
 * 그 리드들이 만든 것이므로, "파티션을 볼 수 있으면 그 유입 경로도 본다"가 일관된다.
 * 의도적인 권한 확대이며 트래커 툴이 조회 전용이라 대가가 읽기에 한정된다.
 */
export function resolveScopeWorkspaces(
    scopes: readonly TokenScopeLike[],
    lookup: ScopeWorkspaceLookup,
    permission: Permission = "read"
): WorkspaceScopeResult {
    const ids = new Set<number>();

    for (const scope of scopes) {
        // 권한 비트를 scopeType보다 먼저 본다 — read 없는 org 스코프가 전체를 열면 안 된다
        if (!scope.permissions[permission]) continue;

        switch (scope.scopeType) {
            case "org":
                // 이미 최대 범위라 나머지를 볼 필요가 없다
                return { kind: "all" };
            case "workspace":
                ids.add(scope.scopeId);
                break;
            case "folder": {
                const workspaceId = lookup.folderWorkspaceId.get(scope.scopeId);
                if (workspaceId !== undefined) ids.add(workspaceId);
                break;
            }
            case "partition": {
                const workspaceId = lookup.partitionWorkspaceId.get(scope.scopeId);
                if (workspaceId !== undefined) ids.add(workspaceId);
                break;
            }
            default:
                // 알 수 없는 scopeType은 아무것도 열지 않는다
                break;
        }
    }

    return { kind: "some", ids };
}

/** 워크스페이스 범위가 특정 workspaceId를 포함하는가. 단일 사이트 판정의 단일 정의. */
export function scopeAllowsWorkspace(result: WorkspaceScopeResult, workspaceId: number): boolean {
    return result.kind === "all" || result.ids.has(workspaceId);
}

/** 목록에서 접근 가능한 사이트만 남긴다. scopeAllowsWorkspace를 건별 호출한 것과 결과가 같다. */
export function filterAccessibleSites<T extends { workspaceId: number }>(
    sites: readonly T[],
    result: WorkspaceScopeResult
): T[] {
    if (result.kind === "all") return [...sites];
    return sites.filter((site) => result.ids.has(site.workspaceId));
}
