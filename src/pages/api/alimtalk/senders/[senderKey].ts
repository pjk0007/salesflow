import type { NextApiRequest, NextApiResponse } from "next";
import { getUserFromRequest } from "@/lib/auth";
import { getAlimtalkClient } from "@/lib/nhn-alimtalk";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== "DELETE") {
        return res.status(405).json({ success: false, error: "Method not allowed" });
    }

    const user = getUserFromRequest(req);
    if (!user) {
        return res.status(401).json({ success: false, error: "인증이 필요합니다." });
    }

    const client = await getAlimtalkClient(user.orgId);
    if (!client) {
        return res.status(400).json({ success: false, error: "알림톡 설정이 필요합니다." });
    }

    try {
        const senderKey = req.query.senderKey as string;
        if (!senderKey) {
            return res.status(400).json({ success: false, error: "senderKey는 필수입니다." });
        }

        const result = await client.deleteSender(senderKey);

        if (!result.header.isSuccessful) {
            return res.status(200).json({ success: false, error: result.header.resultMessage });
        }

        return res.status(200).json({
            success: true,
            message: "발신프로필이 삭제되었습니다.",
        });
    } catch (error) {
        console.error("Sender delete error:", error);
        return res.status(500).json({ success: false, error: "발신프로필 삭제에 실패했습니다." });
    }
}
