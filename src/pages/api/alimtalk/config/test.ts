import type { NextApiRequest, NextApiResponse } from "next";
import { getUserFromRequest } from "@/lib/auth";
import { NhnAlimtalkClient } from "@/lib/nhn-alimtalk";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== "POST") {
        return res.status(405).json({ success: false, error: "Method not allowed" });
    }

    const user = getUserFromRequest(req);
    if (!user) {
        return res.status(401).json({ success: false, error: "인증이 필요합니다." });
    }

    try {
        const { appKey, secretKey } = req.body;
        if (!appKey || !secretKey) {
            return res.status(400).json({ success: false, error: "appKey와 secretKey는 필수입니다." });
        }

        const client = new NhnAlimtalkClient(appKey, secretKey);
        const result = await client.listSenders({ pageNum: 1, pageSize: 1 });

        if (result.header.isSuccessful) {
            return res.status(200).json({
                success: true,
                data: {
                    connected: true,
                    senderCount: result.totalCount,
                },
            });
        }

        return res.status(200).json({
            success: false,
            error: `NHN Cloud 연결 실패: ${result.header.resultMessage}`,
        });
    } catch (error) {
        console.error("Alimtalk connection test error:", error);
        return res.status(200).json({
            success: false,
            error: "NHN Cloud 연결에 실패했습니다. API 키를 확인해주세요.",
        });
    }
}
