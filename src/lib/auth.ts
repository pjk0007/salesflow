import { compare, hash } from "bcryptjs";
import jwt from "jsonwebtoken";
import type { NextApiRequest } from "next";
import type { NextRequest } from "next/server";
import type { JWTPayload } from "@/types";
import { db, apiTokens, apiTokenScopes, partitions, workspaces, folders } from "@/lib/db";
import { eq, and, gt, or, isNull } from "drizzle-orm";
import type { ApiTokenScope } from "@/lib/db";

const JWT_SECRET: string = (() => {
    const secret = process.env.JWT_SECRET;
    if (!secret) {
        throw new Error("JWT_SECRET 환경 변수가 설정되지 않았습니다.");
    }
    return secret;
})();
const TOKEN_EXPIRY = "30d";
const TOKEN_EXPIRY_MS = 30 * 24 * 60 * 60 * 1000;

export async function hashPassword(password: string): Promise<string> {
    return hash(password, 10);
}

export async function verifyPassword(password: string, hashedPassword: string): Promise<boolean> {
    return compare(password, hashedPassword);
}

export function generateToken(payload: JWTPayload): string {
    return jwt.sign(payload, JWT_SECRET, { expiresIn: TOKEN_EXPIRY });
}

export function verifyToken(token: string): JWTPayload | null {
    try {
        return jwt.verify(token, JWT_SECRET) as JWTPayload;
    } catch {
        return null;
    }
}

export function getTokenExpiry(token: string): number | null {
    try {
        const decoded = jwt.decode(token) as { exp?: number } | null;
        return decoded?.exp ? decoded.exp * 1000 : null;
    } catch {
        return null;
    }
}

export function getTokenExpiryMs(): number {
    return TOKEN_EXPIRY_MS;
}

export function getTokenFromRequest(req: NextApiRequest): string | null {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith("Bearer ")) {
        return authHeader.substring(7);
    }
    const token = req.cookies.token;
    return token || null;
}

export function getUserFromRequest(req: NextApiRequest): JWTPayload | null {
    const token = getTokenFromRequest(req);
    if (!token) return null;
    return verifyToken(token);
}

/**
 * App Router version of getUserFromRequest.
 * Reads JWT from NextRequest cookies or Authorization header.
 */
export function getUserFromNextRequest(req: NextRequest): JWTPayload | null {
    const authHeader = req.headers.get("authorization");
    if (authHeader && authHeader.startsWith("Bearer ")) {
        const token = authHeader.substring(7);
        return verifyToken(token);
    }
    const token = req.cookies.get("token")?.value;
    if (!token) return null;
    return verifyToken(token);
}

export async function verifyApiToken(token: string, orgId: string): Promise<boolean> {
    try {
        const [apiToken] = await db
            .select()
            .from(apiTokens)
            .where(
                and(
                    eq(apiTokens.token, token),
                    eq(apiTokens.orgId, orgId),
                    eq(apiTokens.isActive, 1),
                    or(isNull(apiTokens.expiresAt), gt(apiTokens.expiresAt, new Date()))
                )
            );

        if (!apiToken) return false;

        await db
            .update(apiTokens)
            .set({ lastUsedAt: new Date() })
            .where(eq(apiTokens.id, apiToken.id));

        return true;
    } catch (error) {
        console.error("API token verification error:", error);
        return false;
    }
}

export function getApiTokenFromRequest(req: NextApiRequest): string | null {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith("Bearer ")) {
        return authHeader.substring(7);
    }
    const apiKey = req.headers["x-api-key"];
    if (apiKey && typeof apiKey === "string") {
        return apiKey;
    }
    return null;
}

export async function authenticateRequest(
    req: NextApiRequest
): Promise<{ type: "jwt"; user: JWTPayload } | { type: "api-token"; orgId: string } | null> {
    const jwtUser = getUserFromRequest(req);
    if (jwtUser) {
        return { type: "jwt", user: jwtUser };
    }

    const apiToken = getApiTokenFromRequest(req);
    if (apiToken) {
        // API 토큰의 경우, orgId를 헤더에서 가져옴
        const orgIdHeader = req.headers["x-org-id"];
        const orgId = orgIdHeader ? String(orgIdHeader) : "";
        if (orgId && await verifyApiToken(apiToken, orgId)) {
            return { type: "api-token", orgId };
        }
    }

    return null;
}

