import type { NextApiRequest, NextApiResponse } from "next";
import { processEmailRepeatQueue } from "@/lib/email-automation";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== "POST") {
        return res.status(405).json({ success: false, error: "Method not allowed" });
    }

    // CRON_SECRET 검증
    const cronSecret = process.env.CRON_SECRET;
    if (!cronSecret) {
        return res.status(500).json({ success: false, error: "CRON_SECRET이 설정되지 않았습니다." });
    }

    const authHeader = req.headers.authorization;
    const token = authHeader?.replace("Bearer ", "") || (req.query.secret as string);

    if (token !== cronSecret) {
        return res.status(401).json({ success: false, error: "인증에 실패했습니다." });
    }

    try {
        const stats = await processEmailRepeatQueue();
        return res.status(200).json({ success: true, data: stats });
    } catch (error) {
        console.error("Email repeat queue error:", error);
        return res.status(500).json({ success: false, error: "처리에 실패했습니다." });
    }
}
