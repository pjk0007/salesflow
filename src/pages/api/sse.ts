import type { NextApiRequest, NextApiResponse } from "next";
import { getUserFromRequest } from "@/lib/auth";
import { addClient, removeClient, sendHeartbeat } from "@/lib/sse";

// response buffering 비활성화
export const config = {
    api: { responseLimit: false },
};

export default function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== "GET") {
        return res.status(405).json({ success: false, error: "Method not allowed" });
    }

    const user = getUserFromRequest(req);
    if (!user) {
        return res.status(401).json({ success: false, error: "인증이 필요합니다." });
    }

    const partitionId = req.query.partitionId as string;
    const sessionId = (req.query.sessionId as string) || "";

    if (!partitionId) {
        return res.status(400).json({ success: false, error: "partitionId가 필요합니다." });
    }

    // SSE 헤더
    res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
    });

    // 연결 확인 이벤트
    res.write(`event: connected\ndata: ${JSON.stringify({ sessionId })}\n\n`);

    const client = { res, sessionId };
    addClient(partitionId, client);

    // 30초 heartbeat
    const heartbeatInterval = setInterval(() => {
        if (!sendHeartbeat(partitionId, client)) {
            clearInterval(heartbeatInterval);
        }
    }, 30000);

    // 연결 종료 처리
    const cleanup = () => {
        clearInterval(heartbeatInterval);
        removeClient(partitionId, client);
    };

    res.on("close", cleanup);
    res.on("error", cleanup);

    // request abort 처리
    req.on("close", cleanup);
}
