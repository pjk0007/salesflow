import type { NextApiRequest, NextApiResponse } from "next";
import { getUserFromRequest } from "@/lib/auth";
import { NhnEmailClient } from "@/lib/nhn-email";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== "POST") {
        return res.status(405).json({ success: false, error: "Method not allowed" });
    }

    const user = getUserFromRequest(req);
    if (!user) {
        return res.status(401).json({ success: false, error: "인증이 필요합니다." });
    }

    const { appKey, secretKey } = req.body;
    if (!appKey || !secretKey) {
        return res.status(400).json({ success: false, error: "appKey와 secretKey는 필수입니다." });
    }

    try {
        const client = new NhnEmailClient(appKey, secretKey);
        const today = new Date().toISOString().slice(0, 10) + " 00:00:00";
        const result = await client.queryMails({ startSendDate: today, endSendDate: today, pageNum: 1, pageSize: 1 });

        if (result.header.isSuccessful) {
            return res.status(200).json({ success: true, message: "연결 성공" });
        } else {
            return res.status(200).json({
                success: false,
                error: `연결 실패: ${result.header.resultMessage}`,
            });
        }
    } catch (error) {
        console.error("Email config test error:", error);
        return res.status(500).json({ success: false, error: "연결 테스트에 실패했습니다." });
    }
}
