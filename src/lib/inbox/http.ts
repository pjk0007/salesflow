import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getUserFromNextRequest } from "@/lib/auth";
import { InboxError } from "./repository";
import { rateLimit } from "@/lib/tracker/rate-limit";
import { sameRequestOrigin } from "./rules";
export function inboxActor(req: NextRequest) {
    const user = getUserFromNextRequest(req);
    if (!user) throw new InboxError("인증이 필요합니다.", 401);
    if (
        req.method !== "GET" &&
        req.headers.get("origin") &&
        !sameRequestOrigin(req.headers.get("origin")!, req.nextUrl.origin)
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
                    error: error.issues[0]?.message ?? "입력값을 확인해주세요.",
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
export async function jsonBody(req: NextRequest) {
    const text = await req.text();
    if (text.length > 16000) throw new InboxError("요청이 너무 큽니다.", 413);
    return JSON.parse(text);
}
export function publicGuard(req: NextRequest, key: string) {
    if (!/^[a-f0-9]{48}$/.test(key))
        throw new InboxError("상담창을 찾을 수 없습니다.", 404);
    // 외부 사이트는 iframe으로 설치한다. API는 iframe과 같은 출처에서만 호출한다.
    const origin = req.headers.get("origin");
    if (origin && !sameRequestOrigin(origin, req.nextUrl.origin))
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
