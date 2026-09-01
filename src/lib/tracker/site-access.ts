import { and, eq, inArray } from "drizzle-orm";
import { db, folders, partitions, trackerSites, workspaces } from "@/lib/db";
import type { ApiTokenInfo } from "@/lib/auth";
import {
    filterAccessibleSites,
    resolveScopeWorkspaces,
    scopeAllowsWorkspace,
    type ScopeWorkspaceLookup,
    type TokenScopeLike,
} from "./site-access-rules";

export {
    resolveScopeWorkspaces,
    scopeAllowsWorkspace,
    filterAccessibleSites,
} from "./site-access-rules";
export type {
    TokenScopeLike,
    ScopeWorkspaceLookup,
    WorkspaceScopeResult,
} from "./site-access-rules";

/** 트래커 툴이 다루는 사이트의 최소 형태. apiKey는 절대 포함하지 않는다. */
export interface AccessibleSite {
    id: number;
    name: string;
    workspaceId: number;
    workspaceName: string;
    domains: string[];
    isActive: number;
    conversionStage: string | null;
    excludePaths: string[];
    createdAt: Date;
}

const SITE_COLUMNS = {
    id: trackerSites.id,
    name: trackerSites.name,
    workspaceId: trackerSites.workspaceId,
    workspaceName: workspaces.name,
    domains: trackerSites.domains,
    isActive: trackerSites.isActive,
    conversionStage: trackerSites.conversionStage,
    excludePaths: trackerSites.excludePaths,
    createdAt: trackerSites.createdAt,
};

/**
 * scope의 folder/partition id → workspaceId 매핑을 DB에서 채운다.
 * org/workspace 스코프만 있으면 쿼리를 아예 하지 않는다 — 실사용 대부분이 그 경우다.
 */
export async function loadScopeWorkspaceLookup(
    scopes: readonly TokenScopeLike[]
): Promise<ScopeWorkspaceLookup> {
    const folderIds = scopes.filter((s) => s.scopeType === "folder").map((s) => s.scopeId);
    const partitionIds = scopes.filter((s) => s.scopeType === "partition").map((s) => s.scopeId);

    const [folderRows, partitionRows] = await Promise.all([
        folderIds.length
            ? db
                  .select({ id: folders.id, workspaceId: folders.workspaceId })
                  .from(folders)
                  .where(inArray(folders.id, folderIds))
            : Promise.resolve([]),
        partitionIds.length
            ? db
                  .select({ id: partitions.id, workspaceId: partitions.workspaceId })
                  .from(partitions)
                  .where(inArray(partitions.id, partitionIds))
            : Promise.resolve([]),
    ]);

    return {
        folderWorkspaceId: new Map(folderRows.map((r) => [r.id, r.workspaceId])),
        partitionWorkspaceId: new Map(partitionRows.map((r) => [r.id, r.workspaceId])),
    };
}

/** 토큰이 조회 가능한 사이트 전부. org 경계 + 스코프 필터를 모두 통과한 것만. */
export async function listAccessibleTrackerSites(tokenInfo: ApiTokenInfo): Promise<AccessibleSite[]> {
    const sites = await db
        .select(SITE_COLUMNS)
        .from(trackerSites)
        .innerJoin(workspaces, eq(workspaces.id, trackerSites.workspaceId))
        .where(eq(trackerSites.orgId, tokenInfo.orgId));

    const lookup = await loadScopeWorkspaceLookup(tokenInfo.scopes);
    const scope = resolveScopeWorkspaces(tokenInfo.scopes, lookup, "read");
    return filterAccessibleSites(sites, scope);
}

export type SiteResolution =
    | { ok: true; site: AccessibleSite }
    | { ok: false; reason: "not_found" | "forbidden"; error: string };

/**
 * 단일 사이트 조회 + 접근 판정. 트래커 툴 전부가 첫 줄에서 이걸 부른다.
 *
 * 타 조직 siteId는 forbidden이 아니라 not_found를 낸다 — "권한 없음"을 주면
 * 그 id가 실재한다는 사실이 새어 나간다(존재 탐침).
 */
export async function resolveTrackerSiteForToken(
    tokenInfo: ApiTokenInfo,
    siteId: number
): Promise<SiteResolution> {
    const [site] = await db
        .select(SITE_COLUMNS)
        .from(trackerSites)
        .innerJoin(workspaces, eq(workspaces.id, trackerSites.workspaceId))
        .where(and(eq(trackerSites.id, siteId), eq(trackerSites.orgId, tokenInfo.orgId)));

    if (!site) {
        return { ok: false, reason: "not_found", error: "트래커를 찾을 수 없습니다." };
    }

    const lookup = await loadScopeWorkspaceLookup(tokenInfo.scopes);
    const scope = resolveScopeWorkspaces(tokenInfo.scopes, lookup, "read");

    if (!scopeAllowsWorkspace(scope, site.workspaceId)) {
        return { ok: false, reason: "forbidden", error: "이 트래커에 대한 접근 권한이 없습니다." };
    }

    return { ok: true, site };
}
