import { after, type NextRequest } from "next/server";
import { rateLimit } from "@/lib/tracker/rate-limit";
import { OPEN_RATE_LIMIT } from "@/lib/email-open-rules";
import { PIXEL_GIF, PIXEL_HEADERS, verifiedOpenId } from "@/lib/email-open-pixel";
import { requestIp } from "@/lib/request-ip";
import { recordOpenSafely } from "@/lib/email-open-tracking";

function pixel(withBody: boolean): Response {   // export하지 않는다 (route.ts는 HTTP 메서드만 내보낸다)
    return new Response(withBody ? PIXEL_GIF : null, { status: 200, headers: PIXEL_HEADERS });
}

/** 메일 오픈 픽셀. 어떤 경우에도 200 + 43바이트 GIF (B6). 기록은 응답 뒤 after()에서 (B9) */
export function GET(req: NextRequest): Response {
    try {
        const sendLogId = verifiedOpenId(req.nextUrl.searchParams);
        // 서명을 먼저 본다 — 틀린 서명이 정상 발송의 레이트 칸을 채우지 못하게
        if (sendLogId !== null && rateLimit(`email-open:${sendLogId}`, OPEN_RATE_LIMIT).allowed) {
            const hit = { sendLogId, openedAt: new Date(), ip: requestIp(req.headers), userAgent: req.headers.get("user-agent") };
            after(() => recordOpenSafely(hit));
        }
    } catch (error) {
        console.error("[open-pixel] 요청 처리 실패: " + (error instanceof Error ? error.message : String(error)));
    }
    return pixel(true);
}

/** 같은 헤더만 주고 기록하지 않는다 (B8). 내보내지 않으면 Next가 HEAD를 GET으로 처리한다 */
export function HEAD(): Response {
    return pixel(false);
}
