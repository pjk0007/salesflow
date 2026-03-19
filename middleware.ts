import { NextRequest, NextResponse } from "next/server";

const CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
};

export function middleware(req: NextRequest) {
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

// /api/v1/ 경로에만 적용
export const config = {
    matcher: "/api/v1/:path*",
};