// ============================================
// External API Token Auth (App Router)
// ============================================

export interface ApiTokenInfo {
    id: number;
    orgId: string;
    scopes: ApiTokenScope[];
}

export function getApiTokenFromNextRequest(req: NextRequest): string | null {
    const authHeader = req.headers.get("authorization");
    if (authHeader && authHeader.startsWith("Bearer ")) {
        return authHeader.substring(7);
    }
    const apiKey = req.headers.get("x-api-key");
    return apiKey || null;
}

export async function resolveApiToken(tokenStr: string): Promise<ApiTokenInfo | null> {
    try {
        const [apiToken] = await db
            .select()
            .from(apiTokens)
            .where(
                and(
                    eq(apiTokens.token, tokenStr),
                    eq(apiTokens.isActive, 1),
                    or(isNull(apiTokens.expiresAt), gt(apiTokens.expiresAt, new Date()))
                )
            );

        if (!apiToken) return null;

        const scopes = await db
            .select()
            .from(apiTokenScopes)
            .where(eq(apiTokenScopes.tokenId, apiToken.id));

        await db
            .update(apiTokens)
            .set({ lastUsedAt: new Date() })
            .where(eq(apiTokens.id, apiToken.id));

        return { id: apiToken.id, orgId: apiToken.orgId, scopes };
    } catch (error) {
        console.error("API token resolution error:", error);
        return null;
    }
}

type Permission = "read" | "create" | "update" | "delete";

export async function checkTokenAccess(
    tokenInfo: ApiTokenInfo,
    partitionId: number,
    permission: Permission
): Promise<boolean> {
    const [partition] = await db
        .select({
            folderId: partitions.folderId,
            workspaceId: partitions.workspaceId,
            orgId: workspaces.orgId,
        })
        .from(partitions)
        .innerJoin(workspaces, eq(partitions.workspaceId, workspaces.id))
        .where(eq(partitions.id, partitionId));

    if (!partition) return false;

    // 토큰은 발급 조직 밖으로 나갈 수 없다 — scope 종류와 무관한 공통 경계
    if (partition.orgId !== tokenInfo.orgId) return false;

    for (const scope of tokenInfo.scopes) {
        if (!scope.permissions[permission]) continue;

        if (scope.scopeType === "org") return true;
        if (scope.scopeType === "partition" && scope.scopeId === partitionId) return true;
        if (scope.scopeType === "folder" && partition.folderId === scope.scopeId) return true;
        if (scope.scopeType === "workspace" && partition.workspaceId === scope.scopeId) return true;
    }
    return false;
}

export interface ScopeInput {
    scopeType: string;
    scopeId: number;
    permissions: { read: boolean; create: boolean; update: boolean; delete: boolean };
}

/**
 * 토큰 발급/수정 시 요청된 scope가 유효하고 해당 org에 속하는지 검증한다.
 * 통과하면 저장 가능한 형태(org 스코프는 scopeId를 0으로 정규화)를 돌려주고,
 * 실패하면 사용자에게 보여줄 에러 메시지를 돌려준다.
 */
export async function validateTokenScopes(
    scopes: ScopeInput[],
    orgId: string
): Promise<{ ok: true; scopes: ScopeInput[] } | { ok: false; error: string }> {
    const normalized: ScopeInput[] = [];

    for (const scope of scopes) {
        if (!["org", "workspace", "folder", "partition"].includes(scope.scopeType)) {
            return { ok: false, error: `유효하지 않은 범위 유형: ${scope.scopeType}` };
        }

        // org 스코프는 토큰의 orgId 자체가 범위라 대상 검증이 없다
        if (scope.scopeType === "org") {
            normalized.push({ ...scope, scopeId: 0 });
            continue;
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
            if (!p) return { ok: false, error: "파티션을 찾을 수 없습니다." };
        }

        normalized.push(scope);
    }

    return { ok: true, scopes: normalized };
}
