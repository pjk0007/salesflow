import { NextRequest, NextResponse } from "next/server";
import { getUserFromNextRequest } from "@/lib/auth";
import type { JWTPayload } from "@/types";

type ApiHandler = (
    req: NextRequest,
    user: JWTPayload,
    params?: Record<string, string>
) => Promise<NextResponse>;

interface ApiHandlerOptions {
    /** 최소 역할. "admin" | "owner" 지정 시 member 접근 차단 */
    minRole?: "admin" | "owner";
}

const roleOrder: Record<string, number> = { member: 0, admin: 1, owner: 2 };

/**
 * API route wrapper — 인증 체크 + 역할 검증 + try/catch 에러 핸들링
 *
 * @example
 * // 기본 사용 (인증만)
 * export const GET = withAuth(async (req, user) => {
 *     const data = await db.select()...;
 *     return NextResponse.json({ success: true, data });
 * });
 *
 * // 역할 체크 + dynamic route params
 * export const PUT = withAuth(async (req, user, params) => {
 *     const id = Number(params?.id);
 *     // ...
 * }, { minRole: "admin" });
 */
export function withAuth(handler: ApiHandler, options?: ApiHandlerOptions) {
    return async (
        req: NextRequest,
        context?: { params: Promise<Record<string, string>> }
    ) => {
        const user = getUserFromNextRequest(req);
        if (!user) {
            return NextResponse.json(
                { success: false, error: "인증이 필요합니다." },
                { status: 401 }
            );
        }

        if (options?.minRole) {
            const userLevel = roleOrder[user.role] ?? 0;
            const requiredLevel = roleOrder[options.minRole];
            if (userLevel < requiredLevel) {
                return NextResponse.json(
                    { success: false, error: "접근 권한이 없습니다." },
                    { status: 403 }
                );
            }
        }

        try {
            const params = context?.params ? await context.params : undefined;
            return await handler(req, user, params);
        } catch (error) {
            console.error(`API error [${req.method} ${req.nextUrl.pathname}]:`, error);
            return NextResponse.json(
                { success: false, error: "서버 오류가 발생했습니다." },
                { status: 500 }
            );
        }
    };
}
