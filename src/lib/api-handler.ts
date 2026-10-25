import { NextRequest, NextResponse } from "next/server";
import { getActiveUserFromNextRequest } from "@/lib/auth";
import { hasMinRole } from "@/lib/auth-admin-rules";
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

/**
 * API route wrapper — 인증 체크(getActiveUserFromNextRequest: 현재 멤버십·DB 역할) + 역할 검증 + try/catch 에러 핸들링
 * (인증 DB 오류 500, 잘린 JSON 본문 400)
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
        try {
            // 인증 DB 오류도 try 안에서 한국어 JSON 500으로 — 401로 바꾸면 세션이 끊긴다
            const user = await getActiveUserFromNextRequest(req);
            if (!user) {
                return NextResponse.json(
                    { success: false, error: "인증이 필요합니다." },
                    { status: 401 }
                );
            }

            if (options?.minRole) {
                if (!hasMinRole(user.role, options.minRole)) {
                    return NextResponse.json(
                        { success: false, error: "접근 권한이 없습니다." },
                        { status: 403 }
                    );
                }
            }

            const params = context?.params ? await context.params : undefined;
            return await handler(req, user, params);
        } catch (error) {
            // handler 안의 req.json()이 잘린 본문에서 던지는 SyntaxError는 서버 오류가 아니라 입력 오류다
            // (본문을 읽지 않은 채 난 SyntaxError — 저장값 JSON.parse 등 — 는 서버 오류로 남긴다)
            if (error instanceof SyntaxError && req.bodyUsed) {
                return NextResponse.json(
                    { success: false, error: "요청 본문을 확인해주세요." },
                    { status: 400 }
                );
            }
            console.error(`API error [${req.method} ${req.nextUrl.pathname}]:`, error);
            return NextResponse.json(
                { success: false, error: "서버 오류가 발생했습니다." },
                { status: 500 }
            );
        }
    };
}
