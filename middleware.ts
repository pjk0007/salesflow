import { NextRequest, NextResponse } from "next/server";
import { PUBLIC_API_CORS_HEADERS as CORS_HEADERS } from "@/lib/public-api-cors";
import { isDevelopmentPreviewRuntime } from "./src/lib/development-runtime";

export function middleware(req: NextRequest) {
    if (req.nextUrl.pathname === "/dev-start" || req.nextUrl.pathname.startsWith("/dev-start/")) {
        if (!isDevelopmentPreviewRuntime(process.env)) {
            return new NextResponse("페이지를 찾을 수 없습니다.", {
                status: 404,
                headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" },
            });
        }
        return NextResponse.next();
    }
    // Preflight OPTIONS 요청 처리
    if (req.method === "OPTIONS") {
        return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
    }

    // 실제 요청에 CORS 헤더 추가
    const response = NextResponse.next();
    for (const [key, value] of Object.entries(CORS_HEADERS)) {
        response.headers.set(key, value);
    }
    return response;
}

// 개발 체험 자료는 지정된 개발 서비스에서만 제공한다.
export const config = {
    matcher: ["/api/v1/:path*", "/dev-start/:path*"],
};
