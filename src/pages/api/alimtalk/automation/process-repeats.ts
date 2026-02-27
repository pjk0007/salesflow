import type { NextApiRequest, NextApiResponse } from "next";
import { processRepeatQueue } from "@/lib/alimtalk-automation";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== "POST") {
        return res.status(405).json({ success: false, error: "Method not allowed" });
    }

    // CRON_SECRET 검증
    const cronSecret = process.env.CRON_SECRET;
    if (cronSecret) {
        const authHeader = req.headers.authorization;
        const querySecret = req.query.secret;

        const provided = authHeader?.replace("Bearer ", "") || querySecret;
        if (provided !== cronSecret) {
            return res.status(401).json({ success: false, error: "Unauthorized" });
        }
    }

    try {
        const result = await processRepeatQueue();
        return res.status(200).json({ success: true, data: result });
    } catch (error) {
        console.error("Process repeats error:", error);
        return res.status(500).json({ success: false, error: "처리에 실패했습니다." });
    }
}
