import { NextRequest, NextResponse } from "next/server";
import { InboxError } from "@/lib/inbox/errors";
import { publicChannel } from "@/lib/inbox/repository";
import { rateLimit } from "@/lib/tracker/rate-limit";
import { sameRequestOrigin } from "@/lib/inbox/rules";
export async function messengerHeaders(req: NextRequest, key: string) {
    if (!/^[a-f0-9]{48}$/.test(key))
        throw new InboxError("상담창을 찾을 수 없습니다.", 404);
    const channel = await publicChannel(key),
        origin = req.headers.get("origin");
    if (
        origin &&
        !sameRequestOrigin(origin, req.nextUrl.origin) &&
        !channel.allowedOrigins.includes(origin)
    )
        throw new InboxError(
            "이 사이트에는 상담창이 설치되어 있지 않습니다.",
            403,
        );
    const headers: Record<string, string> = {
        "Cache-Control": "no-store",
        Vary: "Origin",
        "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
        "Access-Control-Allow-Headers": "Authorization,Content-Type",
        "Access-Control-Max-Age": "600",
    };
    if (origin) headers["Access-Control-Allow-Origin"] = origin;
    const ip =
        req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "unknown";
    if (
        !rateLimit(`messenger:${key}:${ip}:${req.method}`, {
            maxRequests: req.method === "GET" ? 300 : 120,
            windowMs: 60000,
        }).allowed
    )
        throw new InboxError("잠시 후 다시 시도해주세요.", 429);
    return headers;
}
export function applyMessengerHeaders(
    response: NextResponse,
    headers: Record<string, string>,
) {
    for (const [key, value] of Object.entries(headers))
        response.headers.set(key, value);
    return response;
}
