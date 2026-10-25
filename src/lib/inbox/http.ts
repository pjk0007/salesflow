import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getUserFromNextRequest } from "@/lib/auth";
import { InboxError } from "./repository";
import { rateLimit } from "@/lib/tracker/rate-limit";
import { inputErrorMessage, sameApplicationOrigin } from "./rules";
/**
 * 상담·고객 업무 라우트의 신원(JWT 서명)과 요청 출처만 확인한다. DB의 멤버십·권한 확인은 하지 않는다.
 * 계약: 이 결과를 받는 저장소 함수는 activeCustomerActor·requireCustomerAccess·requireCustomerChannel·ownedConversation 중
 * 하나를 반드시 거친다. 새 라우트가 이 중 아무것도 거치지 않으면 제거·비활성 직원의 토큰이 통과한다.
 */
export function inboxActor(req: NextRequest) {
    const user = getUserFromNextRequest(req);
    if (!user) throw new InboxError("인증이 필요합니다.", 401);
    if (
        req.method !== "GET" &&
        req.headers.get("origin") &&
        !sameApplicationOrigin(
            req.headers.get("origin")!,
            req.nextUrl.origin,
            process.env.NEXT_PUBLIC_APP_URL,
        )
    )
        throw new InboxError("허용되지 않은 요청입니다.", 403);
    return user;
}
export const ok = (data: unknown) =>
    NextResponse.json(
        { success: true, data },
        { headers: { "Cache-Control": "no-store" } },
    );
export async function handleInbox(action: () => Promise<unknown>) {
    try {
        return ok(await action());
    } catch (error) {
        if (error instanceof z.ZodError)
            return NextResponse.json(
                {
                    success: false,
                    error: inputErrorMessage(error),
                },
                { status: 400 },
            );
        if (error instanceof InboxError)
            return NextResponse.json(
                { success: false, error: error.message },
                { status: error.status },
            );
        if (error instanceof SyntaxError)
            return NextResponse.json(
                { success: false, error: "요청 형식을 확인해주세요." },
                { status: 400 },
            );
        console.error(
            "[inbox] 요청 처리 실패",
            error instanceof Error ? error.name : "unknown",
        );
        return NextResponse.json(
            {
                success: false,
                error: "상담 요청을 처리하지 못했습니다. 다시 시도해주세요.",
            },
            { status: 500 },
        );
    }
}
export async function jsonBody(req: NextRequest, maxCharacters = 16000) {
    const text = await req.text();
    if (text.length > maxCharacters) throw new InboxError("요청이 너무 큽니다.", 413);
    return JSON.parse(text);
}
export function publicGuard(req: NextRequest, key: string) {
    if (!/^[a-f0-9]{48}$/.test(key))
        throw new InboxError("상담창을 찾을 수 없습니다.", 404);
    // 외부 사이트는 iframe으로 설치한다. API는 iframe과 같은 출처에서만 호출한다.
    const origin = req.headers.get("origin");
    if (
        origin &&
        !sameApplicationOrigin(
            origin,
            req.nextUrl.origin,
            process.env.NEXT_PUBLIC_APP_URL,
        )
    )
        throw new InboxError("상담창에서 다시 시도해주세요.", 403);
    const ip =
        req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "unknown";
    if (
        !rateLimit(`inbox:${req.method}:${key}:${ip}`, {
            maxRequests: req.method === "GET" ? 240 : 40,
            windowMs: 60000,
        }).allowed
    )
        throw new InboxError("잠시 후 다시 시도해주세요.", 429);
}
export function visitorToken(req: NextRequest) {
    return req.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
}
