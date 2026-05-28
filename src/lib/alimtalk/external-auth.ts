import type { NextRequest } from "next/server";
import { getApiTokenFromNextRequest, resolveApiToken } from "@/lib/auth";
import type { ApiTokenInfo } from "@/lib/auth";

export async function authenticateExternalAlimtalk(
    req: NextRequest,
): Promise<ApiTokenInfo | null> {
    const tokenStr = getApiTokenFromNextRequest(req);
    if (!tokenStr) return null;
    return resolveApiToken(tokenStr);
}
