import { NextRequest, NextResponse } from "next/server";
import { getUserFromNextRequest } from "@/lib/auth";
import { addClient, removeClient, sendHeartbeat } from "@/lib/sse";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
    const user = getUserFromNextRequest(req);
    if (!user) {
        return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    }

    const partitionId = req.nextUrl.searchParams.get("partitionId");
    const sessionId = req.nextUrl.searchParams.get("sessionId") || "";

    if (!partitionId) {
        return NextResponse.json({ success: false, error: "partitionId가 필요합니다." }, { status: 400 });
    }

    const stream = new ReadableStream({
        start(controller) {
            const encoder = new TextEncoder();

            // 연결 확인 이벤트
            controller.enqueue(encoder.encode(`event: connected\ndata: ${JSON.stringify({ sessionId })}\n\n`));

            // ServerResponse-like wrapper for sse.ts compatibility
            const resWrapper = {
                write(chunk: string) {
                    try {
                        controller.enqueue(encoder.encode(chunk));
                        return true;
                    } catch {
                        return false;
                    }
                },
            };

            const client = { res: resWrapper as any, sessionId };
            addClient(partitionId, client);

            // 30초 heartbeat
            const heartbeatInterval = setInterval(() => {
                if (!sendHeartbeat(partitionId, client)) {
                    clearInterval(heartbeatInterval);
                }
            }, 30000);

            // 연결 종료 처리
            req.signal.addEventListener("abort", () => {
                clearInterval(heartbeatInterval);
                removeClient(partitionId, client);
                try {
                    controller.close();
                } catch {
                    // already closed
                }
            });
        },
    });

    return new Response(stream, {
        headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache, no-transform",
            Connection: "keep-alive",
            "X-Accel-Buffering": "no",
        },
    });
}
