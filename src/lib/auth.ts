import { compare, hash } from "bcryptjs";
import jwt from "jsonwebtoken";
import type { NextApiRequest } from "next";
import type { JWTPayload } from "@/types";
import { db, apiTokens } from "@/lib/db";
import { eq, and, gt, or, isNull } from "drizzle-orm";

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
